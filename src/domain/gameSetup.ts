import type { Stone } from '../types/game'
import { AI_STRENGTHS, type AiStrength } from './ai'

export type RuleSet = 'chinese' | 'japanese-korean' | 'aga'
export type PlayerColorChoice = 'random' | 'black' | 'white'
export type Handicap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type TimePresetId = 'blitz' | 'standard' | 'slow' | 'custom' | 'untimed'

export interface TimeControl {
  preset: TimePresetId
  mainTimeSeconds: number
  byoYomiSeconds: number
  byoYomiPeriods: number
}

export interface GameSetup {
  ruleSet: RuleSet
  playerColor: PlayerColorChoice
  resolvedPlayerColor: Stone
  handicap: Handicap
  komi: number
  komiUnit: '子' | '目'
  komiLabel: string
  timeControl: TimeControl
  aiStrength: AiStrength
}

export const GAME_SETUP_STORAGE_KEY = 'shiguang-go:game-setup'

export const RULE_PRESETS: Record<RuleSet, { label: string; engineRule: string; scoring: string }> = {
  chinese: { label: '中国规则', engineRule: 'chinese', scoring: '数子' },
  'japanese-korean': { label: '日韩规则', engineRule: 'japanese', scoring: '数目' },
  aga: { label: 'AGA 规则', engineRule: 'aga', scoring: '数子' },
}

export const HANDICAP_OPTIONS: Array<{ value: Handicap; label: string }> = [
  { value: 0, label: '分先' },
  { value: 1, label: '让先' },
  { value: 2, label: '让 2 子' },
  { value: 3, label: '让 3 子' },
  { value: 4, label: '让 4 子' },
  { value: 5, label: '让 5 子' },
  { value: 6, label: '让 6 子' },
  { value: 7, label: '让 7 子' },
  { value: 8, label: '让 8 子' },
  { value: 9, label: '让 9 子' },
]

export const TIME_PRESETS: Record<Exclude<TimePresetId, 'custom'>, TimeControl> = {
  blitz: { preset: 'blitz', mainTimeSeconds: 60, byoYomiSeconds: 15, byoYomiPeriods: 3 },
  standard: { preset: 'standard', mainTimeSeconds: 600, byoYomiSeconds: 30, byoYomiPeriods: 3 },
  slow: { preset: 'slow', mainTimeSeconds: 1800, byoYomiSeconds: 40, byoYomiPeriods: 3 },
  untimed: { preset: 'untimed', mainTimeSeconds: 0, byoYomiSeconds: 0, byoYomiPeriods: 0 },
}

export const CUSTOM_MAIN_TIME_OPTIONS = [0, 60, 300, 600, 1200, 1800, 2400, 3600, 7200]
export const CUSTOM_BYO_YOMI_OPTIONS = [10, 15, 20, 30, 40, 60]
export const CUSTOM_PERIOD_OPTIONS = [1, 3, 5, 10]

export function komiFor(ruleSet: RuleSet, handicap: Handicap): number {
  if (handicap === 0) {
    if (ruleSet === 'chinese') return 3.75
    if (ruleSet === 'japanese-korean') return 6.5
    return 7.5
  }

  if (ruleSet === 'chinese') return handicap === 1 ? 0 : handicap * 0.5
  return 0.5
}

export function komiUnitFor(ruleSet: RuleSet): '子' | '目' {
  return ruleSet === 'chinese' ? '子' : '目'
}

export function formatKomi(value: number): string {
  if (value === 0) return '0'
  if (value === 0.5) return '½'
  if (value === 1.5) return '1½'
  if (value === 2.5) return '2½'
  if (value === 3.5) return '3½'
  if (value === 3.75) return '3¾'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

export function komiLabelFor(ruleSet: RuleSet, handicap: Handicap): string {
  const value = komiFor(ruleSet, handicap)
  return `${formatKomi(value)}${komiUnitFor(ruleSet)}`
}

export function defaultGameSetup(aiStrength: AiStrength): GameSetup {
  return {
    ruleSet: 'chinese',
    playerColor: 'black',
    resolvedPlayerColor: 'black',
    handicap: 0,
    komi: komiFor('chinese', 0),
    komiUnit: '子',
    komiLabel: komiLabelFor('chinese', 0),
    timeControl: { ...TIME_PRESETS.standard },
    aiStrength,
  }
}

export function normalizeGameSetup(input: Partial<GameSetup>, aiStrength: AiStrength): GameSetup {
  const base = defaultGameSetup(aiStrength)
  const selectedStrength = input.aiStrength && input.aiStrength in AI_STRENGTHS
    ? input.aiStrength
    : aiStrength
  const ruleSet = input.ruleSet && input.ruleSet in RULE_PRESETS ? input.ruleSet : base.ruleSet
  const handicap = HANDICAP_OPTIONS.some((option) => option.value === input.handicap)
    ? input.handicap as Handicap
    : base.handicap
  const playerColor = input.playerColor === 'random' || input.playerColor === 'white' || input.playerColor === 'black'
    ? input.playerColor
    : base.playerColor
  const timeControl = normalizeTimeControl(input.timeControl)
  return {
    ...base,
    ...input,
    ruleSet,
    playerColor,
    resolvedPlayerColor: input.resolvedPlayerColor === 'white' ? 'white' : 'black',
    handicap,
    komi: komiFor(ruleSet, handicap),
    komiUnit: komiUnitFor(ruleSet),
    komiLabel: komiLabelFor(ruleSet, handicap),
    timeControl,
    aiStrength: selectedStrength,
  }
}

function normalizeTimeControl(value: TimeControl | undefined): TimeControl {
  if (!value || !['blitz', 'standard', 'slow', 'custom', 'untimed'].includes(value.preset)) {
    return { ...TIME_PRESETS.standard }
  }
  return {
    preset: value.preset,
    mainTimeSeconds: Number.isFinite(value.mainTimeSeconds) ? Math.max(0, value.mainTimeSeconds) : 600,
    byoYomiSeconds: Number.isFinite(value.byoYomiSeconds) ? Math.max(0, value.byoYomiSeconds) : 30,
    byoYomiPeriods: Number.isFinite(value.byoYomiPeriods) ? Math.max(0, value.byoYomiPeriods) : 3,
  }
}

export function loadGameSetup(aiStrength: AiStrength): GameSetup {
  if (typeof window === 'undefined') return defaultGameSetup(aiStrength)
  try {
    const raw = window.localStorage.getItem(GAME_SETUP_STORAGE_KEY)
    return raw ? normalizeGameSetup(JSON.parse(raw) as Partial<GameSetup>, aiStrength) : defaultGameSetup(aiStrength)
  } catch {
    return defaultGameSetup(aiStrength)
  }
}

export function saveGameSetup(setup: GameSetup): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(GAME_SETUP_STORAGE_KEY, JSON.stringify(setup))
}

export function resolvePlayerColor(choice: PlayerColorChoice): Stone {
  if (choice === 'black' || choice === 'white') return choice
  return Math.random() < 0.5 ? 'black' : 'white'
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}
