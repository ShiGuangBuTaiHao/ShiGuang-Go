import type { Board, Stone, TerritoryMarker } from '../types/game'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Convert KataGo ownership probabilities into territory display markers. */
export function ownershipTerritory(
  board: Board,
  ownership: number[] | null | undefined,
  ownershipStdev: number[] | null | undefined,
): TerritoryMarker[] {
  const height = board.length
  const width = board[0]?.length ?? 0
  if (!height || !width || !ownership || ownership.length < height * width) return []

  const occupiedPoints = board.flatMap((row, rowIndex) => row.flatMap((stone, colIndex) =>
    stone ? [{ row: rowIndex, col: colIndex }] : [],
  ))
  if (!occupiedPoints.length) return []
  const moveNumber = occupiedPoints.length
  // 早期只绘制距离已有棋子不超过6格的区域；12手后扩大到9格；35手后全盘。
  // 这里的距离是棋盘坐标的 Chebyshev 距离 max(|行差|,|列差|)。
  const range = moveNumber < 12 ? 6 : moveNumber < 35 ? 9 : Number.POSITIVE_INFINITY

  const markers: TerritoryMarker[] = []
  board.forEach((row, rowIndex) => row.forEach((stone, colIndex) => {
    if (stone) return

    const index = rowIndex * width + colIndex
    const nearestStone = occupiedPoints.reduce(
      (distance, point) => Math.min(distance, Math.max(Math.abs(point.row - rowIndex), Math.abs(point.col - colIndex))),
      Number.POSITIVE_INFINITY,
    )
    if (nearestStone > range) return
    const value = Number(ownership[index])
    if (!Number.isFinite(value)) return

    // KataGo ownership：-1=白方、0=未定、+1=黑方。绝对值越大，归属越确定。
    const certainty = Math.abs(clamp(value, -1, 1))
    // ownershipStdev 范围通常为0..1，越大代表模型对该点越不稳定。
    const uncertainty = clamp(Number(ownershipStdev?.[index] ?? 0), 0, 1)
    // |ownership| < 0.16 的点直接不显示。提高0.16会减少边界/模糊区域，降低会扩大显示范围。
    if (certainty < 0.16) return

    const owner: Stone = value >= 0 ? 'black' : 'white'
    // 不确定性最多削弱35%：uncertainty=1时保留 certainty 的65%。
    // 0.35越大，AI预测范围越保守；设为0则完全忽略stdev。
    const stableCertainty = certainty * (1 - uncertainty * 0.35)
    // >=0.62显示为确定区域；>=0.30且<0.62为弱区域；其余为争议区域。
    const zone = stableCertainty >= 0.62
      ? 'sure'
      : stableCertainty >= 0.3
        ? 'weak'
        : 'contested'

    markers.push({
      row: rowIndex,
      col: colIndex,
      owner,
      // 标记尺寸由 confidence 控制：基础0.28，确定度贡献0.72，最终限制在0.24..1。
      // 这只影响方块大小，不改变是否显示；显示由上面的0.16阈值决定。
      confidence: clamp(0.28 + stableCertainty * 0.72, 0.24, 1),
      uncertainty,
      zone,
    })
  }))

  return markers
}
