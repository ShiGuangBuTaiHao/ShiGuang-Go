import { invoke } from '@tauri-apps/api/core'
import type { AiStrength, AnalysisStrength } from '../domain/ai'
import type { Handicap, RuleSet } from '../domain/gameSetup'

export { AI_STRENGTHS, AMATEUR_STRENGTHS, DAN_STRENGTHS, type AiStrength, type AnalysisStrength } from '../domain/ai'

// ── Types matching Rust backend (serde camelCase) ──────────────────────

export interface EngineStatus {
  configured: boolean
  running: boolean
  warming?: boolean
  detail: string
  error?: string
}

export type GtpPlayer = 'B' | 'W'

export interface KataGoMove {
  player: GtpPlayer
  coordinate: string
}

export interface KataGoRootInfo {
  currentPlayer: GtpPlayer
  visits: number
  winrate: number   // [0,1] from black's perspective
  scoreLead: number // positive = black leading, in points
  scoreStdev?: number // standard deviation of score estimate, for uncertainty indication
  utility: number // [-1,1], from the configured analysis perspective
}

export interface KataGoMoveInfo {
  move: string       // GTP coordinate ("D4", "pass", etc.)
  visits: number
  winrate: number
  scoreLead: number
  scoreStdev?: number
  utility: number
  playSelectionValue: number
  order: number
  prior: number
  humanPrior?: number
  pv: string[]       // principal variation
  isSymmetryOf?: string
}

export interface KataGoAnalysis {
  turnNumber: number
  rootInfo: KataGoRootInfo
  moveInfos: KataGoMoveInfo[]
  /**
   * Ownership map: 19x19=361 values in [-1, 1].
   * +1接近黑方最终占领，-1接近白方，0表示争议/未定。
   * 前端会再经过 territory.ts 的阈值和范围裁剪后才显示。
   */
  ownership: number[]
  /**
   * 每个点的搜索树标准差，通常为[0,1]；越大越不稳定。
   * territory.ts用 uncertainty * 0.35 折减确定度，最多折减35%。
   */
  ownershipStdev: number[]
  humanPolicy: number[]
}

export interface WinratePoint {
  moveNumber: number
  black: number
  white: number
  scoreLead: number
}

// ── Analysis modes ─────────────────────────────────────────────────────

export type AnalysisMode = 'fast' | 'deep'

// ── Helpers ────────────────────────────────────────────────────────────

function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// ── API ────────────────────────────────────────────────────────────────

export async function getEngineStatus(): Promise<EngineStatus> {
  if (!isDesktopRuntime()) {
    return { configured: false, running: false, detail: '请在桌面端运行' }
  }
  return invoke<EngineStatus>('engine_status')
}

export interface KataGoFinalScore {
  finalScore: string
  deadStones: string[]
}

export async function warmupEngine(): Promise<void> {
  if (!isDesktopRuntime()) return
  await invoke('warmup_engine')
}

/** Ask the backend to stop a low-priority recommendation/territory search. */
export async function cancelAnalysis(): Promise<void> {
  if (!isDesktopRuntime()) return
  await invoke('cancel_analysis')
}

/** Run a structured position analysis through the persistent KataGo JSON engine. */
export async function analyzePosition(
  moves: KataGoMove[],
  mode: AnalysisMode = 'fast',
  strength: AnalysisStrength = 'normal',
  humanProfile?: AiStrength,
  ruleSet: RuleSet = 'chinese',
  komi = 7.5,
  handicap: Handicap = 0,
  maxVisits?: number,
): Promise<KataGoAnalysis> {
  if (!isDesktopRuntime()) throw new Error('当前不是 Tauri 桌面环境')
  const engineRule = ruleSet === 'japanese-korean' ? 'japanese' : ruleSet
  return invoke<KataGoAnalysis>('analyze_position', {
    request: {
      moves,
      mode,
      strength,
      humanProfile,
      ruleSet: engineRule,
      komi,
      handicap,
      ...(maxVisits === undefined ? {} : { maxVisits }),
    },
  })
}

export async function finalScore(
  moves: KataGoMove[],
  ruleSet: RuleSet = 'chinese',
  komi = 7.5,
): Promise<KataGoFinalScore> {
  if (!isDesktopRuntime()) throw new Error('当前不是 Tauri 桌面环境')
  const engineRule = ruleSet === 'japanese-korean' ? 'japanese' : ruleSet
  return invoke<KataGoFinalScore>('final_score', {
    request: { moves, ruleSet: engineRule, komi },
  })
}
