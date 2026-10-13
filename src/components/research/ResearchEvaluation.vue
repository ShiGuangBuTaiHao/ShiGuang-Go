<script setup lang="ts">
import { computed } from 'vue'
import { BrainCircuit, Play, RefreshCw, Square } from 'lucide-vue-next'
import type { KataGoAnalysis, KataGoMoveInfo, AnalysisMode, WinratePoint } from '../../services/katago'

const props = defineProps<{ analysis: KataGoAnalysis | null; candidates: KataGoMoveInfo[]; history: WinratePoint[]; status: 'idle' | 'loading' | 'error'; error: string; live: boolean; mode: AnalysisMode; previewMove?: string }>()
const emit = defineEmits<{ request: []; stop: []; preview: [move: string]; 'update:live': [enabled: boolean]; 'update:mode': [mode: AnalysisMode] }>()
const perspective = defineModel<'black' | 'white'>('perspective', { default: 'black' })
const winrate = computed(() => props.analysis ? (perspective.value === 'black' ? props.analysis.rootInfo.winrate : 1 - props.analysis.rootInfo.winrate) * 100 : null)
const score = computed(() => props.analysis ? props.analysis.rootInfo.scoreLead * (perspective.value === 'black' ? 1 : -1) : null)
const trend = computed(() => {
  const first = props.history[0]?.moveNumber ?? 0
  const last = props.history.at(-1)?.moveNumber ?? first
  return props.history.map((point) => ({ x: 8 + (point.moveNumber - first) / Math.max(1, last - first) * 304, y: 74 - (perspective.value === 'black' ? point.black : point.white) * .66 }))
})
const line = computed(() => trend.value.map((point) => `${point.x},${point.y}`).join(' '))
function candidateWinrate(move: KataGoMoveInfo) { return ((perspective.value === 'black' ? move.winrate : 1 - move.winrate) * 100).toFixed(1) }
function loss(move: KataGoMoveInfo) {
  const sign = props.analysis?.rootInfo.currentPlayer === 'B' ? 1 : -1
  const best = Math.max(...props.candidates.map((item) => item.scoreLead * sign))
  return Math.max(0, best - move.scoreLead * sign).toFixed(1)
}
</script>

<template>
  <section class="research-evaluation" aria-label="AI 分析" :aria-busy="status === 'loading'">
    <div class="evaluation-heading"><h2><BrainCircuit :size="16" aria-hidden="true" />AI 分析</h2><span class="engine-state" :class="{ busy: status === 'loading', failed: status === 'error' }" role="status">{{ status === 'loading' ? '分析中' : status === 'error' ? '引擎不可用' : analysis ? `${analysis.rootInfo.visits.toLocaleString()} 次搜索` : '待分析' }}</span></div>
    <div class="evaluation-controls">
      <select :value="mode" aria-label="分析深度" :disabled="status === 'loading'" @change="emit('update:mode', ($event.target as HTMLSelectElement).value as AnalysisMode)"><option value="fast">快速分析</option><option value="deep">深入分析</option></select>
      <button class="analysis-command" type="button" :aria-label="status === 'loading' ? '停止分析' : '分析当前局面'" @click="status === 'loading' ? emit('stop') : emit('request')"><Square v-if="status === 'loading'" :size="13" /><RefreshCw v-else-if="analysis" :size="14" /><Play v-else :size="14" /><span>{{ status === 'loading' ? '停止' : analysis ? '重新分析' : '开始分析' }}</span></button>
    </div>
    <div class="evaluation-options"><label><input type="checkbox" :checked="live" @change="emit('update:live', ($event.target as HTMLInputElement).checked)" />跟随局面</label><div class="perspective" role="group" aria-label="评价视角"><button v-for="side in (['black', 'white'] as const)" :key="side" type="button" :aria-pressed="perspective === side" :class="{ selected: perspective === side }" @click="perspective = side">{{ side === 'black' ? '黑方' : '白方' }}</button></div></div>
    <div class="metrics"><div><span>{{ perspective === 'black' ? '黑方胜率' : '白方胜率' }}</span><strong>{{ winrate === null ? '--' : winrate.toFixed(1) }}<small>%</small></strong></div><div><span>目数差</span><strong>{{ score === null ? '--' : `${score > 0 ? '+' : ''}${score.toFixed(1)}` }}<small>目</small></strong></div></div>
    <div class="winrate-meter" aria-hidden="true"><span :style="{ width: `${winrate ?? 50}%` }" /></div>
    <div v-if="history.length > 1" class="trend"><svg viewBox="0 0 320 82" role="img" :aria-label="`${perspective === 'black' ? '黑方' : '白方'}胜率走势，${history.length} 个已分析节点`"><line x1="8" y1="41" x2="312" y2="41" /><polyline :points="line" /><circle v-for="(point, index) in trend" :key="index" :cx="point.x" :cy="point.y" r="2.5" /></svg><div><span>第 {{ history[0].moveNumber }} 手</span><span>第 {{ history.at(-1)?.moveNumber }} 手</span></div></div>
    <div v-if="error" class="analysis-error" role="alert">{{ error }}</div>
    <div class="candidates-heading"><h3>候选落点</h3><span>{{ candidates.length ? `${candidates.length} 个` : '暂无结果' }}</span></div>
    <div v-if="candidates.length" class="candidate-table" role="table" aria-label="候选落点比较">
      <div class="candidate-head" role="row"><span role="columnheader">落点</span><span role="columnheader">胜率</span><span role="columnheader">损失 / 目</span><span role="columnheader">搜索</span></div>
      <button v-for="(candidate, index) in candidates" :key="candidate.move" type="button" class="candidate-row" :class="{ selected: previewMove === candidate.move }" :aria-label="`预览候选 ${candidate.move}`" :aria-pressed="previewMove === candidate.move" @click="emit('preview', candidate.move)"><span><b>{{ index + 1 }}</b>{{ candidate.move === 'pass' ? '停一手' : candidate.move }}</span><span>{{ candidateWinrate(candidate) }}%</span><span>{{ loss(candidate) }}</span><span>{{ candidate.visits.toLocaleString() }}</span></button>
    </div>
    <div v-else class="candidate-empty">{{ status === 'loading' ? '正在搜索候选落点…' : '当前节点尚未分析' }}</div>
  </section>
</template>

<style scoped>
.research-evaluation { min-width: 0; }
.evaluation-heading, .evaluation-options, .candidates-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h2, h3 { margin: 0; font-size: 13px; font-weight: 600; } h2 { display: flex; align-items: center; gap: 7px; } h2 svg { color: var(--accent); }
.engine-state { color: var(--muted); font-size: 11px; }.engine-state.busy { color: var(--accent); }.engine-state.failed { color: var(--danger); }
.evaluation-controls { display: flex; gap: 8px; margin-top: 12px; }.evaluation-controls select { height: 32px; flex: 1; padding: 0 8px; font-size: 12px; }
.analysis-command { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 104px; height: 32px; border: 1px solid var(--accent); border-radius: 6px; color: var(--surface); background: var(--accent); font-size: 12px; }.analysis-command:hover { background: var(--accent-strong); }
.evaluation-options { margin-top: 8px; min-height: 30px; }.evaluation-options label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }.evaluation-options input { accent-color: var(--accent); }
.perspective { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 5px; background: rgba(237,235,233,.58); }.perspective button { height: 24px; padding: 0 8px; border: 0; border-radius: 3px; color: var(--muted); background: transparent; font-size: 10px; }.perspective button.selected { color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); }
.metrics { display: grid; grid-template-columns: 1fr 1fr; margin: 12px 0; }.metrics > div { display: grid; gap: 6px; }.metrics > div + div { padding-left: 16px; border-left: 1px solid var(--border); }.metrics span { font-size: 11px; color: var(--muted); }.metrics strong { font-size: 25px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }.metrics small { margin-left: 3px; font-size: 11px; color: var(--muted); }
.winrate-meter { height: 4px; overflow: hidden; border-radius: 2px; background: var(--surface-muted); }.winrate-meter span { display: block; height: 100%; background: var(--accent); }
.trend { margin-top: 8px; }.trend svg { display: block; width: 100%; height: 74px; }.trend line { stroke: var(--border); stroke-dasharray: 3 3; }.trend polyline { fill: none; stroke: var(--accent); stroke-width: 2; }.trend circle { fill: var(--accent); }.trend > div { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); }
.candidates-heading { margin: 16px 0 8px; }.candidates-heading h3 { font-size: 12px; }.candidates-heading > span { color: var(--muted); font-size: 10px; }
.candidate-head, .candidate-row { display: grid; grid-template-columns: 1.1fr 1fr 1fr .9fr; gap: 5px; align-items: center; width: 100%; min-width: 0; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; }.candidate-head { min-height: 25px; color: var(--muted); font-size: 10px; padding: 0 6px; }.candidate-head > :first-child, .candidate-row > :first-child { text-align: left; }
.candidate-row { min-height: 30px; padding: 3px 6px; border: 1px solid transparent; border-radius: 4px; color: var(--text); background: transparent; }.candidate-row:hover, .candidate-row.selected { background: var(--accent-soft); }.candidate-row.selected { border-color: var(--accent-16); }.candidate-row > :first-child { display: flex; align-items: center; gap: 7px; }.candidate-row b { font-size: 10px; color: var(--accent-strong); width: 12px; }
.candidate-empty { display: grid; place-items: center; min-height: 66px; color: var(--muted); font-size: 11px; border-top: 1px solid var(--border); }
.analysis-error { margin-top: 12px; padding: 8px 10px; border-radius: 4px; background: var(--danger-soft); color: var(--danger); font-size: 11px; overflow-wrap: anywhere; }
</style>
