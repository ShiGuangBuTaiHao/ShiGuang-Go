import type { RuleSet } from '../domain/gameSetup'
import type { Board, Position, Stone } from './game'

export type ResearchMode = 'play' | 'setup' | 'mark'

export type BoardMarkType = 'circle' | 'triangle' | 'square' | 'cross' | 'label' | 'arrow'

export interface BoardMark {
  id: string
  type: BoardMarkType
  row?: number
  col?: number
  text?: string
  from?: Position
  to?: Position
}

export interface ResearchMove {
  stone: Stone
  row?: number
  col?: number
  coordinate: string
  pass?: boolean
}

export interface ResearchSnapshot {
  board: Board
  currentPlayer: Stone
  moveNumber: number
  lastMove: Position | null
  capturedByBlack: number
  capturedByWhite: number
}

export interface ResearchNode {
  id: string
  parentId: string | null
  children: string[]
  move: ResearchMove | null
  snapshot: ResearchSnapshot
  comment: string
  marks: BoardMark[]
}

export interface ResearchTree {
  rootId: string
  currentNodeId: string
  nodes: Record<string, ResearchNode>
  boardSize: number
  komi: number
  ruleSet: RuleSet
  mode: ResearchMode
  dirty: boolean
}
