import SabakiBoard from '@sabaki/go-board'
import { boardHash, cloneBoard, coordinateLabel, createBoard, positionFromCoordinate } from './go'
import type { RuleSet } from './gameSetup'
import type { BoardMark, BoardMarkType, ResearchNode, ResearchSnapshot, ResearchTree, VariationGraph } from '../types/research'
import type { Stone } from '../types/game'

export function researchId(prefix = 'node'): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function createResearchTree(boardSize = 19, ruleSet: RuleSet = 'chinese', komi = 3.75): ResearchTree {
  const id = researchId('root')
  return {
    rootId: id, currentNodeId: id, boardSize, komi, ruleSet, mode: 'play', dirty: false,
    title: '未命名研究', blackName: '黑方', whiteName: '白方',
    nodes: { [id]: {
      id, parentId: null, children: [], move: null, comment: '', marks: [], setup: false, properties: {},
      snapshot: { board: createBoard(boardSize), currentPlayer: 'black', moveNumber: 0, lastMove: null, capturedByBlack: 0, capturedByWhite: 0 },
    } },
  }
}

export function currentResearchNode(tree: ResearchTree): ResearchNode {
  return tree.nodes[tree.currentNodeId] ?? tree.nodes[tree.rootId]
}

export function researchPath(tree: ResearchTree, nodeId = tree.currentNodeId): ResearchNode[] {
  const path: ResearchNode[] = []
  let node: ResearchNode | undefined = tree.nodes[nodeId]
  while (node) {
    path.push(node)
    node = node.parentId ? tree.nodes[node.parentId] : undefined
  }
  return path.reverse()
}

export function selectResearchNode(tree: ResearchTree, nodeId: string): ResearchTree {
  return tree.nodes[nodeId] ? { ...tree, currentNodeId: nodeId } : tree
}

function replaceNode(tree: ResearchTree, node: ResearchNode): ResearchTree {
  return { ...tree, dirty: true, nodes: { ...tree.nodes, [node.id]: node } }
}

function appendNode(tree: ResearchTree, snapshot: ResearchSnapshot, move: ResearchNode['move']): ResearchTree {
  const parent = currentResearchNode(tree)
  const id = researchId()
  const node: ResearchNode = { id, parentId: parent.id, children: [], snapshot, move, comment: '', marks: [], setup: false, properties: {} }
  return {
    ...tree, dirty: true, currentNodeId: id,
    nodes: { ...tree.nodes, [parent.id]: { ...parent, children: [...parent.children, id] }, [id]: node },
  }
}

export function appendResearchMove(tree: ResearchTree, row: number, col: number): { tree: ResearchTree; error: string | null } {
  const parent = currentResearchNode(tree)
  const { board, currentPlayer: stone } = parent.snapshot
  if (!Number.isInteger(row) || !Number.isInteger(col) || board[row]?.[col] !== null) return { tree, error: '此处不能落子' }
  const existing = parent.children.map((id) => tree.nodes[id]).find((node) => !node.setup && node.move?.stone === stone && node.move.row === row && node.move.col === col)
  if (existing) return { tree: selectResearchNode(tree, existing.id), error: null }
  const sign = stone === 'black' ? 1 : -1
  const position = new SabakiBoard(board.map((line) => line.map((cell) => cell === 'black' ? 1 : cell === 'white' ? -1 : 0)))
  if (position.analyzeMove(sign, [col, row]).suicide) return { tree, error: '此手为自杀，不能落子' }
  const result = position.makeMove(sign, [col, row], { preventOverwrite: true, preventSuicide: true })
  const nextBoard = result.signMap.map((line) => line.map((cell): Stone | null => cell === 1 ? 'black' : cell === -1 ? 'white' : null))
  if (!parent.setup && parent.parentId && boardHash(tree.nodes[parent.parentId].snapshot.board) === boardHash(nextBoard)) return { tree, error: '此手违反打劫规则' }
  const snapshot: ResearchSnapshot = {
    board: nextBoard, currentPlayer: stone === 'black' ? 'white' : 'black', moveNumber: parent.snapshot.moveNumber + 1,
    lastMove: { row, col },
    capturedByBlack: parent.snapshot.capturedByBlack + (stone === 'black' ? result.getCaptures(1) : 0),
    capturedByWhite: parent.snapshot.capturedByWhite + (stone === 'white' ? result.getCaptures(-1) : 0),
  }
  return { tree: appendNode(tree, snapshot, { stone, row, col, coordinate: coordinateLabel(row, col, tree.boardSize) }), error: null }
}

export function appendResearchPass(tree: ResearchTree): ResearchTree {
  const node = currentResearchNode(tree)
  const existing = node.children.map((id) => tree.nodes[id]).find((child) => child.move?.pass && !child.setup && child.move.stone === node.snapshot.currentPlayer)
  if (existing) return selectResearchNode(tree, existing.id)
  return appendNode(tree, { ...node.snapshot, currentPlayer: node.snapshot.currentPlayer === 'black' ? 'white' : 'black', moveNumber: node.snapshot.moveNumber + 1, lastMove: null }, { stone: node.snapshot.currentPlayer, coordinate: 'pass', pass: true })
}

export function appendResearchVariation(tree: ResearchTree, coordinates: string[]): { tree: ResearchTree; error: string | null } {
  let next = tree
  for (const coordinate of coordinates) {
    if (coordinate.toLowerCase() === 'pass') { next = appendResearchPass(next); continue }
    const point = positionFromCoordinate(coordinate, tree.boardSize)
    if (!point || point.col >= tree.boardSize) return { tree, error: `无效落点：${coordinate}` }
    const result = appendResearchMove(next, point.row, point.col)
    if (result.error) return { tree, error: result.error }
    next = result.tree
  }
  return { tree: next, error: null }
}

export function deleteResearchVariation(tree: ResearchTree, nodeId: string): ResearchTree {
  const node = tree.nodes[nodeId]
  if (!node?.parentId) return tree
  const nodes = { ...tree.nodes }
  const pending = [nodeId]
  while (pending.length) {
    const id = pending.pop()!
    pending.push(...nodes[id].children)
    delete nodes[id]
  }
  const parent = nodes[node.parentId]
  nodes[parent.id] = { ...parent, children: parent.children.filter((id) => id !== nodeId) }
  return { ...tree, dirty: true, nodes, currentNodeId: nodes[tree.currentNodeId] ? tree.currentNodeId : parent.id }
}

export function promoteResearchVariation(tree: ResearchTree): ResearchTree {
  let next = tree
  for (const node of researchPath(tree).slice(1)) {
    const parent = next.nodes[node.parentId!]
    if (parent.children[0] !== node.id) next = replaceNode(next, { ...parent, children: [node.id, ...parent.children.filter((id) => id !== node.id)] })
  }
  return next
}

export function updateResearchComment(tree: ResearchTree, nodeId: string, comment: string): ResearchTree {
  const node = tree.nodes[nodeId]
  return !node || node.comment === comment ? tree : replaceNode(tree, { ...node, comment })
}

export function clearResearchMarks(tree: ResearchTree, nodeId: string): ResearchTree {
  const node = tree.nodes[nodeId]
  return node?.marks.length ? replaceNode(tree, { ...node, marks: [] }) : tree
}

export function addResearchPointMark(tree: ResearchTree, nodeId: string, type: BoardMarkType, row: number, col: number): ResearchTree {
  const node = tree.nodes[nodeId]
  if (!node || row < 0 || col < 0 || row >= tree.boardSize || col >= tree.boardSize) return tree
  const existing = node.marks.find((mark) => mark.row === row && mark.col === col)
  const marks: BoardMark[] = node.marks.filter((mark) => mark.row !== row || mark.col !== col)
  if (existing?.type !== type) marks.push({ id: researchId('mark'), type, row, col })
  return replaceNode(tree, { ...node, marks })
}

export function editResearchSetup(tree: ResearchTree, row: number, col: number, stone: Stone | null): ResearchTree {
  let node = currentResearchNode(tree)
  if (node.snapshot.board[row]?.[col] === undefined || node.snapshot.board[row][col] === stone) return tree
  let next = tree
  for (const id of node.children) next = deleteResearchVariation(next, id)
  node = currentResearchNode(next)
  const board = cloneBoard(node.snapshot.board)
  board[row][col] = stone
  return replaceNode(next, { ...node, setup: true, snapshot: { ...node.snapshot, board, lastMove: null } })
}

export function setResearchPlayer(tree: ResearchTree, stone: Stone): ResearchTree {
  const node = currentResearchNode(tree)
  if (node.snapshot.currentPlayer === stone) return tree
  let next = tree
  for (const id of node.children) next = deleteResearchVariation(next, id)
  return replaceNode(next, { ...currentResearchNode(next), setup: true, snapshot: { ...node.snapshot, currentPlayer: stone, lastMove: null } })
}

export function researchLine(tree: ResearchTree, preferred: Record<string, string>): ResearchNode[] {
  const path = researchPath(tree)
  let node = path.at(-1)!
  while (node.children.length) {
    node = tree.nodes[node.children.includes(preferred[node.id]) ? preferred[node.id] : node.children[0]]
    path.push(node)
  }
  return path
}

export function researchGraph(tree: ResearchTree): VariationGraph {
  const path = new Set(researchPath(tree).map((node) => node.id))
  const graph: VariationGraph = { nodes: [], edges: [], width: 0, height: 0 }
  let lane = 0
  const pending = [{ id: tree.rootId, depth: 0, lane: 0 }]
  while (pending.length) {
    const entry = pending.pop()!
    const node = tree.nodes[entry.id]
    const row = entry.lane < 0 ? ++lane : entry.lane
    graph.nodes.push({ id: node.id, x: 24 + row * 72, y: 24 + entry.depth * 56, label: node.move ? String(node.snapshot.moveNumber) : '·', stone: node.move?.stone ?? null, current: node.id === tree.currentNodeId, onPath: path.has(node.id), comment: Boolean(node.comment) })
    graph.width = Math.max(graph.width, 72 + row * 72)
    graph.height = Math.max(graph.height, 48 + entry.depth * 56)
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]
      graph.edges.push({ from: node.id, to: child, active: path.has(child) })
      pending.push({ id: child, depth: entry.depth + 1, lane: index === 0 ? row : -1 })
    }
  }
  return graph
}
