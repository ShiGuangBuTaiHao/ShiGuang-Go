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

/**
 * Keep the viewport width constant so density never changes with game length.
 * `max` tracks the newest analysed ply on every move, which keeps the
 * coordinate system moving and lets ECharts animate the newly appended point;
 * `min` trails one window behind and never goes below zero.
 *
 * A minimum extent of one move keeps the axis valid at ply zero while still
 * letting the first played move shift the frame, so the opening also animates.
 */
export function winrateViewport(
  points: readonly WinratePoint[],
  windowSize: number,
): { min: number; max: number } {
  const size = Math.max(1, Math.floor(windowSize))
  const latest = points.length ? Math.max(...points.map(winratePly)) : 0
  return { min: Math.max(0, latest - size), max: latest + 1 }
}

/**
 * Whose stone a plotted ply represents.
 *
 * A point's `player` is the side *to move* in that position, so the stone that
 * produced ply N is the opposite side. Without that hint the game is assumed to
 * alternate from Black, which makes odd plies Black and even plies White.
 */
export function plyStone(point: WinratePoint | undefined, ply: number): 'black' | 'white' {
  const rounded = Math.round(ply)
  if (rounded <= 0) return 'black'
  const toMove = point?.player
  if (toMove === 'B' || toMove === 'W') return toMove === 'B' ? 'white' : 'black'
  return rounded % 2 === 1 ? 'black' : 'white'
}

/** Analyze the chart origin first, then fill the current path backwards. */
export function analysisRequestOrder<T>(positions: readonly T[]): T[] {
  return positions.length > 1
    ? [positions[0], ...positions.slice(1).reverse()]
    : [...positions]
}
