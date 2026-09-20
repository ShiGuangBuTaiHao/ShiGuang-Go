<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { init, use, type EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { WinratePoint } from '../../services/katago'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  points: WinratePoint[]
  perspective: 'black' | 'white'
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null

function updateChart() {
  if (!chart) return
  const isBlack = props.perspective === 'black'
  const perspectiveLabel = isBlack ? '黑方' : '白方'
  const winrateColor = isBlack ? '#0078d4' : '#106ebe'
  const selectedLead = (point: WinratePoint) => isBlack ? point.scoreLead : -point.scoreLead
  const formatLead = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} 目`
  chart.setOption({
    animationDuration: 180,
    grid: { top: 14, right: 10, bottom: 28, left: 36 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex?: number
          axisValue?: string | number
          value?: number
        }>
        const item = items[0] ?? {}
        const index = item.dataIndex ?? 0
        const point = props.points[index]
        return [
          `第 ${item.axisValue ?? props.points[index]?.moveNumber ?? '-'} 手`,
          `${perspectiveLabel}胜率：${Number(point ? (isBlack ? point.black : point.white) : 0).toFixed(1)}%`,
          `${perspectiveLabel}目差：${formatLead(point ? selectedLead(point) : 0)}`,
        ].join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      name: '手数',
      nameGap: 8,
      nameTextStyle: { color: '#605e5c', fontSize: 10 },
      axisLine: { lineStyle: { color: '#d1d1d1' } },
      axisTick: { show: false },
      axisLabel: { color: '#605e5c', fontSize: 10 },
      data: props.points.map((point) => point.moveNumber),
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: { color: '#605e5c', fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#e1e1e1' } },
    },
    series: [
      {
        name: `${perspectiveLabel}胜率`,
        type: 'line',
        data: props.points.map((point) => (isBlack ? point.black : point.white)),
        showSymbol: props.points.length < 18,
        symbol: 'circle',
        symbolSize: 5,
        smooth: 0.18,
        lineStyle: { width: 2, color: winrateColor },
        itemStyle: { color: winrateColor },
        areaStyle: { color: winrateColor, opacity: 0.06 },
      },
    ],
  })
}

onMounted(async () => {
  await nextTick()
  if (!host.value) return
  chart = init(host.value)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(host.value)
  updateChart()
})

watch(() => [props.points, props.perspective], updateChart, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div class="chart-wrap">
    <div
      ref="host"
      class="winrate-chart"
      role="img"
      :aria-label="`${perspective === 'black' ? '黑方' : '白方'}胜率变化折线图，悬停可查看目差`"
    />
    <span v-if="!points.length" class="chart-empty">暂无胜率数据</span>
  </div>
</template>

<style scoped>
.chart-wrap { position: relative; width: 100%; height: 156px; }
.winrate-chart { width: 100%; height: 100%; }
.chart-empty {
  position: absolute;
  top: 60px;
  right: 0;
  left: 36px;
  color: #605e5c;
  font-size: 11px;
  text-align: center;
  pointer-events: none;
}
</style>
