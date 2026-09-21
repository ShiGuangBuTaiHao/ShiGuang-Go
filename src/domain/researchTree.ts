import { applyMove, boardHash, cloneBoard, coordinateLabel, createBoard } from './go'
import type { RuleSet } from './gameSetup'
import type { Board, Stone } from '../types/game'
import type {
  BoardMark,
  BoardMarkType,
  ResearchMove,
  ResearchNode,
  ResearchSnapshot,
  ResearchTree,
} from '../types/research'

function nextPlayer(stone: Stone): Stone {
  return stone === 'black' ? 'white' : 'black'
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cloneSnapshot(snapshot: ResearchSnapshot): ResearchSnapshot {
  return {
    board: cloneBoard(snapshot.board),
    currentPlayer: snapshot.currentPlayer,
    moveNumber: snapshot.moveNumber,
    lastMove: snapshot.lastMove ? { ...snapshot.lastMove } : null,
    capturedByBlack: snapshot.capturedByBlack,
    capturedByWhite: snapshot.capturedByWhite,
  }
}

function cloneNode(node: ResearchNode): ResearchNode {
  return {
    ...node,
    children: [...node.children],
    snapshot: cloneSnapshot(node.snapshot),
    move: node.move ? { ...node.move } : null,
    marks: node.marks.map((mark) => ({
      ...mark,
      from: mark.from ? { ...mark.from } : undefined,
      to: mark.to ? { ...mark.to } : undefined,
    })),
  }
}

function cloneTree(tree: ResearchTree): ResearchTree {
  return {
    ...tree,
    nodes: Object.fromEntries(Object.entries(tree.nodes).map(([id, node]) => [id, cloneNode(node)])),
  }
}

function createRootNode(boardSize: number): ResearchNode {
  return {
    id: makeId('root'),
    parentId: null,
    children: [],
    move: null,
    snapshot: {
      board: createBoard(boardSize),
      currentPlayer: 'black',
      moveNumber: 0,
      lastMove: null,
      capturedByBlack: 0,
      capturedByWhite: 0,
    },
    comment: '',
    marks: [],
  }
}

export function createResearchTree(
  boardSize = 19,
  ruleSet: RuleSet = 'chinese',
  komi = 3.75,
): ResearchTree {
  const root = createRootNode(boardSize)
  return {
    rootId: root.id,
    currentNodeId: root.id,
    nodes: { [root.id]: root },
    boardSize,
    komi,
    ruleSet,
    mode: 'play',
    dirty: false,
  }
}

export function currentResearchNode(tree: ResearchTree): ResearchNode {
  return tree.nodes[tree.currentNodeId] ?? tree.nodes[tree.rootId]
}

export function researchPath(tree: ResearchTree, nodeId = tree.currentNodeId): ResearchNode[] {
  const path: ResearchNode[] = []
  let cursor = tree.nodes[nodeId]
  while (cursor) {
    path.unshift(cursor)
    if (!cursor.parentId) break
    cursor = tree.nodes[cursor.parentId]
  }
  return path
}

function hasSimpleKo(tree: ResearchTree, parent: ResearchNode, nextBoard: Board): boolean {
  if (!parent.parentId) return false
  const grandparent = tree.nodes[parent.parentId]
  return Boolean(grandparent && boardHash(grandparent.snapshot.board) === boardHash(nextBoard))
}

function appendNode(tree: ResearchTree, parent: ResearchNode, move: ResearchMove, snapshot: ResearchSnapshot): ResearchTree {
  const next = cloneTree(tree)
  const node: ResearchNode = {
    id: makeId('node'),
    parentId: parent.id,
    children: [],
    move,
    snapshot,
    comment: '',
    marks: [],
  }
  next.nodes[node.id] = node
  next.nodes[parent.id].children.push(node.id)
  next.currentNodeId = node.id
  next.dirty = true
  return next
}

export function appendResearchMove(tree: ResearchTree, row: number, col: number): { tree: ResearchTree; error: string | null } {
  const parent = currentResearchNode(tree)
  const stone = parent.snapshot.currentPlayer
  const result = applyMove(parent.snapshot.board, row, col, stone)
  if (!result) return { tree, error: '此处不能落子' }
  if (hasSimpleKo(tree, parent, result.board)) return { tree, error: '此手违反打劫规则' }

  const snapshot: ResearchSnapshot = {
    board: result.board,
    currentPlayer: nextPlayer(stone),
    moveNumber: parent.snapshot.moveNumber + 1,
    lastMove: { row, col },
    capturedByBlack: parent.snapshot.capturedByBlack + (stone === 'black' ? result.captured : 0),
    capturedByWhite: parent.snapshot.capturedByWhite + (stone === 'white' ? result.captured : 0),
  }
  return {
    tree: appendNode(tree, parent, { stone, row, col, coordinate: coordinateLabel(row, col, tree.boardSize) }, snapshot),
    error: null,
  }
}

export function appendResearchPass(tree: ResearchTree): ResearchTree {
  const parent = currentResearchNode(tree)
  const stone = parent.snapshot.currentPlayer
  return appendNode(tree, parent, {
    stone,
    coordinate: 'pass',
    pass: true,
  }, {
    ...cloneSnapshot(parent.snapshot),
    currentPlayer: nextPlayer(stone),
    moveNumber: parent.snapshot.moveNumber + 1,
    lastMove: null,
  })
}

export function selectResearchNode(tree: ResearchTree, nodeId: string): ResearchTree {
  if (!tree.nodes[nodeId]) return tree
  return { ...tree, currentNodeId: nodeId }
}

export function deleteResearchVariation(tree: ResearchTree, nodeId: string): ResearchTree {
  const node = tree.nodes[nodeId]
  if (!node || node.id === tree.rootId) return tree
  const next = cloneTree(tree)
  const parent = node.parentId ? next.nodes[node.parentId] : null
  if (parent) parent.children = parent.children.filter((childId) => childId !== nodeId)

  const remove = (id: string) => {
    next.nodes[id]?.children.forEach(remove)
    delete next.nodes[id]
  }
  remove(nodeId)
  if (!next.nodes[next.currentNodeId]) next.currentNodeId = parent?.id ?? next.rootId
  next.dirty = true
  return next
}

export function updateResearchComment(tree: ResearchTree, nodeId: string, comment: string): ResearchTree {
  if (!tree.nodes[nodeId]) return tree
  const next = cloneTree(tree)
  next.nodes[nodeId].comment = comment
  next.dirty = true
  return next
}

export function addResearchMark(tree: ResearchTree, nodeId: string, mark: Omit<BoardMark, 'id'>): ResearchTree {
  if (!tree.nodes[nodeId]) return tree
  const next = cloneTree(tree)
  next.nodes[nodeId].marks.push({ ...mark, id: makeId('mark') })
  next.dirty = true
  return next
}

export function clearResearchMarks(tree: ResearchTree, nodeId: string): ResearchTree {
  if (!tree.nodes[nodeId]) return tree
  const next = cloneTree(tree)
  next.nodes[nodeId].marks = []
  next.dirty = true
  return next
}

export function editResearchSetup(
  tree: ResearchTree,
  row: number,
  col: number,
  stone: Stone | null,
): ResearchTree {
  const current = tree.nodes[tree.currentNodeId]
  if (!current || !current.snapshot.board[row]?.length || col < 0 || col >= current.snapshot.board.length) return tree

  const next = cloneTree(tree)
  const node = next.nodes[next.currentNodeId]
  node.snapshot.board[row][col] = stone
  node.snapshot.lastMove = null
  node.children.forEach((childId) => deleteResearchSubtree(next.nodes, childId))
  node.children = []
  next.dirty = true
  return next
}

function deleteResearchSubtree(nodes: Record<string, ResearchNode>, nodeId: string) {
  nodes[nodeId]?.children.forEach((childId) => deleteResearchSubtree(nodes, childId))
  delete nodes[nodeId]
}

export function addResearchPointMark(
  tree: ResearchTree,
  nodeId: string,
  type: BoardMarkType,
  row: number,
  col: number,
): ResearchTree {
  if (!tree.nodes[nodeId]) return tree
  return addResearchMark(tree, nodeId, { type, row, col })
}
