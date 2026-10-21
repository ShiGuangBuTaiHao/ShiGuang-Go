import type { KataGoAnalysis } from '../services/katago'
import type { Stone } from '../types/game'
import { positionScore } from './scoring'

export interface KataGoScoreProposal {
  winner: Stone | null
  scoreLead: number
}

/** KataGo can request counting even when its uncertainty checks are not settled. */
export function kataGoScoreProposal(analysis: KataGoAnalysis): KataGoScoreProposal | null {
  const bestMove = [...analysis.moveInfos].sort((left, right) => left.order - right.order)[0]
  if (bestMove?.move.trim().toLowerCase() !== 'pass') return null
  if (!Number.isFinite(Number(analysis.rootInfo.scoreLead))) return null
  const { winner, lead } = positionScore(
    analysis.rootInfo.winrate,
    analysis.rootInfo.scoreLead,
  )
  return { winner, scoreLead: lead }
}
