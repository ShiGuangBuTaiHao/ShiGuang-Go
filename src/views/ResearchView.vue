<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ArrowLeft, BrainCircuit, RotateCcw, Sparkles } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import GoBoard from '../components/board/GoBoard.vue'
import { loadBoardStyle } from '../domain/boardTheme'
import { positionFromCoordinate } from '../domain/go'
import { useGameStore } from '../stores/game'
import type { MoveNumberMarker } from '../types/game'

const router = useRouter()
const game = useGameStore()
const { current } = storeToRefs(game)
const boardStyle = loadBoardStyle()

const moveNumbers = computed<MoveNumberMarker[]>(() => current.value.moves.flatMap((move, index) => {
  const position = positionFromCoordinate(move.coordinate)
  return position ? [{ ...position, moveNumber: index + 1, stone: move.stone }] : []
}))

function place(row: number, col: number) {
  game.play(row, col)
}

function resetBoard() {
  game.reset(0)
}

onMounted(resetBoard)
</script>

<template>
  <main class="research-page">
    <header class="research-header">
      <button class="back-button" type="button" aria-label="返回主菜单" title="返回主菜单" @click="router.push({ name: 'mode-select' })">
        <ArrowLeft :size="17" />
      </button>
      <div class="page-title"><span>研究</span><h1>自由研究盘</h1></div>
      <div class="research-header-actions">
        <button class="toolbar-button" type="button" @click="resetBoard"><RotateCcw :size="16" />清空棋盘</button>
        <button class="toolbar-button primary" type="button" disabled><BrainCircuit :size="16" />获取分析</button>
      </div>
    </header>

    <section class="research-layout">
      <div class="research-board-panel">
        <div class="panel-toolbar">
          <div><span class="section-kicker">当前局面</span><strong>自由摆子与变化拆解</strong></div>
          <span class="board-status">{{ current.moves.length }} 手</span>
        </div>
        <div class="board-stage research-board-stage">
          <GoBoard
            :board="current.board"
            :current-player="current.currentPlayer"
            :last-move="current.lastMove"
            :candidates="[]"
            :territory="[]"
            territory-mode="current"
            :show-star-points="true"
            :show-coordinates="true"
            :dead-stones="[]"
            :move-numbers="moveNumbers"
            :show-move-numbers="true"
            :board-style="boardStyle"
            :disabled="false"
            :busy="false"
            @place="place"
          />
        </div>
      </div>

      <aside class="research-sidebar">
        <section class="research-section">
          <div class="section-heading"><span class="section-kicker">变化树</span><strong>主变化</strong></div>
          <div class="empty-state compact">
            <Sparkles :size="19" />
            <strong>先在棋盘上落子</strong>
            <span>研究盘会在后续版本中支持分支、标记和主变化预览。</span>
          </div>
        </section>
        <section class="research-section">
          <div class="section-heading"><span class="section-kicker">分析</span><strong>局面判断</strong></div>
          <div class="analysis-placeholder"><span>等待分析</span><small>分析功能将在研究盘流程中接入。</small></div>
        </section>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.research-page { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; background: var(--shell); color: var(--text); }
.research-header { display: flex; min-height: 68px; align-items: center; gap: 14px; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--surface); }
.back-button { display: grid; width: 36px; height: 36px; place-items: center; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); }
.back-button:hover { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.page-title { display: grid; gap: 3px; min-width: 0; }.page-title span, .section-kicker { color: var(--text-subtle); font-size: 10px; font-weight: 700; letter-spacing: .08em; }.page-title h1 { margin: 0; font-size: 18px; }
.research-header-actions { display: flex; gap: 8px; margin-left: auto; }.toolbar-button { display: inline-flex; min-height: 34px; align-items: center; gap: 7px; padding: 0 11px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--surface); font: inherit; font-size: 12px; }.toolbar-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }.toolbar-button.primary { border-color: var(--accent); color: #fff; background: var(--accent); }.toolbar-button:disabled { cursor: not-allowed; opacity: .46; }
.research-layout { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(0, 1fr) 340px; }.research-board-panel { display: flex; min-width: 0; min-height: 0; flex-direction: column; }.panel-toolbar { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 16px; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }.panel-toolbar > div { display: grid; gap: 4px; }.panel-toolbar strong { font-size: 13px; }.board-status { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }.research-board-stage { padding: 24px; background: var(--surface-muted); }
.research-sidebar { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: auto; border-left: 1px solid var(--border); background: var(--surface); }.research-section { padding: 18px 16px; border-bottom: 1px solid var(--border); }.section-heading { display: grid; gap: 4px; margin-bottom: 14px; }.section-heading strong { font-size: 14px; }.empty-state { display: grid; justify-items: start; gap: 8px; padding: 16px; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); background: var(--surface-muted); }.empty-state svg { color: var(--accent); }.empty-state strong { color: var(--text); font-size: 12px; }.empty-state span { font-size: 11px; line-height: 1.6; }.analysis-placeholder { display: grid; gap: 5px; padding: 14px 0; color: var(--text-subtle); font-size: 12px; }.analysis-placeholder small { font-size: 11px; line-height: 1.5; }
@media (max-width: 900px) { .research-layout { display: block; overflow: auto; }.research-board-panel { min-height: 620px; }.research-sidebar { border-top: 1px solid var(--border); border-left: 0; }.research-header { padding: 0 16px; }.research-header-actions .toolbar-button:not(.primary) { display: none; } }
@media (max-width: 520px) { .research-header { min-height: 60px; }.research-header-actions .primary { padding: 0 9px; }.research-header-actions .primary svg { display: none; }.research-board-stage { padding: 12px; }.research-board-panel { min-height: 500px; } }
</style>
