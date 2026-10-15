import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { researchAnalysisPosition } from '../domain/researchAnalysis'
import { appendResearchVariation, currentResearchNode } from '../domain/researchTree'
import { analyzePosition, cancelAnalysis, getEngineStatus, type AnalysisMode, type KataGoAnalysis } from '../services/katago'
import { cancelGnuGoRequest, estimateWithGnuGo, type GnuGoEstimate } from '../services/gnugo'
import { positionFromCoordinate } from '../domain/go'
import type { useResearchStore } from '../stores/research'

export function useResearchAnalysis(research: ReturnType<typeof useResearchStore>) {
  const cache = shallowRef<Record<string, { signature: string; value: KataGoAnalysis }>>({})
  const position = computed(() => researchAnalysisPosition(research.tree))
  const pathPositions = computed(() => research.path.map((node) => {
    const nodePosition = researchAnalysisPosition({ ...research.tree, currentNodeId: node.id })
    return { nodeId: node.id, position: nodePosition }
  }))
  const analysis = computed(() => {
    const entry = cache.value[research.current.id]
    return entry?.signature === position.value.signature ? entry.value : null
  })
  const status = ref<'idle' | 'loading' | 'error'>('idle')
  const error = ref('')
  const live = ref(true)
  const mode = ref<AnalysisMode>('fast')
  const candidatesVisible = ref(false)
  const territoryVisible = ref(false)
  const territoryEstimate = shallowRef<GnuGoEstimate | null>(null)
  const territoryStatus = ref<'idle' | 'loading' | 'error'>('idle')
  const territoryError = ref('')
  const preview = ref<{ move: string; coordinates: string[]; step: number } | null>(null)
  let token = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let territoryRequestId: string | null = null
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
    const positions = pathPositions.value
    status.value = 'loading'
    error.value = ''
    preview.value = null
    try {
      const engine = await getEngineStatus()
      if (requestToken !== token) return
      if (!engine.configured || engine.error) throw new Error(engine.error || engine.detail || '分析引擎未就绪')
      for (const { nodeId, position: requestPosition } of positions) {
        const cached = cache.value[nodeId]
        if (cached?.signature === requestPosition.signature) continue
        const value = await analyzePosition(requestPosition.moves, mode.value, 'normal', undefined, research.tree.ruleSet, research.tree.ruleSet === 'chinese' ? research.tree.komi * 2 : research.tree.komi, 0, undefined, requestPosition)
        if (requestToken !== token || disposed) return
        cache.value = { ...cache.value, [nodeId]: { signature: requestPosition.signature, value: { ...value, turnNumber: requestPosition.turnNumber } } }
      }
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

  async function requestTerritory() {
    if (territoryStatus.value === 'loading' || disposed) return
    const requestId = crypto.randomUUID()
    territoryRequestId = requestId
    territoryStatus.value = 'loading'
    territoryError.value = ''
    try {
      if (research.tree.boardSize !== 19) throw new Error('GNU Go 形势预测仅支持 19 路棋盘')
      const position = researchAnalysisPosition(research.tree)
      const pathMoves = [
        ...position.initialStones.map((stone) => ({ stone: stone.player === 'B' ? 'black' as const : 'white' as const, coordinate: stone.coordinate })),
        ...position.moves.map((move) => ({ stone: move.player === 'B' ? 'black' as const : 'white' as const, coordinate: move.coordinate })),
      ]
      const result = await estimateWithGnuGo(requestId, pathMoves, research.current.snapshot.currentPlayer, research.tree.ruleSet, research.tree.ruleSet === 'chinese' ? research.tree.komi * 2 : research.tree.komi)
      if (disposed || territoryRequestId !== requestId) return
      territoryEstimate.value = result
      territoryStatus.value = 'idle'
    } catch (cause) {
      if (disposed || territoryRequestId !== requestId) return
      territoryError.value = cause instanceof Error ? cause.message : String(cause)
      territoryStatus.value = 'error'
    }
  }

  function stopTerritory() {
    const requestId = territoryRequestId
    territoryRequestId = null
    territoryStatus.value = 'idle'
    if (requestId) void cancelGnuGoRequest(requestId).catch(() => {})
  }

  function territoryDeadStones() {
    return (territoryEstimate.value?.deadStones ?? []).flatMap((coordinate) => {
      const point = positionFromCoordinate(coordinate, research.tree.boardSize)
      return point && research.current.snapshot.board[point.row]?.[point.col] ? [point] : []
    })
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
    const hasUncachedPosition = pathPositions.value.some(({ nodeId, position }) => cache.value[nodeId]?.signature !== position.signature)
    if (live.value && hasUncachedPosition && status.value !== 'loading') timer = setTimeout(() => { void request() }, 350)
  }
  watch([() => research.current.id, () => pathPositions.value.map(({ nodeId, position }) => `${nodeId}:${position.signature}`).join('|')], () => { stop(); stopTerritory(); territoryEstimate.value = null; preview.value = null; error.value = ''; schedule() })
  watch(live, (enabled) => { if (enabled) schedule(); else { clearTimeout(timer); if (status.value === 'loading') stop() } })
  watch(() => research.tree.rootId, () => { cache.value = {}; preview.value = null })
  schedule()
  onBeforeUnmount(() => { disposed = true; live.value = false; stop(); stopTerritory() })
  return { analysis, candidates, history, status, error, live, mode, candidatesVisible, territoryVisible, territoryEstimate, territoryStatus, territoryError, preview, previewTree, displayNode, request, requestTerritory, territoryDeadStones, stop, stopTerritory, showPreview, commitPreview }
}
