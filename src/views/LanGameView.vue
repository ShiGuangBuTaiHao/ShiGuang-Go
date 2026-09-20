<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LoaderCircle, Minimize2, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import GoBoard from '../components/board/GoBoard.vue'
import PlayerHeader from '../components/game/PlayerHeader.vue'
import GameSettingsDialog from '../components/game/GameSettingsDialog.vue'
import AnalysisPanel from '../components/analysis/AnalysisPanel.vue'
import { coordinateLabel, positionFromCoordinate } from '../domain/go'
import { ownershipTerritory } from '../domain/territory'
import { analyzePosition, cancelAnalysis, getEngineStatus, type EngineStatus, type KataGoAnalysis, type KataGoMove } from '../services/katago'
import { useGameStore } from '../stores/game'
import { useLanStore } from '../stores/lan'
import { formatKomi, RULE_PRESETS } from '../domain/gameSetup'
import { RECOMMENDATION_BUDGETS, type RecommendationStrength } from '../domain/ai'
import { loadBoardStyle, saveBoardStyle, type BoardStyle } from '../domain/boardTheme'
import type { MoveNumberMarker, Stone, TerritoryMarker } from '../types/game'

const router = useRouter()
const game = useGameStore()
const lan = useLanStore()
const { current, message } = storeToRefs(game)
const { pendingUndoRequest, undoConsentRemaining, undoWaitingRemaining, undoWaiting } = storeToRefs(lan)
const engineStatus = ref<EngineStatus | null>(null)
const territoryVisible = ref(false)
const territoryLoading = ref(false)
const territory = ref<TerritoryMarker[]>([])
const analysis = ref<KataGoAnalysis | null>(null)
const localError = ref('')
const pendingAction = ref<'undo' | 'pass' | 'resign' | null>(null)
const gameSettingsVisible = ref(false)
const moveNumbersEnabled = ref(false)
const coordinatesEnabled = ref(true)
const boardStyle = ref<BoardStyle>(loadBoardStyle())
const immersiveEnabled = ref(false)
const recommendationStrength = ref<RecommendationStrength>('auto')
let territoryRequestToken = 0

const localStone = computed<Stone | null>(() => lan.localStone as Stone | null)
const boardLocked = computed(() => lan.status !== 'playing' || current.value.currentPlayer !== localStone.value || current.value.status === 'finished')
const blackName = computed(() => lan.room?.config.hostColor === 'black' ? '玩家一' : '玩家二')
const whiteName = computed(() => lan.room?.config.hostColor === 'white' ? '玩家一' : '玩家二')
const lastMoveLabel = computed(() => current.value.lastMove ? coordinateLabel(current.value.lastMove.row, current.value.lastMove.col) : '无')
const connectionLabel = computed(() => {
  if (lan.status === 'reconnecting') return '等待对手重连'
  if (lan.connected) return '网络已连接'
  if (lan.status === 'connecting') return '正在连接'
  return '网络已断开'
})
const connectionHint = computed(() => {
  if (lan.status === 'reconnecting') return `棋局已暂停，等待原玩家恢复连接${lan.reconnectRemaining === null ? '' : `（剩余 ${lan.reconnectRemaining} 秒）`}`
  if (lan.connected) return '对手在线，可以继续对局'
  return lan.error || '请返回房间重新连接'
})
const ruleName = computed(() => {
  const ruleSet = lan.room?.config.ruleSet ?? 'chinese'
  return RULE_PRESETS[ruleSet].label
})
const ruleSummary = computed(() => {
  const config = lan.room?.config
  if (!config) return '19 路棋盘'
  return `${formatKomi(config.komi)}${config.komiUnit} · 19 路棋盘`
})
const engineLabel = computed(() => {
  if (engineStatus.value?.error) return engineStatus.value.error
  if (engineStatus.value?.warming) return '预热中'
  if (territoryLoading.value) return 'GPU 分析中…'
  if (engineStatus.value?.configured) return '已连接'
  return '未配置'
})
const engineHint = computed(() => {
  if (engineStatus.value?.error) return '引擎异常，请检查本机 KataGo 配置'
  if (engineStatus.value?.warming) return '正在加载模型与 GPU 推理引擎'
  if (territoryLoading.value) return '正在计算当前局面的形势'
  return '形势分析只在本机运行'
})
const headerEngineLabel = computed(() => {
  if (engineStatus.value?.error) return '引擎异常'
  if (engineStatus.value?.warming) return '引擎加载中'
  if (territoryLoading.value) return '分析中'
  if (engineStatus.value?.configured) return '引擎已连接'
  return '引擎未配置'
})
const headerEngineTone = computed(() => {
  if (engineStatus.value?.error) return 'error'
  if (engineStatus.value?.warming || territoryLoading.value) return 'busy'
  return engineStatus.value?.configured ? 'ready' : 'idle'
})
function publishHeaderSummary() {
  window.dispatchEvent(new CustomEvent('game-header-summary', {
    detail: {
      primary: ruleName.value,
      secondary: `${ruleSummary.value} · ${connectionLabel.value}`,
      status: headerEngineLabel.value,
      statusTone: headerEngineTone.value,
      statusTitle: engineStatus.value?.error ?? engineHint.value,
    },
  }))
}
const analysisBusy = computed(() => territoryLoading.value)
const confirmTitle = computed(() => {
  if (pendingAction.value === 'undo') return '悔棋'
  if (pendingAction.value === 'pass') return '停一手'
  return '认输'
})
const confirmMessage = computed(() => {
  if (pendingAction.value === 'undo' && undoWaiting.value) {
    const remaining = undoWaitingRemaining.value ?? 10
    return `已发送悔棋请求，等待对方选择（剩余 ${remaining} 秒）`
  }
  if (pendingAction.value === 'undo') return '确定要悔棋吗？'
  if (pendingAction.value === 'pass') return '确定要停一手吗？'
  return '确定要认输吗？'
})
const canUndo = computed(() =>
  lan.status === 'playing'
  && lan.connected
  && !undoWaiting.value
  && !pendingUndoRequest.value
  && current.value.moveNumber > 0
  && current.value.status !== 'finished'
)

const moveNumbers = computed<MoveNumberMarker[]>(() => current.value.moves.flatMap((move, index) => {
  const position = positionFromCoordinate(move.coordinate)
  return position ? [{ ...position, moveNumber: index + 1, stone: move.stone }] : []
}))

function currentMoves(): KataGoMove[] {
  return current.value.moves.map((move) => ({ player: move.stone === 'black' ? 'B' : 'W', coordinate: move.coordinate }))
}

function invalidateTerritory() {
  territoryRequestToken += 1
  territoryLoading.value = false
  territoryVisible.value = false
  territory.value = []
  analysis.value = null
  void cancelAnalysis()
}

async function refreshEngineStatus() {
  try {
    engineStatus.value = await getEngineStatus()
  } catch (error) {
    engineStatus.value = {
      configured: false,
      running: false,
      detail: '引擎状态不可用',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function requestTerritory() {
  if (territoryLoading.value || !lan.connected || current.value.status === 'finished') return
  const token = ++territoryRequestToken
  const moveNumber = current.value.moveNumber
  const snapshotMoves = currentMoves()
  const config = lan.room?.config
  territoryLoading.value = true
  territoryVisible.value = false
  territory.value = []
  analysis.value = null
  localError.value = ''
  try {
    const result = await analyzePosition(
      snapshotMoves,
      'fast',
      'normal',
      undefined,
      config?.ruleSet ?? 'chinese',
      config?.komi ?? 7.5,
      config?.handicap ?? 0,
      RECOMMENDATION_BUDGETS.high,
    )
    if (token !== territoryRequestToken || current.value.moveNumber !== moveNumber || String(current.value.status) === 'finished') return
    analysis.value = result
    territory.value = ownershipTerritory(current.value.board, result.ownership, result.ownershipStdev)
    territoryVisible.value = true
    await refreshEngineStatus()
  } catch (error) {
    if (token === territoryRequestToken) {
      localError.value = error instanceof Error ? error.message : String(error)
      await refreshEngineStatus()
    }
  } finally {
    if (token === territoryRequestToken) territoryLoading.value = false
  }
}

async function place(row: number, col: number) {
  if (boardLocked.value) return
  invalidateTerritory()
  try {
    await lan.submitMove(row, col)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

function requestAction(action: 'undo' | 'pass' | 'resign') {
  if (action === 'undo' ? !canUndo.value : boardLocked.value) return
  pendingAction.value = action
}

function cancelPendingAction() {
  if (pendingAction.value === 'undo' && undoWaiting.value) return
  pendingAction.value = null
}

async function respondUndo(approved: boolean) {
  try {
    await lan.respondUndo(approved)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function confirmPendingAction() {
  const action = pendingAction.value
  if (!action) return
  invalidateTerritory()
  if (action === 'undo') {
    try {
      await lan.requestUndo()
      return
    } catch (error) {
      pendingAction.value = null
      localError.value = error instanceof Error ? error.message : String(error)
      return
    }
  }
  pendingAction.value = null
  try {
    if (action === 'pass') await lan.submitPass()
    else await lan.resign()
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (gameSettingsVisible.value) {
    gameSettingsVisible.value = false
    return
  }
  cancelPendingAction()
}

function setImmersiveMode(value: boolean) {
  immersiveEnabled.value = value
  document.documentElement.dataset.immersive = value ? 'true' : 'false'
  window.dispatchEvent(new CustomEvent('game-immersive-change', { detail: value }))
}

function openGameSettings() {
  gameSettingsVisible.value = true
}

function setBoardStyle(value: BoardStyle) {
  boardStyle.value = value
  saveBoardStyle(value)
}

function exitImmersiveMode() {
  setImmersiveMode(false)
}

watch(undoWaiting, (waiting) => {
  if (!waiting && pendingAction.value === 'undo') pendingAction.value = null
})

watch(() => [current.value.moveNumber, current.value.currentPlayer, current.value.status, lan.status], () => {
  if (territoryVisible.value || territoryLoading.value || analysis.value) invalidateTerritory()
})

watch(() => lan.error, (value) => {
  if (value) localError.value = value
})

watch(
  [ruleName, ruleSummary, connectionLabel, headerEngineLabel, headerEngineTone, territoryLoading],
  publishHeaderSummary,
  { immediate: true },
)

onMounted(async () => {
  window.addEventListener('open-game-settings', openGameSettings)
  window.addEventListener('keydown', handleKeydown)
  await lan.initialize()
  await refreshEngineStatus()
  publishHeaderSummary()
  if (!lan.room) router.replace({ name: 'lan-lobby' })
})

onBeforeUnmount(() => {
  window.removeEventListener('open-game-settings', openGameSettings)
  window.removeEventListener('keydown', handleKeydown)
  void cancelAnalysis()
})
</script>

<template>
  <div class="workspace lan-workspace" :class="{ immersive: immersiveEnabled }">
    <main class="game-area">
      <PlayerHeader
        :black-name="blackName"
        :white-name="whiteName"
        :move-number="current.moveNumber"
        :current-player="current.currentPlayer"
        :last-move-label="lastMoveLabel"
      />

      <div class="board-stage">
        <GoBoard
          :board="current.board"
          :current-player="current.currentPlayer"
          :last-move="current.lastMove"
          :candidates="[]"
          :territory="territoryVisible ? territory : []"
          territory-mode="ai"
          :show-star-points="!territoryVisible"
          :show-coordinates="coordinatesEnabled"
          :dead-stones="[]"
          :move-numbers="moveNumbers"
          :show-move-numbers="moveNumbersEnabled"
          :board-style="boardStyle"
          :disabled="boardLocked"
          :busy="false"
          @place="place"
        />
      </div>

      <div class="board-actions">
        <p v-if="message" class="game-message" role="alert">{{ message }}</p>
        <div class="actions-group">
          <button class="action-btn primary" type="button" :disabled="!canUndo" @click="requestAction('undo')">{{ undoWaiting ? '等待同意' : '悔棋' }}</button>
          <button class="action-btn" type="button" :disabled="boardLocked" @click="requestAction('pass')">停一手</button>
          <button class="action-btn resign" type="button" :disabled="boardLocked" @click="requestAction('resign')">认输</button>
          <button v-if="immersiveEnabled" class="action-btn immersive-exit" type="button" aria-label="退出" title="退出" @click="exitImmersiveMode">
            <Minimize2 :size="16" aria-hidden="true" />
            <span>退出</span>
          </button>
        </div>
      </div>
    </main>

    <aside class="right-panel lan-side">
      <div class="info-cards">
        <div class="info-card network-card">
          <div class="card-title">网络</div>
          <div class="card-body">
            <div>
              <div class="card-main" :class="{ error: !lan.connected }">{{ connectionLabel }}</div>
              <div class="card-sub">{{ connectionHint }}</div>
            </div>
            <span class="status-dot" :class="{ connected: lan.connected, error: !lan.connected }" />
          </div>
        </div>

        <div class="info-card rule-card">
          <div class="card-title">规则</div>
          <div class="card-body">
            <div>
              <div class="card-main">{{ ruleName }}</div>
              <div class="card-sub">{{ ruleSummary }}</div>
            </div>
          </div>
        </div>

        <div class="info-card engine-card">
          <div class="card-title">引擎</div>
          <div class="card-body">
            <div>
              <div class="card-main" :class="{ error: engineStatus?.error }">{{ engineLabel }}</div>
              <div class="card-sub">{{ engineHint }}</div>
            </div>
            <span class="status-dot" :class="{ connected: engineStatus?.configured && !engineStatus?.error, running: territoryLoading, error: engineStatus?.error }" />
          </div>
        </div>
      </div>

      <div class="controls-group controls-list">
        <div class="control-item">
          <div class="control-labels">
            <div class="label-text">AI 预测形势</div>
            <div class="hint">点击后分析当前局面，只在本机运行</div>
          </div>
          <button class="analysis-btn" type="button" :disabled="!lan.connected || analysisBusy || engineStatus?.configured === false" :title="territoryVisible ? '重新获取当前局面的形势预测' : '获取当前局面的形势预测'" @click="requestTerritory">
            <LoaderCircle v-if="territoryLoading" class="spin" :size="14" />
            {{ territoryLoading ? '分析中…' : territoryVisible ? '重新获取' : '获取形势' }}
          </button>
        </div>
      </div>

      <AnalysisPanel
        v-if="territoryVisible"
        embedded
        :analysis="analysis"
        :history="[]"
        perspective="black"
      />

      <p v-if="localError || message" class="error-note" role="alert">{{ localError || message }}</p>
      <p class="side-note">形势判断不会同步给对方，也不会影响棋局结果。对手落子后需要重新点击获取。</p>
    </aside>
  </div>

  <GameSettingsDialog
    :open="gameSettingsVisible"
    :coordinates-enabled="coordinatesEnabled"
    :immersive-enabled="immersiveEnabled"
    :board-style="boardStyle"
    :recommendation-strength="recommendationStrength"
    @close="gameSettingsVisible = false"
    @update:coordinates-enabled="coordinatesEnabled = $event"
    @update:immersive-enabled="setImmersiveMode"
    @update:board-style="setBoardStyle"
    @update:recommendation-strength="recommendationStrength = $event"
  />

  <div v-if="pendingAction" class="result-modal-backdrop confirm-modal-backdrop">
    <section class="result-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="lan-confirm-title">
      <div class="result-modal-heading">
        <span>{{ confirmTitle }}</span>
        <button v-if="pendingAction !== 'undo' || !undoWaiting" class="result-modal-close" type="button" aria-label="关闭确认弹窗" title="关闭" @click="cancelPendingAction"><X :size="16" stroke-width="2" aria-hidden="true" /></button>
      </div>
      <div class="result-modal-body">
        <h2 id="lan-confirm-title">{{ confirmMessage }}</h2>
      </div>
      <div v-if="pendingAction !== 'undo' || !undoWaiting" class="result-modal-actions">
        <button class="result-action primary" type="button" @click="confirmPendingAction">确认</button>
      </div>
    </section>
  </div>

  <div v-if="pendingUndoRequest && !pendingAction" class="result-modal-backdrop confirm-modal-backdrop">
    <section class="result-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="undo-consent-title">
      <div class="result-modal-heading">
        <span>悔棋请求</span>
        <button class="result-modal-close" type="button" aria-label="拒绝悔棋" title="关闭" @click="respondUndo(false)"><X :size="16" stroke-width="2" aria-hidden="true" /></button>
      </div>
      <div class="result-modal-body">
        <h2 id="undo-consent-title">对方请求悔棋，是否同意？</h2>
        <p class="consent-countdown">{{ undoConsentRemaining === null ? '10' : undoConsentRemaining }} 秒后自动拒绝</p>
      </div>
      <div class="result-modal-actions consent-actions">
        <button class="result-action" type="button" @click="respondUndo(false)">拒绝</button>
        <button class="result-action primary" type="button" @click="respondUndo(true)">同意</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lan-workspace { grid-template-columns: minmax(600px, 1fr) 340px; }
.lan-workspace.immersive { grid-template-columns: minmax(0, 1fr); }
.lan-side { display: flex; min-width: 0; flex-direction: column; gap: 12px; padding: 18px 16px; border-left: 1px solid var(--border); overflow-y: auto; background: linear-gradient(180deg, #fff, #fbfcfd); }
.info-cards { display: flex; flex-direction: column; gap: 8px; }
.info-card { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
.card-title { margin-bottom: 6px; color: var(--muted); font-size: 12px; }
.card-body { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; }
.card-main { overflow: hidden; color: var(--text); font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.card-main.error { color: #a0443c; }
.card-sub { margin-top: 3px; overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.status-dot { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; background: #a6aaad; }
.status-dot.connected { background: var(--accent); }
.status-dot.running { background: #c9943f; box-shadow: 0 0 0 4px rgba(201,148,63,.12); }
.status-dot.error { background: #c05048; box-shadow: 0 0 0 4px rgba(192,80,72,.12); }
.controls-group { margin-bottom: 0; }
.controls-list { display: flex; flex-direction: column; gap: 10px; }
.control-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; }
.control-labels { display: flex; min-width: 0; flex-direction: column; }
.label-text { color: var(--text); font-size: 14px; font-weight: 700; }
.hint { margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.45; }
.analysis-btn { min-width: 86px; min-height: 34px; padding: 7px 10px; border: 1px solid var(--accent); border-radius: 7px; color: #fff; background: var(--accent); font: inherit; font-size: 12px; cursor: pointer; transition: background .12s ease, opacity .12s ease; }
.analysis-btn:hover:not(:disabled) { background: #1f6546; }
.analysis-btn:disabled { cursor: not-allowed; opacity: .5; }
.error-note { margin: 0; color: #b0443d; font-size: 12px; line-height: 1.5; }
.side-note { margin: auto 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.board-actions { position: relative; display: flex; justify-content: center; padding: 0 16px 22px; }
.actions-group { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
.action-btn { display: inline-flex; min-height: 44px; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: #fff; font: inherit; font-size: 14px; line-height: 1; cursor: pointer; transition: background .12s ease, border-color .12s ease, color .12s ease; box-shadow: none; }
.action-btn:hover:not(:disabled) { border-color: var(--accent); background: transparent; }
.action-btn:active:not(:disabled) { border-color: var(--accent); background: transparent; }
.action-btn.primary, .action-btn.resign { color: var(--text); }
.action-btn:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(0, 0, 0, .04); }
.action-btn:disabled { cursor: not-allowed; opacity: .6; }
.action-btn.immersive-exit { border-color: rgba(var(--accent-rgb), .32); color: var(--accent-strong); }
.action-btn.immersive-exit:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.game-message { position: absolute; bottom: 68px; left: 50%; margin: 0; color: #b0443d; font-size: 12px; transform: translateX(-50%); white-space: nowrap; }
.result-modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgba(24,30,28,.35); }
.result-modal { width: min(420px, 100%); overflow: hidden; border: 1px solid #e0e5e3; border-radius: 10px; background: #fff; box-shadow: 0 24px 60px rgba(20,30,25,.2); }
.result-modal-heading { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #edf0ef; color: var(--text); font-size: 14px; font-weight: 700; }
.confirm-modal { position: relative; display: grid; height: 216px; grid-template-rows: 146px 70px; }
.confirm-modal .result-modal-heading { position: absolute; z-index: 1; top: 12px; right: 12px; padding: 0; border: 0; }
.confirm-modal .result-modal-heading > span { display: none; }
.confirm-modal .result-modal-body { display: grid; min-height: 0; align-content: center; padding: 42px 56px 18px; }
.confirm-modal .result-modal-actions { min-height: 0; align-items: center; padding: 10px 24px 20px; }
.result-modal-close { display: grid; width: 36px; height: 36px; padding: 0; place-items: center; border: 1px solid transparent; border-radius: 6px; color: #323130; background: transparent; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.result-modal-close:hover { color: #0078d4; border-color: rgba(255,255,255,.6); background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }
.result-modal-close:active { transform: scale(.97); box-shadow: none; }
.result-modal-body { padding: 26px 20px; text-align: center; }.result-modal-body h2 { margin: 0; color: var(--text); font-size: 18px; }
.consent-countdown { margin: 10px 0 0; color: var(--muted); font-size: 12px; }
.result-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px 16px; border: 0; }
.result-action { min-height: 36px; padding: 0 15px; border-radius: 6px; font: inherit; font-size: 13px; transition: transform 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.result-action:not(.primary) { border: 1px solid transparent; color: #323130; background: transparent; }
.result-action:not(.primary):hover { color: #0078d4; border-color: rgba(255,255,255,.6); background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }
.result-action.primary { min-height: 40px; padding: 0 18px; border: 1px solid #0078d4; color: #fff; background: #0078d4; box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); font-weight: 600; }
.result-action.primary:hover { border-color: #0078d4; background: #106ebe; box-shadow: 0 3.2px 7.2px rgba(0,0,0,.13), 0 .6px 1.8px rgba(0,0,0,.1); }
.result-action:active { transform: scale(.97); box-shadow: none; }
.result-action.primary:active { background: #005a9e; }
.result-modal-close:focus-visible, .result-action:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4; }
@media (max-width: 980px) { .lan-workspace { display: block; height: auto; min-height: 100%; overflow-y: auto; }.lan-side { border-top: 1px solid var(--border); border-left: 0; }.side-note { margin-top: 0; } }
@media (max-width: 640px) { .control-item { align-items: flex-end; }.label-text { font-size: 13px; }.hint { font-size: 10px; }.game-message { position: static; margin: 0 0 8px; transform: none; }.board-actions { flex-direction: column; padding-bottom: 16px; }.actions-group { width: 100%; }.action-btn { flex: 1 1 0; justify-content: center; } }
</style>
