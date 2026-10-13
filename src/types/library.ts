import type { RuleSet } from '../domain/gameSetup'

export type ReviewState = 'pending' | 'reviewing' | 'completed'
export type RecordSource = 'import' | 'research' | 'game'
export interface RecordMetadata {
  title: string
  black: string
  white: string
  blackRank: string
  whiteRank: string
  event: string
  date: string
  result: string
  boardSize: number
  ruleSet: RuleSet
  komi: number
  moves: number
}
export interface LibraryRecord extends RecordMetadata {
  id: string
  sgf: string
  originalSgf: string
  fingerprint: string
  fileName: string
  source: RecordSource
  favorite: boolean
  tags: string[]
  collectionIds: string[]
  reviewState: ReviewState
  lastNodePath: number[]
  createdAt: string
  updatedAt: string
  openedAt: string | null
  deletedAt: string | null
}
export interface RecordCollection {
  id: string
  name: string
}
export interface LibraryData {
  version: 1
  revision: number
  records: LibraryRecord[]
  collections: RecordCollection[]
}
export interface ImportResult {
  name: string
  status: 'imported' | 'duplicate' | 'error'
  message: string
}
export const REVIEW_LABELS: Record<ReviewState, string> = {
  pending: '待复盘',
  reviewing: '复盘中',
  completed: '已复盘',
}
export const SOURCE_LABELS: Record<RecordSource, string> = {
  import: 'SGF 导入',
  research: '研究棋谱',
  game: '本地对局',
}

export function emptyLibrary(): LibraryData {
  return { version: 1, revision: 0, records: [], collections: [] }
}
