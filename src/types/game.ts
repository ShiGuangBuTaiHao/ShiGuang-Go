export type Stone = 'black' | 'white'

export type GameStatus = 'playing' | 'finished'

export type GameEndReason = 'resignation' | 'timeout' | 'two-passes' | 'score'

export interface CountedGameScore {
  blackStones: number
  whiteStones: number
  blackTerritory: number
  whiteTerritory: number
  blackCaptures: number
  whiteCaptures: number
  blackScore: number
  whiteScore: number
  margin: number
  komi: number
  ruleSet: string
  deadStones: string[]
}

export interface RefereeGameScore {
  engine: 'gnugo'
  finalScore: string
  margin: number
  komi: number
  ruleSet: string
  deadStones: string[]
  sekiStones: string[]
}

export interface KataGoGameScore {
  engine: 'katago'
  finalScore: string
  /** Signed point margin, never Chinese zi. */
  margin: number
  komi: number
  ruleSet: string
  deadStones: string[]
}

export type GameScore = CountedGameScore | RefereeGameScore | KataGoGameScore

export interface GameResult {
  winner: Stone | null
  loser: Stone | null
  reason: GameEndReason
  score?: GameScore
}

export interface Position {
  row: number
  col: number
}

export interface Move extends Position {
  stone: Stone
}

export interface RecordedMove {
  stone: Stone
  coordinate: string
}

export interface CandidateMarker extends Position {
  rank: number
  percentage: number
}

export type TerritoryZone = 'sure' | 'weak' | 'contested'

export interface TerritoryMarker extends Position {
  owner: Stone
  confidence: number // 0-1, controls marker size
  uncertainty?: number // 0-1, ownership standard deviation
  zone: TerritoryZone
}

export interface MoveNumberMarker extends Position {
  moveNumber: number
  stone: Stone
}

export type Board = Array<Array<Stone | null>>

export interface GameSnapshot {
  board: Board
  currentPlayer: Stone
  status: GameStatus
  result: GameResult | null
  consecutivePasses: number
  capturedByBlack: number
  capturedByWhite: number
  lastMove: Move | null
  moveNumber: number
  moves: RecordedMove[]
  /** Number of consecutive opening moves still granted to White. */
  handicapRemaining: number
}

export type GameCommand =
  | { type: 'place'; row: number; col: number }
  | { type: 'pass' }
  | { type: 'resign'; reason?: 'resignation' | 'timeout' }
  | { type: 'score'; winner: Stone | null; score: GameScore }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; handicap?: number }

export type GameEvent =
  | { type: 'move-applied'; snapshot: GameSnapshot }
  | { type: 'pass-applied'; snapshot: GameSnapshot }
  | { type: 'resigned'; snapshot: GameSnapshot }
  | { type: 'scored'; snapshot: GameSnapshot }
  | { type: 'undone'; snapshot: GameSnapshot }
  | { type: 'redone'; snapshot: GameSnapshot }
  | { type: 'reset'; snapshot: GameSnapshot }
