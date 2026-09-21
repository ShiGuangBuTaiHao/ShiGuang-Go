<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, BrainCircuit, ChevronLeft, ChevronRight, CircleDot, Eraser, RotateCcw, Sparkles } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import GoBoard from '../components/board/GoBoard.vue'
import PlayerHeader from '../components/game/PlayerHeader.vue'
import { loadBoardStyle } from '../domain/boardTheme'
import { positionFromCoordinate } from '../domain/go'
import { researchPath } from '../domain/researchTree'
import { useResearchStore } from '../stores/research'
import type { MoveNumberMarker } from '../types/game'

const router = useRouter()
const research = useResearchStore()
const { tree, current, message, canGoBack, canGoForward, setupStone, markType } = storeToRefs(research)
const boardStyle = loadBoardStyle()

const moveNumbers = computed<MoveNumberMarker[]>(() => researchPath(tree.value).flatMap((node) => {
  if (!node.move || node.move.pass) return []
  const position = positionFromCoordinate(node.move.coordinate, tree.value.boardSize)
  return position ? [{ ...position, moveNumber: node.snapshot.moveNumber, stone: node.move.stone }] : []
}))

const lastMove = computed(() => {
  if (!current.value.snapshot.lastMove || !current.value.move || current.value.move.pass) return null
  return { ...current.value.snapshot.lastMove, stone: current.value.move.stone }
})

const lastMoveLabel = computed(() => current.value.move?.pass ? '停一手' : current.value.move?.coordinate ?? '尚未落子')

const variationRows = computed(() => {
  const rows: Array<{ id: string; depth: number; label: string; current: boolean }> = []
  const visit = (nodeId: string, depth: number) => {
    const node = tree.value.nodes[nodeId]
    if (!node) return
    const label = node.move?.pass
      ? `${node.snapshot.moveNumber}. 停一手`
      : node.move
        ? `${node.snapshot.moveNumber}. ${node.move.coordinate}`
        : '初始局面'
    rows.push({ id: node.id, depth, label, current: node.id === tree.value.currentNodeId })
    node.children.forEach((childId) => visit(childId, depth + 1))
  }
  visit(tree.value.rootId, 0)
  return rows
})

function place(row: number, col: number) {
  if (tree.value.mode === 'setup') {
    research.editSetup(row, col, current.value.snapshot.board[row]?.[col] ? null : setupStone.value)
    return
  }
  if (tree.value.mode === 'mark') {
    research.markPoint(row, col)
    return
  }
  research.play(row, col)
}

function resetBoard() {
  research.reset(tree.value.boardSize, tree.value.ruleSet, tree.value.komi)
}

</script>

<template>
  <main class="workspace research-workspace">
    <section class="game-area research-game-area">
      <header class="research-context-bar">
        <div class="research-context-copy">
          <button class="research-back-button" type="button" aria-label="返回主菜单" title="返回主菜单" @click="router.push({ name: 'mode-select' })">
            <ArrowLeft :size="17" />
          </button>
          <div>
            <span>研究盘</span>
            <strong>自由研究</strong>
          </div>
        </div>
        <div class="research-header-actions">
          <button class="research-icon-button" type="button" :disabled="!canGoBack" aria-label="回到上一个局面" title="回到上一个局面" @click="research.goBack"><ChevronLeft :size="16" /></button>
          <button class="research-icon-button" type="button" :disabled="!canGoForward" aria-label="进入下一个局面" title="进入下一个局面" @click="research.goForward"><ChevronRight :size="16" /></button>
          <button class="research-toolbar-button" type="button" @click="research.pass"><CircleDot :size="16" />停一手</button>
          <button class="research-toolbar-button" type="button" @click="resetBoard"><RotateCcw :size="16" />清空棋盘</button>
          <button class="research-toolbar-button primary" type="button" disabled><BrainCircuit :size="16" />获取分析</button>
        </div>
      </header>

      <PlayerHeader
        black-name="研究黑方"
        white-name="研究白方"
        :move-number="current.snapshot.moveNumber"
        :current-player="current.snapshot.currentPlayer"
        :last-move-label="lastMoveLabel"
      />

      <div class="research-toolbars">
        <div class="mode-switch" aria-label="研究模式">
          <button type="button" :class="{ selected: tree.mode === 'play' }" @click="research.setMode('play')">落子</button>
          <button type="button" :class="{ selected: tree.mode === 'setup' }" @click="research.setMode('setup')">摆子</button>
          <button type="button" :class="{ selected: tree.mode === 'mark' }" @click="research.setMode('mark')">标记</button>
        </div>
        <div v-if="tree.mode === 'setup'" class="mode-options">
          <button type="button" :class="{ selected: setupStone === 'black' }" @click="research.setSetupStone('black')">黑子</button>
          <button type="button" :class="{ selected: setupStone === 'white' }" @click="research.setSetupStone('white')">白子</button>
        </div>
        <div v-if="tree.mode === 'mark'" class="mode-options">
          <button type="button" :class="{ selected: markType === 'circle' }" @click="research.setMarkType('circle')">圆</button>
          <button type="button" :class="{ selected: markType === 'triangle' }" @click="research.setMarkType('triangle')">三角</button>
          <button type="button" :class="{ selected: markType === 'square' }" @click="research.setMarkType('square')">方</button>
          <button type="button" :class="{ selected: markType === 'cross' }" @click="research.setMarkType('cross')">叉</button>
          <button class="icon-tool-button" type="button" aria-label="清除当前局面标记" title="清除当前局面标记" @click="research.clearMarks"><Eraser :size="14" /></button>
        </div>
      </div>

      <div class="board-stage research-board-stage">
          <GoBoard
            :board="current.snapshot.board"
            :current-player="current.snapshot.currentPlayer"
            :last-move="lastMove"
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
            :marks="current.marks"
            @place="place"
          />
      </div>

      <div class="match-action-bar research-action-bar">
        <div class="match-action-group" aria-label="研究操作">
          <button class="match-action" type="button" :disabled="!canGoBack" aria-label="上一个局面" title="上一个局面" @click="research.goBack"><ChevronLeft :size="16" /><span>上一个</span></button>
          <button class="match-action" type="button" :disabled="!canGoForward" aria-label="下一个局面" title="下一个局面" @click="research.goForward"><ChevronRight :size="16" /><span>下一个</span></button>
          <button class="match-action" type="button" @click="research.pass"><CircleDot :size="16" /><span>停一手</span></button>
          <button class="match-action" type="button" @click="resetBoard"><RotateCcw :size="16" /><span>重新开始</span></button>
        </div>
      </div>
    </section>

    <aside class="game-sidebar research-sidebar" aria-label="研究信息">
      <div class="sidebar-scroll">
        <section class="research-control-section">
          <div class="sidebar-section-heading">
            <div><span class="sidebar-kicker">研究工具</span><strong>当前模式</strong></div>
            <span class="mode-status">{{ tree.mode === 'play' ? '落子' : tree.mode === 'setup' ? '摆子' : '标记' }}</span>
          </div>
          <div class="research-control-row"><span>当前手数</span><strong>{{ current.snapshot.moveNumber }}</strong></div>
          <div class="research-control-row"><span>当前执子</span><strong>{{ current.snapshot.currentPlayer === 'black' ? '黑方' : '白方' }}</strong></div>
          <div v-if="message" class="research-feedback" role="status">{{ message }}</div>
        </section>

        <section class="research-control-section variation-section">
          <div class="sidebar-section-heading"><div><span class="sidebar-kicker">变化树</span><strong>研究节点</strong></div><span class="node-count">{{ variationRows.length }}</span></div>
          <div v-if="variationRows.length === 1" class="empty-state compact">
            <Sparkles :size="18" />
            <strong>等待第一手</strong>
            <span>每一手都会保留为可返回的研究节点。</span>
          </div>
          <div v-else class="variation-tree" aria-label="变化树">
            <button
              v-for="row in variationRows"
              :key="row.id"
              class="variation-node"
              :class="{ selected: row.current }"
              :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
              type="button"
              @click="research.selectNode(row.id)"
            >
              <span class="variation-dot" />
              <span>{{ row.label }}</span>
            </button>
          </div>
        </section>

        <section class="research-control-section analysis-section">
          <div class="sidebar-section-heading"><div><span class="sidebar-kicker">局面分析</span><strong>AI 研究</strong></div><BrainCircuit :size="16" /></div>
          <div class="analysis-placeholder"><span>{{ message || '等待分析' }}</span><small>当前局面分析、候选点和胜率曲线将在下一步接入。</small></div>
          <button class="analysis-command" type="button" disabled><BrainCircuit :size="15" />获取分析</button>
        </section>
      </div>
    </aside>
  </main>
</template>

<style scoped>
.research-workspace { grid-template-columns: minmax(600px, 1fr) 360px; }
.research-game-area { grid-template-rows: 58px 72px 44px minmax(0, 1fr) auto; background: var(--shell); }
.research-context-bar { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 16px; padding: 0 18px; border-bottom: 1px solid rgba(225, 225, 225, .72); background: rgba(255, 255, 255, .42); backdrop-filter: blur(2px); }
.research-context-copy, .research-header-actions { display: flex; min-width: 0; align-items: center; gap: 10px; }
.research-context-copy > div { display: grid; min-width: 0; gap: 2px; }
.research-context-copy span, .sidebar-kicker { color: var(--muted); font-size: 10px; }
.research-context-copy strong { color: var(--text); font-size: 14px; }
.research-back-button, .research-icon-button { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: rgba(255, 255, 255, .64); }
.research-back-button:hover, .research-icon-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.research-icon-button:disabled { cursor: not-allowed; opacity: .42; }
.research-toolbar-button { display: inline-flex; min-height: 34px; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: rgba(255, 255, 255, .64); font: inherit; font-size: 11px; }
.research-toolbar-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.research-toolbar-button.primary { border-color: var(--accent); color: #fff; background: var(--accent); }
.research-toolbar-button:disabled { cursor: not-allowed; opacity: .46; }
.research-toolbars { display: flex; min-width: 0; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--border); background: rgba(255, 255, 255, .62); }
.mode-switch, .mode-options { display: flex; align-items: center; gap: 4px; }
.mode-switch button, .mode-options button { min-height: 28px; padding: 0 10px; border: 1px solid transparent; border-radius: 5px; color: var(--muted); background: transparent; font: inherit; font-size: 11px; }
.mode-switch button:hover, .mode-options button:hover { color: var(--text); background: var(--surface-muted); }
.mode-switch button.selected, .mode-options button.selected { border-color: rgba(var(--accent-rgb), .2); color: var(--accent-strong); background: var(--accent-soft); font-weight: 700; }
.mode-options { padding-left: 10px; border-left: 1px solid var(--border); }
.icon-tool-button { display: grid; width: 30px; padding: 0 !important; place-items: center; }
.research-board-stage { padding: 22px 28px; background: var(--surface-muted); }
.research-action-bar { padding: 0 24px 16px; background: var(--surface-muted); }
.research-sidebar { min-width: 320px; max-width: 420px; border-left: 1px solid var(--border); background: var(--surface); }
.sidebar-scroll { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 16px; }
.research-control-section { padding: 0 0 16px; border-bottom: 1px solid var(--border); }
.research-control-section + .research-control-section { padding-top: 16px; }
.sidebar-section-heading { display: flex; min-height: 30px; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.sidebar-section-heading > div { display: grid; min-width: 0; gap: 3px; }
.sidebar-section-heading strong { color: var(--text); font-size: 13px; }
.sidebar-section-heading > svg { color: var(--accent); }
.mode-status, .node-count { color: var(--accent-strong); font-size: 11px; font-weight: 700; }
.research-control-row { display: flex; min-height: 34px; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 11px; }
.research-control-row strong { color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums; }
.research-feedback { margin-top: 8px; padding: 9px 10px; border: 1px solid rgba(232, 17, 35, .2); border-radius: 6px; color: var(--danger); background: var(--danger-soft); font-size: 11px; line-height: 1.45; }
.empty-state { display: grid; justify-items: start; gap: 8px; padding: 14px; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); background: var(--surface-muted); }
.empty-state svg { color: var(--accent); }.empty-state strong { color: var(--text); font-size: 12px; }.empty-state span { font-size: 11px; line-height: 1.5; }
.variation-tree { display: grid; max-height: 300px; gap: 2px; overflow: auto; }
.variation-node { display: flex; min-height: 32px; align-items: center; gap: 8px; border: 0; color: var(--muted); background: transparent; font: inherit; font-size: 11px; text-align: left; }
.variation-node:hover { color: var(--text); background: var(--surface-muted); }.variation-node.selected { color: var(--accent-strong); background: var(--accent-soft); font-weight: 700; }.variation-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: currentColor; opacity: .65; }
.analysis-placeholder { display: grid; gap: 5px; padding: 2px 0 12px; color: var(--text-subtle); font-size: 12px; }.analysis-placeholder small { font-size: 11px; line-height: 1.5; }
.analysis-command { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 7px; width: 100%; border: 1px solid var(--accent); border-radius: 6px; color: #fff; background: var(--accent); font: inherit; font-size: 11px; font-weight: 600; }.analysis-command:disabled { cursor: not-allowed; opacity: .48; }
@media (max-width: 980px) { .research-workspace { display: block; overflow-y: auto; }.research-game-area { min-height: 780px; }.research-sidebar { max-width: none; border-top: 1px solid var(--border); border-left: 0; }.research-toolbars { padding-inline: 18px; }.research-board-stage { padding: 22px 24px; } }
@media (max-width: 760px) { .research-game-area { min-height: auto; grid-template-rows: auto auto auto minmax(420px, auto) auto; }.research-context-bar { min-height: 56px; padding-inline: 14px; }.research-header-actions .research-toolbar-button:not(.primary) { display: none; }.research-context-copy strong { font-size: 13px; }.research-toolbars { padding-inline: 12px; overflow-x: auto; }.research-board-stage { min-height: 440px; padding: 12px; }.research-action-bar { padding: 0 12px 16px; }.research-toolbar-button.primary { padding-inline: 9px; }.research-toolbar-button.primary svg { display: none; } }
@media (max-width: 480px) { .research-header-actions { gap: 5px; }.research-header-actions .research-icon-button { width: 30px; height: 30px; }.research-header-actions .research-toolbar-button.primary { font-size: 10px; }.sidebar-scroll { padding: 14px 12px; } }
</style>
