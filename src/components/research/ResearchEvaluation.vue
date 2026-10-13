<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import AnalysisPanel from '../analysis/AnalysisPanel.vue'
import type { KataGoAnalysis, WinratePoint } from '../../services/katago'

const props = defineProps<{ analysis: KataGoAnalysis | null; history: WinratePoint[]; status: 'idle' | 'loading' | 'error'; error: string; moveNumbersEnabled: boolean; candidatesVisible: boolean; territoryVisible: boolean; previewMove?: string }>()
const emit = defineEmits<{ request: []; stop: []; 'update:moveNumbersEnabled': [enabled: boolean]; 'update:candidatesVisible': [enabled: boolean]; 'update:territoryVisible': [enabled: boolean] }>()
const perspective = defineModel<'black' | 'white'>('perspective', { default: 'black' })
function toggleOverlay(kind: 'candidates' | 'territory') {
  if (props.status === 'loading') { emit('stop'); return }
  const visible = Boolean(props.analysis) && (kind === 'candidates' ? props.candidatesVisible : props.territoryVisible)
  if (kind === 'candidates') emit('update:candidatesVisible', !visible)
  else emit('update:territoryVisible', !visible)
  if (!props.analysis) emit('request')
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
        <button class="analysis-command" type="button" :disabled="Boolean(previewMove)" :aria-busy="status === 'loading'" :aria-label="status === 'loading' ? '停止分析' : (analysis && props.candidatesVisible ? '关闭推荐落点' : '获取推荐落点')" :title="status === 'loading' ? '停止分析' : (analysis && props.candidatesVisible ? '关闭推荐落点' : '获取推荐落点')" @click="toggleOverlay('candidates')">
          <LoaderCircle v-if="status === 'loading'" class="spin" :size="14" aria-hidden="true" /><span v-else>{{ analysis && props.candidatesVisible ? '关闭' : '获取' }}</span>
        </button>
      </div>
      <div class="control-row">
        <div class="control-copy"><strong>形势预测</strong><span>查看预测占领区域</span></div>
        <button class="analysis-command" type="button" :disabled="Boolean(previewMove)" :aria-busy="status === 'loading'" :aria-label="status === 'loading' ? '取消获取形势' : (analysis && props.territoryVisible ? '关闭形势预测' : '获取形势')" :title="status === 'loading' ? '取消获取形势' : (analysis && props.territoryVisible ? '关闭形势预测' : '获取形势')" @click="toggleOverlay('territory')"><LoaderCircle v-if="status === 'loading'" class="spin" :size="14" aria-hidden="true" /><span v-else>{{ analysis && props.territoryVisible ? '关闭' : '获取' }}</span></button>
      </div>
    </div>
    <AnalysisPanel embedded :analysis="analysis" :history="history" :perspective="perspective" @update:perspective="perspective = $event" />
    <div v-if="error" class="analysis-error" role="alert">{{ error }}</div>
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
