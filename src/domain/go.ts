import type { Board, Position, Stone } from '../types/game'

export const BOARD_SIZE = 19

export function createBoard(size = BOARD_SIZE): Board {
  return Array.from({ length: size }, () => Array<Stone | null>(size).fill(null))
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row])
}

export function boardHash(board: Board): string {
  return board
    .flat()
    .map((stone) => (stone === 'black' ? 'b' : stone === 'white' ? 'w' : '.'))
    .join('')
}

function opponent(stone: Stone): Stone {
  return stone === 'black' ? 'white' : 'black'
}

function neighbors(board: Board, row: number, col: number): Position[] {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ].filter(
    (position) =>
      position.row >= 0 &&
      position.col >= 0 &&
      position.row < board.length &&
      position.col < board.length,
  )
}

function collectGroup(board: Board, start: Position): { stones: Position[]; liberties: number } {
  const color = board[start.row][start.col]
  if (!color) return { stones: [], liberties: 0 }

  const queue = [start]
  const visited = new Set<string>()
  const liberties = new Set<string>()
  const stones: Position[] = []

  while (queue.length) {
    const current = queue.pop()!
    const key = `${current.row}:${current.col}`
    if (visited.has(key)) continue

    visited.add(key)
    stones.push(current)

    for (const next of neighbors(board, current.row, current.col)) {
      const nextStone = board[next.row][next.col]
      if (!nextStone) liberties.add(`${next.row}:${next.col}`)
      if (nextStone === color && !visited.has(`${next.row}:${next.col}`)) queue.push(next)
    }
  }

  return { stones, liberties: liberties.size }
}

export function applyMove(
  board: Board,
  row: number,
  col: number,
  stone: Stone,
): { board: Board; captured: number } | null {
  if (board[row]?.[col] !== null) return null

  const nextBoard = cloneBoard(board)
  nextBoard[row][col] = stone
  let captured = 0

  for (const adjacent of neighbors(nextBoard, row, col)) {
    if (nextBoard[adjacent.row][adjacent.col] !== opponent(stone)) continue
    const group = collectGroup(nextBoard, adjacent)
    if (group.liberties > 0) continue

    captured += group.stones.length
    for (const capturedStone of group.stones) {
      nextBoard[capturedStone.row][capturedStone.col] = null
    }
  }

  if (collectGroup(nextBoard, { row, col }).liberties === 0) return null
  return { board: nextBoard, captured }
}

export function coordinateLabel(row: number, col: number, size = BOARD_SIZE): string {
  const letters = 'ABCDEFGHJKLMNOPQRST'
  return `${letters[col]}${size - row}`
}

export function positionFromCoordinate(coordinate: string, size = BOARD_SIZE): Position | null {
  if (coordinate.toLowerCase() === 'pass') return null
  const letters = 'ABCDEFGHJKLMNOPQRST'
  const col = letters.indexOf(coordinate[0]?.toUpperCase())
  const number = Number(coordinate.slice(1))
  const row = size - number
  if (col < 0 || !Number.isInteger(number) || row < 0 || row >= size) return null
  return { row, col }
}
