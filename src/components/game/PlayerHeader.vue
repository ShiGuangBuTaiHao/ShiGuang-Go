<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  blackName: string | undefined
  whiteName: string | undefined
  moveNumber: number
  currentPlayer: 'black' | 'white'
  lastMoveLabel: string
  scoreEstimate?: string
  blackTime?: string
  whiteTime?: string
  blackClockDetail?: string
  whiteClockDetail?: string
  blackClockRunning?: boolean
  whiteClockRunning?: boolean
}>()

const blackLabel = computed(() => props.blackName ?? '黑方')
const whiteLabel = computed(() => props.whiteName ?? '白方')
const blackInitial = computed(() => String(blackLabel.value).trim().charAt(0).toUpperCase() || 'B')
const whiteInitial = computed(() => String(whiteLabel.value).trim().charAt(0).toUpperCase() || 'W')
</script>

<template>
  <header class="match-header" :class="{ 'with-score': props.scoreEstimate }" aria-label="对局状态">
    <div class="match-player black-player">
      <div class="player-avatar black-avatar" :class="{ active: props.currentPlayer === 'black' }" aria-hidden="true">
        {{ blackInitial }}
      </div>
      <div class="player-copy">
        <span class="player-side-label">黑方</span>
        <strong class="player-name">{{ blackLabel }}</strong>
        <span v-if="props.blackTime" class="player-clock" :class="{ running: props.blackClockRunning }">
          <b>{{ props.blackTime }}</b><small>{{ props.blackClockDetail }}</small>
        </span>
      </div>
    </div>

    <div class="match-status" :class="{ 'with-score': props.scoreEstimate }" aria-live="polite" aria-atomic="true">
      <strong>第 {{ props.moveNumber }} 手 · {{ props.lastMoveLabel.toLowerCase() || '尚未落子' }}</strong>
      <span v-if="props.scoreEstimate" class="score-estimate">{{ props.scoreEstimate }}</span>
    </div>

    <div class="match-player white-player">
      <div class="player-copy align-right">
        <span class="player-side-label">白方</span>
        <strong class="player-name">{{ whiteLabel }}</strong>
        <span v-if="props.whiteTime" class="player-clock" :class="{ running: props.whiteClockRunning }">
          <b>{{ props.whiteTime }}</b><small>{{ props.whiteClockDetail }}</small>
        </span>
      </div>
      <div class="player-avatar white-avatar" :class="{ active: props.currentPlayer === 'white' }" aria-hidden="true">
        {{ whiteInitial }}
      </div>
    </div>
  </header>
</template>

<style scoped>
.match-header {
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 72px;
  flex: 0 0 72px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  align-items: center;
  gap: 20px;
  padding: 10px 24px;
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  box-sizing: border-box;
  overflow: visible;
}

.match-player { display: flex; min-width: 0; max-width: 100%; align-items: center; gap: 10px; }
.white-player { justify-content: flex-end; }

.player-avatar {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  box-shadow: var(--shadow-xs);
  box-sizing: border-box;
  font-size: 13px;
  font-weight: 700;
  transition: box-shadow 150ms ease-out, border-color 150ms ease-out;
}

.player-avatar.active { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.24), var(--shadow-sm); }
.black-avatar { color: #fff; background: #181a1c; }
.white-avatar { color: var(--text); background: rgba(255, 255, 255, 0.7); }
.player-copy { display: grid; min-width: 0; gap: 2px; overflow: hidden; }
.align-right { text-align: right; }
.player-side-label { color: var(--muted); font-size: 10px; }
.player-name { overflow: hidden; color: var(--text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.player-clock { display: flex; align-items: baseline; gap: 5px; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.player-clock b { color: var(--text); font-size: 12px; }
.player-clock.running b { color: var(--accent); }
.player-clock small { font-size: 9px; }

.match-status { display: grid; min-width: 136px; gap: 1px; justify-items: center; line-height: 1.2; text-align: center; }
.match-status strong { color: var(--text); font-size: 13px; }
.match-header.with-score { flex-basis: auto; }
.match-status.with-score { min-width: 0; max-width: 160px; }
.score-estimate { min-width: 0; max-width: 100%; color: var(--accent); font-size: 11px; font-weight: 600; overflow-wrap: anywhere; line-height: 1.4; text-align: center; font-variant-numeric: tabular-nums; }

@media (max-width: 760px) {
  .match-header { min-height: 64px; flex-basis: 64px; gap: 10px; padding: 8px 14px; }
  .player-avatar { width: 32px; height: 32px; flex-basis: 32px; }
  .player-name { max-width: 88px; font-size: 12px; }
  .player-side-label, .player-clock small { display: none; }
  .match-status { min-width: 96px; }
  .match-status.with-score { max-width: 136px; }
}

@media (max-width: 480px) {
  .player-name { max-width: 58px; }
  .match-status { min-width: 78px; }
}
</style>
