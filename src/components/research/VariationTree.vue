<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { VariationGraph } from '../../types/research'

const props = defineProps<{ graph: VariationGraph }>()
const emit = defineEmits<{ select: [id: string] }>()
const host = ref<HTMLElement | null>(null)
const nodes = computed(() => new Map(props.graph.nodes.map((node) => [node.id, node])))
const edges = computed(() => props.graph.edges.map((edge) => ({ ...edge, fromNode: nodes.value.get(edge.from)!, toNode: nodes.value.get(edge.to)! })))
watch(() => props.graph.nodes.find((node) => node.current)?.id, async () => {
  await nextTick()
  const node = props.graph.nodes.find((item) => item.current)
  if (!node || !host.value) return
  const element = host.value
  if (node.x < element.scrollLeft + 20 || node.x > element.scrollLeft + element.clientWidth - 20) element.scrollLeft = Math.max(0, node.x - element.clientWidth / 2)
  if (node.y < element.scrollTop + 20 || node.y > element.scrollTop + element.clientHeight - 20) element.scrollTop = Math.max(0, node.y - element.clientHeight / 2)
}, { immediate: true })
</script>

<template>
  <div ref="host" class="variation-viewport" aria-label="变化树">
    <div class="variation-canvas" :style="{ width: `${Math.max(graph.width, 260)}px`, height: `${Math.max(graph.height, 140)}px` }">
      <svg class="variation-lines" :width="graph.width" :height="graph.height" aria-hidden="true">
        <path v-for="edge in edges" :key="edge.to" :class="{ active: edge.active }" :d="`M ${edge.fromNode.x} ${edge.fromNode.y} H ${edge.fromNode.x + 19} V ${edge.toNode.y} H ${edge.toNode.x}`" />
      </svg>
      <button v-for="node in graph.nodes" :key="node.id" type="button" class="graph-node" :class="[node.stone, { selected: node.current, 'on-path': node.onPath, annotated: node.comment }]" :style="{ left: `${node.x - 14}px`, top: `${node.y - 14}px` }" :aria-label="node.stone ? `第 ${node.label} 手，${node.stone === 'black' ? '黑方' : '白方'}${node.comment ? '，有备注' : ''}` : '初始局面'" :aria-current="node.current ? 'step' : undefined" :title="node.stone ? `第 ${node.label} 手` : '初始局面'" @click="emit('select', node.id)">{{ node.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.variation-viewport { position: relative; min-height: 140px; height: 100%; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: rgba(255,255,255,.38); scrollbar-width: thin; }
.variation-canvas { position: relative; }
.variation-lines { position: absolute; top: 0; left: 0; pointer-events: none; }
.variation-lines path { fill: none; stroke: var(--text-subtle); stroke-width: 1.5; }
.variation-lines path.active { stroke: var(--accent); stroke-width: 2; }
.graph-node { position: absolute; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 50%; color: var(--muted); background: var(--surface-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.graph-node.black { color: #fff; background: #323130; border-color: #323130; }
.graph-node.white { color: var(--text); background: var(--surface); border-color: var(--text-subtle); }
.graph-node.selected { outline: 2px solid var(--accent); outline-offset: 3px; }
.graph-node:hover { box-shadow: 0 0 0 3px var(--accent-soft); }
.graph-node.annotated::after { content: ''; position: absolute; right: -2px; bottom: -2px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); border: 1px solid var(--surface); }
</style>
