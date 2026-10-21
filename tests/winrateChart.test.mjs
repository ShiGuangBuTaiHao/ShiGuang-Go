import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function moduleUrl(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const { analysisRequestOrder, winrateSeries, mergeWinratePoints, visibleWinratePoints } = await import(moduleUrl('../src/components/analysis/winrateChartData.ts'))

test('the initial position is retained as the first chart point', () => {
  const points = [{ moveNumber: 0, black: 63.2, white: 36.8, scoreLead: 2.1 }]
  assert.deepEqual(winrateSeries(points, 'black'), [{ point: points[0], value: 63.2 }])
  assert.deepEqual(winrateSeries(points, 'white'), [{ point: points[0], value: 36.8 }])
})

test('both perspectives retain every analysed move instead of alternating points', () => {
  const points = [0, 1, 2, 3].map((moveNumber) => ({
    moveNumber,
    black: 70 - moveNumber,
    white: 30 + moveNumber,
    scoreLead: 3 - moveNumber,
  }))
  assert.deepEqual(winrateSeries(points, 'black').map(({ point }) => point.moveNumber), [0, 1, 2, 3])
  assert.deepEqual(winrateSeries(points, 'white').map(({ value }) => value), [30, 31, 32, 33])
})

test('chart data ignores malformed and out-of-order points', () => {
  const points = [
    { moveNumber: 2, black: 45, white: 55, scoreLead: -1 },
    { moveNumber: -1, black: 50, white: 50, scoreLead: 0 },
    { moveNumber: 0, black: 52, white: 48, scoreLead: 1 },
    { moveNumber: Number.NaN, black: 50, white: 50, scoreLead: 0 },
    { moveNumber: 1, black: Number.NaN, white: 50, scoreLead: 0 },
  ]
  assert.deepEqual(
    winrateSeries(points, 'black').map(({ point }) => point.moveNumber),
    [0, 2],
  )
})

test('current position results fill the initial move and replace stale duplicates', () => {
  const cached = [
    { moveNumber: 0, black: 34, white: 66, scoreLead: -0.8 },
    { moveNumber: 1, black: 40, white: 60, scoreLead: 1 },
  ]
  const fresh = { moveNumber: 0, black: 36, white: 64, scoreLead: -0.3 }
  const points = mergeWinratePoints(cached, fresh)
  assert.deepEqual(points, [fresh, cached[1]])
})

test('the position before move one and the position after move one remain distinct', () => {
  const points = [
    { moveNumber: 0, ply: 0, black: 34, white: 66, scoreLead: -0.8 },
    { moveNumber: 0, ply: 1, black: 35, white: 65, scoreLead: -0.4 },
  ]
  assert.deepEqual(winrateSeries(points, 'black').map(({ point }) => point.ply), [0, 1])
  assert.deepEqual(mergeWinratePoints(points, null), points)
})

test('live game history keeps future points out without dropping the initial position', () => {
  const points = [
    { moveNumber: 0, ply: 0, black: 50, white: 50, scoreLead: 0 },
    { moveNumber: 0, ply: 1, black: 49, white: 51, scoreLead: -0.2 },
    { moveNumber: 1, ply: 2, black: 48, white: 52, scoreLead: -0.4 },
  ]
  assert.deepEqual(visibleWinratePoints(points, 1), points.slice(0, 2))
})

test('initial position analysis is prioritized over the rest of a long path', () => {
  assert.deepEqual(analysisRequestOrder(['root', 'move 1', 'move 2', 'move 3']), ['root', 'move 3', 'move 2', 'move 1'])
})

test('engine-reported reversals are preserved in both perspectives', () => {
  const points = [
    { moveNumber: 191, black: 0.14, white: 99.86, scoreLead: -0.53, player: 'W' },
    { moveNumber: 192, black: 98, white: 2, scoreLead: 19.8, player: 'B' },
    { moveNumber: 193, black: 0.82, white: 99.18, scoreLead: -0.58, player: 'W' },
  ]
  assert.deepEqual(winrateSeries(points, 'black').map(({ value }) => value), [0.14, 98, 0.82])
  assert.deepEqual(winrateSeries(points, 'white').map(({ value }) => value), [99.86, 2, 99.18])
})

test('sparse analysis retains actual move numbers instead of renumbering points', () => {
  const points = [0, 190, 211].map((moveNumber) => ({
    moveNumber, black: 43, white: 57, scoreLead: -0.7,
  }))
  assert.deepEqual(winrateSeries(points, 'black').map(({ point }) => point.moveNumber), [0, 190, 211])
})
