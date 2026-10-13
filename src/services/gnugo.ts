import { invoke } from '@tauri-apps/api/core'
import type { RecordedMove, Stone } from '../types/game'
import type { RuleSet } from '../domain/gameSetup'

export interface GnuGoResult {
  finalScore: string
  deadStones: string[]
  sekiStones: string[]
}

export interface GnuGoEstimate {
  scoreLead: number
  scoreLowerBound: number
  scoreUpperBound: number
  influenceRegions: number[]
  deadStones?: string[]
  readiness?: GnuGoScoringReadiness | null
}

export interface GnuGoScoringReadiness {
  ready: boolean
  uncertainPoints: number
  unresolvedGroups: number
  blackMove: string
  whiteMove: string
  reasons: string[]
}

export async function estimateWithGnuGo(
  requestId: string,
  moves: RecordedMove[],
  currentPlayer: Stone,
  ruleSet: RuleSet,
  komi: number,
  checkReadiness = false,
): Promise<GnuGoEstimate> {
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('GNU Go 获取形势需要在桌面端运行')
  if (ruleSet === 'aga') throw new Error('GNU Go 暂不支持 AGA 形势估值，请使用中国或日韩规则')
  return invoke('gnugo_estimate', {
    request: {
      requestId,
      moves: moves.map((move) => ({ player: move.stone === 'black' ? 'B' : 'W', coordinate: move.coordinate })),
      currentPlayer: currentPlayer === 'black' ? 'B' : 'W',
      ruleSet,
      komi,
      checkReadiness,
    },
  })
}

export async function adjudicateWithGnuGo(
  requestId: string,
  moves: RecordedMove[],
  ruleSet: RuleSet,
  komi: number,
): Promise<GnuGoResult> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('GNU Go 裁判需要在桌面端运行')
  }
  if (ruleSet === 'aga') {
    throw new Error('GNU Go 暂不支持 AGA 裁判，请使用中国或日韩规则')
  }
  return invoke('gnugo_adjudicate', {
    request: {
      requestId,
      moves: moves.map((move) => ({ player: move.stone === 'black' ? 'B' : 'W', coordinate: move.coordinate })),
      ruleSet,
      komi,
    },
  })
}

export async function cancelGnuGoAdjudication(requestId: string): Promise<void> {
  await cancelGnuGoRequest(requestId)
}

export async function cancelGnuGoRequest(requestId: string): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return
  await invoke('gnugo_cancel', { requestId })
}
