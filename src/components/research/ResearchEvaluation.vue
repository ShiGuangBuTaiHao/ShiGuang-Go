<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import AnalysisPanel from '../analysis/AnalysisPanel.vue'
import type { KataGoAnalysis, WinratePoint } from '../../services/katago'

const props = defineProps<{ analysis: KataGoAnalysis | null; history: WinratePoint[]; status: 'idle' | 'loading' | 'error'; error: string; territoryStatus: 'idle' | 'loading' | 'error'; territoryError: string; territoryAvailable: boolean; moveNumbersEnabled: boolean; candidatesVisible: boolean; territoryVisible: boolean; previewMove?: string }>()
const emit = defineEmits<{ request: [kind: 'candidates' | 'territory']; stop: [kind: 'candidates' | 'territory']; 'update:moveNumbersEnabled': [enabled: boolean]; 'update:candidatesVisible': [enabled: boolean]; 'update:territoryVisible': [enabled: boolean] }>()
const perspective = defineModel<'black' | 'white'>('perspective', { default: 'black' })
function isVisible(kind: 'candidates' | 'territory') {
  const available = kind === 'candidates' ? Boolean(props.analysis) : props.territoryAvailable
  return available && (kind === 'candidates' ? props.candidatesVisible : props.territoryVisible)
}

function isBusy(kind: 'candidates' | 'territory') {
  return kind === 'territory' ? props.territoryStatus === 'loading' : props.status === 'loading'
}

function isDisabled() {
  return Boolean(props.previewMove)
}

function commandText(kind: 'candidates' | 'territory') {
  if (isBusy(kind)) return '停止'
  return isVisible(kind) ? '关闭' : '获取'
}

function commandLabel(kind: 'candidates' | 'territory') {
  if (isBusy(kind)) return '停止分析'
  if (kind === 'candidates') return isVisible(kind) ? '关闭推荐落点' : '获取推荐落点'
  return isVisible(kind) ? '关闭形势预测' : '获取形势预测'
}

function toggleOverlay(kind: 'candidates' | 'territory') {
  if (isBusy(kind)) {
    emit('stop', kind)
    return
  }
  if (isVisible(kind)) {
    if (kind === 'candidates') emit('update:candidatesVisible', false)
    else emit('update:territoryVisible', false)
    return
  }
  if (kind === 'candidates') emit('update:candidatesVisible', true)
  else emit('update:territoryVisible', true)
  if ((kind === 'candidates' && !props.analysis) || (kind === 'territory' && !props.territoryAvailable)) {
    emit('request', kind)
  }
}
</script>

<template>
  <section class="research-evaluation" aria-label="AI 分析" :aria-busy="status === 'loading'">
    <div class="evaluation-controls" aria-label="棋盘显示与分析控制">
      <div class="control-row">
        <div class="control-copy"><strong>手数</strong><span>在棋盘上显示手数标记</span></div>
        <button class="toggle-btn" type="button" role="switch" :aria-checked="props.moveNumbersEnabled" :aria-label="props.moveNumbersEnabled ? '关闭手数' : '显示手数'" :title="props.moveNumbersEnabled ? '关闭手数' : '显示手数'" @click="emit('update:moveNumbersEnabled', !props.moveNumbersEnabled)"><span class="toggle-knob" :class="{ on: props.moveNumbersEnabled }" /></button>
      </div>
      <div class="control-row">
        <div class="control-copy"><strong>推荐落点</strong><span>分析当前局面的候选点</span></div>
        <button class="analysis-command" type="button" :disabled="isDisabled()" :aria-busy="isBusy('candidates')" :aria-label="commandLabel('candidates')" :title="commandLabel('candidates')" @click="toggleOverlay('candidates')">
          <LoaderCircle v-if="isBusy('candidates')" class="spin" :size="14" aria-hidden="true" /><span v-else>{{ commandText('candidates') }}</span>
        </button>
      </div>
      <div class="control-row">
        <div class="control-copy"><strong>形势预测</strong><span>查看预测占领区域</span></div>
        <button class="analysis-command" type="button" :disabled="isDisabled()" :aria-busy="isBusy('territory')" :aria-label="commandLabel('territory')" :title="commandLabel('territory')" @click="toggleOverlay('territory')"><LoaderCircle v-if="isBusy('territory')" class="spin" :size="14" aria-hidden="true" /><span v-else>{{ commandText('territory') }}</span></button>
      </div>
    </div>
    <AnalysisPanel embedded :analysis="analysis" :history="history" :perspective="perspective" @update:perspective="perspective = $event" />
    <div v-if="error || territoryError" class="analysis-error" role="alert">{{ error || territoryError }}</div>
  </section>
</template>

<style scoped>
.research-evaluation { min-width: 0; }
.evaluation-controls { display: grid; gap: 2px; }
.control-row { display: flex; min-height: 56px; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 2px; }
.control-copy { display: grid; min-width: 0; gap: 3px; }
.control-copy strong { color: var(--text); font-size: 12px; }
.control-copy span { color: var(--muted); font-size: 11px; line-height: 1.4; }
.toggle-btn { display: inline-flex; width: 42px; height: 24px; flex: 0 0 42px; align-items: center; justify-content: flex-start; padding: 2px; border: 1px solid var(--border); border-radius: 999px; background: rgba(237, 235, 233, .72); transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.toggle-btn[aria-checked='true'] { border-color: var(--accent); background: var(--accent); }
.toggle-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.toggle-btn:active { transform: scale(.97); }
.toggle-knob { display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-xs); transition: transform 150ms ease-out; }
.toggle-knob.on { transform: translateX(18px); }
.analysis-command { display: inline-flex; min-width: 68px; min-height: 32px; flex: 0 0 68px; align-items: center; justify-content: center; gap: 5px; padding: 0 9px; border: 1px solid var(--accent); border-radius: 6px; color: #fff; background: var(--accent); box-shadow: var(--shadow-xs); font: inherit; font-size: 11px; font-weight: 600; transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.analysis-command:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); box-shadow: var(--shadow-sm); }.analysis-command:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px rgba(243, 242, 241, 0.9); }.analysis-command:active:not(:disabled) { transform: scale(.97); }
.analysis-command:disabled { cursor: not-allowed; opacity: .42; }
.spin { animation: spin 800ms linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.analysis-error { margin-top: 12px; padding: 8px 10px; border-radius: 4px; background: var(--danger-soft); color: var(--danger); font-size: 11px; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
