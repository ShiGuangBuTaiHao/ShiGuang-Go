<script setup lang="ts">
import { computed } from 'vue'
import WinrateChart from './WinrateChart.vue'
import type { KataGoAnalysis, WinratePoint } from '../../services/katago'
import { positionScore } from '../../domain/scoring'
import { displayMoveNumber, mergeWinratePoints } from './winrateChartData'

const props = defineProps<{
  analysis: KataGoAnalysis | null
  history: WinratePoint[]
  perspective: 'black' | 'white'
  embedded?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:perspective', value: 'black' | 'white'): void
}>()

const points = computed(() => mergeWinratePoints(
  props.history,
  props.analysis
    ? {
        moveNumber: props.analysis.turnNumber,
        ply: props.analysis.turnNumber,
        black: props.analysis.rootInfo.winrate * 100,
        white: 100 - props.analysis.rootInfo.winrate * 100,
        scoreLead: props.analysis.rootInfo.scoreLead,
        player: props.analysis.rootInfo.currentPlayer,
      }
    : null,
))
const currentPoint = computed(() => props.analysis
  ? points.value.find((point) => displayMoveNumber(point) === props.analysis!.turnNumber)
  : points.value.at(-1))

const blackWinrate = computed(() => {
  const winrate = currentPoint.value?.black ?? 50
  return Math.min(100, Math.max(0, winrate))
})
const whiteWinrate = computed(() => 100 - blackWinrate.value)

const displayTurnNumber = computed(() => displayMoveNumber(currentPoint.value))

const selectedWinrate = computed(() =>
  props.perspective === 'black' ? blackWinrate.value : whiteWinrate.value
)

const hasAnalysis = computed(() => points.value.length > 0)

const currentScoreLead = computed(() => {
  const point = currentPoint.value
  if (!point) return 0
  const lead = positionScore(point.black / 100, point.scoreLead).lead
  return props.perspective === 'black' ? lead : -lead
})

const scoreLeadClass = computed(() => {
  if (Math.abs(currentScoreLead.value) < 0.05) return 'close'
  return currentScoreLead.value > 0 ? 'ahead' : 'behind'
})

const scoreDrop = computed(() => {
  const point = currentPoint.value
  const previousPoint = points.value.find((item) => displayMoveNumber(item) === displayTurnNumber.value - 1)
  if (!point || !previousPoint) return null
  const currentLead = positionScore(point.black / 100, point.scoreLead).lead
  const previousLead = positionScore(previousPoint.black / 100, previousPoint.scoreLead).lead
  const current = props.perspective === 'black' ? currentLead : -currentLead
  const previous = props.perspective === 'black' ? previousLead : -previousLead
  return Math.max(0, previous - current)
})

</script>

<template>
  <aside class="analysis-panel" :class="{ embedded }">
    <div class="analysis-heading">
      <div>
        <span class="analysis-kicker">局面分析</span>
        <strong>第 {{ displayTurnNumber }} 手</strong>
      </div>
      <div class="perspective-toggle" role="group" aria-label="选择胜率视角">
        <button type="button" :class="{ selected: perspective === 'black' }" :aria-pressed="perspective === 'black'" @click="emit('update:perspective', 'black')">黑方</button>
        <button type="button" :class="{ selected: perspective === 'white' }" :aria-pressed="perspective === 'white'" @click="emit('update:perspective', 'white')">白方</button>
      </div>
    </div>

    <WinrateChart :points="points" :perspective="perspective" />

    <div class="evaluation">
      <div class="winrate-values">
        <div class="metric winrate-metric">
          <span>{{ perspective === 'black' ? '黑方胜率' : '白方胜率' }}</span>
          <strong v-if="hasAnalysis">{{ selectedWinrate.toFixed(1) }}<small>%</small></strong>
          <strong v-else>--<small>%</small></strong>
          <em>{{ hasAnalysis ? '当前局面' : '等待分析' }}</em>
        </div>
        <div class="score-lead">
          <span>当前目数差</span>
          <strong v-if="hasAnalysis" :class="scoreLeadClass">
            {{ currentScoreLead > 0 ? '+' : '' }}{{ currentScoreLead.toFixed(1) }}<small>目</small>
          </strong>
          <strong v-else>--<small>目</small></strong>
          <em v-if="hasAnalysis && displayTurnNumber > 0 && scoreDrop !== null">较上一手下降 <b>{{ scoreDrop.toFixed(1) }}</b> 目</em>
          <em v-else-if="hasAnalysis && displayTurnNumber > 0">上一手尚未分析</em>
          <em v-else-if="hasAnalysis">初始局面</em>
          <em v-else>等待 KataGo 评估当前局面</em>
        </div>
      </div>

    </div>
  </aside>
</template>

<style scoped>
.analysis-panel {
  border-left: 1px solid var(--border);
  background: transparent;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  max-width: 380px;
  height: 100%;
  overflow: hidden;
}

.analysis-panel.embedded {
  min-width: 0;
  max-width: none;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  overflow: visible;
}

.embedded .evaluation {
  padding: 12px;
}

.evaluation-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 11px;
}

.embedded .winrate-values span {
  font-size: 11px;
}

.embedded .winrate-values strong {
  font-size: 25px;
}

.embedded .winrate-values em {
  font-size: 11px;
}

.evaluation {
  padding: 14px 18px;
}

.winrate-values {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  min-height: 72px;
  gap: 0;
}

.winrate-values div {
  display: grid;
  gap: 4px;
}

.winrate-values span {
  color: var(--muted);
  font-size: 10px;
}

.winrate-values strong {
  color: var(--text);
  font-size: 24px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.winrate-values small {
  margin-left: 2px;
  font-size: 12px;
  font-weight: 600;
}

.metric {
  min-width: 0;
}

.metric em,
.score-lead em {
  color: var(--muted);
  font-size: 10px;
  font-style: normal;
}

.score-lead {
  position: relative;
  padding-left: 16px;
  text-align: right;
}

.score-lead::before {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 1px;
  background: var(--border);
  content: '';
}

.score-lead strong {
  display: block;
  font-size: 24px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.score-lead em b {
  color: var(--text);
  font-weight: 600;
}

.score-lead strong.ahead {
  color: #2f7d4a;
}

.score-lead strong.behind {
  color: #b45145;
}

.score-lead strong.close {
  color: var(--muted);
}

.white-value {
  text-align: right;
}

@media (max-width: 980px) {
  .analysis-panel {
    border-top: 1px solid var(--border);
    border-left: 0;
  }
}
</style>

<style scoped>
.analysis-panel { min-width: 320px; max-width: 420px; border-left-color: var(--border); background: transparent; }
.analysis-panel.embedded { border-color: var(--border); border-radius: 6px; background: transparent; }
.analysis-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 0; }
.analysis-heading > div:first-child { display: grid; gap: 4px; min-width: 0; }
.analysis-kicker { color: #605e5c; font-size: 11px; }
.analysis-heading strong { color: var(--text); font-size: 13px; }
.perspective-toggle { display: inline-flex; flex: 0 0 auto; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-muted); }
.perspective-toggle button { min-height: 26px; padding: 0 8px; border: 0; border-radius: 3px; color: var(--muted); background: transparent; font: inherit; font-size: 10px; }
.perspective-toggle button.selected { color: var(--text); background: var(--surface); box-shadow: var(--shadow-xs); }
.evaluation { padding: 16px; }
.winrate-values { min-height: 82px; }
.winrate-values span { color: #605e5c; font-size: 11px; }
.winrate-values strong, .score-lead strong { font-size: 26px; }
.winrate-values small, .score-lead strong small { color: var(--muted); font-size: 12px; }
.metric em, .score-lead em { color: #605e5c; }
.score-lead::before { background: var(--border); }
.score-lead strong.ahead { color: #0078d4; }
.score-lead strong.behind { color: var(--danger); }
@media (max-width: 520px) { .analysis-heading { align-items: flex-start; flex-direction: column; }.perspective-toggle { align-self: stretch; }.perspective-toggle button { flex: 1; } }
@media (max-width: 980px) { .analysis-panel { max-width: none; border-top-color: var(--border); } }
</style>

<style scoped>
.analysis-panel.embedded {
  min-width: 0;
  max-width: none;
  height: auto;
  overflow: visible;
  border: 0;
  border-radius: 7px;
  background: transparent;
  box-shadow: none;
}
.embedded .analysis-heading { padding: 13px; }
.embedded .perspective-toggle { border-color: rgba(225, 225, 225, 0.72); background: rgba(237, 235, 233, 0.62); }
.embedded .perspective-toggle button { min-height: 28px; border-radius: 5px; }
.embedded .perspective-toggle button.selected { color: var(--accent); background: rgba(255, 255, 255, 0.7); box-shadow: var(--shadow-xs); }
.embedded .perspective-toggle button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.embedded .perspective-toggle button:active { transform: scale(0.97); }
.embedded .evaluation { padding: 13px; }
</style>
