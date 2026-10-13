import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// Load the pure domain modules without introducing a second test framework.
function moduleUrl(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  for (const [specifier, url] of Object.entries(imports)) {
    code = code.replaceAll(`'${specifier}'`, `'${url}'`)
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const go = moduleUrl('../src/domain/go.ts')
const { createRefereeScore, refereeKomi } = await import(moduleUrl('../src/domain/referee.ts', { './go': go }))
const { applyGameCommand, createInitialSnapshot, resumeAfterAdjudication } = await import(
  moduleUrl('../src/domain/gameSession.ts', { './go': go }),
)

test('Chinese zi komi converts to points without rounding', () => {
  assert.equal(refereeKomi({ komi: 3.75, komiUnit: '子' }), 7.5)
  assert.equal(refereeKomi({ komi: 6.5, komiUnit: '目' }), 6.5)
})

test('the engine point margin is authoritative, including draws', () => {
  const board = createInitialSnapshot().board
  const result = { finalScore: 'W+12.5', deadStones: [], sekiStones: [] }
  assert.equal(createRefereeScore(result, board, 'chinese', 7.5).margin, -12.5)
  assert.equal(createRefereeScore({ ...result, finalScore: 'B+2.25' }, board, 'chinese', 7.5).margin, 2.25)
  assert.equal(createRefereeScore({ ...result, finalScore: '0' }, board, 'chinese', 0).margin, 0)
  for (const finalScore of ['B+R', 'W+NaN', 'B+-3', 'unknown', '']) {
    assert.throws(() => createRefereeScore({ ...result, finalScore }, board, 'chinese', 7.5))
  }
})

test('dead coordinates must point to existing stones; proposal never mutates board', () => {
  const board = createInitialSnapshot().board
  board[15][3] = 'black'
  const original = structuredClone(board)
  const result = { finalScore: 'W+4.5', deadStones: ['D4', 'D4'], sekiStones: [] }
  const score = createRefereeScore(result, board, 'chinese', 7.5)
  assert.deepEqual(score.deadStones, ['15:3'])
  assert.deepEqual(board, original)
  assert.throws(() => createRefereeScore({ ...result, deadStones: ['A1'] }, board, 'chinese', 7.5))
})

test('cancelling after two passes preserves position, next player and move history', () => {
  const initial = createInitialSnapshot()
  const placed = applyGameCommand(initial, { type: 'place', row: 15, col: 3 }).event.snapshot
  const firstPass = applyGameCommand(placed, { type: 'pass' }).event.snapshot
  const secondPass = applyGameCommand(firstPass, { type: 'pass' }).event.snapshot
  assert.equal(secondPass.status, 'finished')
  const resumed = resumeAfterAdjudication(secondPass)
  assert.equal(resumed.status, 'playing')
  assert.equal(resumed.consecutivePasses, 0)
  assert.equal(resumed.result, null)
  assert.equal(resumed.currentPlayer, secondPass.currentPlayer)
  assert.deepEqual(resumed.board, secondPass.board)
  assert.deepEqual(resumed.moves, secondPass.moves)
  assert.equal(resumed.moveNumber, secondPass.moveNumber)
  const nextPass = applyGameCommand(resumed, { type: 'pass' }).event.snapshot
  assert.equal(nextPass.status, 'playing')
  assert.equal(nextPass.consecutivePasses, 1)
  assert.equal(secondPass.status, 'finished')
})

test('confirmed referee result finishes the game and cannot be resumed', () => {
  const current = createInitialSnapshot()
  const score = createRefereeScore({ finalScore: 'W+7.5', deadStones: [], sekiStones: [] }, current.board, 'chinese', 7.5)
  const finished = applyGameCommand(current, { type: 'score', winner: 'white', score }).event.snapshot
  assert.equal(finished.result.winner, 'white')
  assert.equal(finished.result.score.engine, 'gnugo')
  assert.equal(finished.result.score.finalScore, 'W+7.5')
  assert.equal(resumeAfterAdjudication(finished), null)
  assert.equal(applyGameCommand(finished, { type: 'place', row: 1, col: 1 }).event, null)
})
