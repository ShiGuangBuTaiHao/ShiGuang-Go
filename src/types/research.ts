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
  sgfProperties?: Record<string, string[]>
  id: string
  parentId: string | null
  children: string[]
  move: ResearchMove | null
  snapshot: ResearchSnapshot
  comment: string
  marks: BoardMark[]
  setup: boolean
  properties: Record<string, string[]>
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
  title: string
  blackName: string
  whiteName: string
}

export interface VariationGraphNode {
  id: string
  x: number
  y: number
  label: string
  stone: Stone | null
  current: boolean
  onPath: boolean
  comment: boolean
}

export interface VariationGraph {
  nodes: VariationGraphNode[]
  edges: Array<{ from: string; to: string; active: boolean }>
  width: number
  height: number
}
