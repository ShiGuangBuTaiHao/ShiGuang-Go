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

/**
 * Automatic recommendation stages use a matching analysis strength so the
 * backend timeout grows with the explicit visit budget. Every stage is still
 * a normal KataGo analysis; only the search budget changes.
 */
export const AUTO_RECOMMENDATION_STAGES = [
  { maxVisits: 300, strength: 'casual' },
  { maxVisits: 1200, strength: 'normal' },
  { maxVisits: 4000, strength: 'strong' },
  { maxVisits: 10000, strength: 'expert' },
] as const

export const AUTO_RECOMMENDATION_BUDGETS = AUTO_RECOMMENDATION_STAGES.map((stage) => stage.maxVisits)

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
  group: '低级' | '中级' | '高级'
  resignThreshold: number
  resignConsecutiveTurns: number
  visitBudget: number
  /**
   * Zero keeps the raw Human SL distribution. Higher tiers gradually mix in
   * the search utility without ever discarding the human move distribution.
   */
  searchUtilityWeight: number
  /** Utility scale of the search correction; smaller values sharpen search. */
  searchUtilityLambda: number
  /** Temperature applied to humanPolicy. 1 is the raw Human SL distribution. */
  policyTemperature: number
  /** Keep the search's pass judgement even for the lowest ranks. */
  allowSearchPass: boolean
}

/**
 * Human SL is a policy model, not a calibrated Elo scale. The profile remains
 * the source distribution; search influence and its candidate coverage grow
 * continuously on the same 20k-to-9d rank axis.
 */
function rankProgress(rank: number, dan: boolean): number {
  // One continuous axis: 20k = 0, 1k = 19/28, 1d = 20/28, 9d = 1.
  return (dan ? 19 + rank : 20 - rank) / 28
}

function visitBudgetFor(progress: number): number {
  return Math.round(40 + (1200 - 40) * progress ** 2)
}

function resignationConfig(): Pick<AiStrengthConfig, 'resignThreshold' | 'resignConsecutiveTurns'> {
  // Keep resigning behavior out of the rank curve; it should not make a
  // stronger profile abandon games sooner than a weaker one.
  return { resignThreshold: -0.99, resignConsecutiveTurns: 20 }
}

function tieredSearchWeight(rank: number, dan: boolean): Pick<
  AiStrengthConfig,
  'searchUtilityWeight' | 'searchUtilityLambda' | 'policyTemperature'
> {
  const progress = rankProgress(rank, dan)
  const searchProgress = progress ** 1.5
  return {
    searchUtilityWeight: searchProgress,
    searchUtilityLambda: 0.48 - searchProgress * 0.4,
    policyTemperature: 1 + (1 - progress) * 0.15,
  }
}

function amateurConfig(rank: number): AiStrengthConfig {
  return {
    label: `${rank}级`,
    description: rank >= 15 ? '保留入门级人类失误' : rank >= 8 ? '保留业余级人类失误' : '适合进阶训练',
    group: rank >= 11 ? '低级' : '中级',
    visitBudget: visitBudgetFor(rankProgress(rank, false)),
    ...tieredSearchWeight(rank, false),
    allowSearchPass: true,
    ...resignationConfig(),
  }
}

function danConfig(rank: number): AiStrengthConfig {
  return {
    label: `${rank}段`,
    description: rank <= 3 ? '适合稳定提升' : rank <= 6 ? '适合高强度训练' : '接近高段位棋力',
    group: '高级',
    visitBudget: visitBudgetFor(rankProgress(rank, true)),
    ...tieredSearchWeight(rank, true),
    allowSearchPass: true,
    ...resignationConfig(),
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
  legalMoves?: Iterable<string>
  boardSize?: number
  /** Raw Human SL distribution temperature; 1 leaves the policy unchanged. */
  temperature?: number
  /** Search corrections keyed by normalized GTP coordinate. */
  searchCandidates?: Iterable<AiCandidate>
  /** Mix between Human SL (0) and search-adjusted utility (1). */
  searchUtilityWeight?: number
  /** Lower values make utility differences matter sooner. */
  searchUtilityLambda?: number
  /** AI perspective; analysis utilities are reported from Black's perspective. */
  aiColor?: 'black' | 'white'
}

function sampleWeightedMove(
  moves: string[],
  weights: number[],
  random: () => number = Math.random,
): string | null {
  const normalizedWeights = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  )
  const total = normalizedWeights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return null

  let roll = Math.min(Math.max(random(), 0), 1) * total
  for (let index = 0; index < moves.length; index += 1) {
    roll -= normalizedWeights[index]
    if (roll <= 0) return moves[index]
  }
  return moves[moves.length - 1] ?? null
}

function policyIndexForCoordinate(coordinate: string, boardSize = 19): number | null {
  if (coordinate.trim().toLowerCase() === 'pass') return boardSize * boardSize
  const letters = 'ABCDEFGHJKLMNOPQRST'
  const col = letters.indexOf(coordinate[0]?.toUpperCase())
  const number = Number(coordinate.slice(1))
  const row = boardSize - number
  if (col < 0 || col >= boardSize || !Number.isInteger(number) || row < 0 || row >= boardSize) {
    return null
  }
  return row * boardSize + col
}

/** Sample from the complete legal Human SL distribution, excluding pass. */
export function selectHumanPolicyMove(
  humanPolicy: number[],
  options: HumanPolicySelectionOptions = {},
  random: () => number = Math.random,
): string | null {
  const boardSize = options.boardSize ?? 19
  if (humanPolicy.length < boardSize * boardSize + 1) return null
  const letters = 'ABCDEFGHJKLMNOPQRST'
  const candidates = new Map<string, AiCandidate>()
  for (const candidate of options.searchCandidates ?? []) {
    const move = candidate.move.trim().toUpperCase()
    if (candidate.utility == null || !Number.isFinite(candidate.utility)) continue
    // At tiny visit budgets moveInfos can report a single, barely searched
    // move. It must not be treated as universally better than every Human SL
    // move that did not receive a visit.
    if ('visits' in candidate && Number(candidate.visits) <= 0) continue
    const current = candidates.get(move)
    if (!current || candidate.utility > current.utility) candidates.set(move, candidate)
  }
  const utilityValues = Array.from(candidates.values(), (candidate) =>
    options.aiColor === 'white' ? -candidate.utility : candidate.utility,
  )
  const utilityMax = utilityValues.length ? Math.max(...utilityValues) : 0
  const mixedWeight = Math.min(Math.max(options.searchUtilityWeight ?? 0, 0), 1)
  const lambda = Math.max(options.searchUtilityLambda ?? 0.5, 1e-3)
  const temperature = Math.max(options.temperature ?? 1, 1e-3)
  const moves: string[] = []
  const weights: number[] = []
  const legal = options.legalMoves
    ? new Set(Array.from(options.legalMoves, (move) => move.toUpperCase()))
    : null
  for (let index = 0; index < boardSize * boardSize; index += 1) {
    const probability = humanPolicy[index]
    if (!Number.isFinite(probability) || probability <= 0) continue
    const row = Math.floor(index / boardSize)
    const col = index % boardSize
    const move = `${letters[col]}${boardSize - row}`
    if (legal && !legal.has(move)) continue
    const searchCandidate = candidates.get(move)
    const utilityDelta = searchCandidate
      ? (options.aiColor === 'white' ? -searchCandidate.utility : searchCandidate.utility) - utilityMax
      : 0
    // Unsearched moves are neutral, not presumed good or bad. Root exploration
    // settings in the backend expand coverage as rank strength increases.
    const searchFactor = mixedWeight > 0 ? Math.exp(utilityDelta / lambda) : 1
    moves.push(move)
    // Keep policy temperature independent from search correction.
    weights.push(Math.pow(probability, 1 / temperature) * Math.pow(searchFactor, mixedWeight))
  }
  return sampleWeightedMove(moves, weights, random)
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

export function policyCoordinateIndex(coordinate: string, boardSize = 19): number | null {
  return policyIndexForCoordinate(coordinate, boardSize)
}

/**
 * Low ranks need a search-backed ending check, but their ordinary moves must
 * remain Human SL moves. Return the extra visits required for that check, or
 * zero in the opening where the profile policy should be used untouched.
 */
export function passJudgementVisits(strength: AiStrength, moveNumber: number): number {
  if (moveNumber < 60) return 0
  return AI_STRENGTHS[strength].visitBudget
}

/** Pass only when the search explicitly ranks pass first and play is ending. */
export function shouldAcceptSearchPass(
  strength: AiStrength,
  result: Pick<AiCandidate, 'move'> | undefined,
  moveNumber: number,
  opponentPassed = false,
): boolean {
  if (!AI_STRENGTHS[strength].allowSearchPass || !result) return false
  if (result.move.trim().toLowerCase() !== 'pass') return false
  return moveNumber >= 60 || opponentPassed
}
