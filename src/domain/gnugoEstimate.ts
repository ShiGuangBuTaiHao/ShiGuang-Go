import type { Board, TerritoryMarker } from '../types/game'
import type { GnuGoEstimate } from '../services/gnugo'
import { positionFromCoordinate } from './go'

export function validateGnuGoEstimate(result: GnuGoEstimate, board: Board): GnuGoEstimate {
  if (![result.scoreLead, result.scoreLowerBound, result.scoreUpperBound].every(Number.isFinite)
    || result.scoreLowerBound > result.scoreUpperBound
    || result.influenceRegions.length !== board.length * (board[0]?.length ?? 0)
    || result.influenceRegions.some((value) => !Number.isInteger(value) || value < -4 || value > 4)) {
    throw new Error('GNU Go 返回的形势数据无效')
  }
  if (result.deadStones !== undefined && (!Array.isArray(result.deadStones)
    || result.deadStones.some((coordinate) => {
      const point = typeof coordinate === 'string' ? positionFromCoordinate(coordinate, board.length) : null
      return !point || !board[point.row]?.[point.col]
    }))) {
    throw new Error('GNU Go 返回的死子数据无效')
  }
  return result
}

export function gnuGoTerritory(board: Board, regions: number[]): TerritoryMarker[] {
  const width = board[0]?.length ?? 0
  if (regions.length !== board.length * width) return []
  return board.flatMap((row, rowIndex) => row.flatMap((stone, colIndex): TerritoryMarker[] => {
    const region = regions[rowIndex * width + colIndex]
    const extent = Math.abs(region)
    if (stone || !Number.isInteger(region) || extent < 1 || extent > 3) return []
    // Region classes are influence categories, not ownership probabilities.
    return [{
      row: rowIndex, col: colIndex, owner: region < 0 ? 'black' : 'white',
      zone: extent === 3 ? 'sure' : extent === 2 ? 'weak' : 'contested',
      confidence: extent === 3 ? 1 : extent === 2 ? 0.65 : 0.4,
    }]
  }))
}

export function formatGnuGoLead(lead: number): string {
  return lead === 0 ? '预计双方持平' : `预计${lead > 0 ? '黑方' : '白方'}领先 ${Math.abs(lead).toFixed(1)} 目`
}

export function assessGnuGoScoringReadiness(result: GnuGoEstimate): { ready: boolean; reasons: string[] } {
  const status = result.readiness
  if (!status || typeof status.ready !== 'boolean'
    || !Number.isInteger(status.uncertainPoints) || status.uncertainPoints < 0
    || !Number.isInteger(status.unresolvedGroups) || status.unresolvedGroups < 0
    || !Array.isArray(status.reasons) || status.reasons.some((reason) => typeof reason !== 'string')) {
    throw new Error('GNU Go 未返回有效的收官检查结果')
  }
  const ready = status.ready && status.uncertainPoints === 0 && status.unresolvedGroups === 0
    && status.blackMove === 'PASS' && status.whiteMove === 'PASS'
    && status.reasons.length === 0
    && result.scoreUpperBound - result.scoreLowerBound <= 0.1
  return { ready, reasons: ready ? [] : status.reasons.length ? status.reasons : ['局面仍有不确定因素，请继续对局'] }
}
