import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

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
const { gnuGoTerritory, validateGnuGoEstimate, formatGnuGoLead, assessGnuGoScoringReadiness } = await import(moduleUrl('../src/domain/gnugoEstimate.ts', { './go': go }))

test('GNU Go region signs and extent classes are not KataGo probabilities', () => {
  const board = [[null, null, null, null, null, null, null, 'black', null]]
  const original = structuredClone(board)
  const markers = gnuGoTerritory(board, [-3, -2, -1, 0, 1, 2, 3, -4, 4])
  assert.equal(markers.length, 6)
  assert.deepEqual(markers.map(marker => marker.owner), ['black', 'black', 'black', 'white', 'white', 'white'])
  assert.deepEqual(markers.map(marker => marker.zone), ['sure', 'weak', 'contested', 'contested', 'weak', 'sure'])
  assert.deepEqual(board, original)
  assert.deepEqual(gnuGoTerritory(board, [3]), [])
})

test('invalid estimates and malformed board matrices are rejected', () => {
  const board = [[null, null]]
  const valid = { scoreLead: -7.5, scoreLowerBound: -10, scoreUpperBound: -2, influenceRegions: [0, 1] }
  assert.equal(validateGnuGoEstimate(valid, board), valid)
  for (const changed of [{ scoreLead: NaN }, { scoreLowerBound: 1 }, { influenceRegions: [0] }, { influenceRegions: [0, 5] }, { influenceRegions: [0, 0.5] }]) {
    assert.throws(() => validateGnuGoEstimate({ ...valid, ...changed }, board))
  }
})

test('estimate labels distinguish the leading side and equal score', () => {
  assert.equal(formatGnuGoLead(7.5), '预计黑方领先 7.5 目')
  assert.equal(formatGnuGoLead(-6.5), '预计白方领先 6.5 目')
  assert.equal(formatGnuGoLead(0), '预计双方持平')
})

test('prediction dead stones must identify occupied points without mutating the board', () => {
  const board = Array.from({ length: 19 }, () => Array(19).fill(null))
  board[15][3] = 'white'
  board[15][4] = 'white'
  board[3][3] = 'black'
  const original = structuredClone(board)
  const valid = { scoreLead: 1, scoreLowerBound: 1, scoreUpperBound: 1, influenceRegions: Array(361).fill(0), deadStones: ['D4', 'E4', 'D16'] }
  assert.equal(validateGnuGoEstimate(valid, board), valid)
  assert.deepEqual(board, original)
  for (const deadStones of [null, 'D4', [4], ['A1'], ['I4'], ['D20'], ['PASS'], ['D4\nquit']]) {
    assert.throws(() => validateGnuGoEstimate({ ...valid, deadStones }, board))
  }
})

test('counting requires an explicit complete readiness result, never just an empty overlay', () => {
  const ready = {
    scoreLead: 1, scoreLowerBound: 1, scoreUpperBound: 1, influenceRegions: [0],
    readiness: { ready: true, uncertainPoints: 0, unresolvedGroups: 0, blackMove: 'PASS', whiteMove: 'PASS', reasons: [] },
  }
  assert.equal(assessGnuGoScoringReadiness(ready).ready, true)
  for (const patch of [{ ready: false }, { uncertainPoints: 1 }, { unresolvedGroups: 1 }, { blackMove: 'D4' }, { reasons: ['仍有官子'] }]) {
    assert.equal(assessGnuGoScoringReadiness({ ...ready, readiness: { ...ready.readiness, ...patch } }).ready, false)
  }
  assert.equal(assessGnuGoScoringReadiness({ ...ready, scoreUpperBound: 3 }).ready, false)
  assert.throws(() => assessGnuGoScoringReadiness({ ...ready, readiness: null }))
})
