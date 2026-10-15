<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ResearchTree, VariationGraph } from '../../types/research'

const props = defineProps<{ graph: VariationGraph; tree: ResearchTree }>()
const emit = defineEmits<{ select: [id: string] }>()
const host = ref<HTMLElement | null>(null)
const isPanning = ref(false)
let panStart: { pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null = null
const nodes = computed(() => new Map(props.graph.nodes.map((node) => [node.id, node])))
const connectors = computed(() => props.graph.nodes.flatMap((fromNode) => {
  const parent = props.tree.nodes[fromNode.id]
  if (!parent?.children.length) return []
  const children = parent.children.flatMap((id) => {
    const node = nodes.value.get(id)
    return node ? [node] : []
  })
  if (children.length === 1) {
    const child = children[0]
    return [{ key: child.id, active: child.onPath, d: `M ${fromNode.x} ${fromNode.y + 15} V ${child.y - 15}` }]
  }
  const junctionY = (fromNode.y + children[0].y) / 2
  return [
    { key: `${fromNode.id}-stem`, active: children.some((child) => child.onPath), d: `M ${fromNode.x} ${fromNode.y + 15} V ${junctionY}` },
    ...children.map((child) => ({
      key: child.id,
      active: child.onPath,
      d: `M ${fromNode.x} ${junctionY} H ${child.x} V ${child.y - 15}`,
    })),
  ]
}))

function nodeDescription(id: string) {
  const node = props.tree.nodes[id]
  if (!node?.move) return node?.setup ? '局面设置' : '初始局面'
  const side = node.move.stone === 'black' ? '黑方' : '白方'
  const move = node.move.pass ? '停一手' : node.move.coordinate
  return `第 ${node.snapshot.moveNumber} 手，${side}，${move}${node.comment ? '，有备注' : ''}`
}

function startPan(event: PointerEvent) {
  const element = host.value
  const target = event.target
  if (!element || event.button !== 0 || !(target instanceof Element) || target.closest('.graph-node')) return
  const bounds = element.getBoundingClientRect()
  const contentRight = bounds.left + element.clientLeft + element.clientWidth
  const contentBottom = bounds.top + element.clientTop + element.clientHeight
  if (event.clientX >= contentRight || event.clientY >= contentBottom) return
  panStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }
  element.setPointerCapture(event.pointerId)
}

function pan(event: PointerEvent) {
  const element = host.value
  if (!element || !panStart || panStart.pointerId !== event.pointerId) return
  const deltaX = event.clientX - panStart.x
  const deltaY = event.clientY - panStart.y
  if (!isPanning.value && Math.hypot(deltaX, deltaY) < 3) return
  isPanning.value = true
  element.scrollLeft = panStart.scrollLeft - deltaX
  element.scrollTop = panStart.scrollTop - deltaY
  event.preventDefault()
}

function stopPan(event: PointerEvent) {
  if (!panStart || panStart.pointerId !== event.pointerId) return
  panStart = null
  isPanning.value = false
}

async function keepCurrentVisible() {
  await nextTick()
  const node = props.graph.nodes.find((item) => item.current)
  const element = host.value
  if (!node || !element) return
  const margin = 22
  if (node.x < element.scrollLeft + margin || node.x > element.scrollLeft + element.clientWidth - margin) {
    element.scrollLeft = Math.max(0, node.x - element.clientWidth / 2)
  }
  if (node.y < element.scrollTop + margin || node.y > element.scrollTop + element.clientHeight - margin) {
    element.scrollTop = Math.max(0, node.y - element.clientHeight / 2)
  }
}

watch(() => props.tree.currentNodeId, keepCurrentVisible, { immediate: true })
</script>

<template>
  <div
    ref="host"
    class="variation-viewport"
    :class="{ 'is-panning': isPanning }"
    role="region"
    tabindex="0"
    aria-label="变化树，可横向和纵向滚动"
    @pointerdown="startPan"
    @pointermove="pan"
    @pointerup="stopPan"
    @pointercancel="stopPan"
    @lostpointercapture="stopPan"
  >
    <div class="variation-canvas" :style="{ width: `${Math.max(graph.width, 260)}px`, height: `${Math.max(graph.height, 140)}px` }">
      <svg class="variation-lines" :width="graph.width" :height="graph.height" aria-hidden="true">
        <path
          v-for="connector in connectors"
          :key="connector.key"
          :class="{ active: connector.active }"
          :d="connector.d"
        />
      </svg>
      <button
        v-for="node in graph.nodes"
        :key="node.id"
        type="button"
        class="graph-node"
        :class="{ selected: node.current, 'on-path': node.onPath, annotated: node.comment }"
        :style="{ left: `${node.x - 23}px`, top: `${node.y - 15}px` }"
        :aria-label="nodeDescription(node.id)"
        :aria-current="node.current ? 'step' : undefined"
        :title="nodeDescription(node.id)"
        @click="emit('select', node.id)"
      >
        <span v-if="node.stone" class="stone-marker" :class="node.stone" aria-hidden="true" />
        <span v-else-if="tree.nodes[node.id]?.setup" class="stone-marker setup-marker" aria-hidden="true">摆</span>
        <span v-else class="stone-marker setup-marker root-marker" aria-hidden="true" />
        <span class="move-number">{{ node.label === '·' ? '' : node.label }}</span>
        <span v-if="tree.nodes[node.id]?.children.length > 1" class="fork-count" aria-hidden="true">+{{ tree.nodes[node.id].children.length - 1 }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.variation-viewport { position: relative; min-width: 0; min-height: 140px; height: 100%; overflow: auto; border: 0; border-radius: 0; background: transparent; overscroll-behavior: contain; cursor: grab; touch-action: none; }
.variation-viewport::-webkit-scrollbar-track { margin: 4px; background: transparent; }
.variation-viewport::-webkit-scrollbar-corner { background: transparent; }
.variation-viewport.is-panning { cursor: grabbing; user-select: none; }
.variation-viewport:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.variation-canvas { position: relative; }
.variation-lines { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
.variation-lines path { fill: none; stroke: var(--border); stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.variation-lines path.active { stroke: var(--accent-strong); stroke-width: 1.75; }
.graph-node { position: absolute; display: flex; align-items: center; justify-content: center; gap: 6px; width: 46px; height: 30px; padding: 0 5px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--surface); font-size: 11px; font-variant-numeric: tabular-nums; cursor: pointer; touch-action: manipulation; transition: background-color 120ms ease, border-color 120ms ease; }
.graph-node.on-path:not(.selected) { border-color: rgba(var(--accent-rgb), .22); background: rgba(var(--accent-rgb), .035); }
.graph-node.selected { border-color: var(--accent); background: var(--accent-soft); }
.graph-node:hover { border-color: var(--accent-16); background: var(--accent-soft); }
.graph-node:focus-visible { z-index: 2; outline: 2px solid var(--accent); outline-offset: 2px; }
.stone-marker { flex: 0 0 9px; width: 9px; height: 9px; border: 1px solid #555; border-radius: 50%; background: var(--surface); }
.stone-marker.black { border-color: #323130; background: #323130; }
.stone-marker.white { border-color: #777; background: #fff; }
.setup-marker { display: grid; flex-basis: 15px; width: 15px; height: 15px; place-items: center; border-color: transparent; color: var(--muted); font-size: 9px; }
.move-number { min-width: 0; }
.fork-count { position: absolute; top: 50%; left: calc(100% + 4px); color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; line-height: 1; transform: translateY(-50%); white-space: nowrap; }
.graph-node.selected .fork-count, .graph-node:hover .fork-count { color: var(--accent-strong); }
.graph-node.annotated::after { position: absolute; top: -3px; right: -3px; width: 6px; height: 6px; border: 1px solid var(--surface); border-radius: 50%; background: var(--accent); content: ''; }
</style>
