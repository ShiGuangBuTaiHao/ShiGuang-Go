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

const { analysisRequestOrder, plyStone, winrateSeries, mergeWinratePoints, visibleWinratePoints, winrateViewport } = await import(moduleUrl('../src/components/analysis/winrateChartData.ts'))

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

test('the viewport width never exceeds the window however long the game runs', () => {
  const at = (total, size = 20) => winrateViewport([0, total].map((moveNumber) => ({ moveNumber, black: 50, white: 50, scoreLead: 0 })), size)
  assert.deepEqual(at(380), { min: 360, max: 381 })
  assert.deepEqual(at(200), { min: 180, max: 201 })
  // Once the game is longer than the window the span is pinned at window + 1.
  for (const size of [10, 20, 60, 100]) {
    const view = at(380, size)
    assert.equal(view.max - view.min, size + 1)
    assert.equal(view.max, 381)
  }
})

test('the viewport advances on every move so the appended point can animate', () => {
  const at = (total) => winrateViewport([0, total].map((moveNumber) => ({ moveNumber, black: 50, white: 50, scoreLead: 0 })), 20)
  // A frozen right edge makes ECharts map the new point onto its final pixel
  // immediately, so the update animation has nowhere to travel and the point
  // simply appears. `max` must move on the opening moves too.
  assert.deepEqual(at(0), { min: 0, max: 1 })
  assert.deepEqual(at(1), { min: 0, max: 2 })
  assert.deepEqual(at(20), { min: 0, max: 21 })
  assert.deepEqual(at(21), { min: 1, max: 22 })
  for (let ply = 1; ply <= 40; ply += 1) {
    assert.ok(at(ply).max > at(ply - 1).max, `max must advance at ply ${ply}`)
  }
})

test('the viewport never goes below move zero', () => {
  const at = (total) => winrateViewport([0, total].map((moveNumber) => ({ moveNumber, black: 50, white: 50, scoreLead: 0 })), 20)
  for (let ply = 0; ply <= 40; ply += 1) assert.ok(at(ply).min >= 0, `min must stay non-negative at ply ${ply}`)
})

test('an empty chart still has a usable x extent', () => {
  assert.deepEqual(winrateViewport([], 20), { min: 0, max: 1 })
})

test('a ply belongs to the side that just played it', () => {
  const point = (extra) => ({ moveNumber: 1, black: 50, white: 50, scoreLead: 0, ...extra })
  // No hint: the game alternates from Black, so odd plies are Black.
  assert.equal(plyStone(undefined, 1), 'black')
  assert.equal(plyStone(undefined, 2), 'white')
  assert.equal(plyStone(point({}), 7), 'black')
  // `player` is the side to move, so the stone just played is the other one.
  assert.equal(plyStone(point({ player: 'B' }), 4), 'white')
  assert.equal(plyStone(point({ player: 'W' }), 5), 'black')
  // The empty position before the first move belongs to nobody yet.
  assert.equal(plyStone(undefined, 0), 'black')
})

test('every other ply is labelled, and only one side ever is', () => {
  const labelsFor = (axisStone) => {
    const shown = []
    for (let ply = 1; ply <= 20; ply += 1) {
      const stone = ply % 2 === 1 ? 'black' : 'white'
      if (stone === axisStone) shown.push(ply)
    }
    return shown
  }
  assert.deepEqual(labelsFor('black'), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19])
  assert.deepEqual(labelsFor('white'), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
})

