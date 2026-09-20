export const AMATEUR_STRENGTHS = [
  'rank_20k', 'rank_19k', 'rank_18k', 'rank_17k', 'rank_16k',
  'rank_15k', 'rank_14k', 'rank_13k', 'rank_12k', 'rank_11k',
  'rank_10k', 'rank_9k', 'rank_8k', 'rank_7k', 'rank_6k',
  'rank_5k', 'rank_4k', 'rank_3k', 'rank_2k', 'rank_1k',
] as const

export const DAN_STRENGTHS = [
  'rank_1d', 'rank_2d', 'rank_3d', 'rank_4d', 'rank_5d',
  'rank_6d', 'rank_7d', 'rank_8d', 'rank_9d',
] as const

export type AiStrength = typeof AMATEUR_STRENGTHS[number] | typeof DAN_STRENGTHS[number]
export type AnalysisStrength = 'beginner' | 'casual' | 'normal' | 'strong' | 'expert'
export type RecommendationStrength = 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'maximum'

export const AUTO_RECOMMENDATION_BUDGETS = [300, 1200, 4000, 10000] as const

export const RECOMMENDATION_STRENGTHS: Record<Exclude<RecommendationStrength, 'auto'>, AnalysisStrength> = {
  low: 'beginner',
  medium: 'casual',
  high: 'normal',
  ultra: 'strong',
  maximum: 'expert',
}

export const RECOMMENDATION_BUDGETS: Record<Exclude<RecommendationStrength, 'auto'>, number> = {
  low: 150,
  medium: 500,
  high: 1500,
  ultra: 4000,
  maximum: 10000,
}

export function recommendationAnalysisStrength(value: RecommendationStrength): AnalysisStrength {
  return value === 'auto' ? 'normal' : RECOMMENDATION_STRENGTHS[value]
}
export interface AiStrengthConfig {
  label: string
  description: string
  group: '业余级' | '段位'
  resignThreshold: number
  resignConsecutiveTurns: number
}

function amateurConfig(rank: number): AiStrengthConfig {
  return {
    label: `${rank}级`,
    description: rank >= 15 ? '适合入门与基础练习' : rank >= 8 ? '适合业余级对弈' : '适合进阶训练',
    group: '业余级',
    resignThreshold: -0.9,
    resignConsecutiveTurns: 3,
  }
}

function danConfig(rank: number): AiStrengthConfig {
  return {
    label: `${rank}段`,
    description: rank <= 3 ? '适合稳定提升' : rank <= 6 ? '适合高强度训练' : '接近高段位棋力',
    group: '段位',
    resignThreshold: -0.9,
    resignConsecutiveTurns: 3,
  }
}

export const AI_STRENGTHS: Record<AiStrength, AiStrengthConfig> = {
  rank_20k: amateurConfig(20), rank_19k: amateurConfig(19), rank_18k: amateurConfig(18),
  rank_17k: amateurConfig(17), rank_16k: amateurConfig(16), rank_15k: amateurConfig(15),
  rank_14k: amateurConfig(14), rank_13k: amateurConfig(13), rank_12k: amateurConfig(12),
  rank_11k: amateurConfig(11), rank_10k: amateurConfig(10), rank_9k: amateurConfig(9),
  rank_8k: amateurConfig(8), rank_7k: amateurConfig(7), rank_6k: amateurConfig(6),
  rank_5k: amateurConfig(5), rank_4k: amateurConfig(4), rank_3k: amateurConfig(3),
  rank_2k: amateurConfig(2), rank_1k: amateurConfig(1),
  rank_1d: danConfig(1), rank_2d: danConfig(2), rank_3d: danConfig(3),
  rank_4d: danConfig(4), rank_5d: danConfig(5), rank_6d: danConfig(6),
  rank_7d: danConfig(7), rank_8d: danConfig(8), rank_9d: danConfig(9),
}

export interface AiCandidate {
  move: string
  utility: number
  prior: number
  humanPrior?: number
  isSymmetryOf?: string
}

export interface HumanPolicySelectionOptions {
  aiColor?: 'black' | 'white'
  strength?: AiStrength
}

function isKyuStrength(strength: AiStrength | undefined): boolean {
  return strength?.endsWith('k') ?? false
}

function danUtilityTemperature(strength: AiStrength | undefined): number {
  const dan = Number(strength?.match(/_(\d+)d$/)?.[1] ?? 1)
  return Math.max(0.16, 0.8 - (dan - 1) * 0.08)
}

function kyuUtilityTemperature(strength: AiStrength | undefined): number {
  const kyu = Number(strength?.match(/_(\d+)k$/)?.[1] ?? 20)
  if (kyu >= 16) return 1.2
  if (kyu >= 11) return 0.9
  if (kyu >= 6) return 0.7
  if (kyu >= 3) return 0.5
  return 0.35
}

function sampleWeightedMove(choices: AiCandidate[], weights: number[]): string | null {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return choices[0]?.move ?? null

  let roll = Math.random() * total
  for (let index = 0; index < choices.length; index += 1) {
    roll -= weights[index]
    if (roll <= 0) return choices[index].move
  }
  return choices[0]?.move ?? null
}

export function updateResignationStreak(
  previousStreak: number,
  aiUtility: number,
  strength: AiStrength,
) {
  const config = AI_STRENGTHS[strength]
  const streak = aiUtility <= config.resignThreshold ? previousStreak + 1 : 0
  return { streak, shouldResign: streak >= config.resignConsecutiveTurns }
}

export function distinctAiCandidates<T extends AiCandidate>(candidates: T[]): T[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const move = candidate.move.trim().toLowerCase()
    if (move === 'pass' || move === 'resign') return false
    const group = candidate.isSymmetryOf ?? candidate.move
    if (seen.has(group)) return false
    seen.add(group)
    return true
  })
}

/** Choose a human-style move while suppressing moves KataGo evaluates as too costly. */
export function selectHumanPolicyMove(
  candidates: AiCandidate[],
  options: HumanPolicySelectionOptions = {},
): string | null {
  const choices = distinctAiCandidates(candidates)
  const first = choices[0]
  if (!first) return null

  const temperature = isKyuStrength(options.strength)
    ? kyuUtilityTemperature(options.strength)
    : danUtilityTemperature(options.strength)
  const utilityFromAiPerspective = choices.map((candidate) =>
    options.aiColor === 'white' ? -candidate.utility : candidate.utility,
  )
  const bestUtility = Math.max(...utilityFromAiPerspective)
  const weights = choices.map((candidate) => {
    const humanPrior = candidate.humanPrior ?? 0
    const prior = Number.isFinite(humanPrior) && humanPrior > 0
      ? humanPrior
      : Number.isFinite(candidate.prior) && candidate.prior > 0
        ? candidate.prior
        : 0
    const index = choices.indexOf(candidate)
    return prior * Math.exp((utilityFromAiPerspective[index] - bestUtility) / temperature)
  })
  return sampleWeightedMove(choices, weights)
}
