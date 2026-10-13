import { parse, stringify, tokenizeIter, type SgfNode } from '@sabaki/sgf'
import GoPosition from '@sabaki/go-board'
import type { RecordMetadata } from '../types/library'
import type { Board, Stone, GameSnapshot } from '../types/game'
import type { ResearchNode, ResearchTree, BoardMark } from '../types/research'

const alphabet = 'abcdefghijklmnopqrstuvwxyz'
const point = (value: string, size: number): [number, number] => {
  const x = alphabet.indexOf(value[0] ?? '')
  const y = alphabet.indexOf(value[1] ?? '')
  if (value.length !== 2 || x < 0 || y < 0 || x >= size || y >= size)
    throw new Error(`无效棋盘坐标：${value}`)
  return [x, y]
}
const vertex = (row: number, col: number) => `${alphabet[col]}${alphabet[row]}`
const stone = (sign: number): Stone | null =>
  sign === 1 ? 'black' : sign === -1 ? 'white' : null
const coordinate = (row: number, col: number, size: number) =>
  `${'ABCDEFGHJKLMNOPQRST'[col]}${size - row}`

export function readSgf(text: string): SgfNode[] {
  const input = text.replace(/^\uFEFF/, '').trim()
  if (!input.startsWith('(')) throw new Error('文件不是有效的 SGF 棋谱')
  // The parser is deliberately permissive; reject unfinished collections before import.
  let depth = 0, hasNode = false
  for (const token of tokenizeIter(input)) {
    if (token.type === 'invalid') throw new Error('SGF 文件格式不正确')
    if (token.type === 'semicolon') hasNode = true
    if (token.type === 'parenthesis') depth += token.value === '(' ? 1 : -1
    if (depth < 0) throw new Error('SGF 括号不匹配')
  }
  if (depth || !hasNode) throw new Error('SGF 文件未完整结束')
  const roots = parse(input)
  if (!roots.length) throw new Error('SGF 中没有棋谱')
  for (const root of roots) {
    if (root.data.GM?.[0] && root.data.GM[0] !== '1')
      throw new Error('仅支持围棋 SGF')
    const size = Number(root.data.SZ?.[0] ?? 19)
    if (![9, 13, 19].includes(size))
      throw new Error('目前支持 9、13、19 路方形棋盘')
    if (
      root.data.KM?.[0] !== undefined &&
      !Number.isFinite(Number(root.data.KM[0]))
    )
      throw new Error('棋谱贴目不是有效数字')
  }
  return roots
}

export function mainLine(root: SgfNode): SgfNode[] {
  const result: SgfNode[] = []
  let current: SgfNode | undefined = root
  while (current) {
    result.push(current)
    current = current.children[0]
  }
  return result
}

export function metadata(
  root: SgfNode,
  fallback = '未命名棋谱',
): RecordMetadata {
  const data = root.data
  const rules = (data.RU?.[0] ?? '').toLowerCase()
  return {
    title:
      data.GN?.[0]?.trim() ||
      (data.PB?.[0] && data.PW?.[0]
        ? `${data.PB[0]} vs ${data.PW[0]}`
        : fallback),
    black: data.PB?.[0] ?? '',
    white: data.PW?.[0] ?? '',
    blackRank: data.BR?.[0] ?? '',
    whiteRank: data.WR?.[0] ?? '',
    event: data.EV?.[0] ?? '',
    date: data.DT?.[0] ?? '',
    result: data.RE?.[0] ?? '',
    boardSize: Number(data.SZ?.[0] ?? 19),
    ruleSet: /japan|korea|日韩|日本/.test(rules)
      ? 'japanese-korean'
      : /aga/.test(rules)
        ? 'aga'
        : 'chinese',
    komi: Number(data.KM?.[0] ?? 0),
    moves: mainLine(root).filter((node) => node.data.B || node.data.W).length,
  }
}

function expandPoints(values: string[], size: number): [number, number][] {
  return values.flatMap((value) => {
    if (!value.includes(':')) return [point(value, size)]
    const [from, to] = value.split(':').map((value) => point(value, size))
    const result: [number, number][] = []
    for (let y = Math.min(from[1], to[1]); y <= Math.max(from[1], to[1]); y++) {
      for (let x = Math.min(from[0], to[0]); x <= Math.max(from[0], to[0]); x++)
        result.push([x, y])
    }
    return result
  })
}

export function applySgfNode(
  board: GoPosition,
  node: SgfNode,
  size: number,
): GoPosition {
  let next = board.clone()
  if (node.data.B && node.data.W)
    throw new Error('同一节点不能同时包含黑白两手')
  const move = node.data.B?.[0] ?? node.data.W?.[0]
  if (move !== undefined && move !== '' && !(move === 'tt' && size === 19)) {
    next = next.makeMove(node.data.B ? 1 : -1, point(move, size), {
      preventOverwrite: true,
      preventSuicide: true,
    })
  }
  for (const [key, sign] of [['AE', 0], ['AB', 1], ['AW', -1]] as const) {
    for (const location of expandPoints(node.data[key] ?? [], size)) next.set(location, sign)
  }
  if (node.data.PL && !['B', 'W'].includes(node.data.PL[0])) throw new Error('无效的执子方设置')
  return next
}

export interface PreviewPosition {
  board: Board
  lastMove: { row: number; col: number; stone: Stone } | null
  moveNumber: number
  comment: string
}
export function previewPositions(root: SgfNode): PreviewPosition[] {
  const size = metadata(root).boardSize
  let board = GoPosition.fromDimensions(size),
    moveNumber = 0
  return mainLine(root).map((node) => {
    board = applySgfNode(board, node, size)
    const move = node.data.B?.[0] ?? node.data.W?.[0]
    if (move !== undefined) moveNumber++
    const location = move && move !== 'tt' && !node.data.AB && !node.data.AW && !node.data.AE ? point(move, size) : null
    return {
      board: board.signMap.map((row) => row.map(stone)),
      lastMove: location
        ? {
            col: location[0],
            row: location[1],
            stone: node.data.B ? 'black' : 'white',
          }
        : null,
      moveNumber,
      comment: node.data.C?.[0] ?? '',
    }
  })
}

function readMarks(node: SgfNode, size: number): BoardMark[] {
  const marks: BoardMark[] = []
  for (const [key, type] of [
    ['CR', 'circle'],
    ['TR', 'triangle'],
    ['SQ', 'square'],
    ['MA', 'cross'],
  ] as const) {
    for (const [col, row] of expandPoints(node.data[key] ?? [], size))
      marks.push({ id: crypto.randomUUID(), type, row, col })
  }
  for (const label of node.data.LB ?? []) {
    const separator = label.indexOf(':')
    const [col, row] = point(label.slice(0, separator), size)
    marks.push({
      id: crypto.randomUUID(),
      type: 'label',
      row,
      col,
      text: label.slice(separator + 1),
    })
  }
  for (const arrow of node.data.AR ?? []) {
    const [a, b] = arrow.split(':').map((value) => point(value, size))
    marks.push({
      id: crypto.randomUUID(),
      type: 'arrow',
      from: { col: a[0], row: a[1] },
      to: { col: b[0], row: b[1] },
    })
  }
  return marks
}

export function sgfToResearch(
  root: SgfNode,
  path: number[] = [],
): ResearchTree {
  const info = metadata(root),
    nodes: Record<string, ResearchNode> = {}
  let count = 0
  const visit = (
    source: SgfNode,
    parent: ResearchNode | null,
    previous: GoPosition,
    depth = 0,
  ): string => {
    if (++count > 10000 || depth > 1500)
      throw new Error('棋谱过大：最多支持 10000 个节点和 1500 层变化')
    const id = crypto.randomUUID(),
      board = applySgfNode(previous, source, info.boardSize)
    const moveText = source.data.B?.[0] ?? source.data.W?.[0]
    const color: Stone = source.data.B ? 'black' : 'white'
    const location =
      moveText && moveText !== 'tt' ? point(moveText, info.boardSize) : null
    const node: ResearchNode = {
      id,
      parentId: parent?.id ?? null,
      children: [],
      sgfProperties: structuredClone(source.data),
      move:
        moveText === undefined
          ? null
          : {
              stone: color,
              pass: !location,
              row: location?.[1],
              col: location?.[0],
              coordinate: location
                ? coordinate(location[1], location[0], info.boardSize)
                : 'pass',
            },
      snapshot: {
        board: board.signMap.map((row) => row.map(stone)),
        currentPlayer:
          source.data.PL?.[0] === 'B'
            ? 'black'
            : source.data.PL?.[0] === 'W'
              ? 'white'
              : moveText !== undefined
                ? color === 'black'
                  ? 'white'
                  : 'black'
                : (parent?.snapshot.currentPlayer ??
                  (Number(source.data.HA?.[0] ?? 0) > 1 ? 'white' : 'black')),
        moveNumber:
          (parent?.snapshot.moveNumber ?? 0) + (moveText !== undefined ? 1 : 0),
        lastMove: location ? { row: location[1], col: location[0] } : null,
        capturedByBlack: board.getCaptures(1),
        capturedByWhite: board.getCaptures(-1),
      },
      comment: source.data.C?.[0] ?? '',
      marks: readMarks(source, info.boardSize),
      setup: Boolean(
        source.data.AB || source.data.AW || source.data.AE || source.data.PL,
      ),
      properties: structuredClone(source.data),
    }
    nodes[id] = node
    node.children = source.children.map((child) =>
      visit(child, node, board, depth + 1),
    )
    return id
  }
  const rootId = visit(root, null, GoPosition.fromDimensions(info.boardSize))
  let currentNodeId = rootId
  for (const index of path) {
    const child = nodes[currentNodeId].children[index]
    if (!child) break
    currentNodeId = child
  }
  return {
    rootId,
    currentNodeId,
    nodes,
    boardSize: info.boardSize,
    ruleSet: info.ruleSet,
    komi: info.ruleSet === 'chinese' ? info.komi / 2 : info.komi,
    mode: 'play',
    dirty: false,
    title: info.title,
    blackName: info.black,
    whiteName: info.white,
  }
}

export function researchNodePath(tree: ResearchTree): number[] {
  const path: number[] = []
  let current = tree.nodes[tree.currentNodeId]
  while (current.parentId) {
    const parent = tree.nodes[current.parentId]
    path.unshift(parent.children.indexOf(current.id))
    current = parent
  }
  return path
}

export function researchToSgf(
  tree: ResearchTree,
  info?: Partial<RecordMetadata>,
): string {
  const visit = (id: string): SgfNode => {
    const node = tree.nodes[id],
      data = structuredClone(node.sgfProperties ?? node.properties ?? {})
    for (const key of [
      'B',
      'W',
      'C',
      'CR',
      'TR',
      'SQ',
      'MA',
      'LB',
      'AR',
      'AB',
      'AW',
      'AE',
    ])
      delete data[key]
    if (node.move)
      data[node.move.stone === 'black' ? 'B' : 'W'] = [
        node.move.pass ? '' : vertex(node.move.row!, node.move.col!),
      ]
    if (node.comment) data.C = [node.comment]
    // Serialize setup as the difference from the position produced by this node's move.
    const parent = node.parentId ? tree.nodes[node.parentId] : null
    let expected = parent
      ? new GoPosition(
          parent.snapshot.board.map((row) =>
            row.map((value) =>
              value === 'black' ? 1 : value === 'white' ? -1 : 0,
            ),
          ),
        )
      : GoPosition.fromDimensions(tree.boardSize)
    if (node.move && !node.move.pass)
      expected = expected.makeMove(node.move.stone === 'black' ? 1 : -1, [
        node.move.col!,
        node.move.row!,
      ])
    node.snapshot.board.forEach((row, y) =>
      row.forEach((value, x) => {
        if (stone(expected.get([x, y])) === value) return
        const key = value === 'black' ? 'AB' : value === 'white' ? 'AW' : 'AE'
        ;(data[key] ??= []).push(vertex(y, x))
      }),
    )
    for (const mark of node.marks) {
      const key = {
        circle: 'CR',
        triangle: 'TR',
        square: 'SQ',
        cross: 'MA',
        label: 'LB',
        arrow: 'AR',
      }[mark.type]
      if (mark.type === 'arrow' && mark.from && mark.to)
        (data[key] ??= []).push(
          `${vertex(mark.from.row, mark.from.col)}:${vertex(mark.to.row, mark.to.col)}`,
        )
      else if (mark.row !== undefined && mark.col !== undefined)
        (data[key] ??= []).push(
          `${vertex(mark.row, mark.col)}${mark.type === 'label' ? `:${mark.text ?? ''}` : ''}`,
        )
    }
    return {
      id,
      parentId: node.parentId,
      data,
      children: node.children.map(visit),
    }
  }
  const root = visit(tree.rootId)
  Object.assign(root.data, {
    GM: ['1'],
    FF: ['4'],
    CA: ['UTF-8'],
    AP: ['ShiGuangGo:0.1'],
    SZ: [String(tree.boardSize)],
    KM: [String(tree.komi)],
  })
  if (!root.data.RU)
    root.data.RU = [
      tree.ruleSet === 'japanese-korean'
        ? 'Japanese'
        : tree.ruleSet === 'aga'
          ? 'AGA'
          : 'Chinese',
    ]
  const fields = {
    title: 'GN',
    black: 'PB',
    white: 'PW',
    blackRank: 'BR',
    whiteRank: 'WR',
    event: 'EV',
    date: 'DT',
    result: 'RE',
  } as const
  for (const [field, property] of Object.entries(fields)) {
    const value = info?.[field as keyof typeof fields]
    if (value !== undefined) {
      if (value) root.data[property] = [value]
      else delete root.data[property]
    }
  }
  return stringify([root])
}

export function updateSgfMetadata(text: string, info: RecordMetadata): string {
  const root = readSgf(text)[0]
  const fields = {
    GN: info.title,
    PB: info.black,
    PW: info.white,
    BR: info.blackRank,
    WR: info.whiteRank,
    EV: info.event,
    DT: info.date,
    RE: info.result,
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value) root.data[key] = [value]
    else delete root.data[key]
  }
  return stringify([root])
}

export function createSgf(info: Partial<RecordMetadata>): string {
  return stringify([
    {
      id: 'root',
      parentId: null,
      children: [],
      data: {
        GM: ['1'],
        FF: ['4'],
        CA: ['UTF-8'],
        GN: [info.title || '新建棋谱'],
        PB: [info.black ?? ''],
        PW: [info.white ?? ''],
        DT: [info.date ?? ''],
        EV: [info.event ?? ''],
        RE: [info.result ?? ''],
        BR: [info.blackRank ?? ''],
        WR: [info.whiteRank ?? ''],
        SZ: [String(info.boardSize ?? 19)],
        KM: [String(info.komi ?? 7.5)],
        RU: [
          info.ruleSet === 'japanese-korean'
            ? 'Japanese'
            : info.ruleSet === 'aga'
              ? 'AGA'
              : 'Chinese',
        ],
      },
    },
  ])
}

export function gameToSgf(snapshot: GameSnapshot, info: Partial<RecordMetadata>): string {
  const root = readSgf(createSgf(info))[0]
  const size = snapshot.board.length
  root.data.SZ = [String(size)]
  root.data.PL = [snapshot.moves[0]?.stone === 'white' ? 'W' : 'B']
  const result = snapshot.result
  if (result) {
    const winner = result.winner === 'black' ? 'B' : 'W'
    if (result.reason === 'resignation') root.data.RE = [`${winner}+R`]
    else if (result.reason === 'timeout') root.data.RE = [`${winner}+T`]
    else if (result.score) {
      if ('finalScore' in result.score) root.data.RE = [result.score.finalScore]
      else {
        const margin = Math.abs(result.score.margin)
        root.data.RE = [result.winner ? `${winner}+${margin}` : '0']
      }
    }
  }
  let parent = root
  snapshot.moves.forEach((move, index) => {
    let value = ''
    if (move.coordinate.toLowerCase() !== 'pass') {
      const col = 'ABCDEFGHJKLMNOPQRST'.indexOf(move.coordinate[0]?.toUpperCase()), row = size - Number(move.coordinate.slice(1))
      if (col < 0 || col >= size || !Number.isInteger(row) || row < 0 || row >= size) throw new Error('对局包含无效落子坐标')
      value = vertex(row, col)
    }
    const node: SgfNode = { id: `move-${index}`, parentId: parent.id, children: [], data: { [move.stone === 'black' ? 'B' : 'W']: [value] } }
    parent.children.push(node); parent = node
  })
  return stringify([root])
}

export async function sgfFingerprint(text: string): Promise<string> {
  const normalize = (node: SgfNode): unknown => ({
    data: Object.fromEntries(
      Object.keys(node.data)
        .sort()
        .filter((key) => key !== 'CA' && key !== 'AP')
        .map((key) => [key, node.data[key]]),
    ),
    children: node.children.map(normalize),
  })
  const bytes = new TextEncoder().encode(
    JSON.stringify(readSgf(text).map(normalize)),
  )
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function decodeSgfFile(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('单个文件不能超过 20 MB')
  const buffer = await file.arrayBuffer()
  const header = new TextDecoder('latin1').decode(buffer.slice(0, 4096))
  const encoding = /\bCA\[([^\]]+)\]/.exec(header)?.[1]
  if (encoding) return new TextDecoder(encoding, { fatal: true }).decode(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('无法确定文件编码，请使用 UTF-8，或在 SGF 中指定 CA 编码')
  }
}
