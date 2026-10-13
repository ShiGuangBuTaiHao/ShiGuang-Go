import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { researchAnalysisPosition } from '../domain/researchAnalysis'
import { appendResearchVariation, currentResearchNode } from '../domain/researchTree'
import { analyzePosition, cancelAnalysis, getEngineStatus, type AnalysisMode, type KataGoAnalysis } from '../services/katago'
import type { useResearchStore } from '../stores/research'

export function useResearchAnalysis(research: ReturnType<typeof useResearchStore>) {
  const cache = shallowRef<Record<string, { signature: string; value: KataGoAnalysis }>>({})
  const position = computed(() => researchAnalysisPosition(research.tree))
  const analysis = computed(() => {
    const entry = cache.value[research.current.id]
    return entry?.signature === position.value.signature ? entry.value : null
  })
  const status = ref<'idle' | 'loading' | 'error'>('idle')
  const error = ref('')
  const live = ref(false)
  const mode = ref<AnalysisMode>('fast')
  const candidatesVisible = ref(true)
  const territoryVisible = ref(false)
  const preview = ref<{ move: string; coordinates: string[]; step: number } | null>(null)
  let token = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const candidates = computed(() => [...(analysis.value?.moveInfos ?? [])].sort((a, b) => a.order - b.order).slice(0, 5))
  const history = computed(() => research.path.flatMap((node) => {
    const entry = cache.value[node.id]
    if (!entry || entry.signature !== researchAnalysisPosition({ ...research.tree, currentNodeId: node.id }).signature) return []
    return [{ moveNumber: node.snapshot.moveNumber, black: entry.value.rootInfo.winrate * 100, white: 100 - entry.value.rootInfo.winrate * 100, scoreLead: entry.value.rootInfo.scoreLead }]
  }))
  const previewTree = computed(() => preview.value ? appendResearchVariation(research.tree, preview.value.coordinates.slice(0, preview.value.step)).tree : null)
  const displayNode = computed(() => previewTree.value ? currentResearchNode(previewTree.value) : research.current)

  async function request() {
    if (status.value === 'loading' || disposed) return
    const requestToken = ++token
    const nodeId = research.current.id
    const requestPosition = position.value
    status.value = 'loading'
    error.value = ''
    preview.value = null
    try {
      const engine = await getEngineStatus()
      if (requestToken !== token) return
      if (!engine.configured || engine.error) throw new Error(engine.error || engine.detail || '分析引擎未就绪')
      const value = await analyzePosition(requestPosition.moves, mode.value, 'normal', undefined, research.tree.ruleSet, research.tree.ruleSet === 'chinese' ? research.tree.komi * 2 : research.tree.komi, 0, undefined, requestPosition)
      if (requestToken !== token || disposed) return
      cache.value = { ...cache.value, [nodeId]: { signature: requestPosition.signature, value: { ...value, turnNumber: requestPosition.turnNumber } } }
      status.value = 'idle'
    } catch (cause) {
      if (requestToken !== token || disposed) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      status.value = 'error'
      live.value = false
    }
  }

  function stop() {
    token += 1
    clearTimeout(timer)
    if (status.value === 'loading') void cancelAnalysis().catch(() => {})
    status.value = 'idle'
  }

  function showPreview(move: string) {
    const candidate = candidates.value.find((item) => item.move === move)
    if (!candidate) return
    const coordinates = candidate.pv[0] === move ? candidate.pv : [move, ...candidate.pv]
    const result = appendResearchVariation(research.tree, coordinates)
    if (result.error) { research.message = `无法预览此变化：${result.error}`; return }
    preview.value = { move, coordinates, step: Math.min(coordinates.length, 8) }
  }

  function commitPreview() {
    if (!preview.value) return
    if (research.addVariation(preview.value.coordinates.slice(0, preview.value.step))) preview.value = null
  }

  function schedule() {
    clearTimeout(timer)
    if (live.value && !analysis.value && status.value !== 'loading') timer = setTimeout(() => { void request() }, 350)
  }
  watch([() => research.current.id, () => position.value.signature], () => { stop(); preview.value = null; error.value = ''; schedule() })
  watch(live, (enabled) => { if (enabled) schedule(); else { clearTimeout(timer); if (status.value === 'loading') stop() } })
  watch(() => research.tree.rootId, () => { cache.value = {}; preview.value = null })
  onBeforeUnmount(() => { disposed = true; live.value = false; stop() })
  return { analysis, candidates, history, status, error, live, mode, candidatesVisible, territoryVisible, preview, previewTree, displayNode, request, stop, showPreview, commitPreview }
}
