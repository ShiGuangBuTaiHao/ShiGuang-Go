import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { addResearchPointMark, appendResearchMove, appendResearchPass, appendResearchVariation, clearResearchMarks, createResearchTree, currentResearchNode, deleteResearchVariation, editResearchSetup, promoteResearchVariation, researchGraph, researchLine, researchPath, selectResearchNode, setResearchPlayer, updateResearchComment } from '../domain/researchTree'
import { exportResearchSgf, importResearchSgf } from '../domain/researchSgf'
import type { BoardMarkType, ResearchMode, ResearchTree } from '../types/research'
import type { Stone } from '../types/game'

const draftKey = 'shiguang-go:research-draft:v2'

function restoreDraft(): { tree: ResearchTree; recordId: string | null } {
  try {
    const saved = localStorage.getItem(draftKey)
    if (saved) {
      const draft = JSON.parse(saved) as { sgf: string; dirty: boolean; path?: number[]; recordId?: string | null }
      const next = { ...importResearchSgf(draft.sgf), dirty: draft.dirty }
      let id = next.rootId
      for (const index of draft.path ?? []) { const child = next.nodes[id].children[index]; if (!child) break; id = child }
      next.currentNodeId = id
      return { tree: next, recordId: typeof draft.recordId === 'string' ? draft.recordId : null }
    }
  } catch { /* A damaged or unavailable draft must not prevent opening the workspace. */ }
  return { tree: createResearchTree(), recordId: null }
}

export const useResearchStore = defineStore('research', () => {
  const draft = restoreDraft()
  const tree = shallowRef(draft.tree)
  const recordId = ref<string | null>(draft.recordId)
  let savedContent = draft.tree.dirty ? null : exportResearchSgf(draft.tree)
  const message = ref('')
  const mode = ref<ResearchMode>('play')
  const setupStone = ref<Stone | null>('black')
  const markType = ref<BoardMarkType>('triangle')
  const preferred = ref<Record<string, string>>({})
  const undoStack = shallowRef<ResearchTree[]>([])
  const redoStack = shallowRef<ResearchTree[]>([])
  const current = computed(() => currentResearchNode(tree.value))
  const path = computed(() => researchPath(tree.value))
  const line = computed(() => researchLine(tree.value, preferred.value))
  const lineIndex = computed(() => line.value.findIndex((node) => node.id === current.value.id))
  const graph = computed(() => researchGraph(tree.value))
  const canGoBack = computed(() => Boolean(current.value.parentId))
  const canGoForward = computed(() => current.value.children.length > 0)
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const onMainLine = computed(() => path.value.slice(1).every((node) => tree.value.nodes[node.parentId!].children[0] === node.id))

  function rememberSelection() {
    const next = { ...preferred.value }
    for (const node of researchPath(tree.value).slice(1)) next[node.parentId!] = node.id
    preferred.value = next
  }

  function commit(next: ResearchTree, group = false) {
    if (next === tree.value) return
    if (!group) { undoStack.value = [...undoStack.value.slice(-39), tree.value]; noteNode = null }
    redoStack.value = []
    tree.value = { ...next, dirty: exportResearchSgf(next) !== savedContent }
    rememberSelection()
    message.value = ''
  }

  function selectNode(id: string) {
    tree.value = selectResearchNode(tree.value, id)
    rememberSelection()
    message.value = ''
  }

  function play(row: number, col: number) {
    const result = appendResearchMove(tree.value, row, col)
    if (result.error) { message.value = result.error; return false }
    if (result.tree.dirty === tree.value.dirty && Object.keys(result.tree.nodes).length === Object.keys(tree.value.nodes).length) selectNode(result.tree.currentNodeId)
    else commit(result.tree)
    return true
  }

  function addVariation(coordinates: string[]) {
    const result = appendResearchVariation(tree.value, coordinates)
    if (result.error) { message.value = result.error; return false }
    commit(result.tree)
    return true
  }

  function undo() {
    const previous = undoStack.value.at(-1)
    if (!previous) return
    redoStack.value = [...redoStack.value, tree.value]
    undoStack.value = undoStack.value.slice(0, -1)
    tree.value = { ...previous, dirty: exportResearchSgf(previous) !== savedContent }
    noteNode = null
    rememberSelection()
    message.value = ''
  }

  function redo() {
    const next = redoStack.value.at(-1)
    if (!next) return
    undoStack.value = [...undoStack.value, tree.value]
    redoStack.value = redoStack.value.slice(0, -1)
    tree.value = { ...next, dirty: exportResearchSgf(next) !== savedContent }
    noteNode = null
    rememberSelection()
    message.value = ''
  }

  function replaceDocument(next: ResearchTree) {
    tree.value = next
    savedContent = exportResearchSgf(next)
    noteNode = null
    undoStack.value = []
    redoStack.value = []
    preferred.value = {}
    recordId.value = null
    mode.value = 'play'
    message.value = ''
  }

  let noteNode: string | null = null
  function setComment(comment: string) {
    const group = noteNode === current.value.id
    commit(updateResearchComment(tree.value, current.value.id, comment), group)
    noteNode = current.value.id
  }
  watch(() => tree.value.currentNodeId, () => { noteNode = null })
  watch([tree, recordId], ([next, id]) => {
    const path = researchPath(next).slice(1).map((node) => next.nodes[node.parentId!].children.indexOf(node.id))
    try { localStorage.setItem(draftKey, JSON.stringify({ sgf: exportResearchSgf(next), dirty: next.dirty, path, recordId: id })) }
    catch { message.value = '本地草稿保存失败，请导出 SGF 保存研究' }
  })

  return {
    tree, current, path, line, lineIndex, graph, message, mode, setupStone, markType, recordId,
    canGoBack, canGoForward, canUndo, canRedo, onMainLine,
    play, addVariation, undo, redo, selectNode, setComment,
    reset: () => replaceDocument(createResearchTree()),
    openSgf: (contents: string) => replaceDocument(importResearchSgf(contents)),
    openTree: (next: ResearchTree) => replaceDocument(next),
    loadRecord: (id: string, title: string, next: ResearchTree) => {
      replaceDocument({ ...next, title })
      recordId.value = id
    },
    exportSgf: () => exportResearchSgf(tree.value),
    markSaved: (snapshot = tree.value) => {
      if (snapshot.rootId !== tree.value.rootId) return
      savedContent = exportResearchSgf(snapshot)
      noteNode = null
      tree.value = { ...tree.value, dirty: exportResearchSgf(tree.value) !== savedContent }
    },
    setTitle: (title: string) => { if (title.trim() && title.trim() !== tree.value.title) commit({ ...tree.value, title: title.trim(), dirty: true }) },
    setMode: (value: ResearchMode) => { mode.value = value },
    setSetupStone: (value: Stone | null) => { setupStone.value = value },
    setMarkType: (value: BoardMarkType) => { markType.value = value },
    pass: () => commit(appendResearchPass(tree.value)),
    goBack: () => { if (current.value.parentId) selectNode(current.value.parentId) },
    goForward: () => { const id = line.value[lineIndex.value + 1]?.id; if (id) selectNode(id) },
    goFirst: () => selectNode(tree.value.rootId),
    goLast: () => selectNode(line.value.at(-1)!.id),
    goToIndex: (index: number) => { const node = line.value[index]; if (node) selectNode(node.id) },
    promoteVariation: () => commit(promoteResearchVariation(tree.value)),
    deleteVariation: () => commit(deleteResearchVariation(tree.value, current.value.id)),
    editSetup: (row: number, col: number) => commit(editResearchSetup(tree.value, row, col, setupStone.value)),
    setPlayer: (stone: Stone) => commit(setResearchPlayer(tree.value, stone)),
    markPoint: (row: number, col: number) => commit(addResearchPointMark(tree.value, current.value.id, markType.value, row, col)),
    clearMarks: () => commit(clearResearchMarks(tree.value, current.value.id)),
  }
})
