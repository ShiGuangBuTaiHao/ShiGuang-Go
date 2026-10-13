import sgf, { type SgfNode } from '@sabaki/sgf'
import SabakiBoard from '@sabaki/go-board'
import { cloneBoard, coordinateLabel } from './go'
import { createResearchTree, researchId } from './researchTree'
import type { BoardMarkType, ResearchNode, ResearchTree } from '../types/research'
import type { Stone } from '../types/game'

const markProperties: Partial<Record<BoardMarkType, string>> = { circle: 'CR', triangle: 'TR', square: 'SQ', cross: 'MA', label: 'LB', arrow: 'AR' }
const managedProperties = ['B', 'W', 'C', 'CR', 'TR', 'SQ', 'MA', 'LB', 'AR', 'AB', 'AW', 'AE', 'PL']

function vertex(value: string, size: number): [number, number] {
  const point = sgf.parseVertex(value)
  if (point.some((n) => n < 0 || n >= size)) throw new Error(`无效的棋盘坐标：${value}`)
  return point
}

export function importResearchSgf(contents: string): ResearchTree {
  if (contents.length > 5_000_000) throw new Error('棋谱文件超过 5 MB')
  contents = contents.replace(/^\uFEFF/, '').trim()
  if (!contents.startsWith('(')) throw new Error('文件不是有效的 SGF 棋谱')
  let balance = 0
  let hasNode = false
  for (const token of sgf.tokenizeIter(contents)) {
    if (token.type === 'invalid') throw new Error('棋谱格式不正确')
    if (token.type === 'semicolon') hasNode = true
    if (token.type === 'parenthesis') balance += token.value === '(' ? 1 : -1
    if (balance < 0) throw new Error('棋谱括号不匹配')
  }
  if (balance || !hasNode) throw new Error('棋谱格式不完整')
  const roots = sgf.parse(contents)
  if (roots.length !== 1) throw new Error('请打开只包含一局的 SGF 文件')
  const root = roots[0]
  if (root.data.GM?.[0] && root.data.GM[0] !== '1') throw new Error('该文件不是围棋棋谱')
  const size = Number(root.data.SZ?.[0] ?? 19)
  if (![9, 13, 19].includes(size)) throw new Error('仅支持 9、13、19 路棋盘')
  const rules = root.data.RU?.[0]?.toLowerCase() ?? 'chinese'
  const ruleSet = /japan|korea/.test(rules) ? 'japanese-korean' : /aga/.test(rules) ? 'aga' : 'chinese'
  const engineKomi = Number(root.data.KM?.[0] ?? (ruleSet === 'japanese-korean' ? 6.5 : 7.5))
  if (!Number.isFinite(engineKomi)) throw new Error('棋谱贴目无效')
  const tree = createResearchTree(size, ruleSet, ruleSet === 'chinese' ? engineKomi / 2 : engineKomi)
  tree.title = root.data.GN?.[0] || '导入研究'
  tree.blackName = root.data.PB?.[0] || '黑方'
  tree.whiteName = root.data.PW?.[0] || '白方'
  const empty = tree.nodes[tree.rootId]
  tree.nodes = {}
  const pending: Array<{ parsed: SgfNode; parent: ResearchNode | null; depth: number }> = [{ parsed: root, parent: null, depth: 0 }]
  let count = 0
  while (pending.length) {
    if (++count > 10000) throw new Error('棋谱节点超过 10000 个')
    const { parsed, parent, depth } = pending.pop()!
    if (depth > 1500) throw new Error('棋谱变化超过 1500 层')
    const data = parsed.data
    const id = parent ? researchId() : tree.rootId
    const snapshot = { ...(parent ?? empty).snapshot, board: cloneBoard((parent ?? empty).snapshot.board) }
    const node: ResearchNode = { id, parentId: parent?.id ?? null, children: [], snapshot, move: null, comment: data.C?.[0] ?? '', marks: [], setup: false, properties: { ...data } }
    if (data.B && data.W) throw new Error('同一节点不能同时包含黑白落子')
    const moveColor: Stone | null = data.B ? 'black' : data.W ? 'white' : null
    if (moveColor) {
      const value = data[moveColor === 'black' ? 'B' : 'W'][0]
      const pass = value === '' || (size === 19 && value === 'tt')
      const sign = moveColor === 'black' ? 1 : -1
      if (!pass) {
        const [col, row] = vertex(value, size)
        const board = new SabakiBoard(snapshot.board.map((line) => line.map((cell) => cell === 'black' ? 1 : cell === 'white' ? -1 : 0)))
        const next = board.makeMove(sign, [col, row], { preventOverwrite: true, preventSuicide: true })
        snapshot.board = next.signMap.map((line) => line.map((cell): Stone | null => cell === 1 ? 'black' : cell === -1 ? 'white' : null))
        snapshot.capturedByBlack += moveColor === 'black' ? next.getCaptures(1) : 0
        snapshot.capturedByWhite += moveColor === 'white' ? next.getCaptures(-1) : 0
        snapshot.lastMove = { row, col }
        node.move = { stone: moveColor, row, col, coordinate: coordinateLabel(row, col, size) }
      } else {
        node.move = { stone: moveColor, pass: true, coordinate: 'pass' }
        snapshot.lastMove = null
      }
      snapshot.moveNumber += 1
      snapshot.currentPlayer = moveColor === 'black' ? 'white' : 'black'
    }
    for (const [property, stone] of [['AE', null], ['AB', 'black'], ['AW', 'white']] as const) {
      for (const value of data[property] ?? []) {
        for (const [col, row] of sgf.parseCompressedVertices(value)) {
          if (row < 0 || col < 0 || row >= size || col >= size) throw new Error(`无效的摆子坐标：${value}`)
          snapshot.board[row][col] = stone
        }
        node.setup = true
      }
    }
    if (data.PL) {
      if (!['B', 'W'].includes(data.PL[0])) throw new Error('棋谱执子设置无效')
      snapshot.currentPlayer = data.PL[0] === 'B' ? 'black' : 'white'
      node.setup = true
    } else if (!parent && Number(data.HA?.[0]) >= 2) {
      snapshot.currentPlayer = 'white'
      node.setup = true
    }
    if (node.setup) snapshot.lastMove = null
    for (const [type, property] of Object.entries(markProperties)) {
      for (const value of data[property] ?? []) {
        if (type === 'arrow') {
          const [from, to] = value.split(':')
          const [fc, fr] = vertex(from, size)
          const [tc, tr] = vertex(to, size)
          node.marks.push({ id: researchId('mark'), type: 'arrow', from: { row: fr, col: fc }, to: { row: tr, col: tc } })
        } else if (type === 'label') {
          const [col, row] = vertex(value.slice(0, 2), size)
          node.marks.push({ id: researchId('mark'), type: 'label', row, col, text: value.slice(3) })
        } else {
          for (const [col, row] of sgf.parseCompressedVertices(value)) {
            if (row < 0 || col < 0 || row >= size || col >= size) throw new Error('棋谱标记坐标无效')
            node.marks.push({ id: researchId('mark'), type: type as BoardMarkType, row, col })
          }
        }
      }
    }
    tree.nodes[id] = node
    parent?.children.push(id)
    for (let index = parsed.children.length - 1; index >= 0; index -= 1) pending.push({ parsed: parsed.children[index], parent: node, depth: depth + 1 })
  }
  return tree
}

export function exportResearchSgf(tree: ResearchTree): string {
  const converted: Record<string, SgfNode> = {}
  for (const node of Object.values(tree.nodes)) {
    const data = { ...node.properties }
    for (const property of managedProperties) delete data[property]
    if (node.comment) data.C = [node.comment]
    const move = node.move
    if (move) data[move.stone === 'black' ? 'B' : 'W'] = [move.pass ? '' : sgf.stringifyVertex([move.col!, move.row!])]
    if (node.id === tree.rootId || node.setup) {
      // Save setup as a delta after this node's move, preserving captures and branches.
      let before = node.parentId ? tree.nodes[node.parentId].snapshot.board : Array.from({ length: tree.boardSize }, () => Array<Stone | null>(tree.boardSize).fill(null))
      if (move && !move.pass) {
        const board = new SabakiBoard(before.map((line) => line.map((cell) => cell === 'black' ? 1 : cell === 'white' ? -1 : 0)))
        before = board.makeMove(move.stone === 'black' ? 1 : -1, [move.col!, move.row!]).signMap.map((line) => line.map((cell): Stone | null => cell === 1 ? 'black' : cell === -1 ? 'white' : null))
      }
      node.snapshot.board.forEach((line, row) => line.forEach((stone, col) => {
        if (stone === before[row][col]) return
        const property = stone === 'black' ? 'AB' : stone === 'white' ? 'AW' : 'AE'
        ;(data[property] ??= []).push(sgf.stringifyVertex([col, row]))
      }))
      data.PL = [node.snapshot.currentPlayer === 'black' ? 'B' : 'W']
    }
    for (const mark of node.marks) {
      const property = markProperties[mark.type]
      if (!property) continue
      let value = ''
      if (mark.type === 'arrow' && mark.from && mark.to) value = `${sgf.stringifyVertex([mark.from.col, mark.from.row])}:${sgf.stringifyVertex([mark.to.col, mark.to.row])}`
      else if (mark.row !== undefined && mark.col !== undefined) value = sgf.stringifyVertex([mark.col, mark.row]) + (mark.type === 'label' ? `:${mark.text ?? ''}` : '')
      if (value) (data[property] ??= []).push(value)
    }
    converted[node.id] = { id: node.id, parentId: node.parentId, data, children: [] }
  }
  for (const node of Object.values(tree.nodes)) converted[node.id].children = node.children.map((id) => converted[id])
  Object.assign(converted[tree.rootId].data, {
    GM: ['1'], FF: ['4'], CA: ['UTF-8'], AP: ['ShiguangGo'], SZ: [String(tree.boardSize)],
    KM: [String(tree.ruleSet === 'chinese' ? tree.komi * 2 : tree.komi)],
    RU: [tree.ruleSet === 'japanese-korean' ? 'Japanese' : tree.ruleSet === 'aga' ? 'AGA' : 'Chinese'],
    GN: [tree.title], PB: [tree.blackName], PW: [tree.whiteName],
  })
  return sgf.stringify([converted[tree.rootId]])
}
