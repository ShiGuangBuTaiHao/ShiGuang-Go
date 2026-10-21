<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { init, use, type EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { WinratePoint } from '../../services/katago'
import { winratePly, winrateSeries } from './winrateChartData'
import { positionScore } from '../../domain/scoring'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  points: WinratePoint[]
  perspective: 'black' | 'white'
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null
const visiblePoints = computed(() => winrateSeries(props.points, props.perspective))

function updateChart() {
  if (!chart) return
  const seriesPoints = visiblePoints.value
  const points = seriesPoints.map(({ point }) => point)
  const isBlack = props.perspective === 'black'
  const perspectiveLabel = isBlack ? '黑方' : '白方'
  const winrateColor = isBlack ? '#0078d4' : '#106ebe'
  const selectedLead = (point: WinratePoint) => {
    const lead = positionScore(point.black / 100, point.scoreLead).lead
    return isBlack ? lead : -lead
  }
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
          value?: [number, number]
        }>
        const item = items[0] ?? {}
        const index = item.dataIndex ?? 0
        const point = points[index]
        return [
          `第 ${points[index] ? winratePly(points[index]) : item.axisValue ?? '-'} 手`,
          `${perspectiveLabel}胜率：${Number(point ? seriesPoints[index]?.value : 0).toFixed(1)}%`,
          `${perspectiveLabel}目差：${formatLead(point ? selectedLead(point) : 0)}`,
        ].join('<br/>')
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: Math.max(1, ...points.map((point) => winratePly(point))),
      minInterval: 1,
      boundaryGap: false,
      name: '手数',
      nameGap: 8,
      nameTextStyle: { color: '#605e5c', fontSize: 10 },
      axisLine: { lineStyle: { color: '#d1d1d1' } },
      axisTick: { show: false },
      axisLabel: { color: '#605e5c', fontSize: 10 },
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
        data: seriesPoints.map(({ point, value }) => [winratePly(point), value]),
        showSymbol: points.length < 18,
        symbol: 'circle',
        symbolSize: 5,
        smooth: false,
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
  </div>
</template>

<style scoped>
.chart-wrap { position: relative; width: 100%; height: 156px; }
.winrate-chart { width: 100%; height: 100%; }
</style>
