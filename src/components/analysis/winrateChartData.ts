import type { WinratePoint } from '../../services/katago'

export interface WinrateSeriesPoint {
  point: WinratePoint
  value: number
}

export function winratePly(point: WinratePoint): number {
  return Number.isFinite(point.ply) ? point.ply! : point.moveNumber
}

/** Display the pre-move position as move zero and each played move as one ply. */
export function displayMoveNumber(point: WinratePoint | null | undefined): number {
  return point ? winratePly(point) : 0
}

/** Keep every analysed position, including move zero, in chronological order. */
export function winrateSeries(
  points: readonly WinratePoint[],
  perspective: 'black' | 'white',
): WinrateSeriesPoint[] {
  const byPly = new Map<number, WinratePoint>()
  for (const point of points) {
    const ply = winratePly(point)
    if (!Number.isFinite(ply) || ply < 0) continue
    const value = perspective === 'black' ? point.black : point.white
    if (!Number.isFinite(value)) continue
    byPly.set(ply, point)
  }
  return [...byPly.values()]
    .sort((left, right) => winratePly(left) - winratePly(right))
    .map((point) => ({
      point,
      value: perspective === 'black' ? point.black : point.white,
    }))
}

/** Merge completed path analysis with the current position's fresh result. */
export function mergeWinratePoints(
  history: readonly WinratePoint[],
  current: WinratePoint | null | undefined,
): WinratePoint[] {
  return winrateSeries(current ? [...history, current] : history, 'black').map(({ point }) => point)
}

/** Remove points beyond the current game length before charting live play. */
export function visibleWinratePoints(
  points: readonly WinratePoint[],
  moveNumber: number,
): WinratePoint[] {
  return points.filter((point) => winratePly(point) <= moveNumber)
}

/** Analyze the chart origin first, then fill the current path backwards. */
export function analysisRequestOrder<T>(positions: readonly T[]): T[] {
  return positions.length > 1
    ? [positions[0], ...positions.slice(1).reverse()]
    : [...positions]
}
