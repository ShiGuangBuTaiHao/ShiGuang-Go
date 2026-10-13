import { positionFromCoordinate } from './go'
import type { Board, RefereeGameScore } from '../types/game'
import type { GameSetup } from './gameSetup'
import type { GnuGoResult } from '../services/gnugo'

export function refereeKomi(setup: Pick<GameSetup, 'komi' | 'komiUnit'>): number {
  return setup.komiUnit === '子' ? setup.komi * 2 : setup.komi
}

export function createRefereeScore(
  result: GnuGoResult,
  board: Board,
  ruleSet: string,
  komi: number,
): RefereeGameScore {
  const finalScore = result.finalScore.trim().toUpperCase()
  const match = /^([BW])\+(\d+(?:\.\d+)?)$/.exec(finalScore)
  const margin = finalScore === '0' || finalScore === 'JIGO'
    ? 0
    : match ? Number(match[2]) * (match[1] === 'B' ? 1 : -1) : NaN
  if (!Number.isFinite(margin)) throw new Error('GNU Go 未返回有效的终局比分')
  const stoneKeys = (coordinates: string[]) => [...new Set(coordinates.map((coordinate) => {
    const point = positionFromCoordinate(coordinate)
    if (!point || !board[point.row]?.[point.col]) throw new Error('GNU Go 返回的棋子坐标无效')
    return `${point.row}:${point.col}`
  }))]
  return {
    engine: 'gnugo', finalScore, margin, komi, ruleSet,
    deadStones: stoneKeys(result.deadStones),
    sekiStones: stoneKeys(result.sekiStones),
  }
}
