<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LineChart } from 'echarts/charts'
import { GraphicComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { init, use, type EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { WinratePoint } from '../../services/katago'
import { plyStone, winratePly, winrateSeries, winrateViewport } from './winrateChartData'
import { positionScore } from '../../domain/scoring'

use([LineChart, GridComponent, TooltipComponent, GraphicComponent, CanvasRenderer])

const props = defineProps<{
  points: WinratePoint[]
  perspective: 'black' | 'white'
}>()

/** Moves kept inside the scrolling viewport. Constant density at any game length. */
const WINDOW = 20
/** How long the marker trails the curve before settling on the newest point. */
const MARKER_FOLLOW_MS = 320
/** Visually meaningful reference: an even game sits on this line. */
const EVEN_WINRATE = 50
/** Percentage points of empty space above 100% and below 0%. */
const Y_PADDING = 4
/** Horizontal guides, drawn as markLines so 0% and 100% never get a line. */
const GRID_LEVELS = [20, 40, 60, 80] as const

const host = ref<HTMLDivElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null
let followFrame = 0
const visiblePoints = computed(() => winrateSeries(props.points, props.perspective))
const hasData = computed(() => visiblePoints.value.length > 0)

const viewport = computed(() => winrateViewport(visiblePoints.value.map(({ point }) => point), WINDOW))

/**
 * ECharts hard-codes `disableAnimation` for line markers and jumps scatter
 * positions, so neither kind of symbol travels with the curve. The endpoints are
 * therefore drawn as `graphic` circles re-read from the animated polyline on
 * every frame, so the tail slides in exactly like the line.
 *
 * The reference-line series also owns a polyline (with no points), so pick the
 * longest one instead of trusting display-list order.
 */
function readCurveEnds(): { head: [number, number]; tail: [number, number] } | null {
  if (!chart) return null
  let best: number[] | null = null
  let bestLength = 0
  const visit = (element: unknown) => {
    const node = element as { type?: string; shape?: { points?: ArrayLike<number> }; children?: unknown[] }
    const points = node?.type === 'ec-polyline' ? node.shape?.points : undefined
    if (points && points.length > bestLength) {
      best = Array.from(points)
      bestLength = points.length
    }
    node?.children?.forEach(visit)
  }
  const storage = (chart.getZr() as unknown as { storage?: { getDisplayList(update?: boolean): unknown[] } }).storage
  storage?.getDisplayList(true).forEach(visit)
  // A single analysed move yields a one-point polyline: no line is drawn, but its
  // marker still has to appear, so one point is enough here.
  if (!best || bestLength < 2) return null
  const points = best as number[]
  return {
    head: [points[0], points[1]],
    tail: [points[points.length - 2], points[points.length - 1]],
  }
}

/**
 * Pixel rect of the plot area. `graphic` children ignore the series clip, so the
 * marker needs this to hide once the curve scrolls past the axis edge.
 */
function readPlotRect(): { x: number; y: number; width: number; height: number } | null {
  if (!chart) return null
  const model = (chart as unknown as { getModel?: () => { getComponent(name: string): unknown } }).getModel?.()
  const grid = model?.getComponent('grid') as
    | { coordinateSystem?: { getRect?(): { x: number; y: number; width: number; height: number } } }
    | undefined
  const rect = grid?.coordinateSystem?.getRect?.()
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
}

/** True when a point is far enough outside the plot that its dot must be hidden. */
function outsidePlot(point: [number, number], rect: { x: number; y: number; width: number; height: number }): boolean {
  const [x, y] = point
  const slack = 1
  return x < rect.x - slack || x > rect.x + rect.width + slack || y < rect.y - slack || y > rect.y + rect.height + slack
}

function stopMarkerFollow() {
  if (followFrame) cancelAnimationFrame(followFrame)
  followFrame = 0
}

/** Keep the marker glued to the animated curve tail until it settles. */
function startMarkerFollow(duration: number) {
  stopMarkerFollow()
  if (!duration) return
  const until = performance.now() + duration
  const step = () => {
    // Rebuild the whole graphic stack: `setOption({ graphic })` replaces the
    // group, so touching only the marker would drop the guide lines.
    updateMarker()
    followFrame = performance.now() < until ? requestAnimationFrame(step) : 0
  }
  followFrame = requestAnimationFrame(step)
}

const WINRATE_COLORS = {
  black: {
    line: '#0078d4',
    rival: '#106ebe',
    coral: '#0078d4',
  },
  white: {
    line: '#106ebe',
    rival: '#0078d4',
    coral: '#106ebe',
  },
} as const

function updateChart() {
  if (!chart) return
  const seriesPoints = visiblePoints.value
  const points = seriesPoints.map(({ point }) => point)
  const isBlack = props.perspective === 'black'
  const perspectiveLabel = isBlack ? '黑方' : '白方'
  const palette = WINRATE_COLORS[isBlack ? 'black' : 'white']
  const winrateColor = palette.line
  const selectedLead = (point: WinratePoint) => {
    const lead = positionScore(point.black / 100, point.scoreLead).lead
    return isBlack ? lead : -lead
  }
  const formatLead = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} 目`
  const { min, max } = viewport.value
  // Which side played each plotted ply, so the x axis can carry only that side's
  // move numbers (odd for Black, even for White).
  const stoneByPly = new Map<number, 'black' | 'white'>()
  for (const { point } of seriesPoints) {
    const ply = winratePly(point)
    stoneByPly.set(Math.round(ply), plyStone(point, ply))
  }
  const axisStone: 'black' | 'white' =
    stoneByPly.get(Math.round(min)) ?? stoneByPly.get(Math.round(max)) ?? 'black'

  chart.setOption({
    animation: true,
    animationDuration: 260,
    animationDurationUpdate: 300,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicInOut',
    // Hand-tuned so the widest y label (100%) fits on the left and the last
    // centred move number clears the right edge.
    grid: { top: 18, right: 22, bottom: 26, left: 50, containLabel: false },
    tooltip: {
      trigger: 'axis',
      // Frosted floating panel, matching SetupDropdown / DatePicker.
      backgroundColor: 'rgba(255, 255, 255, 0.72)',
      borderColor: 'rgba(225, 225, 225, 0.9)',
      borderWidth: 1,
      padding: [8, 11],
      extraCssText:
        'border-radius:8px;box-shadow:0 6.4px 14.4px rgba(0,0,0,.13),0 1.2px 3.6px rgba(0,0,0,.1);' +
        'backdrop-filter:blur(24px) saturate(1.3);-webkit-backdrop-filter:blur(24px) saturate(1.3);',
      textStyle: { color: '#323130', fontSize: 11 },
      axisPointer: {
        type: 'line',
        lineStyle: { color: 'rgba(69, 67, 66, 0.35)', width: 1, type: [2, 3] },
      },
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex?: number
          axisValue?: string | number
          value?: [number, number]
        }>
        const item = items[0] ?? {}
        const index = item.dataIndex ?? 0
        const point = points[index]
        const move = points[index] ? winratePly(points[index]) : item.axisValue ?? '-'
        const value = Number(point ? seriesPoints[index]?.value : 0).toFixed(1)
        const lead = formatLead(point ? selectedLead(point) : 0)
        // All three rows share one row style, so the panel reads as a small table
        // instead of three competing sizes.
        const row = (label: string, content: string) =>
          `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;` +
          `font-size:11px;line-height:1.6;font-variant-numeric:tabular-nums;color:#323130">` +
          `<span style="color:#605e5c">${label}</span><span>${content}</span></div>`
        return [
          row('手数', `第 ${move} 手`),
          row(`${perspectiveLabel}胜率`, `${value}%`),
          row(`${perspectiveLabel}目差`, lead),
        ].join('')
      },
    },
    xAxis: {
      type: 'value',
      min,
      max,
      minInterval: 1,
      // A value axis picks its ticks from round numbers, which skips most plies.
      // Asking for a tick per move makes ECharts evaluate every integer, so the
      // label formatter can then keep only the odd ones.
      splitNumber: Math.max(1, Math.round(max - min)),
      boundaryGap: false,
      // Bare ruler: no baseline and no tick marks, so nothing sits on the bottom
      // edge of the plot. The move numbers alone carry the scale.
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#605e5c',
        fontSize: 10,
        fontWeight: 500,
        margin: 8,
        interval: 1,
        hideOverlap: false,
        // Only the side to move next is labelled: Black's moves are odd, White's
        // are even, so the ruler reads 1 3 5 … or 2 4 6 … and each number names
        // the stone just played.
        formatter: (value: number) => {
          const ply = Math.round(value)
          if (ply <= 0) return ''
          const stone = stoneByPly.get(ply) ?? (ply % 2 === 1 ? 'black' : 'white')
          return stone === axisStone ? `${ply}` : ''
        },
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      // A small overshoot keeps a 100% or 0% curve off the plot edge instead of
      // running flush along the top or bottom border.
      min: -Y_PADDING,
      max: 100 + Y_PADDING,
      // `splitNumber` (not `interval`) so ECharts keeps real ticks at 0 and 100:
      // a fixed interval starting from -Y_PADDING lands on -4/21/46/71/96 and
      // silently loses both percentage labels.
      splitNumber: 5,
      axisLine: { show: false },
      axisTick: { show: false },
      // Only the two extremes are named; the even point is shown by its dashed
      // line alone, so the axis stays uncluttered.
      axisLabel: {
        color: '#605e5c',
        fontSize: 10,
        fontWeight: 500,
        margin: 8,
        formatter: (value: number) => {
          if (value === 0) return '0%'
          if (value === 100) return '100%'
          return ''
        },
      },
      splitLine: { show: false },
    },
    series: [
      {
        name: `${perspectiveLabel}胜率`,
        type: 'line',
        // The newest vertex is left symbol-less: `startMarkerFollow` draws it as a
        // `graphic` circle so it can slide in with the curve (line symbols never
        // animate), and two marks there would double up.
        data: seriesPoints.map(({ point, value }, index) => ({
          value: [winratePly(point), value],
          // The newest vertex normally hands off to the `graphic` marker so it can
          // slide in with the curve. With a single move there is no curve yet, so
          // keep its own symbol or the opening ply would show nothing at all.
          symbol: index === seriesPoints.length - 1 && seriesPoints.length > 1 ? 'none' : 'circle',
          // Drawn at full size from the start; there is no hover pop.
          symbolSize: 5,
          itemStyle: { emphasis: { scale: false } },
        })),
        showSymbol: true,
        symbol: 'circle',
        // No hover pop: every dot is drawn at its full size from the start.
        emphasis: { scale: false, itemStyle: { color: winrateColor } },
        // Everything outside the window must be clipped: with `clip: false` the
        // older points of a scrolling game kept drawing their symbols past the
        // y axis and off the canvas.
        clip: true,
        // Straight segments: a smoothed winrate curve implies values between plies
        // that the engine never evaluated.
        smooth: false,
        lineStyle: {
          width: 1.8,
          color: winrateColor,
          cap: 'round',
          join: 'round',
          shadowBlur: 5,
          shadowColor: 'rgba(0, 0, 0, 0.06)',
          shadowOffsetY: 1,
        },
        itemStyle: { color: winrateColor },
        z: 3,
      },
    ],
    // Seeded here so the graphic group exists from the very first option; a later
    // `setOption({ graphic })` alone is not enough to bring it into being.
    graphic: buildGraphic(),
  })
  // The curve starts moving on the next frame; ride it until it settles.
  startMarkerFollow(MARKER_FOLLOW_MS)
  updateMarker()
}

/**
 * Everything drawn outside the series: the four horizontal guides, the empty-state
 * hint and the animated tail marker.
 *
 * These are `graphic` elements because `setOption` on a fresh instance ignored a
 * `graphic`-only update, while a `markLine` on a data-less series rendered
 * nothing at all.
 */
function buildGraphic(): Record<string, unknown>[] {
  const ends = readCurveEnds()
  const rect = readPlotRect()
  const winrateColor = WINRATE_COLORS[props.perspective === 'black' ? 'black' : 'white'].line
  const graphic: Record<string, unknown>[] = []
  if (rect) {
    const top = rect.y
    const height = rect.height
    const left = rect.x
    const right = rect.x + rect.width
    for (const level of GRID_LEVELS) {
      const y = top + height * (1 - level / 100)
      graphic.push({
        id: `grid-${level}`,
        type: 'line',
        z: 0,
        silent: true,
        shape: { x1: left, y1: y, x2: right, y2: y },
        style: { stroke: 'rgba(69, 67, 66, 0.42)', lineWidth: 1, lineDash: [4, 4] },
      })
    }
    if (!hasData.value) {
      const y = top + height * (1 - EVEN_WINRATE / 100)
      graphic.push({
        id: 'empty-hint',
        type: 'text',
        z: 1,
        silent: true,
        style: {
          x: left + rect.width / 2,
          y,
          text: '点击分析查看胜率走势',
          fill: '#605e5c',
          fontSize: 10,
          align: 'center',
          verticalAlign: 'middle',
        },
      })
    }
  }
  // With a lone move the series keeps its own symbol, so the graphic marker would
  // only stack a second dot on the same pixel.
  const hasCurve = visiblePoints.value.length > 1
  // The curve is clipped to the plot, but `graphic` is not: drop the marker as
  // soon as its vertex leaves the plot so no orphan dot survives the scroll.
  if (hasCurve && ends && rect && !outsidePlot(ends.tail, rect)) {
    const { tail } = ends
    graphic.push(
      {
        id: 'latest-halo',
        type: 'circle',
        z: 9,
        silent: true,
        shape: { cx: tail[0], cy: tail[1], r: 6.5 },
        style: { fill: winrateColor, opacity: 0.14 },
      },
      {
        id: 'latest-marker',
        type: 'circle',
        z: 10,
        silent: true,
        shape: { cx: tail[0], cy: tail[1], r: 2.5 },
        style: { fill: winrateColor },
      },
    )
  }
  return graphic
}

/** Repaint the graphic stack (guides plus the animated tail marker). */
function updateMarker() {
  if (!chart) return
  chart.setOption({ graphic: buildGraphic() })
}

onMounted(async () => {
  await nextTick()
  if (!host.value) return
  chart = init(host.value)
  observer = new ResizeObserver(() => {
    chart?.resize()
    updateMarker()
  })
  observer.observe(host.value)
  updateChart()
})

watch(() => [props.points, props.perspective], updateChart, { deep: true })

onBeforeUnmount(() => {
  stopMarkerFollow()
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
      :aria-label="`${perspective === 'black' ? '黑方' : '白方'}胜率变化折线图，显示最近 ${WINDOW} 手，悬停可查看目差`"
    />
  </div>
</template>

<style scoped>
.chart-wrap {
  position: relative;
  width: 100%;
  height: 156px;
  padding: 2px 0 0;
}

.winrate-chart {
  width: 100%;
  height: 100%;
}
</style>


