<script setup lang="ts">
import { ref, toRef } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import AnalysisPanel from '../analysis/AnalysisPanel.vue'
import type { EngineStatus, KataGoAnalysis, WinratePoint } from '../../services/katago'

const props = defineProps<{
  recommendationVisible?: boolean
  territoryVisible?: boolean
  moveNumbersEnabled: boolean
  locked: boolean
  engineStatus?: EngineStatus | null
  recommendationLoading?: boolean
  territoryLoading?: boolean
  analysisBusy?: boolean
  analysis?: KataGoAnalysis | null
  history?: WinratePoint[]
  perspective?: 'black' | 'white'
}>()

const emit = defineEmits<{
  (event: 'request-recommendation'): void
  (event: 'close-recommendation'): void
  (event: 'request-territory'): void
  (event: 'close-territory'): void
  (event: 'update:moveNumbersEnabled', value: boolean): void
  (event: 'update:perspective', value: 'black' | 'white'): void
}>()

const moveNumbersRef = toRef(props, 'moveNumbersEnabled')
const analysisVisible = ref(true)

</script>

<template>
  <aside class="game-sidebar" aria-label="对局信息">
    <div class="sidebar-scroll" role="tabpanel">
      <section class="controls-section" aria-label="棋盘显示设置">
        <div class="control-row">
          <div class="control-copy">
            <strong>手数</strong>
            <span>在棋盘上显示手数标记</span>
          </div>
          <button
            class="toggle-btn"
            type="button"
            role="switch"
            :aria-checked="moveNumbersRef"
            :title="moveNumbersRef ? '关闭手数' : '显示手数'"
            @click="emit('update:moveNumbersEnabled', !moveNumbersRef)"
          >
            <span class="toggle-knob" :class="{ on: moveNumbersRef }" />
          </button>
        </div>
        <div class="control-row">
          <div class="control-copy">
            <strong>局面分析</strong>
            <span>显示胜率曲线与目数差</span>
          </div>
          <button
            class="toggle-btn"
            type="button"
            role="switch"
            :aria-checked="analysisVisible"
            :title="analysisVisible ? '隐藏局面分析' : '显示局面分析'"
            @click="analysisVisible = !analysisVisible"
          >
            <span class="toggle-knob" :class="{ on: analysisVisible }" />
          </button>
        </div>
        <div class="control-row">
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
            :disabled="props.locked || props.analysisBusy || props.engineStatus?.warming || props.engineStatus?.configured === false"
            :aria-busy="props.territoryLoading"
            :aria-label="props.territoryLoading ? '分析中' : (props.territoryVisible ? '关闭形势预测' : '获取形势预测')"
            :title="props.territoryLoading ? '分析中' : (props.territoryVisible ? '关闭形势预测' : '获取形势预测')"
            @click="props.territoryVisible ? emit('close-territory') : emit('request-territory')"
          >
            <LoaderCircle v-if="props.territoryLoading" class="spin" :size="14" aria-hidden="true" />
            <span v-else>{{ props.territoryVisible ? '关闭' : '获取' }}</span>
          </button>
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
    </div>
  </aside>
</template>

<style scoped>
.game-sidebar {
  display: flex;
  min-width: 320px;
  max-width: 400px;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid rgba(225, 225, 225, 0.65);
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.sidebar-scroll { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 16px; }
.controls-section { display: grid; gap: 2px; margin-top: 0; padding-top: 0; }
.control-row { display: flex; min-height: 56px; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 2px; }
.control-copy { display: grid; min-width: 0; gap: 3px; }
.control-copy strong { color: var(--text); font-size: 12px; }
.control-copy span { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.toggle-btn { display: inline-flex; width: 42px; height: 24px; flex: 0 0 42px; align-items: center; justify-content: flex-start; padding: 2px; border: 1px solid var(--border); border-radius: 999px; background: rgba(237, 235, 233, 0.72); transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.toggle-btn[aria-checked='true'] { border-color: var(--accent); background: var(--accent); }
.toggle-btn:focus-visible, .analysis-command:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px rgba(243, 242, 241, 0.9); }
.toggle-btn:active, .analysis-command:active:not(:disabled) { transform: scale(0.97); }
.toggle-knob { display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-xs); transition: transform 150ms ease-out; }
.toggle-knob.on { transform: translateX(18px); }
.analysis-command { display: inline-flex; min-width: 68px; min-height: 30px; flex: 0 0 68px; align-items: center; justify-content: center; gap: 5px; padding: 0 9px; border: 1px solid var(--accent); border-radius: 6px; color: #fff; background: var(--accent); box-shadow: var(--shadow-xs); font: inherit; font-size: 11px; font-weight: 600; transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.analysis-command:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); box-shadow: var(--shadow-sm); }
.analysis-command:disabled { cursor: not-allowed; opacity: 0.42; }
.analysis-feedback { display: grid; gap: 4px; margin-top: 14px; padding: 10px; border: 1px solid rgba(232, 17, 35, 0.24); border-radius: 6px; color: var(--danger); background: rgba(253, 231, 233, 0.62); font-size: 11px; line-height: 1.45; }
.analysis-feedback strong { font-size: 12px; }

.spin { animation: spin 800ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 980px) {
  .game-sidebar { width: 100%; max-width: none; height: auto; min-height: 320px; border-top: 1px solid rgba(225, 225, 225, 0.65); border-left: 0; }
  .sidebar-scroll { max-height: 420px; }
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
</style>
