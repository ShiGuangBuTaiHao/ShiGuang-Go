import type { Board, KataGoGameScore, Position, Stone, TerritoryMarker } from '../types/game'
import type { KataGoAnalysis } from '../services/katago'

export interface ScoreSummary {
  blackStones: number
  whiteStones: number
  blackTerritory: number
  whiteTerritory: number
  blackScore: number
  whiteScore: number
  blackCaptures: number
  whiteCaptures: number
  margin: number
  komi: number
  ruleSet: string
  deadStones: string[]
}

export interface ScoreOptions {
  ruleSet?: string
  capturedByBlack?: number
  capturedByWhite?: number
}

export interface StabilityAssessment {
  stable: boolean
  winner: Stone | null
  scoreLead: number
  scoreStdev: number
  finalMargin: number | null
  passGap: number | null
  unresolvedGroups: Position[][]
  unresolvedPoints: Position[]
  deadStones: Set<string>
  reasons: string[]
}

export interface StabilityOptions {
  deadStones?: Set<string>
  finalScore?: string
}

export interface KataGoTerminalScoreOptions {
  komi?: number
  ruleSet?: string
  capturedByBlack?: number
  capturedByWhite?: number
}

export interface PositionScore {
  winner: Stone | null
  /** Black's lead in points: positive means Black, negative means White. */
  lead: number
}

export interface RuleAwareScore {
  /** Territory difference: positive means Black, negative means White. */
  margin: number
  /** Human-facing result. Chinese zi is half the engine point margin. */
  displayMargin: number
  displayUnit: '子' | '目'
}

const directions: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
]

function key(row: number, col: number) {
  return `${row}:${col}`
}

function neighbors(board: Board, row: number, col: number) {
  const width = board[0]?.length ?? 0
  return directions
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter((point) => point.row >= 0 && point.col >= 0 && point.row < board.length && point.col < width)
}

function cloneWithoutDead(board: Board, deadStones: Set<string>) {
  return board.map((row, rowIndex) => row.map((stone, colIndex) => (deadStones.has(key(rowIndex, colIndex)) ? null : stone)))
}

export function collectGroup(board: Board, start: Position): Position[] {
  const color = board[start.row]?.[start.col]
  if (!color) return []
  const queue = [start]
  const visited = new Set<string>()
  const group: Position[] = []
  while (queue.length) {
    const point = queue.pop()!
    const pointKey = key(point.row, point.col)
    if (visited.has(pointKey)) continue
    visited.add(pointKey)
    if (board[point.row]?.[point.col] !== color) continue
    group.push(point)
    for (const next of neighbors(board, point.row, point.col)) {
      if (!visited.has(key(next.row, next.col))) queue.push(next)
    }
  }
  return group
}

export function inferDeadStones(board: Board, ownership: number[] | null | undefined, ownershipStdev: number[] | null | undefined) {
  const dead = new Set<string>()
  if (!ownership) return dead
  const width = board[0]?.length ?? 0
  const visited = new Set<string>()
  board.forEach((row, rowIndex) => row.forEach((stone, colIndex) => {
    const startKey = key(rowIndex, colIndex)
    if (!stone || visited.has(startKey)) return

    const group = collectGroup(board, { row: rowIndex, col: colIndex })
    group.forEach((point) => visited.add(key(point.row, point.col)))
    if (!group.length) return

    const estimates = group.map((point) => {
      const index = point.row * width + point.col
      const value = ownership[index] ?? 0
      const stdev = ownershipStdev?.[index] ?? 0
      return {
        fromStone: stone === 'black' ? value : -value,
        stdev,
      }
    })
    const averageOwnership = estimates.reduce((total, item) => total + item.fromStone, 0) / estimates.length
    const worstOwnership = Math.max(...estimates.map((item) => item.fromStone))
    const worstStdev = Math.max(...estimates.map((item) => item.stdev))

    // Judge whole groups only when the group's ownership agrees clearly and
    // the least-dead point is still strongly settled in the opponent's area.
    if (averageOwnership < -0.62 && worstOwnership < -0.42 && worstStdev < 0.3) {
      group.forEach((point) => dead.add(key(point.row, point.col)))
    }
  }))
  return dead
}

export function scoreTerritory(board: Board, deadStones: Set<string>): TerritoryMarker[] {
  const scoredBoard = cloneWithoutDead(board, deadStones)
  const visited = new Set<string>()
  const markers: TerritoryMarker[] = []
  scoredBoard.forEach((row, rowIndex) => row.forEach((stone, colIndex) => {
    const startKey = key(rowIndex, colIndex)
    if (stone || visited.has(startKey)) return
    const queue = [{ row: rowIndex, col: colIndex }]
    const region: Position[] = []
    const boundary = new Set<Stone>()
    visited.add(startKey)
    while (queue.length) {
      const point = queue.shift()!
      region.push(point)
      for (const next of neighbors(scoredBoard, point.row, point.col)) {
        const nextStone = scoredBoard[next.row][next.col]
        if (nextStone) boundary.add(nextStone)
        else if (!visited.has(key(next.row, next.col))) {
          visited.add(key(next.row, next.col))
          queue.push(next)
        }
      }
    }
    if (boundary.size !== 1) return
    const owner = [...boundary][0]
    region.forEach((point) => markers.push({ row: point.row, col: point.col, owner, confidence: 0.72, zone: 'sure' }))
  }))
  return markers
}

/** Local counting preview; komi and margin are always points, not Chinese zi. */
export function calculateScore(
  board: Board,
  deadStones: Set<string>,
  komi = 7.5,
  options: ScoreOptions = {},
): ScoreSummary {
  const scoredBoard = cloneWithoutDead(board, deadStones)
  const markers = scoreTerritory(board, deadStones)
  const blackStones = scoredBoard.flat().filter((stone) => stone === 'black').length
  const whiteStones = scoredBoard.flat().filter((stone) => stone === 'white').length
  const blackTerritory = markers.filter((marker) => marker.owner === 'black').length
  const whiteTerritory = markers.filter((marker) => marker.owner === 'white').length
  const blackCaptures = options.capturedByBlack ?? 0
  const whiteCaptures = options.capturedByWhite ?? 0
  const deadBlack = [...deadStones].filter((value) => {
    const [row, col] = value.split(':').map(Number)
    return board[row]?.[col] === 'black'
  }).length
  const deadWhite = [...deadStones].filter((value) => {
    const [row, col] = value.split(':').map(Number)
    return board[row]?.[col] === 'white'
  }).length
  const isTerritoryScoring = options.ruleSet === 'japanese-korean'
  const blackScore = isTerritoryScoring
    ? blackTerritory + blackCaptures + deadWhite
    : blackStones + blackTerritory
  const whiteScore = isTerritoryScoring
    ? whiteTerritory + whiteCaptures + deadBlack + komi
    : whiteStones + whiteTerritory + komi
  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    blackScore,
    whiteScore,
    blackCaptures,
    whiteCaptures,
    margin: blackScore - whiteScore,
    komi,
    ruleSet: options.ruleSet ?? 'chinese',
    deadStones: [...deadStones],
  }
}

function groupStability(
  board: Board,
  group: Position[],
  ownership: number[],
  ownershipStdev: number[],
): { alive: boolean; dead: boolean } {
  const width = board[0]?.length ?? 0
  const stone = board[group[0].row]?.[group[0].col]
  if (!stone || !group.length) return { alive: false, dead: false }
  const values = group.map((point) => {
    const index = point.row * width + point.col
    const ownershipValue = Number(ownership[index] ?? 0)
    return stone === 'black' ? ownershipValue : -ownershipValue
  })
  const stdev = Math.max(...group.map((point) => Number(ownershipStdev[point.row * width + point.col] ?? 0)))
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const leastCertain = Math.min(...values)
  return {
    alive: average >= 0.62 && leastCertain >= 0.38 && stdev <= 0.28,
    dead: average <= -0.62 && Math.max(...values) <= -0.42 && stdev <= 0.3,
  }
}

function emptyPointIsUnresolved(value: number, stdev: number): boolean {
  return Math.abs(value) < 0.62 && stdev > 0.2
}

export function parseFinalScore(value: string | undefined): number | null {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  if (normalized === '0' || normalized === 'JIGO') return 0
  const match = normalized.match(/^([BW])\s*\+\s*(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const margin = Number(match[2])
  return Number.isFinite(margin) ? (match[1] === 'B' ? margin : -margin) : null
}

/**
 * Preserve KataGo's proposed result without fabricating per-color totals.
 * GTP final_score can estimate an unfinished position; confirmation is separate.
 */
export function calculateKataGoTerminalScore(
  board: Board,
  finalScore: string,
  deadStones: Iterable<string>,
  options: KataGoTerminalScoreOptions = {},
): KataGoGameScore {
  const margin = parseFinalScore(finalScore)
  if (margin === null) throw new Error(`KataGo 终局分数格式异常：${finalScore}`)
  const dead = [...new Set(deadStones)]
  for (const value of dead) {
    if (!/^\d+:\d+$/.test(value)) throw new Error('KataGo 死子坐标无效')
    const [row, col] = value.split(':').map(Number)
    if (!board[row!]?.[col!]) throw new Error('KataGo 死子坐标未对应盘上棋子')
  }
  return {
    engine: 'katago',
    finalScore: finalScore.trim().toUpperCase(),
    margin,
    komi: options.komi ?? 7.5,
    ruleSet: options.ruleSet ?? 'chinese',
    deadStones: dead,
  }
}

/**
 * Decide whether KataGo has enough evidence to ask the player to count.
 * This deliberately errs on the side of continuing the game.
 */
export function assessPositionStability(
  board: Board,
  analysis: KataGoAnalysis,
  options: StabilityOptions = {},
): StabilityAssessment {
  const ownership = analysis.ownership ?? []
  const ownershipStdev = analysis.ownershipStdev ?? []
  const width = board[0]?.length ?? 0
  const deadStones = options.deadStones ?? inferDeadStones(board, ownership, ownershipStdev)
  const unresolvedGroups: Position[][] = []
  const visited = new Set<string>()

  board.forEach((row, rowIndex) => row.forEach((stone, colIndex) => {
    const groupKey = key(rowIndex, colIndex)
    if (!stone || visited.has(groupKey)) return
    const group = collectGroup(board, { row: rowIndex, col: colIndex })
    group.forEach((point) => visited.add(key(point.row, point.col)))
    const settled = groupStability(board, group, ownership, ownershipStdev)
    const wholeGroupDead = group.every((point) => deadStones.has(key(point.row, point.col)))
    if (!settled.alive && !(settled.dead && wholeGroupDead)) unresolvedGroups.push(group)
  }))

  const unresolvedPoints: Position[] = []
  board.forEach((row, rowIndex) => row.forEach((stone, colIndex) => {
    if (stone) return
    const index = rowIndex * width + colIndex
    if (emptyPointIsUnresolved(Number(ownership[index] ?? 0), Number(ownershipStdev[index] ?? 0))) {
      unresolvedPoints.push({ row: rowIndex, col: colIndex })
    }
  }))

  const scoreLead = Number(analysis.rootInfo.scoreLead)
  const scoreStdev = Number(analysis.rootInfo.scoreStdev ?? Number.POSITIVE_INFINITY)
  const finalMargin = parseFinalScore(options.finalScore)
  const pass = analysis.moveInfos.find((move) => move.move.trim().toLowerCase() === 'pass')
  const bestNonPass = analysis.moveInfos.find((move) => !['pass', 'resign'].includes(move.move.trim().toLowerCase()))
  const passGap = pass && bestNonPass ? Math.abs(pass.scoreLead - bestNonPass.scoreLead) : null
  const scoreStable = Number.isFinite(scoreLead)
    && Number.isFinite(scoreStdev)
    && scoreStdev <= 1.5
    && Math.abs(scoreLead) >= Math.max(2, scoreStdev * 2 + 0.5)
  const passStable = passGap === null || passGap <= 1
  const reasons: string[] = []
  if (options.finalScore && finalMargin === null) {
    reasons.push('KataGo 终局分数格式异常')
  }
  if (finalMargin !== null && finalMargin !== 0 && scoreLead !== 0 && Math.sign(finalMargin) !== Math.sign(scoreLead)) {
    reasons.push('终局分数与当前形势方向不一致')
  }
  if (unresolvedGroups.length) reasons.push(`${unresolvedGroups.length} 个棋块生死未定`)
  if (unresolvedPoints.length) reasons.push(`${unresolvedPoints.length} 个空点归属不稳定`)
  if (!scoreStable) reasons.push('预计分差仍有较大误差')
  if (!passStable) reasons.push('仍有明显优于停着的着法')
  const winner = scoreLead > 0 ? 'black' : scoreLead < 0 ? 'white' : null
  return {
    stable: unresolvedGroups.length === 0
      && unresolvedPoints.length === 0
      && scoreStable
      && passStable
      && winner !== null
      && (finalMargin === null || Math.sign(finalMargin) === Math.sign(scoreLead)),
    winner,
    scoreLead,
    scoreStdev,
    finalMargin,
    passGap,
    unresolvedGroups,
    unresolvedPoints,
    deadStones,
    reasons,
  }
}

/**
 * KataGo reports winrate from Black's perspective and scoreLead in points.
 * Keep both values on one authoritative scale so the winner label cannot
 * disagree with the score shown beside it.
 */
export function positionScore(
  winrate: number,
  scoreLead: number,
): PositionScore {
  const finiteWinrate = Number(winrate)
  const finiteLead = Number(scoreLead)
  const lead = Number.isFinite(finiteLead)
    ? finiteLead
    : Number.isFinite(finiteWinrate)
      ? (finiteWinrate - 0.5) * 100
      : 0
  return {
    winner: lead > 0 ? 'black' : lead < 0 ? 'white' : null,
    lead,
  }
}

/**
 * Convert a point margin for display, not between area and territory rules.
 * Re-evaluate with the other ruleset to obtain its score; dividing by two
 * only converts Chinese point differences to Chinese zi.
 */
export function ruleAwareScore(margin: number, ruleSet: string): RuleAwareScore {
  const original = Number(margin)
  const displayMargin = ruleSet === 'chinese' ? original / 2 : original
  return {
    margin: original,
    displayMargin,
    displayUnit: ruleSet === 'chinese' ? '子' : '目',
  }
}

/** Preserve quarter-zi results such as 0.25 and 3.75 without trailing zeros. */
export function formatScoreMargin(margin: number, ruleSet: string): string {
  return Number(Math.abs(ruleAwareScore(margin, ruleSet).displayMargin).toFixed(2)).toString()
}
