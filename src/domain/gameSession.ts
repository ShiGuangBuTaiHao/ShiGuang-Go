import { applyMove, boardHash, coordinateLabel, createBoard } from './go'
import type { GameCommand, GameEvent, GameSnapshot, Stone } from '../types/game'

export function createInitialSnapshot(handicap = 0): GameSnapshot {
  return {
    board: createBoard(),
    currentPlayer: handicap > 0 ? 'white' : 'black',
    status: 'playing',
    result: null,
    consecutivePasses: 0,
    capturedByBlack: 0,
    capturedByWhite: 0,
    lastMove: null,
    moveNumber: 0,
    moves: [],
    handicapRemaining: handicap,
  }
}

function nextPlayer(stone: Stone): Stone {
  return stone === 'black' ? 'white' : 'black'
}

function cloneSnapshot(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    board: snapshot.board.map((row) => [...row]),
    result: snapshot.result ? { ...snapshot.result } : null,
    lastMove: snapshot.lastMove ? { ...snapshot.lastMove } : null,
    moves: snapshot.moves.map((move) => ({ ...move })),
  }
}

export function resumeAfterAdjudication(snapshot: GameSnapshot): GameSnapshot | null {
  if (snapshot.status === 'finished' && snapshot.result?.reason !== 'two-passes') return null
  const next = cloneSnapshot(snapshot)
  next.status = 'playing'
  next.result = null
  next.consecutivePasses = 0
  return next
}

export interface SessionApplyResult {
  event: GameEvent | null
  error: string | null
}

export function applyGameCommand(
  snapshot: GameSnapshot,
  command: GameCommand,
  history: readonly GameSnapshot[] = [],
): SessionApplyResult {
  if (command.type === 'reset') {
    const next = createInitialSnapshot(command.handicap ?? 0)
    return { event: { type: 'reset', snapshot: next }, error: null }
  }

  if (command.type === 'undo' || command.type === 'redo') {
    return { event: null, error: `${command.type === 'undo' ? '悔棋' : '重做'}由会话时间线处理` }
  }

  if (snapshot.status === 'finished' && !(command.type === 'score' && snapshot.result?.reason === 'two-passes')) {
    return { event: null, error: '棋局已经结束' }
  }

  if (command.type === 'place') {
    const result = applyMove(snapshot.board, command.row, command.col, snapshot.currentPlayer)
    if (!result) return { event: null, error: '此处不能落子' }

    const previous = history.at(-1)
    if (previous && boardHash(result.board) === boardHash(previous.board)) {
      return { event: null, error: '此手违反打劫规则' }
    }

    const stone = snapshot.currentPlayer
    const next = cloneSnapshot(snapshot)
    next.board = result.board
    next.currentPlayer = snapshot.handicapRemaining > 0
      ? snapshot.handicapRemaining === 1 ? 'black' : 'white'
      : nextPlayer(stone)
    next.consecutivePasses = 0
    next.lastMove = { row: command.row, col: command.col, stone }
    next.moveNumber += 1
    next.moves.push({ stone, coordinate: coordinateLabel(command.row, command.col) })
    next.handicapRemaining = Math.max(0, snapshot.handicapRemaining - 1)
    if (stone === 'black') next.capturedByBlack += result.captured
    else next.capturedByWhite += result.captured
    return { event: { type: 'move-applied', snapshot: next }, error: null }
  }

  if (command.type === 'pass') {
    if (snapshot.handicapRemaining > 0) return { event: null, error: '让子阶段必须由白方连续落子' }
    const next = cloneSnapshot(snapshot)
    next.currentPlayer = nextPlayer(snapshot.currentPlayer)
    next.consecutivePasses += 1
    next.lastMove = null
    next.moveNumber += 1
    next.moves.push({ stone: snapshot.currentPlayer, coordinate: 'pass' })
    if (next.consecutivePasses >= 2) {
      next.status = 'finished'
      next.result = { winner: null, loser: null, reason: 'two-passes' }
    }
    return { event: { type: 'pass-applied', snapshot: next }, error: null }
  }

  if (command.type === 'resign') {
    const next = cloneSnapshot(snapshot)
    next.status = 'finished'
    next.result = {
      winner: nextPlayer(snapshot.currentPlayer),
      loser: snapshot.currentPlayer,
      reason: command.reason ?? 'resignation',
    }
    return { event: { type: 'resigned', snapshot: next }, error: null }
  }

  if (command.type === 'score') {
    const next = cloneSnapshot(snapshot)
    next.status = 'finished'
    next.result = {
      winner: command.winner,
      loser: command.winner ? nextPlayer(command.winner) : null,
      reason: 'score',
      score: { ...command.score, deadStones: [...command.score.deadStones] },
    }
    return { event: { type: 'scored', snapshot: next }, error: null }
  }

  return { event: null, error: '不支持的棋局命令' }
}
