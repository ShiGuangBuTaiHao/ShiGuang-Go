<script setup lang="ts">
import { ref, toRef } from 'vue'
import { Calculator, Flag, LoaderCircle, Pause, RotateCcw, Undo2 } from 'lucide-vue-next'
import AnalysisPanel from '../analysis/AnalysisPanel.vue'
import SidebarShell, { type SidebarTab } from './SidebarShell.vue'
import type { EngineStatus, KataGoAnalysis, WinratePoint } from '../../services/katago'

const props = withDefaults(defineProps<{
  recommendationVisible?: boolean
  territoryVisible?: boolean
  moveNumbersEnabled: boolean
  locked: boolean
  engineStatus?: EngineStatus | null
  recommendationLoading?: boolean
  territoryLoading?: boolean
  territoryDisabled?: boolean
  territoryError?: string
  analysisBusy?: boolean
  recommendationEnabled?: boolean
  analysisDefaultVisible?: boolean
  analysis?: KataGoAnalysis | null
  history?: WinratePoint[]
  perspective?: 'black' | 'white'
  canUndo?: boolean
  passDisabled?: boolean
  resignDisabled?: boolean
  resetDisabled?: boolean
  timelineLocked?: boolean
  gameFinished?: boolean
  scoreVisible?: boolean
  scoreDisabled?: boolean
  scoreTitle?: string
  refereeVisible?: boolean
  refereeDisabled?: boolean
}>(), {
  scoreVisible: true,
})

const emit = defineEmits<{
  (event: 'request-recommendation'): void
  (event: 'close-recommendation'): void
  (event: 'request-territory'): void
  (event: 'close-territory'): void
  (event: 'update:moveNumbersEnabled', value: boolean): void
  (event: 'update:perspective', value: 'black' | 'white'): void
  (event: 'undo' | 'pass' | 'resign' | 'reset' | 'score' | 'referee'): void
}>()

const moveNumbersRef = toRef(props, 'moveNumbersEnabled')
const analysisVisible = ref(props.analysisDefaultVisible ?? false)
const activeTab = ref('board')
const sidebarTabs: SidebarTab[] = [
  { id: 'board', label: '棋盘' },
  { id: 'analysis', label: '分析' },
]
</script>

<template>
  <SidebarShell
    v-model="activeTab"
    label="对局信息"
    title="对局工具"
    id-prefix="game-sidebar"
    :tabs="sidebarTabs"
  >
    <section v-if="activeTab === 'board'" class="controls-section" aria-label="棋盘显示设置">
      <div class="control-row">
        <div class="control-copy">
          <strong>手数</strong>
          <span>在棋盘上显示手数标记</span>
        </div>
        <button
          class="toggle-btn"
          type="button"
          role="switch"
          aria-label="在棋盘上显示手数"
          :aria-checked="moveNumbersRef"
          :title="moveNumbersRef ? '关闭手数' : '显示手数'"
          @click="emit('update:moveNumbersEnabled', !moveNumbersRef)"
        >
          <span class="toggle-knob" :class="{ on: moveNumbersRef }" />
        </button>
      </div>
      <div class="game-actions" aria-label="对局操作">
        <button class="game-action" type="button" :disabled="props.gameFinished || !props.canUndo || props.timelineLocked" aria-label="悔棋" title="悔棋" @click="emit('undo')"><Undo2 :size="16" aria-hidden="true" /><span>悔棋</span></button>
        <button class="game-action" type="button" :disabled="props.passDisabled" aria-label="停一手" title="停一手" @click="emit('pass')"><Pause :size="16" aria-hidden="true" /><span>停一手</span></button>
        <button v-if="props.scoreVisible !== false && !props.refereeVisible" class="game-action" type="button" :disabled="props.scoreDisabled" aria-label="数子" :title="props.scoreTitle ?? '数子'" @click="emit('score')"><Calculator :size="16" aria-hidden="true" /><span>数子</span></button>
        <button v-if="props.refereeVisible" class="game-action" type="button" :disabled="props.refereeDisabled" aria-label="申请数子" title="申请数子" @click="emit('referee')"><Calculator :size="16" aria-hidden="true" /><span>申请数子</span></button>
        <button class="game-action" type="button" :disabled="props.resetDisabled" aria-label="重新开始" title="重新开始" @click="emit('reset')"><RotateCcw :size="16" aria-hidden="true" /><span>重新开始</span></button>
        <button class="game-action danger" type="button" :disabled="props.resignDisabled" aria-label="认输" title="认输" @click="emit('resign')"><Flag :size="16" aria-hidden="true" /><span>认输</span></button>
      </div>
    </section>

    <template v-else>
      <section class="controls-section" aria-label="局面分析与预测">
        <div class="control-row">
          <div class="control-copy">
            <strong>胜率与目数差</strong>
            <span>显示胜率曲线与目数差</span>
          </div>
          <button
            class="toggle-btn"
            type="button"
            role="switch"
            aria-label="显示局面分析"
            :aria-checked="analysisVisible"
            :title="analysisVisible ? '隐藏局面分析' : '显示局面分析'"
            @click="analysisVisible = !analysisVisible"
          >
            <span class="toggle-knob" :class="{ on: analysisVisible }" />
          </button>
        </div>

        <div v-if="props.recommendationEnabled !== false" class="control-row">
          <div class="control-copy">
            <strong>推荐落点</strong>
            <span>分析当前局面的候选点</span>
          </div>
          <button
            class="analysis-command"
            type="button"
            :disabled="props.locked || props.analysisBusy || props.engineStatus?.warming || props.engineStatus?.configured === false"
            :aria-busy="props.recommendationLoading"
            :aria-label="props.recommendationLoading ? '分析中' : (props.recommendationVisible ? '关闭推荐落点' : '获取推荐落点')"
            :title="props.recommendationLoading ? '分析中' : (props.recommendationVisible ? '关闭推荐落点' : '获取推荐落点')"
            @click="props.recommendationVisible ? emit('close-recommendation') : emit('request-recommendation')"
          >
            <LoaderCircle v-if="props.recommendationLoading" class="spin" :size="14" aria-hidden="true" />
            <span v-else>{{ props.recommendationVisible ? '关闭' : '获取' }}</span>
          </button>
        </div>
        <div class="control-row">
          <div class="control-copy">
            <strong>形势预测</strong>
            <span>查看预测占领区域</span>
          </div>
          <button
            class="analysis-command"
            type="button"
            :disabled="props.territoryDisabled"
            :aria-busy="props.territoryLoading"
            :aria-label="props.territoryLoading ? '取消获取形势' : (props.territoryVisible ? '关闭形势预测' : '获取形势')"
            :title="props.territoryLoading ? '取消获取形势' : (props.territoryVisible ? '关闭形势预测' : '获取形势')"
            @click="props.territoryVisible || props.territoryLoading ? emit('close-territory') : emit('request-territory')"
          >
            <LoaderCircle v-if="props.territoryLoading" class="spin" :size="14" aria-hidden="true" />
            <span v-else>{{ props.territoryVisible ? '关闭' : '获取' }}</span>
          </button>
        </div>
        <div v-if="props.territoryError" class="analysis-feedback" role="alert">
          <strong>形势预测不可用</strong>
          <span>{{ props.territoryError }}</span>
        </div>
      </section>

      <AnalysisPanel
        v-if="analysisVisible"
        embedded
        :analysis="props.analysis ?? null"
        :history="props.history ?? []"
        :perspective="props.perspective ?? 'black'"
        @update:perspective="emit('update:perspective', $event)"
      />

      <div v-if="props.engineStatus?.error" class="analysis-feedback" role="alert">
        <strong>分析服务不可用</strong>
        <span>{{ props.engineStatus.error }}</span>
      </div>
    </template>
  </SidebarShell>
</template>

<style scoped>
.controls-section { display: grid; gap: 2px; margin-top: 0; padding-top: 0; }
.game-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; padding: 6px 0 10px; }
.game-action { display: inline-flex; min-width: 0; min-height: 38px; align-items: center; justify-content: center; gap: 7px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); box-shadow: var(--shadow-xs); font: inherit; font-size: 12px; font-weight: 600; }
.game-action:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); }
.game-action:disabled { cursor: not-allowed; opacity: .42; }
.game-action.danger { color: var(--danger); border-color: rgba(232, 17, 35, .28); }
.control-row { display: flex; min-height: 56px; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 2px; }
.control-copy { display: grid; min-width: 0; gap: 3px; }
.control-copy strong { color: var(--text); font-size: 12px; }
.control-copy span { color: var(--muted); font-size: 11px; line-height: 1.4; }
.toggle-btn { display: inline-flex; width: 42px; height: 24px; flex: 0 0 42px; align-items: center; justify-content: flex-start; padding: 2px; border: 1px solid var(--border); border-radius: 999px; background: rgba(237, 235, 233, 0.72); transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.toggle-btn[aria-checked='true'] { border-color: var(--accent); background: var(--accent); }
.toggle-btn:focus-visible, .analysis-command:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px rgba(243, 242, 241, 0.9); }
.toggle-btn:active, .analysis-command:active:not(:disabled) { transform: scale(.97); }
.toggle-knob { display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-xs); transition: transform 150ms ease-out; }
.toggle-knob.on { transform: translateX(18px); }
.analysis-command { display: inline-flex; min-width: 68px; min-height: 32px; flex: 0 0 68px; align-items: center; justify-content: center; gap: 5px; padding: 0 9px; border: 1px solid var(--accent); border-radius: 6px; color: #fff; background: var(--accent); box-shadow: var(--shadow-xs); font: inherit; font-size: 11px; font-weight: 600; transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.analysis-command:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); box-shadow: var(--shadow-sm); }
.analysis-command:disabled { cursor: not-allowed; opacity: 0.42; }
.analysis-feedback { display: grid; gap: 4px; margin-top: 14px; padding: 10px; border: 1px solid rgba(232, 17, 35, 0.24); border-radius: 6px; color: var(--danger); background: rgba(253, 231, 233, 0.62); font-size: 11px; line-height: 1.45; }
.analysis-feedback strong { font-size: 12px; }
.spin { animation: spin 800ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
