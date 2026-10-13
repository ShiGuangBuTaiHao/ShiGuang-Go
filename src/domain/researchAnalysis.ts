import { boardHash, coordinateLabel } from './go'
import { researchPath } from './researchTree'
import type { ResearchTree } from '../types/research'
import type { KataGoMove } from '../services/katago'

export function researchAnalysisPosition(tree: ResearchTree) {
  const path = researchPath(tree)
  let setupIndex = -1
  path.forEach((node, index) => { if (node.setup) setupIndex = index })
  if (setupIndex < 0 && path[0].move) setupIndex = 0
  const base = path[Math.max(0, setupIndex)]
  const initialStones: KataGoMove[] = []
  if (setupIndex >= 0) base.snapshot.board.forEach((line, row) => line.forEach((stone, col) => {
    if (stone) initialStones.push({ player: stone === 'black' ? 'B' : 'W', coordinate: coordinateLabel(row, col, tree.boardSize) })
  }))
  const moves: KataGoMove[] = path.slice(setupIndex >= 0 ? setupIndex + 1 : 1).flatMap((node) => node.move ? [{ player: node.move.stone === 'black' ? 'B' as const : 'W' as const, coordinate: node.move.coordinate }] : [])
  const current = path.at(-1)!
  return {
    moves, initialStones, boardSize: tree.boardSize,
    initialPlayer: base.snapshot.currentPlayer === 'black' ? 'B' as const : 'W' as const,
    turnNumber: current.snapshot.moveNumber,
    signature: `${tree.ruleSet}:${tree.komi}:${tree.boardSize}:${boardHash(current.snapshot.board)}:${current.snapshot.currentPlayer}:${current.snapshot.moveNumber}:${JSON.stringify(initialStones)}:${JSON.stringify(moves)}`,
  }
}
