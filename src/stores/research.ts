import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  addResearchMark,
  appendResearchMove,
  appendResearchPass,
  clearResearchMarks,
  createResearchTree,
  currentResearchNode,
  deleteResearchVariation,
  editResearchSetup,
  addResearchPointMark,
  selectResearchNode,
  updateResearchComment,
} from '../domain/researchTree'
import type { RuleSet } from '../domain/gameSetup'
import type { BoardMark, BoardMarkType, ResearchMode } from '../types/research'

export const useResearchStore = defineStore('research', () => {
  const tree = ref(createResearchTree())
  const message = ref('')
  const setupStone = ref<'black' | 'white'>('black')
  const markType = ref<BoardMarkType>('circle')

  const current = computed(() => currentResearchNode(tree.value))
  const canGoBack = computed(() => current.value.parentId !== null)
  const canGoForward = computed(() => current.value.children.length > 0)

  function reset(boardSize = 19, ruleSet: RuleSet = 'chinese', komi = 3.75) {
    tree.value = createResearchTree(boardSize, ruleSet, komi)
    message.value = ''
  }

  function play(row: number, col: number) {
    const result = appendResearchMove(tree.value, row, col)
    if (result.error) {
      message.value = result.error
      return false
    }
    tree.value = result.tree
    message.value = ''
    return true
  }

  function pass() {
    tree.value = appendResearchPass(tree.value)
    message.value = ''
  }

  function selectNode(nodeId: string) {
    tree.value = selectResearchNode(tree.value, nodeId)
    message.value = ''
  }

  function goBack() {
    if (current.value.parentId) selectNode(current.value.parentId)
  }

  function goForward() {
    const child = current.value.children[0]
    if (child) selectNode(child)
  }

  function deleteVariation(nodeId: string) {
    tree.value = deleteResearchVariation(tree.value, nodeId)
  }

  function setMode(mode: ResearchMode) {
    tree.value = { ...tree.value, mode }
  }

  function setComment(comment: string) {
    tree.value = updateResearchComment(tree.value, current.value.id, comment)
  }

  function addMark(mark: Omit<BoardMark, 'id'>) {
    tree.value = addResearchMark(tree.value, current.value.id, mark)
  }

  function clearMarks() {
    tree.value = clearResearchMarks(tree.value, current.value.id)
  }

  function setSetupStone(stone: 'black' | 'white') {
    setupStone.value = stone
  }

  function setMarkType(type: BoardMarkType) {
    markType.value = type
  }

  function editSetup(row: number, col: number, stone: 'black' | 'white' | null = setupStone.value) {
    tree.value = editResearchSetup(tree.value, row, col, stone)
    message.value = ''
  }

  function markPoint(row: number, col: number) {
    tree.value = addResearchPointMark(tree.value, current.value.id, markType.value, row, col)
  }

  return {
    tree,
    current,
    message,
    canGoBack,
    canGoForward,
    reset,
    play,
    pass,
    selectNode,
    goBack,
    goForward,
    deleteVariation,
    setMode,
    setComment,
    addMark,
    clearMarks,
    setupStone,
    markType,
    setSetupStone,
    setMarkType,
    editSetup,
    markPoint,
  }
})
