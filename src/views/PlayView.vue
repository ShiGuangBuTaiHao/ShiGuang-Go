<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import GoBoard from "../components/board/GoBoard.vue";
import PlayerHeader from "../components/game/PlayerHeader.vue";
import ControlsPanel from "../components/game/ControlsPanel.vue";
import GameSettingsDialog from "../components/game/GameSettingsDialog.vue";
import SaveGameRecord from "../components/library/SaveGameRecord.vue";
import { CheckCircle2, LoaderCircle, X } from "lucide-vue-next";
import { boardHash, coordinateLabel, positionFromCoordinate } from "../domain/go";
import { assessPositionStability, calculateScore } from "../domain/scoring";
import { createRefereeScore, refereeKomi } from "../domain/referee";
import { adjudicateWithGnuGo, cancelGnuGoAdjudication, cancelGnuGoRequest, estimateWithGnuGo, type GnuGoEstimate } from "../services/gnugo";
import { assessGnuGoScoringReadiness, formatGnuGoLead, gnuGoTerritory, validateGnuGoEstimate } from "../domain/gnugoEstimate";
import { loadBoardStyle, saveBoardStyle, type BoardStyle } from "../domain/boardTheme";
import {
  AUTO_RECOMMENDATION_BUDGETS,
  distinctAiCandidates,
  RECOMMENDATION_BUDGETS,
  recommendationAnalysisStrength,
  selectHumanPolicyMove,
  updateResignationStreak,
  type RecommendationStrength,
} from "../domain/ai";
import {
  formatClock,
  HANDICAP_OPTIONS,
  loadGameSetup,
  RULE_PRESETS,
  type GameSetup,
} from "../domain/gameSetup";
import { useGameStore } from "../stores/game";
import {
  analyzePosition,
  cancelAnalysis,
  AI_STRENGTHS,
  finalScore,
  getEngineStatus,
  type AnalysisMode,
  type AiStrength,
  type AnalysisStrength,
  type EngineStatus,
  type KataGoAnalysis,
  type KataGoMove,
  type WinratePoint,
} from "../services/katago";
import type {
  CandidateMarker,
  Board,
  MoveNumberMarker,
  Position,
  Stone,
  TerritoryMarker,
  GameScore,
  RefereeGameScore,
} from "../types/game";

// ── State ──────────────────────────────────────────────────────────────

const route = useRoute();
const router = useRouter();
const isAiMode = computed(() => route.name === "play-ai");
const game = useGameStore();
const { current, canUndo } = storeToRefs(game);

function resolveAiStrength(value: unknown): AiStrength {
  return typeof value === "string" && value in AI_STRENGTHS
    ? (value as AiStrength)
    : "rank_5k";
}

const gameSetup = ref<GameSetup>(loadGameSetup("rank_10k"));
const engineStatus = ref<EngineStatus | null>(null);
const analysis = ref<KataGoAnalysis | null>(null);
const recommendationLoading = ref(false);
const realtimeAnalysisLoading = ref(false);
const aiThinking = ref(false);
const recommendationVisible = ref(false);
const gnuGoEstimateVisible = ref(false);
const gnuGoEstimateLoading = ref(false);
const territoryVisible = gnuGoEstimateVisible;
const territoryLoading = gnuGoEstimateLoading;
const gnuGoEstimateError = ref("");
const gnuGoEstimate = ref<GnuGoEstimate | null>(null);
let gnuGoEstimateRequestId: string | null = null;
const deadStones = ref<Set<string>>(new Set());
const moveNumbersEnabled = ref(false);
const coordinatesEnabled = ref(true);
const recommendationEnabled = ref(isAiMode.value);
const boardStyle = ref<BoardStyle>(loadBoardStyle());
const immersiveEnabled = ref(false);
const resultModalVisible = ref(false);
const scoringVisible = ref(false);
const scoringLoading = ref(false);
const scoringError = ref("");
const scoreAssessment = ref<ReturnType<typeof assessPositionStability> | null>(null);
const scoreDeadStones = ref<Set<string>>(new Set());
const scorePreview = ref<ReturnType<typeof calculateScore> | null>(null);
const scoreApplication = ref(false);
const scoreRequestToken = ref(0);
const scoreProposalVisible = ref(false);
const scoreProposalText = ref("");
const scoreProposalCooldown = ref(0);
const lastObservedMoveNumber = ref(0);
const gameSettingsVisible = ref(false);
const refereeVisible = ref(false);
const refereeLoading = ref(false);
const refereeError = ref("");
const refereeStage = ref<'checking' | 'scoring' | 'unsettled'>('checking');
const refereeResult = ref<RefereeGameScore | null>(null);
const refereePositionKey = ref("");
const refereeConfirmations = ref<Stone[]>([]);
const refereeDialog = ref<HTMLElement | null>(null);
let refereeRestoreFocus: HTMLElement | null = null;
let refereeRequestId: string | null = null;
type ConfirmAction = "undo" | "pass" | "resign" | "reset";
const pendingAction = ref<ConfirmAction | null>(null);
const aiStrength = ref<AiStrength>(resolveAiStrength(gameSetup.value.aiStrength ?? route.query.strength));
const recommendationStrength = ref<RecommendationStrength>("auto");
const winratePerspective = ref<"black" | "white">("black");
const winrateHistory = ref<WinratePoint[]>([]);

// Counting is intended for the midgame/endgame, not for opening positions.
const MIN_SCORING_MOVES = 40;
const MIN_AI_RESIGN_MOVES = 75;

let aiRequestToken = 0;
let analysisRequestToken = 0;
let realtimeAnalysisSequence = 0;
let gameGeneration = 0;
let aiResignStreak = 0;

// Per-turn + per-mode + per-strength cache.
// The strength is part of the key because search budgets produce different results.
const analysisCache = new Map<string, KataGoAnalysis>();
type SideClockState = {
  mainRemaining: number;
  byoYomiRemaining: number;
  byoYomiPeriodsRemaining: number;
};
type ClockState = Record<Stone, SideClockState>;
const clock = ref<ClockState>({
  black: { mainRemaining: 0, byoYomiRemaining: 0, byoYomiPeriodsRemaining: 0 },
  white: { mainRemaining: 0, byoYomiRemaining: 0, byoYomiPeriodsRemaining: 0 },
});
const clockSnapshots = new Map<string, ClockState>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
let lastClockTick = 0;

// ── Computed ───────────────────────────────────────────────────────────

const playerColor = computed(() => gameSetup.value.resolvedPlayerColor);
const aiColor = computed(() => (playerColor.value === "black" ? "white" : "black") as Stone);
const aiTurn = computed(() => isAiMode.value && current.value.currentPlayer === aiColor.value);
const blackPlayerName = computed(() => (isAiMode.value ? playerColor.value === "black" ? "你" : "KataGo" : "玩家一"));
const whitePlayerName = computed(() => (isAiMode.value ? playerColor.value === "white" ? "你" : "KataGo" : "玩家二"));
const analysisBusy = computed(() => recommendationLoading.value || territoryLoading.value || realtimeAnalysisLoading.value);
const gnuGoEstimateDisabled = computed(() => analysisLocked.value || scoringVisible.value || scoringLoading.value
  || current.value.handicapRemaining > 0 || pendingAction.value !== null);
const gameFinished = computed(() => current.value.status === "finished");
const timelineLocked = computed(
  () =>
    refereeVisible.value ||
    aiThinking.value ||
    (isAiMode.value && aiTurn.value && !gameFinished.value)
);
const boardLocked = computed(
  () =>
    refereeVisible.value ||
    gameFinished.value ||
    (isAiMode.value &&
      (aiTurn.value || aiThinking.value))
);
const analysisLocked = computed(
  () => refereeVisible.value || (!gameFinished.value && isAiMode.value && (aiTurn.value || aiThinking.value)),
);
const passDisabled = computed(
  () => boardLocked.value || current.value.moveNumber === 0 || current.value.handicapRemaining > 0
);
const twoPassesAwaitingScore = computed(
  () => !isAiMode.value && current.value.result?.reason === "two-passes",
);
const scoreDisabled = computed(
  () => refereeVisible.value || (!isAiMode.value && !twoPassesAwaitingScore.value && current.value.moveNumber < MIN_SCORING_MOVES)
    || (boardLocked.value && !twoPassesAwaitingScore.value)
    || scoreApplication.value
    || scoringLoading.value
    || scoreProposalVisible.value
    || scoreProposalCooldown.value > 0,
);
const refereeDisabled = computed(() =>
  isAiMode.value || refereeVisible.value || scoringVisible.value || scoringLoading.value
  || pendingAction.value !== null || current.value.handicapRemaining > 0
  || current.value.moveNumber === 0 || (gameFinished.value && !twoPassesAwaitingScore.value),
);
const refereeSummary = computed(() => {
  const result = refereeResult.value;
  if (!result) return "";
  if (result.margin === 0) return "双方和棋";
  return `${result.margin > 0 ? "黑方" : "白方"}胜 ${Math.abs(result.margin).toFixed(1)} 目`;
});
const scoreTitle = computed(() =>
  current.value.moveNumber < MIN_SCORING_MOVES
    ? `数子将在第 ${MIN_SCORING_MOVES} 手后可用`
    : "数子",
);
const scoreEstimateLead = computed(() =>
  scoreAssessment.value?.finalMargin ?? scoreAssessment.value?.scoreLead ?? scorePreview.value?.margin ?? 0,
);
const scoreEstimateSign = computed(() => {
  const lead = scoreEstimateLead.value;
  return lead > 0 ? "+" : lead < 0 ? "-" : "±";
});
const scoreEstimateValue = computed(() => {
  return `${scoreEstimateSign.value}${Math.abs(scoreEstimateLead.value).toFixed(1)}`;
});
const scoreEstimateTone = computed(() =>
  scoreEstimateLead.value > 0
    ? "score-estimate-black"
    : scoreEstimateLead.value < 0
      ? "score-estimate-white"
      : "score-estimate-even",
);

const rulePreset = computed(() => RULE_PRESETS[gameSetup.value.ruleSet]);
const handicapLabel = computed(() => HANDICAP_OPTIONS.find((option) => option.value === gameSetup.value.handicap)?.label ?? "分先");
const matchSummary = computed(() => `${gameSetup.value.playerColor === "random" ? "猜先" : playerColor.value === "black" ? "执黑" : "执白"} · ${handicapLabel.value} · 黑贴 ${gameSetup.value.komiLabel}`);

function publishHeaderSummary() {
  const status = engineStatus.value;
  const statusTone = status?.error ? "error" : status?.warming || !status ? "busy" : status.configured ? "ready" : "idle";
  const statusLabel = status?.error
    ? "引擎异常"
    : status?.warming
      ? "引擎加载中"
      : status?.configured
        ? "引擎已连接"
        : status?.running
          ? "引擎运行中"
          : "引擎未配置";
  const strengthLabel = isAiMode.value ? ` · ${AI_STRENGTHS[aiStrength.value].label}` : "";
  window.dispatchEvent(new CustomEvent("game-header-summary", {
    detail: {
      primary: rulePreset.value.label,
      secondary: `${matchSummary.value}${strengthLabel}`,
      status: statusLabel,
      statusTone,
      statusTitle: status?.error ?? status?.detail ?? "KataGo 本地引擎状态",
    },
  }));
}

watch(
  [matchSummary, aiStrength, () => engineStatus.value?.configured, () => engineStatus.value?.running, () => engineStatus.value?.warming, () => engineStatus.value?.error],
  publishHeaderSummary,
  { immediate: true },
);

const clockOwner = computed<Stone | null>(() => {
  if (isAiMode.value) return current.value.currentPlayer === playerColor.value ? playerColor.value : null;
  return current.value.currentPlayer;
});
const timedGame = computed(() => gameSetup.value.timeControl.preset !== "untimed");
function clockLabel(side: Stone): string {
  const sideClock = clock.value[side];
  return formatClock(sideClock.mainRemaining > 0 ? sideClock.mainRemaining : sideClock.byoYomiRemaining);
}
function clockDetail(side: Stone): string {
  if (!timedGame.value) return "不计时";
  if (clock.value[side].mainRemaining > 0) return "主时间";
  return `读秒 ${clock.value[side].byoYomiPeriodsRemaining}/${gameSetup.value.timeControl.byoYomiPeriods}`;
}
const blackClockVisible = computed(() => timedGame.value && (!isAiMode.value || playerColor.value === "black"));
const whiteClockVisible = computed(() => timedGame.value && (!isAiMode.value || playerColor.value === "white"));

const lastMoveLabel = computed(() => {
  const move = current.value.lastMove;
  return move ? coordinateLabel(move.row, move.col) : "无";
});

const resultWinnerStone = computed<Stone | null>(() => current.value.result?.winner ?? null);
const resultWinnerName = computed(() =>
  resultWinnerStone.value === "black" ? blackPlayerName.value : resultWinnerStone.value === "white" ? whitePlayerName.value : "",
);
const resultWinnerSide = computed(() =>
  resultWinnerStone.value === "black" ? "黑方" : resultWinnerStone.value === "white" ? "白方" : "",
);
const gameResultCopy = computed(() => {
  const result = current.value.result;
  if (!result) return "";
  if (result.reason === "two-passes") return "双方连续停一手，胜负待计分";
  if (result.reason === "score") {
    if (result.winner === null) return "双方和棋";
    return `${resultWinnerName.value}胜 ${Math.abs(result.score?.margin ?? 0).toFixed(1)}目`;
  }
  const loser = result.loser === "black" ? blackPlayerName.value : whitePlayerName.value;
  return result.reason === "timeout" ? `${loser}超时` : `${loser}认输`;
});

const gameResultOutcome = computed(() => {
  const result = current.value.result;
  if (!result) return "";
  if (result.winner === null) return result.reason === "two-passes" ? "胜负待定" : "和棋";
  return "获胜";
});
const resultWinnerLabel = computed(() =>
  resultWinnerStone.value ? `${resultWinnerSide.value} · ${resultWinnerName.value} 获胜` : gameResultOutcome.value,
);

const confirmActionMessage = computed(() => {
  switch (pendingAction.value) {
    case "undo":
      return "确定要悔棋吗？";
    case "pass":
      return "确定要停一手吗？";
    case "resign":
      return "确定要认输吗？";
    case "reset":
      return "确定要重新开始吗？";
    default:
      return "";
  }
});

function distinctMoveInfos(result: KataGoAnalysis | null): KataGoAnalysis['moveInfos'] {
  return distinctAiCandidates(result?.moveInfos ?? []);
}

const candidates = computed<CandidateMarker[]>(() =>
  (recommendationVisible.value ? distinctMoveInfos(analysis.value) : [])
    .slice(0, 5)
    .map((candidate, index) => {
      const position = positionFromCoordinate(candidate.move);
      return position
        ? { ...position, rank: index + 1, percentage: Math.round(candidate.winrate * 100) }
        : null;
    })
    .filter((candidate): candidate is CandidateMarker => candidate !== null)
);

const displayedTerritory = computed<TerritoryMarker[]>(() =>
  gnuGoEstimateVisible.value && gnuGoEstimate.value
    ? gnuGoTerritory(current.value.board, gnuGoEstimate.value.influenceRegions)
    : [],
);
const matchScoreEstimate = computed(() =>
  gnuGoEstimateVisible.value && gnuGoEstimate.value
    ? formatGnuGoLead(gnuGoEstimate.value.scoreLead)
    : undefined,
);

const displayedDeadStones = computed<Position[]>(() => {
  if (gnuGoEstimateVisible.value && gnuGoEstimate.value && !refereeVisible.value && !scoringVisible.value) {
    return (gnuGoEstimate.value.deadStones ?? [])
      .map((coordinate) => positionFromCoordinate(coordinate))
      .filter((point): point is Position => point !== null && Boolean(current.value.board[point.row]?.[point.col]));
  }
  return [...(refereeVisible.value ? refereeResult.value?.deadStones ?? [] : scoringVisible.value ? scoreDeadStones.value : deadStones.value)]
    .map((value) => value.split(":").map(Number))
    .filter(([row, col]) => Number.isInteger(row) && Number.isInteger(col))
    .map(([row, col]) => ({ row, col }))
    .filter((point) => Boolean(current.value.board[point.row]?.[point.col]));
});

const moveNumbers = computed<MoveNumberMarker[]>(() => {
  const markers = new Map<string, MoveNumberMarker>();
  current.value.moves.forEach((move, index) => {
    const position = positionFromCoordinate(move.coordinate);
    if (!position) return;
    markers.set(`${position.row}:${position.col}`, {
      ...position,
      moveNumber: index + 1,
      stone: move.stone,
    });
  });
  return [...markers.values()].filter(
    (marker) => current.value.board[marker.row]?.[marker.col] === marker.stone
  );
});

const visibleWinrateHistory = computed(() =>
  winrateHistory.value.filter((p) => p.moveNumber <= current.value.moveNumber)
);

// ── Helpers ────────────────────────────────────────────────────────────

function stoneToGtp(stone: Stone): "B" | "W" {
  return stone === "black" ? "B" : "W";
}

function positionKey(): string {
  const history = current.value.moves
    .map((move) => `${move.stone[0]}:${move.coordinate}`)
    .join(";");
  return `${boardHash(current.value.board)}:${history}`;
}

function cacheKey(
  mode: AnalysisMode,
  strength: AnalysisStrength,
  humanProfile?: AiStrength,
  maxVisits?: number,
  key = positionKey(),
): string {
  return `${key}:${mode}:${strength}:${humanProfile ?? "none"}:${maxVisits ?? "default"}`;
}

function currentClockKey(): string {
  return `${current.value.moveNumber}:${current.value.moves.map((move) => `${move.stone[0]}${move.coordinate}`).join(";")}`;
}

function cloneClock(value: ClockState): ClockState {
  return {
    black: { ...value.black },
    white: { ...value.white },
  };
}

function initializeClock() {
  const timeControl = gameSetup.value.timeControl;
  const initialSideClock = {
    mainRemaining: timeControl.mainTimeSeconds,
    byoYomiRemaining: timeControl.byoYomiSeconds,
    byoYomiPeriodsRemaining: timeControl.byoYomiPeriods,
  };
  clock.value = {
    black: { ...initialSideClock },
    white: { ...initialSideClock },
  };
  clockSnapshots.clear();
  clockSnapshots.set(currentClockKey(), cloneClock(clock.value));
}

function rememberClock() {
  clockSnapshots.set(currentClockKey(), cloneClock(clock.value));
}

function restoreClock() {
  const saved = clockSnapshots.get(currentClockKey());
  if (saved) clock.value = cloneClock(saved);
}

function resetPlayerByoYomiAfterMove() {
  const side = clockOwner.value;
  if (!timedGame.value || !side) return;
  const byoYomiSeconds = gameSetup.value.timeControl.byoYomiSeconds;
  if (clock.value[side].mainRemaining <= 0 && clock.value[side].byoYomiPeriodsRemaining > 0 && byoYomiSeconds > 0) {
    clock.value[side].byoYomiRemaining = byoYomiSeconds;
  }
}

function playerClockIsRunning(side: Stone): boolean {
  return timedGame.value && clockOwner.value === side && !gameFinished.value && !aiThinking.value && !refereeVisible.value;
}

function handlePlayerTimeout() {
  rememberClock();
  if (!game.resign("timeout")) return;
  resultModalVisible.value = true;
}

function tickClock() {
  const side = clockOwner.value;
  if (!side || !playerClockIsRunning(side)) {
    lastClockTick = Date.now();
    return;
  }
  const now = Date.now();
  const elapsed = Math.min(1, Math.max(0, (now - lastClockTick) / 1000));
  lastClockTick = now;
  if (elapsed <= 0) return;

  const next = cloneClock(clock.value);
  const sideClock = next[side];
  if (sideClock.mainRemaining > 0) {
    sideClock.mainRemaining = Math.max(0, sideClock.mainRemaining - elapsed);
  } else if (sideClock.byoYomiRemaining > 0) {
    sideClock.byoYomiRemaining = Math.max(0, sideClock.byoYomiRemaining - elapsed);
  }

  if (sideClock.mainRemaining <= 0 && sideClock.byoYomiRemaining <= 0) {
    if (sideClock.byoYomiPeriodsRemaining > 1) {
      sideClock.byoYomiPeriodsRemaining -= 1;
      sideClock.byoYomiRemaining = gameSetup.value.timeControl.byoYomiSeconds;
    } else if (sideClock.byoYomiPeriodsRemaining === 1) {
      sideClock.byoYomiPeriodsRemaining = 0;
      sideClock.byoYomiRemaining = 0;
      clock.value = next;
      handlePlayerTimeout();
      return;
    } else {
      clock.value = next;
      handlePlayerTimeout();
      return;
    }
  }
  clock.value = next;
  rememberClock();
}

function currentKataGoMoves(): KataGoMove[] {
  return current.value.moves.map((m) => ({
    player: stoneToGtp(m.stone),
    coordinate: m.coordinate,
  }));
}

function rememberAnalysis(result: KataGoAnalysis) {
  const black = result.rootInfo.winrate * 100;
  const point: WinratePoint = {
    moveNumber: result.turnNumber,
    black,
    white: 100 - black,
    scoreLead: result.rootInfo.scoreLead,
  };
  winrateHistory.value = [
    ...winrateHistory.value.filter((p) => p.moveNumber !== point.moveNumber),
    point,
  ].sort((a, b) => a.moveNumber - b.moveNumber);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestReferee() {
  if (refereeDisabled.value) return;
  const id = crypto.randomUUID();
  let activeRequestId = id;
  const key = positionKey();
  refereeRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  refereeRequestId = id;
  refereePositionKey.value = key;
  refereeVisible.value = true;
  void nextTick(() => refereeDialog.value?.querySelector<HTMLElement>('button')?.focus());
  refereeLoading.value = true;
  refereeStage.value = 'checking';
  refereeError.value = "";
  refereeResult.value = null;
  refereeConfirmations.value = [];
  resultModalVisible.value = false;
  recommendationVisible.value = false;
  territoryVisible.value = false;
  clearShapeState();
  analysisRequestToken += 1;
  realtimeAnalysisSequence += 1;
  realtimeAnalysisLoading.value = false;
  void cancelAnalysis();
  rememberClock();
  const moves = current.value.moves.map((move) => ({ ...move }));
  const currentPlayer = current.value.currentPlayer;
  const ruleSet = gameSetup.value.ruleSet;
  const komi = refereeKomi(gameSetup.value);
  try {
    await closeGnuGoEstimate();
    if (refereeRequestId !== id || !refereeVisible.value || positionKey() !== key) return;
    const estimate = await estimateWithGnuGo(id, moves, currentPlayer, ruleSet, komi, true);
    if (refereeRequestId !== id || !refereeVisible.value || positionKey() !== key) return;
    const position = validateGnuGoEstimate(estimate, current.value.board);
    const readiness = assessGnuGoScoringReadiness(position);
    if (!readiness.ready) {
      refereeStage.value = 'unsettled';
      game.resumeAfterScore();
      // Resuming after two passes triggers the position watcher. Restore the
      // overlay after that watcher has invalidated the previous analysis.
      await nextTick();
      if (refereeRequestId === id && positionKey() === key && refereeVisible.value) {
        gnuGoEstimate.value = position;
        gnuGoEstimateVisible.value = true;
      }
      return;
    }
    gnuGoEstimate.value = position;
    gnuGoEstimateVisible.value = true;
    refereeStage.value = 'scoring';
    void nextTick(() => refereeDialog.value?.querySelector<HTMLElement>('button')?.focus());
    // Each isolated process has its own cancellation ID; completed IDs cannot
    // be reused because the backend remembers them to handle early cancellation.
    const scoringId = crypto.randomUUID();
    activeRequestId = scoringId;
    refereeRequestId = scoringId;
    const result = await adjudicateWithGnuGo(scoringId, moves, ruleSet, komi);
    if (refereeRequestId !== scoringId || positionKey() !== key || !refereeVisible.value) return;
    refereeResult.value = createRefereeScore(result, current.value.board, ruleSet, komi);
  } catch (error) {
    if (refereeRequestId === activeRequestId && refereeVisible.value && positionKey() === key) {
      refereeStage.value = 'scoring';
      refereeError.value = errorText(error);
      void nextTick(() => refereeDialog.value?.querySelector<HTMLElement>('button')?.focus());
    }
  } finally {
    if (refereeRequestId === activeRequestId) refereeLoading.value = false;
  }
}

async function requestGnuGoEstimate() {
  if (gnuGoEstimateLoading.value || gnuGoEstimateDisabled.value) return;
  const requestId = crypto.randomUUID();
  const key = positionKey();
  gnuGoEstimateRequestId = requestId;
  gnuGoEstimateVisible.value = false;
  gnuGoEstimateLoading.value = true;
  gnuGoEstimateError.value = "";
  gnuGoEstimate.value = null;
  try {
    const result = await estimateWithGnuGo(
      requestId,
      current.value.moves.map((move) => ({ ...move })),
      current.value.currentPlayer,
      gameSetup.value.ruleSet,
      refereeKomi(gameSetup.value),
    );
    if (gnuGoEstimateRequestId !== requestId || positionKey() !== key) return;
    gnuGoEstimate.value = validateGnuGoEstimate(result, current.value.board);
    gnuGoEstimateVisible.value = true;
    clearShapeState();
  } catch (error) {
    if (gnuGoEstimateRequestId === requestId) gnuGoEstimateError.value = errorText(error);
  } finally {
    if (gnuGoEstimateRequestId === requestId) gnuGoEstimateLoading.value = false;
  }
}

function closeGnuGoEstimate(): Promise<void> {
  const requestId = gnuGoEstimateRequestId;
  gnuGoEstimateRequestId = null;
  gnuGoEstimateVisible.value = false;
  gnuGoEstimateLoading.value = false;
  gnuGoEstimateError.value = "";
  gnuGoEstimate.value = null;
  return requestId ? cancelGnuGoRequest(requestId).catch(() => {}) : Promise.resolve();
}

function closeReferee(resumeGame = true) {
  const id = refereeRequestId;
  const estimate = resumeGame && gnuGoEstimateVisible.value ? gnuGoEstimate.value : null;
  const key = positionKey();
  refereeRequestId = null;
  if (id) void cancelGnuGoAdjudication(id).catch(() => {});
  refereeVisible.value = false;
  refereeLoading.value = false;
  refereeResult.value = null;
  refereeError.value = "";
  refereeConfirmations.value = [];
  if (resumeGame) game.resumeAfterScore();
  if (!resumeGame) void closeGnuGoEstimate();
  lastClockTick = Date.now();
  if (resumeGame) void nextTick(() => {
    // Two-pass resumption changes status and clears analysis in the watcher.
    // Preserve the completed estimate only while the original position remains.
    if (estimate && positionKey() === key && !refereeVisible.value && !gameFinished.value) {
      gnuGoEstimate.value = estimate;
      gnuGoEstimateVisible.value = true;
    }
    refereeRestoreFocus?.focus();
  });
}

function handleRefereeKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeReferee();
    return;
  }
  if (event.key !== 'Tab' || !refereeDialog.value) return;
  const buttons = [...refereeDialog.value.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const first = buttons[0];
  const last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function confirmReferee(side: Stone) {
  const result = refereeResult.value;
  if (!result || refereeLoading.value || refereeConfirmations.value.includes(side)) return;
  if (positionKey() !== refereePositionKey.value) {
    refereeError.value = "棋盘已变化，请取消后重新申请数子";
    return;
  }
  refereeConfirmations.value = [...refereeConfirmations.value, side];
  if (refereeConfirmations.value.length < 2) return;
  const winner = result.margin > 0 ? "black" : result.margin < 0 ? "white" : null;
  if (!game.score(winner, result)) {
    refereeError.value = game.message;
    refereeConfirmations.value = [];
    return;
  }
  closeReferee(false);
  resultModalVisible.value = true;
}

function showEngineError(error: unknown) {
  const detail = errorText(error);
  engineStatus.value = {
    configured: engineStatus.value?.configured ?? true,
    running: false,
    detail: engineStatus.value?.detail ?? detail,
    error: detail,
  };
}

function clearEngineError() {
  if (!engineStatus.value?.error) return;
  const { error: _error, ...healthyStatus } = engineStatus.value;
  engineStatus.value = healthyStatus;
}

// ── Core analysis function ─────────────────────────────────────────────

async function runAnalysis(
  mode: AnalysisMode,
  strength: AnalysisStrength = "normal",
  humanProfile?: AiStrength,
  maxVisits?: number,
): Promise<KataGoAnalysis | null> {
  const token = ++analysisRequestToken;
  const generation = gameGeneration;
  const moveNumber = current.value.moveNumber;
  const moves = currentKataGoMoves();
  const key = cacheKey(mode, strength, humanProfile, maxVisits);

  // Return cached result immediately if available
  const cached = analysisCache.get(key);
  if (cached && cached.ownership?.length === 361) {
    if (
      token === analysisRequestToken &&
      generation === gameGeneration &&
      current.value.moveNumber === moveNumber
    ) {
      return cached;
    }
    return null; // stale request
  }

  try {
    const result = await analyzePosition(
      moves,
      mode,
      strength,
      humanProfile,
      gameSetup.value.ruleSet,
      gameSetup.value.komi,
      gameSetup.value.handicap,
      maxVisits,
    );
    if (generation !== gameGeneration) return null;
    if (token !== analysisRequestToken) return null;
    if (current.value.moveNumber !== moveNumber) return null;

    analysisCache.set(key, result);
    rememberAnalysis(result);
    clearEngineError();
    void refreshEngineStatus();
    return result;
  } catch (error) {
    if (token === analysisRequestToken) showEngineError(error);
    return null;
  } finally {
    // Loading flags are cleared by the public trigger that started this run.
  }
}

async function requestRealtimeAnalysis() {
  if (isAiMode.value || gameFinished.value) return;
  const sequence = ++realtimeAnalysisSequence;
  const generation = gameGeneration;
  const moveNumber = current.value.moveNumber;
  realtimeAnalysisLoading.value = true;
  try {
    const result = await runAnalysis("fast", "beginner", undefined, RECOMMENDATION_BUDGETS.low);
    if (
      sequence === realtimeAnalysisSequence
      && generation === gameGeneration
      && current.value.moveNumber === moveNumber
      && result
    ) {
      analysis.value = result;
    }
  } finally {
    if (sequence === realtimeAnalysisSequence) realtimeAnalysisLoading.value = false;
  }
}

function calculateCurrentScore(dead: Set<string>) {
  return calculateScore(current.value.board, dead, gameSetup.value.komi, {
    ruleSet: gameSetup.value.ruleSet,
    capturedByBlack: current.value.capturedByBlack,
    capturedByWhite: current.value.capturedByWhite,
  });
}

function scoreSummary(score: ReturnType<typeof calculateScore>) {
  return `黑方 ${score.blackScore.toFixed(1)}，白方 ${score.whiteScore.toFixed(1)}，${Math.abs(score.margin).toFixed(1)} 目`;
}

function updateScorePreview() {
  scorePreview.value = calculateCurrentScore(scoreDeadStones.value);
}

function toggleScoringGroup(row: number, col: number) {
  const stone = current.value.board[row]?.[col];
  if (!stone) return;
  const groupPoints = collectGroupForScoring(current.value.board, { row, col });
  const shouldRemove = groupPoints.some((point) => scoreDeadStones.value.has(`${point.row}:${point.col}`));
  const next = new Set(scoreDeadStones.value);
  groupPoints.forEach((point) => {
    const pointKey = `${point.row}:${point.col}`;
    if (shouldRemove) next.delete(pointKey);
    else next.add(pointKey);
  });
  scoreDeadStones.value = next;
  updateScorePreview();
}

function collectGroupForScoring(board: Board, start: Position): Position[] {
  const stone = board[start.row]?.[start.col];
  if (!stone) return [];
  const group: Position[] = [];
  const queue = [start];
  const visited = new Set<string>();
  while (queue.length) {
    const point = queue.pop()!;
    const pointKey = `${point.row}:${point.col}`;
    if (visited.has(pointKey) || board[point.row]?.[point.col] !== stone) continue;
    visited.add(pointKey);
    group.push(point);
    for (const next of [
      { row: point.row - 1, col: point.col },
      { row: point.row + 1, col: point.col },
      { row: point.row, col: point.col - 1 },
      { row: point.row, col: point.col + 1 },
    ]) {
      if (next.row >= 0 && next.col >= 0 && next.row < board.length && next.col < board[0].length) queue.push(next);
    }
  }
  return group;
}

function closeScoring(resumeGame = true) {
  scoreRequestToken.value += 1;
  scoringVisible.value = false;
  scoringLoading.value = false;
  scoringError.value = "";
  territoryVisible.value = false;
  analysis.value = null;
  scoreAssessment.value = null;
  scorePreview.value = null;
  scoreDeadStones.value = new Set();
  if (resumeGame && isAiMode.value && aiTurn.value && !gameFinished.value && !scoreProposalVisible.value) {
    void playAiMove();
  }
  if (resumeGame && !isAiMode.value) game.resumeAfterScore();
}

async function startScoring() {
  if (scoringLoading.value) return;
  void closeGnuGoEstimate();
  if (!isAiMode.value) {
    if (!twoPassesAwaitingScore.value && current.value.moveNumber < MIN_SCORING_MOVES) return;
    scoringVisible.value = true;
    territoryVisible.value = false;
    analysis.value = null;
    recommendationVisible.value = false;
    scoringLoading.value = false;
    scoringError.value = "";
    scoreDeadStones.value = new Set();
    updateScorePreview();
    return;
  }
  if (current.value.moveNumber < MIN_SCORING_MOVES || gameFinished.value) return;
  const token = ++scoreRequestToken.value;
  scoringVisible.value = true;
  territoryVisible.value = false;
  analysis.value = null;
  recommendationVisible.value = false;
  scoringLoading.value = true;
  scoringError.value = "";
  try {
    const result = await runAnalysis("deep", "strong", undefined, 5000);
    if (token !== scoreRequestToken.value || !result || gameFinished.value) return;
    const terminal = await finalScore(currentKataGoMoves(), gameSetup.value.ruleSet, gameSetup.value.komi);
    const terminalDeadStones = new Set(
      terminal.deadStones
        .map((coordinate) => positionFromCoordinate(coordinate))
        .filter((point): point is Position => point !== null)
        .filter((point) => Boolean(current.value.board[point.row]?.[point.col]))
        .map((point) => `${point.row}:${point.col}`),
    );
    const assessment = assessPositionStability(current.value.board, result, {
      deadStones: terminalDeadStones,
      finalScore: terminal.finalScore,
    });
    scoreAssessment.value = assessment;
    scoreDeadStones.value = terminalDeadStones;
    updateScorePreview();
    scoringVisible.value = true;
  } catch (error) {
    scoringError.value = errorText(error);
  } finally {
    if (token === scoreRequestToken.value) scoringLoading.value = false;
  }
}

function rejectScoreProposal() {
  scoreProposalVisible.value = false;
  scoreProposalCooldown.value = 5;
  scoreProposalText.value = "";
  void playAiMove();
}

async function acceptScoreProposal() {
  scoreProposalVisible.value = false;
  await startScoring();
}

function confirmScore() {
  const preview = scorePreview.value;
  if (!preview || (isAiMode.value && !scoreAssessment.value?.stable)) return;
  const winner = preview.margin > 0 ? "black" : preview.margin < 0 ? "white" : null;
  const score: GameScore = {
    ...preview,
    deadStones: [...scoreDeadStones.value],
  };
  scoreApplication.value = true;
  closeScoring(false);
  if (game.score(winner, score)) resultModalVisible.value = true;
  scoreApplication.value = false;
}

function recommendationStable(previous: KataGoAnalysis, next: KataGoAnalysis): boolean {
  const previousCandidates = distinctMoveInfos(previous).slice(0, 3).map((candidate) => candidate.move);
  const nextCandidates = distinctMoveInfos(next).slice(0, 3).map((candidate) => candidate.move);
  if (!previousCandidates.length || previousCandidates[0] !== nextCandidates[0]) return false;
  const sameLeadingCandidates = previousCandidates.every((move, index) => move === nextCandidates[index]);
  const winrateDelta = Math.abs(previous.rootInfo.winrate - next.rootInfo.winrate);
  const scoreDelta = Math.abs(previous.rootInfo.scoreLead - next.rootInfo.scoreLead);
  return sameLeadingCandidates && winrateDelta <= 0.015 && scoreDelta <= 1;
}

async function runAutomaticRecommendation(): Promise<KataGoAnalysis | null> {
  let previous: KataGoAnalysis | null = null;
  for (const maxVisits of AUTO_RECOMMENDATION_BUDGETS) {
    const result = await runAnalysis("fast", "normal", undefined, maxVisits);
    if (!result) return null;
    if (previous && recommendationStable(previous, result)) return result;
    previous = result;
  }
  return previous;
}

// ── Public-facing triggers ─────────────────────────────────────────────

async function requestRecommendations() {
  if (analysisLocked.value || analysisBusy.value) return;
  const generation = gameGeneration;
  const moveNumber = current.value.moveNumber;
  recommendationLoading.value = true;
  recommendationVisible.value = false;
  try {
    const result = recommendationStrength.value === "auto"
      ? await runAutomaticRecommendation()
      : await runAnalysis(
          "fast",
          recommendationAnalysisStrength(recommendationStrength.value),
          undefined,
          RECOMMENDATION_BUDGETS[recommendationStrength.value],
        );
    if (
      result &&
      generation === gameGeneration &&
      current.value.moveNumber === moveNumber
    ) {
      analysis.value = result;
      recommendationVisible.value = true;
    }
  } finally {
    recommendationLoading.value = false;
  }
}

function closeRecommendations() {
  recommendationVisible.value = false;
}

async function requestTerritory() {
  await requestGnuGoEstimate();
}

function closeTerritory() {
  void closeGnuGoEstimate();
  clearShapeState();
}

function chooseAiMove(result: KataGoAnalysis): string | null {
  const topMove = result.moveInfos.find((candidate) => candidate.order === 0);
  if (topMove?.move.trim().toLowerCase() === "pass") return "pass";

  const moveInfos = distinctMoveInfos(result);
  return selectHumanPolicyMove(moveInfos, {
    strength: aiStrength.value,
    aiColor: aiColor.value,
  });
}

async function playAiMove() {
  if (
    !isAiMode.value ||
    current.value.currentPlayer !== aiColor.value ||
    aiThinking.value
  )
    return;
  const token = ++aiRequestToken;
  const requestedMoveNumber = current.value.moveNumber;
  const requestedStrength = aiStrength.value;

  aiThinking.value = true;
  try {
    // Use whatever result we have (cache or fresh fast analysis)
    const key = cacheKey("fast", "normal", requestedStrength);
    let result = analysisCache.get(key) ?? null;
    if (!result) {
      result = await analyzePosition(
        currentKataGoMoves(),
        "fast",
        "normal",
        requestedStrength,
        gameSetup.value.ruleSet,
        gameSetup.value.komi,
        gameSetup.value.handicap,
      );
      if (
        token !== aiRequestToken ||
        current.value.moveNumber !== requestedMoveNumber ||
        current.value.currentPlayer !== aiColor.value
      )
        return;
      analysisCache.set(key, result);
      rememberAnalysis(result);
    }

    if (
      token !== aiRequestToken ||
      current.value.moveNumber !== requestedMoveNumber ||
      current.value.currentPlayer !== aiColor.value
    )
      return;

    clearEngineError();

    if (scoreProposalCooldown.value === 0 && current.value.moveNumber >= MIN_SCORING_MOVES) {
      const preliminary = assessPositionStability(current.value.board, result);
      if (preliminary.stable) {
        const verification = await runAnalysis("deep", "strong", undefined, 5000);
        if (
          token !== aiRequestToken ||
          current.value.moveNumber !== requestedMoveNumber ||
          current.value.currentPlayer !== aiColor.value
        ) return;
        let stability = verification
          ? assessPositionStability(current.value.board, verification)
          : preliminary;
        if (verification) {
          try {
            const terminal = await finalScore(currentKataGoMoves(), gameSetup.value.ruleSet, gameSetup.value.komi);
            const terminalDeadStones = new Set(
              terminal.deadStones
                .map((coordinate) => positionFromCoordinate(coordinate))
                .filter((point): point is Position => point !== null)
                .filter((point) => Boolean(current.value.board[point.row]?.[point.col]))
                .map((point) => `${point.row}:${point.col}`),
            );
            stability = assessPositionStability(current.value.board, verification, {
              deadStones: terminalDeadStones,
              finalScore: terminal.finalScore,
            });
          } catch {
            // A GTP final-score probe is advisory. The AI can continue playing
            // when the optional terminal query is unavailable.
          }
        }
        if (stability.stable) {
          scoreProposalText.value = `预计${stability.winner === "black" ? "黑方" : "白方"}领先 ${Math.abs(stability.scoreLead).toFixed(1)} 目，局面已稳定`;
          scoreProposalVisible.value = true;
          aiThinking.value = false;
          return;
        }
      }
    }

    // Analysis utility is reported from Black's perspective. The AI is White
    // in this mode, so negate it before applying the resignation threshold.
    const aiUtility = aiColor.value === "black" ? result.rootInfo.utility : -result.rootInfo.utility;
    if (requestedMoveNumber >= MIN_AI_RESIGN_MOVES) {
      const resignation = updateResignationStreak(aiResignStreak, aiUtility, requestedStrength);
      aiResignStreak = resignation.streak;
      if (resignation.shouldResign) {
        if (!game.resign()) throw new Error("棋局无法记录 KataGo 认输");
        resultModalVisible.value = true;
        return;
      }
    } else {
      // Do not accumulate resignation evidence during the opening and early
      // middle game. The streak starts fresh once 75 moves are complete.
      aiResignStreak = 0;
    }

    const selectedMove = chooseAiMove(result);
    if (!selectedMove) throw new Error("KataGo 没有返回候选点");
    const normalizedMove = selectedMove.trim().toLowerCase();
    if (normalizedMove === "resign") {
      if (requestedMoveNumber >= MIN_AI_RESIGN_MOVES) {
        // KataGo can resign when its configured resignation threshold is met.
        // Treat it as a normal game result instead of an invalid board move.
        if (!game.resign()) throw new Error("棋局无法记录 KataGo 认输");
        resultModalVisible.value = true;
      } else {
        // Ignore an engine resignation before the 75-move floor and use the
        // best legal non-resignation candidate instead.
        const fallbackMove = result.moveInfos.find((candidate) => {
          const move = candidate.move.trim().toLowerCase();
          return move !== "pass" && move !== "resign";
        })?.move;
        const fallbackPosition = fallbackMove ? positionFromCoordinate(fallbackMove) : null;
        if (!fallbackPosition || !game.play(fallbackPosition.row, fallbackPosition.col)) {
          throw new Error("KataGo 在认输保护期内没有返回有效落点");
        }
      }
    } else if (normalizedMove === "pass") {
      game.pass();
      if (current.value.status === "finished") resultModalVisible.value = true;
    } else {
      const position = positionFromCoordinate(selectedMove);
      if (!position || !game.play(position.row, position.col)) {
        throw new Error(`KataGo 返回了无效落点 ${selectedMove}`);
      }
    }
    // The move is already committed. Status refresh is informative only and
    // must not keep the board locked while the next player is ready to move.
    aiThinking.value = false;
    void refreshEngineStatus();
  } catch (error) {
    if (token === aiRequestToken) showEngineError(error);
  } finally {
    if (token === aiRequestToken || !aiTurn.value || gameFinished.value) {
      aiThinking.value = false;
    }
  }
}

// ── Engine status ──────────────────────────────────────────────────────

async function refreshEngineStatus() {
  try {
    engineStatus.value = await getEngineStatus();
  } catch (error) {
    showEngineError(error);
  }
}

// ── Event handlers ─────────────────────────────────────────────────────

function invalidateAiRequest() {
  aiRequestToken += 1;
  aiThinking.value = false;
}

function clearShapeState() {
  deadStones.value = new Set();
}

function handlePlace(row: number, col: number) {
  if (scoringVisible.value) {
    toggleScoringGroup(row, col);
    return;
  }
  if (boardLocked.value) return;
  void cancelAnalysis();
  analysisRequestToken += 1;
  recommendationLoading.value = false;
  territoryLoading.value = false;
  recommendationVisible.value = false;
  territoryVisible.value = false;
  analysis.value = null;
  clearShapeState();
  resetPlayerByoYomiAfterMove();
  rememberClock();
  game.play(row, col);
}

function requestAction(action: ConfirmAction) {
  if (action !== "reset" && boardLocked.value) return;
  if (action === "pass" && current.value.moveNumber === 0) return;
  if (action === "undo" && (!canUndo.value || timelineLocked.value)) return;
  pendingAction.value = action;
}

function handlePass() {
  requestAction("pass");
}

function handleResign() {
  requestAction("resign");
}

function closeResultModal() {
  resultModalVisible.value = false;
}

function returnToMenu() {
  closeResultModal();
  router.push({ name: "mode-select" });
}

function startAnotherGame() {
  closeResultModal();
  performReset();
}

function handleResultModalKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (refereeVisible.value) {
    closeReferee();
    return;
  }
  if (gameSettingsVisible.value) {
    gameSettingsVisible.value = false;
    return;
  }
  if (pendingAction.value) {
    pendingAction.value = null;
  } else if (resultModalVisible.value) {
    closeResultModal();
  }
}

function performUndo() {
  invalidateAiRequest();
  void cancelAnalysis();
  aiResignStreak = 0;
  clearShapeState();
  rememberClock();
  game.undo();
  if (
    isAiMode.value &&
    current.value.currentPlayer === aiColor.value &&
    canUndo.value
  )
    game.undo();
  restoreClock();
}

function handleUndo() {
  requestAction("undo");
}

function performReset() {
  closeGnuGoEstimate();
  closeReferee(false);
  invalidateAiRequest();
  void cancelAnalysis();
  aiResignStreak = 0;
  scoreProposalCooldown.value = 0;
  scoreProposalVisible.value = false;
  closeScoring(false);
  lastObservedMoveNumber.value = 0;
  clearShapeState();
  gameGeneration += 1;
  analysisRequestToken += 1;
  analysis.value = null;
  recommendationVisible.value = false;
  territoryVisible.value = false;
  analysisCache.clear();
  winrateHistory.value = [];
  game.reset(gameSetup.value.handicap);
  initializeClock();
}

function handleReset() {
  requestAction("reset");
}

function cancelPendingAction() {
  pendingAction.value = null;
}

function confirmPendingAction() {
  const action = pendingAction.value;
  pendingAction.value = null;
  if (!action) return;

  switch (action) {
    case "undo":
      performUndo();
      break;
    case "pass":
      void cancelAnalysis();
      resetPlayerByoYomiAfterMove();
      rememberClock();
      game.pass();
      if (current.value.status === "finished" && twoPassesAwaitingScore.value && !isAiMode.value) {
        void requestReferee();
      } else if (current.value.status === "finished") {
        resultModalVisible.value = true;
      }
      break;
    case "resign":
      invalidateAiRequest();
      void cancelAnalysis();
      if (game.resign()) resultModalVisible.value = true;
      break;
    case "reset":
      performReset();
      break;
  }
}

// ── Reactive triggers ─────────────────────────────────────────────────

// Position changes invalidate manual analysis. No analysis starts in the
// background; the user explicitly requests recommendation or territory data.
watch(
  () => [
    current.value.moveNumber,
    current.value.currentPlayer,
    current.value.handicapRemaining,
    current.value.status,
  ] as const,
  () => {
    if (current.value.moveNumber > lastObservedMoveNumber.value) {
      scoreProposalCooldown.value = Math.max(0, scoreProposalCooldown.value - (current.value.moveNumber - lastObservedMoveNumber.value));
    }
    lastObservedMoveNumber.value = current.value.moveNumber;
    analysisRequestToken += 1;
    recommendationLoading.value = false;
    territoryLoading.value = false;
    recommendationVisible.value = false;
    territoryVisible.value = false;
    clearShapeState();
    analysis.value = null;
    closeGnuGoEstimate();

    if (gameFinished.value) return;

    restoreClock();
    if (isAiMode.value && aiTurn.value) {
      void playAiMove();
    } else if (!isAiMode.value) {
      void requestRealtimeAnalysis();
    }
  }
);

watch(gameFinished, (finished) => {
  if (finished && !(twoPassesAwaitingScore.value && !isAiMode.value)) resultModalVisible.value = true;
});

// ── Lifecycle ──────────────────────────────────────────────────────────

onMounted(async () => {
  window.addEventListener("open-game-settings", openGameSettings);
  window.addEventListener("keydown", handleResultModalKeydown);
  publishHeaderSummary();
  game.reset(gameSetup.value.handicap);
  initializeClock();
  clockTimer = setInterval(tickClock, 100);
  await refreshEngineStatus();
  publishHeaderSummary();
  if (aiTurn.value) void playAiMove();
  else if (!isAiMode.value) void requestRealtimeAnalysis();
});

onBeforeUnmount(() => {
  closeReferee(false);
  window.removeEventListener("open-game-settings", openGameSettings);
  window.removeEventListener("keydown", handleResultModalKeydown);
  void cancelAnalysis();
  if (clockTimer) clearInterval(clockTimer);
});

function setImmersiveMode(value: boolean) {
  immersiveEnabled.value = value;
  document.documentElement.dataset.immersive = value ? "true" : "false";
  window.dispatchEvent(new CustomEvent("game-immersive-change", { detail: value }));
}

function openGameSettings() {
  if (refereeVisible.value) return;
  gameSettingsVisible.value = true;
}

function setRecommendationEnabled(value: boolean) {
  recommendationEnabled.value = value;
  if (!value) {
    recommendationVisible.value = false;
    recommendationLoading.value = false;
  }
}

function setBoardStyle(value: BoardStyle) {
  boardStyle.value = value;
  saveBoardStyle(value);
}

</script>

<template>
  <div class="workspace" :class="{ immersive: immersiveEnabled }">
    <main class="game-area">
      <PlayerHeader
        :black-name="blackPlayerName"
        :white-name="whitePlayerName"
        :black-time="blackClockVisible ? clockLabel('black') : undefined"
        :white-time="whiteClockVisible ? clockLabel('white') : undefined"
        :black-clock-detail="blackClockVisible ? clockDetail('black') : undefined"
        :white-clock-detail="whiteClockVisible ? clockDetail('white') : undefined"
        :black-clock-running="playerClockIsRunning('black')"
        :white-clock-running="playerClockIsRunning('white')"
        :move-number="current.moveNumber"
        :current-player="current.currentPlayer"
        :last-move-label="lastMoveLabel"
        :score-estimate="matchScoreEstimate"
      />

      <div class="board-stage">
        <GoBoard
          :board="current.board"
          :current-player="current.currentPlayer"
          :last-move="current.lastMove"
          :candidates="candidates"
          :territory="displayedTerritory"
          territory-mode="ai"
          :show-star-points="true"
          :show-coordinates="coordinatesEnabled"
          :dead-stones="displayedDeadStones"
          :move-numbers="moveNumbers"
          :show-move-numbers="moveNumbersEnabled"
          :board-style="boardStyle"
          :disabled="scoringVisible || scoringLoading || boardLocked"
          :busy="aiThinking"
          @place="handlePlace"
        />
      </div>

    </main>
    <ControlsPanel
        :recommendation-visible="recommendationVisible"
        :territory-visible="territoryVisible"
        v-model:moveNumbersEnabled="moveNumbersEnabled"
        :locked="analysisLocked"
        :recommendation-enabled="recommendationEnabled"
        :analysis-default-visible="isAiMode"
        :engine-status="engineStatus"
        :recommendation-loading="recommendationLoading"
        :territory-loading="territoryLoading"
        :territory-disabled="gnuGoEstimateDisabled"
        :territory-error="gnuGoEstimateError"
        :analysis-busy="analysisBusy || (aiThinking && !gameFinished)"
        :analysis="analysis"
        :history="visibleWinrateHistory"
        :perspective="winratePerspective"
        :can-undo="canUndo"
        :pass-disabled="passDisabled"
        :resign-disabled="boardLocked"
        :reset-disabled="aiThinking || refereeVisible"
        :timeline-locked="timelineLocked"
        :game-finished="gameFinished"
        :score-visible="!isAiMode"
        :score-disabled="scoreDisabled"
        :score-title="scoreTitle"
        :referee-visible="!isAiMode"
        :referee-disabled="refereeDisabled"
        @request-recommendation="requestRecommendations"
        @close-recommendation="closeRecommendations"
        @request-territory="requestTerritory"
        @close-territory="closeTerritory"
        @update:perspective="winratePerspective = $event"
        @undo="handleUndo"
        @pass="handlePass"
        @resign="handleResign"
        @score="startScoring"
        @referee="requestReferee"
        @reset="handleReset"
    />
  </div>

  <div v-if="refereeVisible" class="result-modal-backdrop confirm-modal-backdrop">
    <section ref="refereeDialog" class="result-modal confirm-modal referee-modal" :class="{ 'referee-detailed': refereeResult || refereeError }" role="dialog" aria-modal="true" aria-labelledby="referee-title" @keydown="handleRefereeKeydown">
      <div class="result-modal-heading">
        <button class="result-modal-close" type="button" aria-label="取消数子申请" title="关闭" @click="closeReferee()"><X :size="18" stroke-width="2" aria-hidden="true" /></button>
      </div>
      <div class="result-modal-body">
        <div v-if="refereeLoading" class="scoring-loading" role="status" aria-live="polite">
          <LoaderCircle class="spin" :size="28" aria-hidden="true" />
          <h2 id="referee-title">{{ refereeStage === 'checking' ? '正在检查收官状态' : '正在计算胜负' }}</h2>
        </div>
        <template v-else-if="refereeStage === 'unsettled'">
          <h2 id="referee-title">尚未收官，暂不能数子</h2>
        </template>
        <template v-else-if="refereeResult">
          <h2 id="referee-title">{{ refereeSummary }}</h2>
          <p class="result-modal-hint">{{ rulePreset.label }} · 贴 {{ refereeResult.komi }} 目 · 死子 {{ refereeResult.deadStones.length }} 颗</p>
          <p class="score-state stable" role="status" aria-live="polite">{{ refereeConfirmations.length ? '等待另一方确认' : '等待双方确认' }}</p>
          <div class="referee-confirmations">
            <button class="result-action" type="button" :disabled="refereeConfirmations.includes('black')" @click="confirmReferee('black')">
              <CheckCircle2 v-if="refereeConfirmations.includes('black')" :size="16" aria-hidden="true" />{{ refereeConfirmations.includes('black') ? '黑方已确认' : '黑方确认' }}
            </button>
            <button class="result-action" type="button" :disabled="refereeConfirmations.includes('white')" @click="confirmReferee('white')">
              <CheckCircle2 v-if="refereeConfirmations.includes('white')" :size="16" aria-hidden="true" />{{ refereeConfirmations.includes('white') ? '白方已确认' : '白方确认' }}
            </button>
          </div>
        </template>
        <h2 v-else id="referee-title">数子未完成</h2>
        <p v-if="refereeError" class="score-error" role="alert">{{ refereeError }}</p>
      </div>
      <div class="result-modal-actions">
        <button class="result-action primary" type="button" @click="closeReferee()">继续对局</button>
      </div>
    </section>
  </div>

  <div v-if="scoreProposalVisible && !pendingAction" class="result-modal-backdrop confirm-modal-backdrop">
    <section class="result-modal score-proposal-modal" role="dialog" aria-modal="true" aria-labelledby="score-proposal-title">
      <div class="result-modal-heading">
        <span>数子申请</span>
      </div>
      <div class="result-modal-body">
        <div class="result-modal-mark" aria-hidden="true"><CheckCircle2 :size="24" /></div>
        <h2 id="score-proposal-title">KataGo 申请数子</h2>
        <p class="result-modal-hint">{{ scoreProposalText }}</p>
        <p class="result-modal-hint">确认后将进入死子确认，仍可手动修正。</p>
      </div>
      <div class="result-modal-actions result-modal-actions-separated">
        <button class="result-action" type="button" @click="rejectScoreProposal">继续对局</button>
        <button class="result-action primary" type="button" @click="acceptScoreProposal">同意数子</button>
      </div>
    </section>
  </div>

  <div v-if="scoringVisible && !pendingAction" class="result-modal-backdrop score-modal-backdrop">
    <section class="result-modal scoring-modal" role="dialog" aria-modal="true" aria-labelledby="scoring-title">
      <div class="result-modal-heading">
        <span>确认数子</span>
        <button class="result-modal-close" type="button" aria-label="关闭数子" title="关闭" @click="() => closeScoring()">
          <X :size="18" stroke-width="2" aria-hidden="true" />
        </button>
      </div>
      <div class="result-modal-body scoring-body">
        <div v-if="scoringLoading" class="scoring-loading" role="status" aria-live="polite">
          <LoaderCircle class="spin" :size="28" aria-hidden="true" />
          <h2 id="scoring-title">正在数子</h2>
          <p class="result-modal-hint">KataGo 正在确认终局状态，请稍候</p>
        </div>
        <template v-else-if="!isAiMode || scoreAssessment?.stable">
          <h2 id="scoring-title">{{ scorePreview ? scoreSummary(scorePreview) : "数子完成" }}</h2>
          <p class="score-state stable">{{ isAiMode ? "局面稳定，可以确认结果" : "双方确认棋块后，可以确认结果" }}</p>
          <p class="result-modal-hint">点击棋块可标记为死子，再次点击恢复。</p>
        </template>
        <template v-else>
          <h2 id="scoring-title">仍有未定领地，暂不能结束对局</h2>
          <p class="score-state unsettled">
            预估目数差<span class="score-estimate-value" :class="scoreEstimateTone">{{ scoreEstimateValue }}</span>目
          </p>
        </template>
        <p v-if="scoringError" class="score-error" role="alert">{{ scoringError }}</p>
      </div>
      <div class="result-modal-actions result-modal-actions-separated">
        <template v-if="(!isAiMode || scoreAssessment?.stable) && !scoringLoading">
          <button class="result-action" type="button" @click="() => closeScoring()">继续对局</button>
          <button class="result-action primary" type="button" :disabled="!scorePreview" @click="confirmScore">确认结果</button>
        </template>
        <button v-else class="result-action primary" type="button" @click="() => closeScoring()">继续对局</button>
      </div>
    </section>
  </div>

  <GameSettingsDialog
    :open="gameSettingsVisible"
    :coordinates-enabled="coordinatesEnabled"
    :immersive-enabled="immersiveEnabled"
    :local-mode="!isAiMode"
    :recommendation-enabled="recommendationEnabled"
    :board-style="boardStyle"
    :recommendation-strength="recommendationStrength"
    @close="gameSettingsVisible = false"
    @update:coordinates-enabled="coordinatesEnabled = $event"
    @update:immersive-enabled="setImmersiveMode"
    @update:recommendation-enabled="setRecommendationEnabled"
    @update:board-style="setBoardStyle"
    @update:recommendation-strength="recommendationStrength = $event"
  />

  <div v-if="resultModalVisible && gameFinished && !pendingAction" class="result-modal-backdrop">
    <section
      class="result-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-modal-title"
    >
      <div class="result-modal-heading">
        <span>本局结果</span>
        <button
          class="result-modal-close"
          type="button"
          aria-label="关闭结果弹窗"
          title="关闭"
          @click="closeResultModal"
        >
          <X :size="18" stroke-width="2" aria-hidden="true" />
        </button>
      </div>
      <div class="result-modal-body">
        <div class="result-outcome-row">
          <h2 id="result-modal-title">{{ resultWinnerLabel }}</h2>
        </div>
        <p class="result-modal-hint result-copy">{{ gameResultCopy }}</p>
      </div>
      <div class="result-modal-actions result-modal-actions-separated">
        <button class="result-action" type="button" @click="startAnotherGame">
          再来一局
        </button>
        <button class="result-action primary" type="button" @click="returnToMenu">
          确定
        </button>
      </div>
    </section>
  </div>

  <SaveGameRecord v-if="gameFinished" :snapshot="current" :black="blackPlayerName" :white="whitePlayerName" :rule-set="gameSetup.ruleSet" :komi="refereeKomi(gameSetup)" auto history-only />

  <div v-if="pendingAction" class="result-modal-backdrop confirm-modal-backdrop">
    <section
      class="result-modal confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div class="result-modal-heading">
        <button
          class="result-modal-close"
          type="button"
          aria-label="关闭确认弹窗"
          title="关闭"
          @click="cancelPendingAction"
        >
          <X :size="18" stroke-width="2" aria-hidden="true" />
        </button>
      </div>
      <div class="result-modal-body">
        <h2 id="confirm-modal-title">{{ confirmActionMessage }}</h2>
      </div>
      <div class="result-modal-actions">
        <button
          class="result-action primary"
          type="button"
          @click="confirmPendingAction"
        >
          确认
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.referee-confirmations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; width: 100%; }
.referee-confirmations .result-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 44px; white-space: normal; }
.referee-confirmations .result-action:disabled { opacity: .65; cursor: default; }
.workspace {
  display: grid;
  grid-template-columns: minmax(600px, 1fr) 340px;
  min-height: 0;
  flex: 1;
  height: 100vh; /* ensure workspace fills viewport and avoid page-level scrolling */
  overflow: hidden; /* keep scrolling inside board-stage if necessary */
}
.game-area {
  display: grid;
  min-width: 0;
  min-height: 0;
  /* header + main (board) - removed footer row so board can expand */
  grid-template-rows: 66px minmax(0, 1fr);
  background: #f3f4f4;
}
.game-meta {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 20px;
  padding: 0 28px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.72);
}
.player-block {
  display: flex;
  align-items: center;
  gap: 10px;
}
.white-player {
  justify-content: flex-end;
  text-align: right;
}
.player-block div {
  display: grid;
  line-height: 1.2;
}
.player-label,
.capture-count,
.move-summary span {
  color: var(--muted);
  font-size: 11px;
}
.player-block strong {
  font-size: 13px;
  font-weight: 600;
}
.player-block strong.active {
  color: var(--accent);
}
.capture-count {
  margin-left: 8px;
}
.white-player .capture-count {
  margin-right: 8px;
  margin-left: 0;
}
.stone-indicator {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 2px 5px rgba(24, 27, 29, 0.2);
}
.stone-indicator.black {
  background: #181a1c;
}
.stone-indicator.white {
  border: 1px solid #d5d7d8;
  background: #fff;
}
.move-summary {
  display: grid;
  min-width: 72px;
  text-align: center;
}
.move-summary strong {
  font-size: 14px;
}
.board-stage {
  display: flex;
  /* allow flex/grid children to control overflow correctly */
  min-height: 0;
  /* make the board-stage fill the available grid row height */
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 20px 28px;
  overflow: auto;
}
.feedback,
.score-summary,
.turn-indicator {
  min-width: 0;
  color: #b44137;
  font-size: 12px;
}
.score-summary {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.turn-indicator {
  color: var(--muted);
  text-align: right;
}

.board-stage {
  position: relative;
  display: flex;
  /* allow flex/grid children to control overflow correctly */
  min-height: 0;
  /* make the board-stage fill the available grid row height */
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 20px 28px;
  overflow: auto;
}

/* Right panel wrapper */
.right-panel {
  border-left: 1px solid var(--border);
  background: linear-gradient(180deg, #ffffff, #fbfbfc);
  display: flex;
  flex-direction: column;
  min-width: 320px;
  max-width: 380px;
  height: 100%;
  overflow: hidden;
}

@media (max-width: 980px) {
  .workspace {
    display: block;
    overflow-y: auto;
  }
  .game-area {
    min-height: 760px;
  }
}
@media (max-width: 980px) {
  .workspace {
    display: block;
    overflow-y: auto;
  }
  .game-area {
    min-height: 760px;
  }
}
@media (max-width: 760px) {
  .game-area {
    min-height: auto;
    grid-template-rows: auto auto auto;
  }
  .game-meta {
    padding: 14px 16px;
  }
  .capture-count {
    display: none;
  }
  .board-stage {
    padding: 12px;
  }
  .board-footer {
    grid-template-columns: 1fr;
    gap: 4px;
    padding: 10px 12px;
  }
  .board-left {
    justify-content: center;
    flex-wrap: wrap;
  }
  .feedback,
  .turn-indicator {
    text-align: center;
  }
}
</style>
<style scoped>
.result-modal-backdrop {
  position: fixed;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(24, 29, 30, 0.28);
}
.confirm-modal-backdrop {
  z-index: 30;
}
.score-modal-backdrop {
  z-index: 25;
}
.score-proposal-modal,
.scoring-modal {
  width: min(460px, 100%);
}
.scoring-body {
  display: grid;
  gap: 8px;
}
.scoring-loading {
  display: grid;
  justify-items: center;
  gap: 10px;
  min-height: 112px;
  align-content: center;
  color: var(--accent);
}
.scoring-loading h2 {
  color: var(--text);
}
.scoring-loading .spin {
  animation: scoring-spin 900ms linear infinite;
}
@keyframes scoring-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .scoring-loading .spin { animation: none; }
}
.score-state {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
}
.score-state.stable { color: #237a4b; }
.score-state.unsettled {
  font-size: 18px;
  line-height: 1.4;
}
.score-estimate-value {
  font-variant-numeric: tabular-nums;
}
.score-estimate-value.score-estimate-black { color: var(--accent); }
.score-estimate-value.score-estimate-white { color: var(--danger); }
.score-estimate-value.score-estimate-even { color: var(--text); }
.score-error { margin: 0; color: var(--danger); font-size: 12px; }
.confirm-modal .result-modal-heading {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  padding: 0;
  border: 0;
}
.confirm-modal {
  position: relative;
  display: grid;
  height: 216px;
  grid-template-rows: 146px 70px;
}
.confirm-modal.referee-detailed {
  height: auto;
  grid-template-rows: minmax(146px, auto) 70px;
}
.confirm-modal .result-modal-body {
  display: grid;
  min-height: 0;
  place-items: center;
  padding: 42px 56px 18px;
}
.confirm-modal .result-modal-actions {
  min-height: 0;
  align-items: center;
  padding: 10px 24px 20px;
}
.result-modal {
  width: min(420px, 100%);
  overflow: hidden;
  border: 1px solid #dfe4e3;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(22, 31, 29, 0.2);
}
.result-modal-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}
.result-modal-close {
  display: grid;
  width: 36px;
  height: 36px;
  padding: 0;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #323130;
  background: transparent;
  transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out;
}
.result-modal-close:hover {
  color: #0078d4;
  border-color: rgba(255,255,255,.6);
  background: rgba(255,255,255,.72);
  box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1);
}
.result-modal-close:active {
  transform: scale(.97);
  box-shadow: none;
}
.result-modal-body {
  padding: 28px 24px 24px;
  text-align: center;
}
.result-outcome-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.result-outcome-row h2 {
  margin: 0;
}
.result-modal-label {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.result-modal h2 {
  margin: 0;
  color: var(--text);
  font-size: 22px;
  line-height: 1.35;
}
.result-modal-hint {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.result-copy {
  margin-top: 12px;
}
.result-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border: 0;
}
.result-modal-actions-separated {
  border-top: 1px solid #eef0f0;
}
.result-action {
  min-width: 76px;
  min-height: 36px;
  padding: 8px 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  transition: transform 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out;
}
.result-action:not(.primary) {
  border: 1px solid transparent;
  color: #323130;
  background: transparent;
}
.result-action:not(.primary):hover {
  color: #0078d4;
  border-color: rgba(255,255,255,.6);
  background: rgba(255,255,255,.72);
  box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1);
}
.result-action.primary {
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid #0078d4;
  border-radius: 6px;
  color: #fff;
  background: #0078d4;
  box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px 0.9px rgba(0,0,0,.1);
  font-weight: 600;
}
.result-action.primary:hover {
  border-color: #0078d4;
  background: #106ebe;
  box-shadow: 0 3.2px 7.2px rgba(0,0,0,.13), 0 .6px 1.8px rgba(0,0,0,.1);
}
.result-action:active {
  transform: scale(.97);
  box-shadow: none;
}
.result-action.primary:active {
  background: #005a9e;
}
.result-modal-close:focus-visible, .result-action:focus-visible {
  outline: 2px solid #0078d4;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4;
}
@media (max-width: 520px) {
  .result-modal-actions {
    flex-direction: column-reverse;
  }
  .result-action {
    width: 100%;
  }
}
</style>

<style scoped>
/* Shared gameplay workspace visual pass. */
.workspace { background: var(--shell); }
.game-area { background: var(--shell); }
.board-stage { padding: 24px 32px; background: var(--surface-muted); }
.right-panel { min-width: 320px; max-width: 420px; border-left-color: var(--border); background: var(--surface); }
.result-modal-backdrop { background: rgba(23, 32, 29, .42); }
.result-modal { border-color: var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-md); }
.result-modal-heading { border-bottom-color: var(--border); }
.result-modal-body { padding: 30px 24px 26px; }
.result-modal-mark { display: grid; width: 48px; height: 48px; place-items: center; margin: 0 auto 14px; border-radius: 8px; color: var(--accent); background: var(--accent-soft); }
@media (max-width: 980px) { .board-stage { padding: 22px 24px; }.right-panel { max-width: none; border-top-color: var(--border); } }
@media (max-width: 760px) { .board-stage { padding: 12px; } }
</style>

<style scoped>
/* Gameplay shell: keep the board central and surfaces translucent. */
.workspace {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
  height: auto;
  min-height: 0;
  flex: 1 1 auto;
  background: var(--shell);
  background-image: linear-gradient(rgba(243, 242, 241, 0.22), rgba(243, 242, 241, 0.22)), url('/home-background.png');
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

.game-area {
  grid-template-rows: 72px minmax(0, 1fr) auto;
  min-height: 0;
  background: transparent;
}

.board-stage {
  min-height: 0;
  padding: 24px 32px;
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.workspace :deep(.game-sidebar) {
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.board-stage :deep(.board-host:not(.board-glassmorphism)),
.board-stage :deep(.board-container) {
  box-shadow: var(--shadow-md);
}

.right-panel { display: none; }

.workspace.immersive {
  grid-template-columns: minmax(0, 1fr);
}

.workspace.immersive :deep(.game-sidebar) {
  display: none;
}

.result-modal-backdrop { background: rgba(50, 49, 48, 0.36); backdrop-filter: blur(3px); }
.result-modal { border-color: rgba(225, 225, 225, 0.75); border-radius: 8px; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: var(--shadow-md); }

@media (max-width: 980px) {
  .workspace { display: block; height: auto; min-height: 100vh; overflow-y: auto; }
  .game-area { min-height: 720px; }
  .board-stage { min-height: 560px; padding: 22px 24px; }
}

@media (max-width: 760px) {
  .game-area { min-height: auto; grid-template-rows: auto minmax(420px, auto) auto; }
  .board-stage { min-height: 440px; padding: 12px; }
}
</style>
