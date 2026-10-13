import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { applyGameCommand, createInitialSnapshot, resumeAfterAdjudication } from '../domain/gameSession'
import type { GameCommand, GameScore, GameSnapshot, Stone } from '../types/game'

export const useGameStore = defineStore('game', () => {
  const timeline = ref<GameSnapshot[]>([createInitialSnapshot()])
  const cursor = ref(0)
  const message = ref('')

  const current = computed(() => timeline.value[cursor.value])
  const canUndo = computed(() => cursor.value > 0)
  const canRedo = computed(() => cursor.value < timeline.value.length - 1)

  function commit(snapshot: GameSnapshot) {
    timeline.value = [...timeline.value.slice(0, cursor.value + 1), snapshot]
    cursor.value += 1
    message.value = ''
  }

  function dispatch(command: GameCommand) {
    const result = applyGameCommand(current.value, command, timeline.value.slice(0, cursor.value))
    if (!result.event) {
      message.value = result.error ?? '操作失败'
      return false
    }
    commit(result.event.snapshot)
    return true
  }

  function play(row: number, col: number) { return dispatch({ type: 'place', row, col }) }
  function pass() { return dispatch({ type: 'pass' }) }
  function resign(reason: 'resignation' | 'timeout' = 'resignation') { return dispatch({ type: 'resign', reason }) }
  function score(winner: Stone | null, result: GameScore) { return dispatch({ type: 'score', winner, score: result }) }

  function resumeAfterScore() {
    const snapshot = resumeAfterAdjudication(current.value)
    if (!snapshot) return false
    // Resuming is not a move: preserve the timeline and ko history.
    timeline.value[cursor.value] = snapshot
    message.value = ''
    return true
  }

  function loadSnapshot(snapshot: GameSnapshot) {
    timeline.value = [snapshot]
    cursor.value = 0
    message.value = ''
  }

  function undo() {
    if (!canUndo.value) return
    cursor.value -= 1
    message.value = ''
  }

  function redo() {
    if (!canRedo.value) return
    cursor.value += 1
    message.value = ''
  }

  function reset(handicap = 0) {
    timeline.value = [createInitialSnapshot(handicap)]
    cursor.value = 0
    message.value = ''
  }

  return { current, canUndo, canRedo, message, play, pass, resign, score, resumeAfterScore, undo, redo, reset, dispatch, loadSnapshot }
})
