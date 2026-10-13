import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const packages = Object.fromEntries(['@sabaki/go-board', '@sabaki/sgf'].map((name) => [name, pathToFileURL(require.resolve(name)).href]))
function moduleUrl(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  for (const [specifier, url] of Object.entries({ ...packages, ...imports })) code = code.replaceAll(`'${specifier}'`, `'${url}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const goUrl = moduleUrl('../src/domain/go.ts')
const treeUrl = moduleUrl('../src/domain/researchTree.ts', { './go': goUrl })
const domain = await import(treeUrl)
const sgf = await import(moduleUrl('../src/domain/researchSgf.ts', { './go': goUrl, './researchTree': treeUrl }))
const { researchAnalysisPosition } = await import(moduleUrl('../src/domain/researchAnalysis.ts', { './go': goUrl, './researchTree': treeUrl }))
const { createResearchTree, appendResearchMove, appendResearchVariation, selectResearchNode, appendResearchPass, editResearchSetup, deleteResearchVariation, promoteResearchVariation, researchGraph, updateResearchComment, addResearchPointMark, setResearchPlayer } = domain

function play(tree, row, col) {
  const result = appendResearchMove(tree, row, col)
  assert.equal(result.error, null)
  return result.tree
}

test('moves are immutable and existing continuations are selected instead of duplicated', () => {
  const root = createResearchTree()
  let tree = play(root, 3, 3)
  const first = tree.currentNodeId
  assert.equal(root.nodes[root.rootId].snapshot.board[3][3], null)
  tree = selectResearchNode(tree, tree.rootId)
  const count = Object.keys(tree.nodes).length
  tree = play(tree, 3, 3)
  assert.equal(tree.currentNodeId, first)
  assert.equal(Object.keys(tree.nodes).length, count)
  assert.equal(appendResearchMove(tree, 3, 3).tree, tree)
})

test('capture and immediate ko are enforced by the research domain', () => {
  let tree = createResearchTree(9)
  for (const [row, col] of [[1, 2], [3, 2], [2, 1]]) tree = editResearchSetup(tree, row, col, 'black')
  for (const [row, col] of [[2, 2], [1, 3], [3, 3], [2, 4]]) tree = editResearchSetup(tree, row, col, 'white')
  tree = play(tree, 2, 3)
  assert.equal(tree.nodes[tree.currentNodeId].snapshot.board[2][2], null)
  assert.equal(tree.nodes[tree.currentNodeId].snapshot.capturedByBlack, 1)
  assert.match(appendResearchMove(tree, 2, 2).error, /打劫/)
  tree = appendResearchPass(appendResearchPass(tree))
  tree = play(tree, 2, 2)
  assert.equal(tree.nodes[tree.currentNodeId].snapshot.capturedByWhite, 1)
})

test('preview variation is atomic, handles passes and never changes the source tree', () => {
  const tree = createResearchTree()
  const result = appendResearchVariation(tree, ['D4', 'Q16', 'pass', 'Q4'])
  assert.equal(result.error, null)
  assert.equal(Object.keys(tree.nodes).length, 1)
  assert.equal(result.tree.nodes[result.tree.currentNodeId].snapshot.moveNumber, 4)
  assert.equal(appendResearchVariation(tree, ['D4', 'D4']).tree, tree)
  assert.equal(appendResearchVariation(tree, ['Z99']).tree, tree)
})

test('graph uses horizontal depth, distinct branch lanes, and marks the active path', () => {
  let tree = play(createResearchTree(), 3, 3)
  const first = tree.currentNodeId
  tree = play(tree, 15, 15)
  const main = tree.currentNodeId
  tree = play(selectResearchNode(tree, first), 15, 3)
  const branch = tree.currentNodeId
  const graph = researchGraph(tree)
  const mainNode = graph.nodes.find((node) => node.id === main)
  const branchNode = graph.nodes.find((node) => node.id === branch)
  assert.equal(mainNode.x, branchNode.x)
  assert.notEqual(mainNode.y, branchNode.y)
  assert.equal(branchNode.current, true)
  assert.equal(mainNode.onPath, false)
  tree = promoteResearchVariation(tree)
  assert.equal(tree.nodes[first].children[0], branch)
  assert.equal(tree.nodes[first].children[1], main)
})

test('setup removes only descendants and deletion preserves sibling branches', () => {
  let tree = play(createResearchTree(), 3, 3)
  const first = tree.currentNodeId
  tree = play(tree, 15, 15)
  const main = tree.currentNodeId
  tree = play(selectResearchNode(tree, first), 15, 3)
  const branch = tree.currentNodeId
  const source = tree
  tree = deleteResearchVariation(tree, branch)
  assert.equal(tree.currentNodeId, first)
  assert.ok(tree.nodes[main])
  assert.ok(source.nodes[branch])
  tree = editResearchSetup(tree, 9, 9, 'white')
  assert.deepEqual(tree.nodes[first].children, [])
  assert.ok(tree.nodes[tree.rootId])
  assert.equal(tree.nodes[first].setup, true)
})

test('marks toggle at a point and notes remain node-local', () => {
  let tree = createResearchTree()
  tree = addResearchPointMark(tree, tree.rootId, 'triangle', 3, 3)
  tree = updateResearchComment(tree, tree.rootId, 'Root note')
  tree = play(tree, 3, 3)
  assert.equal(tree.nodes[tree.currentNodeId].comment, '')
  tree = addResearchPointMark(tree, tree.rootId, 'circle', 3, 3)
  assert.equal(tree.nodes[tree.rootId].marks.length, 1)
  assert.equal(tree.nodes[tree.rootId].marks[0].type, 'circle')
  tree = addResearchPointMark(tree, tree.rootId, 'circle', 3, 3)
  assert.equal(tree.nodes[tree.rootId].marks.length, 0)
})

test('SGF roundtrip preserves branches, annotations, metadata, setup, player and exact komi', () => {
  const source = '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese]GN[Study]PB[Black]PW[White]EV[Event]AB[dd:ed]AW[pp]PL[W]C[Escaped \\] note]TR[dd]LB[ed:A](;W[pd]C[Main];B[dp])(;W[dp]C[Branch];B[]))'
  const tree = sgf.importResearchSgf(source)
  assert.equal(tree.komi, 3.75)
  assert.equal(tree.nodes[tree.rootId].snapshot.currentPlayer, 'white')
  assert.equal(tree.nodes[tree.rootId].snapshot.board[3][4], 'black')
  const roundtrip = sgf.importResearchSgf(sgf.exportResearchSgf(tree))
  assert.equal(roundtrip.nodes[roundtrip.rootId].children.length, 2)
  assert.equal(roundtrip.nodes[roundtrip.rootId].comment, 'Escaped ] note')
  assert.equal(roundtrip.nodes[roundtrip.rootId].properties.EV[0], 'Event')
  assert.deepEqual(roundtrip.nodes[roundtrip.rootId].snapshot, tree.nodes[tree.rootId].snapshot)
  assert.equal(roundtrip.nodes[roundtrip.rootId].marks.length, 2)
})

test('editing a setup position at a move node survives SGF roundtrip', () => {
  let tree = play(createResearchTree(), 3, 3)
  tree = editResearchSetup(tree, 10, 10, 'white')
  tree = setResearchPlayer(tree, 'black')
  const roundtrip = sgf.importResearchSgf(sgf.exportResearchSgf(tree))
  const node = roundtrip.nodes[roundtrip.nodes[roundtrip.rootId].children[0]]
  assert.deepEqual(node.snapshot.board, tree.nodes[tree.currentNodeId].snapshot.board)
  assert.equal(node.snapshot.currentPlayer, 'black')
})

test('a move in the SGF root is included in analysis and survives export without duplicate setup', () => {
  const tree = sgf.importResearchSgf('(;GM[1]SZ[19]B[dd];W[pp])')
  const request = researchAnalysisPosition(tree)
  assert.deepEqual(request.initialStones, [{ player: 'B', coordinate: 'D16' }])
  assert.equal(request.initialPlayer, 'W')
  const exported = sgf.exportResearchSgf(tree)
  assert.ok(!exported.includes('AB[dd]'))
  const again = sgf.importResearchSgf(exported)
  assert.equal(again.nodes[again.rootId].snapshot.board[3][3], 'black')
})

test('analysis requests use the latest setup as initial stones and only later moves', () => {
  let tree = play(createResearchTree(), 3, 3)
  tree = editResearchSetup(tree, 10, 10, 'white')
  const base = tree.currentNodeId
  tree = play(tree, 15, 15)
  const request = researchAnalysisPosition(tree)
  assert.equal(request.initialStones.length, 2)
  assert.deepEqual(request.moves, [{ player: 'W', coordinate: 'Q4' }])
  assert.equal(request.initialPlayer, 'W')
  assert.equal(request.turnNumber, 2)
  const before = researchAnalysisPosition(selectResearchNode(tree, base))
  assert.notEqual(request.signature, before.signature)
  tree = updateResearchComment(tree, tree.currentNodeId, 'Note')
  assert.equal(request.signature, researchAnalysisPosition(tree).signature)
})

test('SGF errors do not produce partial documents', () => {
  for (const contents of ['', '(;GM[1]', '(;GM[2])', '(;SZ[100])', '(;KM[NaN])', '(;B[zz])', '(;B[dd]W[pp])', '(;GM[1])(;GM[1])']) assert.throws(() => sgf.importResearchSgf(contents), contents)
})
