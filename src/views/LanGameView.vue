<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Flag, LoaderCircle, Minimize2, Pause, Undo2, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import GoBoard from '../components/board/GoBoard.vue'
import SaveGameRecord from '../components/library/SaveGameRecord.vue'
import PlayerHeader from '../components/game/PlayerHeader.vue'
import GameSettingsDialog from '../components/game/GameSettingsDialog.vue'
import SidebarShell, { type SidebarTab } from '../components/game/SidebarShell.vue'
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
const displayedError = computed(() => localError.value || lan.error || message.value)
const pendingAction = ref<'undo' | 'pass' | 'resign' | null>(null)
const gameSettingsVisible = ref(false)
const moveNumbersEnabled = ref(false)
const coordinatesEnabled = ref(true)
const boardStyle = ref<BoardStyle>(loadBoardStyle())
const immersiveEnabled = ref(false)
const recommendationStrength = ref<RecommendationStrength>('auto')
const activeTab = ref('board')
const analysisPerspective = ref<Stone>('black')
const sidebarTabs: SidebarTab[] = [
  { id: 'board', label: '棋盘' },
  { id: 'analysis', label: '分析' },
]
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
const ruleName = computed(() => {
  const ruleSet = lan.room?.config.ruleSet ?? 'chinese'
  return RULE_PRESETS[ruleSet].label
})
const ruleSummary = computed(() => {
  const config = lan.room?.config
  if (!config) return '19 路棋盘'
  return `${formatKomi(config.komi)}${config.komiUnit} · 19 路棋盘`
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
      config?.komi ?? 3.75,
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
  localError.value = ''
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
  localError.value = ''
  try {
    await lan.respondUndo(approved)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function confirmPendingAction() {
  const action = pendingAction.value
  if (!action) return
  localError.value = ''
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

      <div v-if="immersiveEnabled" class="board-actions">
        <p v-if="displayedError" class="game-message" role="alert">{{ displayedError }}</p>
        <div class="actions-group">
          <button class="action-btn" type="button" :disabled="!canUndo" @click="requestAction('undo')"><Undo2 :size="16" aria-hidden="true" />{{ undoWaiting ? '等待同意' : '悔棋' }}</button>
          <button class="action-btn" type="button" :disabled="boardLocked" @click="requestAction('pass')"><Pause :size="16" aria-hidden="true" />停一手</button>
          <button class="action-btn danger" type="button" :disabled="boardLocked" @click="requestAction('resign')"><Flag :size="16" aria-hidden="true" />认输</button>
          <button class="action-btn immersive-exit" type="button" aria-label="退出沉浸模式" title="退出沉浸模式" @click="exitImmersiveMode">
            <Minimize2 :size="16" aria-hidden="true" />
            <span>退出</span>
          </button>
        </div>
      </div>
    </main>

    <SidebarShell
      v-model="activeTab"
      class="lan-side"
      label="局域网对局工具"
      title="对局工具"
      id-prefix="lan-sidebar"
      :tabs="sidebarTabs"
    >
      <template v-if="activeTab === 'board'">
        <section class="controls-section" aria-label="棋盘显示设置">
          <div class="control-row">
            <strong>手数</strong>
            <button
              class="toggle-btn"
              type="button"
              role="switch"
              aria-label="在棋盘上显示手数"
              :aria-checked="moveNumbersEnabled"
              :title="moveNumbersEnabled ? '关闭手数' : '显示手数'"
              @click="moveNumbersEnabled = !moveNumbersEnabled"
            >
              <span class="toggle-knob" />
            </button>
          </div>
          <div class="game-actions" aria-label="对局操作">
            <button class="action-btn" type="button" :disabled="!canUndo" title="悔棋" @click="requestAction('undo')"><Undo2 :size="16" aria-hidden="true" /><span>{{ undoWaiting ? '等待同意' : '悔棋' }}</span></button>
            <button class="action-btn" type="button" :disabled="boardLocked" title="停一手" @click="requestAction('pass')"><Pause :size="16" aria-hidden="true" /><span>停一手</span></button>
            <button class="action-btn danger" type="button" :disabled="boardLocked" title="认输" @click="requestAction('resign')"><Flag :size="16" aria-hidden="true" /><span>认输</span></button>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="analysis-section" aria-label="本机形势分析">
          <div class="control-row">
            <strong>形势预测</strong>
            <div class="analysis-actions">
              <button v-if="territoryVisible" class="analysis-close" type="button" title="隐藏形势预测" aria-label="隐藏形势预测" @click="invalidateTerritory"><X :size="16" aria-hidden="true" /></button>
              <button
                class="analysis-btn"
                type="button"
                :disabled="!lan.connected || current.status === 'finished' || analysisBusy || engineStatus?.warming || engineStatus?.configured === false"
                :aria-busy="territoryLoading"
                :title="territoryVisible ? '重新获取当前局面的形势预测' : '获取当前局面的形势预测'"
                @click="requestTerritory"
              >
                <LoaderCircle v-if="territoryLoading" class="spin" :size="14" aria-hidden="true" />
                <span>{{ territoryLoading ? '分析中' : territoryVisible ? '重新获取' : '获取' }}</span>
              </button>
            </div>
          </div>
        </section>

        <AnalysisPanel
          v-if="territoryVisible"
          embedded
          :analysis="analysis"
          :history="[]"
          :perspective="analysisPerspective"
          @update:perspective="analysisPerspective = $event"
        />
      </template>

      <SaveGameRecord v-if="current.status === 'finished'" :snapshot="current" :black="blackName" :white="whiteName" :rule-set="lan.room?.config.ruleSet ?? 'chinese'" :komi="(lan.room?.config.komi ?? 3.75) * (lan.room?.config.komiUnit === '目' ? 1 : 2)" auto />
      <p v-if="displayedError" class="error-note" role="alert">{{ displayedError }}</p>
    </SidebarShell>
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
.lan-workspace { grid-template-columns: minmax(0, 1fr) minmax(320px, 360px); background: var(--shell); background-image: linear-gradient(rgba(243, 242, 241, .22), rgba(243, 242, 241, .22)), url('/home-background.png'); background-position: center; background-repeat: no-repeat; background-size: cover; }
.game-area { grid-template-rows: 72px minmax(0, 1fr); min-height: 0; background: transparent; }
.board-stage, .lan-side { background: rgba(243, 242, 241, .2); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.board-stage :deep(.board-host:not(.board-glassmorphism)) { box-shadow: var(--shadow-md); }
.lan-workspace.immersive { grid-template-columns: minmax(0, 1fr); }
.lan-workspace.immersive .game-area { grid-template-rows: 72px minmax(0, 1fr) auto; }
.lan-workspace.immersive .lan-side { display: none; }
.lan-side { min-width: 0; }
.controls-section { padding-top: 0; }
.control-row { display: flex; min-height: 56px; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 2px; }
.control-row > strong { color: var(--text); font-size: 12px; }
.toggle-btn { display: inline-flex; width: 42px; height: 24px; flex: 0 0 42px; align-items: center; padding: 2px; border: 1px solid var(--border); border-radius: 999px; background: rgba(237, 235, 233, .72); transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.toggle-btn[aria-checked='true'] { border-color: var(--accent); background: var(--accent); }
.toggle-knob { width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-xs); transition: transform 150ms ease-out; }
.toggle-btn[aria-checked='true'] .toggle-knob { transform: translateX(18px); }
.game-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; padding: 6px 0 10px; }
.game-actions .action-btn { min-width: 0; justify-content: center; padding: 0 8px; }
.board-actions { position: relative; display: flex; justify-content: center; padding: 0 16px 22px; }
.actions-group { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
.action-btn { display: inline-flex; min-height: 40px; align-items: center; gap: 7px; padding: 0 13px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); font: inherit; font-size: 12px; font-weight: 600; transition: background .15s ease, border-color .15s ease, color .15s ease; box-shadow: var(--shadow-xs); }
.action-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: #fff; box-shadow: var(--shadow-sm); }
.action-btn:active:not(:disabled) { transform: scale(.97); box-shadow: none; }
.action-btn:disabled { cursor: not-allowed; opacity: .42; }
.action-btn.danger { border-color: rgba(232,17,35,.28); color: var(--danger); }
.action-btn.danger:hover:not(:disabled) { border-color: rgba(232,17,35,.5); color: #a80012; background: var(--danger-soft); }
.action-btn.immersive-exit { border-color: rgba(var(--accent-rgb), .32); color: var(--accent-strong); }
.action-btn.immersive-exit:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.game-message { position: absolute; bottom: 68px; left: 16px; right: 16px; width: fit-content; max-width: calc(100% - 32px); margin: 0 auto; padding: 6px 10px; border: 1px solid rgba(232,17,35,.2); border-radius: 4px; color: var(--danger); background: var(--surface); font-size: 12px; overflow-wrap: anywhere; }
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
.analysis-section { padding: 0 0 18px; }
.analysis-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.analysis-close { display: grid; width: 32px; height: 32px; padding: 0; place-items: center; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--surface); }
.analysis-close:hover { color: var(--accent-strong); border-color: var(--accent); }
.analysis-btn { display: inline-flex; min-width: 68px; min-height: 32px; align-items: center; justify-content: center; gap: 7px; padding: 0 9px; border: 1px solid var(--accent); border-radius: 6px; color: #fff; background: var(--accent); font: inherit; font-size: 11px; font-weight: 600; box-shadow: var(--shadow-xs); transition: background-color 150ms ease, border-color 150ms ease, opacity 150ms ease; }
.analysis-btn:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); }
.analysis-btn:focus-visible, .analysis-close:focus-visible, .action-btn:focus-visible, .toggle-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.analysis-btn:disabled { opacity: .45; }
.error-note { margin: 12px 0 0; padding: 9px 10px; border-left: 3px solid var(--danger); color: var(--danger); background: var(--danger-soft); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.board-actions { padding-bottom: 20px; background: rgba(243,242,241,.2); backdrop-filter: blur(2px); }
.actions-group { gap: 6px; }
.result-modal-backdrop { background: rgba(50,49,48,.36); backdrop-filter: blur(2px); }
.result-modal { border-color: var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-md); }
.result-modal-heading { border-bottom-color: var(--border); font-weight: 600; }
.result-modal-actions { border-top: 1px solid var(--border); }
.result-action { border-radius: 4px; }
.result-action.primary { border-color: var(--accent); background: var(--accent); box-shadow: var(--shadow-xs); }
.result-action.primary:hover { border-color: var(--accent-strong); background: var(--accent-strong); box-shadow: var(--shadow-sm); }
.spin { animation: spin 800ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 980px) {
  .lan-workspace { display: block; height: auto; min-height: 100%; overflow-y: auto; }
  .game-area { min-height: 0; grid-template-rows: 72px auto; }
  .board-stage { height: auto; aspect-ratio: 1; padding: 22px 24px; }
}
@media (max-width: 760px) {
  .game-area { grid-template-rows: auto auto; }
  .board-stage { min-height: 0; padding: 12px; }
  .action-btn { min-width: 0; padding: 0 9px; }
  .board-actions { flex-direction: column; padding-bottom: 16px; }
  .game-message { position: static; margin: 0 0 8px; }
  .result-modal-actions { flex-direction: column-reverse; }
  .result-action { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .analysis-btn, .action-btn, .toggle-btn, .toggle-knob { transition: none; }.spin { animation: none; } }
</style>
