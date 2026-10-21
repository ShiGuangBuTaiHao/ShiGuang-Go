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

const goUrl = moduleUrl('../src/domain/go.ts')
const scoring = await import(moduleUrl('../src/domain/scoring.ts', { './go': goUrl }))
const { kataGoScoreProposal } = await import(moduleUrl('../src/domain/kataGoScoreProposal.ts', { './scoring': moduleUrl('../src/domain/scoring.ts', { './go': goUrl }) }))

const komiService = readFileSync(new URL('../src/services/katago.ts', import.meta.url), 'utf8')
const start = komiService.search(/export function engineKomi/)
const end = komiService.indexOf('}', komiService.indexOf('{', start)) + 1
assert.ok(start >= 0 && end > start, 'engineKomi should exist in the KataGo service')
const { engineKomi } = await import(moduleUrlFromCode(komiService.slice(start, end)))

function moduleUrlFromCode(code) {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
}

test('analysis and final-score requests convert UI komi once and choose the engine rules', async () => {
  const calls = []
  const previousWindow = globalThis.window
  const previousInvoke = globalThis.__scoringTestInvoke
  globalThis.window = { __TAURI_INTERNALS__: {} }
  globalThis.__scoringTestInvoke = async (command, payload) => {
    calls.push({ command, request: payload.request })
    return {}
  }
  try {
    const stub = moduleUrlFromCode('export const invoke = (...args) => globalThis.__scoringTestInvoke(...args)')
    const service = await import(moduleUrl('../src/services/katago.ts', {
      '@tauri-apps/api/core': stub,
      '../domain/ai': moduleUrl('../src/domain/ai.ts'),
    }))
    for (const [rule, komi, expectedRule, expectedKomi] of [
      ['chinese', 3.75, 'chinese', 7.5],
      ['chinese', 0.5, 'chinese', 1],
      ['japanese-korean', 6.5, 'japanese', 6.5],
    ]) {
      await service.analyzePosition([], 'fast', 'normal', undefined, rule, komi)
      await service.finalScore([], rule, komi)
      for (const call of calls.splice(0)) {
        assert.equal(call.request.ruleSet, expectedRule)
        assert.equal(call.request.komi, expectedKomi)
      }
    }
    await service.analyzePosition([])
    await service.finalScore([])
    await service.finalScore([], 'japanese-korean')
    assert.deepEqual(calls.map(({ request }) => request.komi), [7.5, 7.5, 6.5])
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousInvoke === undefined) delete globalThis.__scoringTestInvoke
    else globalThis.__scoringTestInvoke = previousInvoke
  }
})

function analysis(scoreLead, moves = ['pass', 'D4']) {
  return {
    turnNumber: 120,
    rootInfo: { currentPlayer: 'B', visits: 5000, winrate: 0.72, scoreLead, scoreStdev: 2, utility: 0.5 },
    moveInfos: moves.map((move, order) => ({ move, order })),
    ownership: [],
    ownershipStdev: [],
    humanPolicy: [],
  }
}

test('KataGo pass suggests counting without requiring a settled score', () => {
  assert.deepEqual(kataGoScoreProposal(analysis(3.5)), { winner: 'black', scoreLead: 3.5 })
  assert.deepEqual(kataGoScoreProposal(analysis(-2.5)), { winner: 'white', scoreLead: -2.5 })
})

test('only a top pass candidate requests counting', () => {
  assert.equal(kataGoScoreProposal(analysis(3.5, ['D4', 'Q16'])), null)
  assert.equal(kataGoScoreProposal(analysis(3.5, ['D4', 'pass'])), null)
  assert.equal(kataGoScoreProposal(analysis(Number.NaN)), null)
})

test('KataGo final score accepts arbitrary decimal precision', () => {
  assert.equal(scoring.parseFinalScore('B+1.0'), 1)
  assert.equal(scoring.parseFinalScore('W+12.25'), -12.25)
  assert.equal(scoring.parseFinalScore('B+0'), 0)
  assert.equal(scoring.parseFinalScore('B+R'), null)
  assert.equal(scoring.parseFinalScore('B+-1'), null)
})

test('Chinese komi is converted from zi to engine points exactly once', () => {
  assert.equal(engineKomi('chinese', 3.75), 7.5)
  assert.equal(engineKomi('chinese', 0.5), 1)
  assert.equal(engineKomi('japanese-korean', 6.5), 6.5)
  assert.equal(engineKomi('aga', 7.5), 7.5)
})

test('position winner and lead share one perspective even if scoreLead has the wrong sign', () => {
  assert.deepEqual(scoring.positionScore(0.72, -4.2), { winner: 'white', lead: -4.2 })
  assert.deepEqual(scoring.positionScore(0.28, 4.2), { winner: 'black', lead: 4.2 })
  assert.deepEqual(scoring.positionScore(0.5, 0), { winner: null, lead: 0 })
  assert.deepEqual(scoring.positionScore(0.72, 4.2), { winner: 'black', lead: 4.2 })
})

test('terminal scores use the ruleset display unit without changing the winner', () => {
  assert.deepEqual(scoring.ruleAwareScore(9, 'chinese'), { margin: 9, displayMargin: 4.5, displayUnit: '子' })
  assert.deepEqual(scoring.ruleAwareScore(-41, 'japanese-korean'), { margin: -41, displayMargin: -41, displayUnit: '目' })
})

test('KataGo score preserves point margin and provenance without inventing totals', () => {
  const board = Array.from({ length: 19 }, () => Array(19).fill(null))
  board[3][3] = 'black'
  board[15][15] = 'white'
  const counted = scoring.calculateKataGoTerminalScore(board, 'B+2.5', ['15:15', '15:15'], { komi: 7.5, ruleSet: 'chinese' })
  assert.equal(counted.margin, 2.5)
  assert.equal(counted.engine, 'katago')
  assert.equal(counted.finalScore, 'B+2.5')
  assert.equal(counted.komi, 7.5)
  assert.equal('blackScore' in counted, false)
  assert.equal('whiteScore' in counted, false)
  assert.deepEqual(counted.deadStones, ['15:15'])
  assert.throws(() => scoring.calculateKataGoTerminalScore(board, 'invalid', []), /格式异常/)
  assert.throws(() => scoring.calculateKataGoTerminalScore(board, 'B+2.5', ['Q4']), /坐标/)
  assert.throws(() => scoring.calculateKataGoTerminalScore(board, 'B+2.5', ['0:0']), /坐标/)
})

test('Chinese point margins preserve quarter-zi results for both winners and draws', () => {
  for (const [points, zi] of [[0.5, '0.25'], [-0.5, '0.25'], [7.5, '3.75'], [-2.5, '1.25'], [9, '4.5'], [0, '0']]) {
    assert.equal(scoring.formatScoreMargin(points, 'chinese'), zi)
  }
  assert.equal(scoring.formatScoreMargin(-6.5, 'japanese-korean'), '6.5')
  assert.equal(scoring.formatScoreMargin(12, 'japanese-korean'), '12')
})

test('Chinese area and Japanese territory scores are recomputed, not converted by division', () => {
  const board = [
    ['black', 'black', 'black', null, 'white'],
    ['black', null, 'black', null, 'white'],
    ['black', 'black', 'black', null, 'white'],
    ['black', 'black', 'black', null, 'white'],
    ['black', 'black', 'black', null, 'white'],
  ]
  const options = { capturedByBlack: 3, capturedByWhite: 1 }
  const chinese = scoring.calculateScore(board, new Set(), engineKomi('chinese', 3.75), { ...options, ruleSet: 'chinese' })
  const japanese = scoring.calculateScore(board, new Set(), engineKomi('japanese-korean', 6.5), { ...options, ruleSet: 'japanese-korean' })
  assert.equal(chinese.blackStones, 14)
  assert.equal(chinese.blackTerritory, 1)
  assert.equal(chinese.margin, 2.5)
  assert.equal(scoring.formatScoreMargin(chinese.margin, 'chinese'), '1.25')
  assert.equal(japanese.blackScore, 4)
  assert.equal(japanese.whiteScore, 7.5)
  assert.equal(japanese.margin, -3.5)
})

test('dead prisoners count twice in Japanese territory scoring but captures never add Chinese area', () => {
  const board = [
    ['black', 'black', 'black', 'black', 'black'],
    ['black', 'white', null, null, 'black'],
    ['black', 'black', 'black', 'black', 'black'],
    ['black', null, 'black', null, 'black'],
    ['black', 'black', 'black', 'black', 'black'],
  ]
  const chinese = scoring.calculateScore(board, new Set(['1:1']), 0, { ruleSet: 'chinese', capturedByBlack: 9 })
  const japanese = scoring.calculateScore(board, new Set(['1:1']), 0, { ruleSet: 'japanese-korean', capturedByBlack: 9 })
  assert.equal(chinese.blackScore, 25)
  assert.equal(japanese.blackTerritory, 5)
  assert.equal(japanese.blackScore, 15)
})
