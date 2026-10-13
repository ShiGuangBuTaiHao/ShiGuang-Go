<script setup lang="ts">
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Flag,
  Minimize2,
  Pause,
  RotateCcw,
  Undo2,
} from 'lucide-vue-next'

defineProps<{
  variant?: 'game' | 'research'
  canUndo: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  passDisabled: boolean
  resignDisabled: boolean
  resetDisabled?: boolean
  timelineLocked?: boolean
  gameFinished?: boolean
  scoreDisabled?: boolean
  scoreTitle?: string
  immersive?: boolean
}>()

const emit = defineEmits<{
  (event: 'back'): void
  (event: 'forward'): void
  (event: 'undo'): void
  (event: 'pass'): void
  (event: 'resign'): void
  (event: 'reset'): void
  (event: 'exit-immersive'): void
  (event: 'score'): void
}>()
</script>

<template>
  <div class="match-action-bar">
    <div v-if="variant === 'research'" class="match-action-group" aria-label="研究操作">
      <button class="match-action" type="button" :disabled="!canGoBack" aria-label="上一个局面" title="上一个局面" @click="emit('back')">
        <ChevronLeft :size="16" aria-hidden="true" />
        <span>上一个</span>
      </button>
      <button class="match-action" type="button" :disabled="!canGoForward" aria-label="下一个局面" title="下一个局面" @click="emit('forward')">
        <ChevronRight :size="16" aria-hidden="true" />
        <span>下一个</span>
      </button>
      <button class="match-action" type="button" :disabled="passDisabled" aria-label="停一手" title="停一手" @click="emit('pass')">
        <Pause :size="16" aria-hidden="true" />
        <span>停一手</span>
      </button>
      <button class="match-action" type="button" :disabled="resetDisabled" aria-label="重新开始" title="重新开始" @click="emit('reset')">
        <RotateCcw :size="16" aria-hidden="true" />
        <span>重新开始</span>
      </button>
    </div>
    <div v-else class="match-action-group" aria-label="对局操作">
      <button
        class="match-action"
        type="button"
        :disabled="gameFinished || !canUndo || timelineLocked"
        aria-label="悔棋"
        title="悔棋"
        @click="emit('undo')"
      >
        <Undo2 :size="16" aria-hidden="true" />
        <span>悔棋</span>
      </button>
      <button
        class="match-action"
        type="button"
        :disabled="passDisabled"
        aria-label="停一手"
        title="停一手"
        @click="emit('pass')"
      >
        <Pause :size="16" aria-hidden="true" />
        <span>停一手</span>
      </button>
      <button
        class="match-action score-action"
        type="button"
        :disabled="scoreDisabled"
        aria-label="数子"
        :title="scoreTitle ?? '数子'"
        @click="emit('score')"
      >
        <Calculator :size="16" aria-hidden="true" />
        <span>数子</span>
      </button>
      <button
        class="match-action"
        type="button"
        :disabled="resetDisabled"
        aria-label="重新开始"
        title="重新开始"
        @click="emit('reset')"
      >
        <RotateCcw :size="16" aria-hidden="true" />
        <span>重新开始</span>
      </button>
      <button
        class="match-action danger"
        type="button"
        :disabled="resignDisabled"
        aria-label="认输"
        title="认输"
        @click="emit('resign')"
      >
        <Flag :size="16" aria-hidden="true" />
        <span>认输</span>
      </button>
      <button
        v-if="immersive"
        class="match-action immersive-exit"
        type="button"
        aria-label="退出"
        title="退出"
        @click="emit('exit-immersive')"
      >
        <Minimize2 :size="16" aria-hidden="true" />
        <span>退出</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.match-action-bar {
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 0 24px 18px;
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.match-action-group {
  display: flex;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.match-action {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  border: 1px solid rgba(225, 225, 225, 0.78);
  border-radius: 6px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.4);
  box-shadow: var(--shadow-xs);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  transition: border-color 150ms ease-out, background-color 150ms ease-out,
    color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out;
}

.match-action:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.6);
  color: var(--accent-strong);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: var(--shadow-sm);
}

.match-action:active:not(:disabled) {
  transform: scale(0.97);
  box-shadow: none;
}

.match-action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(243, 242, 241, 0.9), 0 0 0 6px var(--accent);
}

.match-action:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.match-action.danger {
  border-color: rgba(232, 17, 35, 0.28);
  color: var(--danger);
}

.match-action.danger:hover:not(:disabled) {
  border-color: rgba(232, 17, 35, 0.5);
  color: #a80012;
  background: rgba(253, 231, 233, 0.72);
}

.match-action.immersive-exit {
  border-color: rgba(var(--accent-rgb), 0.32);
  color: var(--accent-strong);
}

.match-action.immersive-exit:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-strong);
  background: var(--accent-soft);
}

@media (max-width: 760px) {
  .match-action-bar { padding: 0 12px 16px; }
  .match-action { flex: 1 1 0; min-width: 0; padding: 0 9px; }
  .match-action span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
