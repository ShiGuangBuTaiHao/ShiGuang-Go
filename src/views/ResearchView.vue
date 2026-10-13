<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowUpToLine, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, FilePlus2, FolderOpen, GitBranch, Library, MessageSquare, Pause, Redo2, Save, Trash2, Undo2, X } from 'lucide-vue-next'
import GoBoard from '../components/board/GoBoard.vue'
import SidebarShell, { type SidebarTab } from '../components/game/SidebarShell.vue'
import ResearchModeToolbar from '../components/research/ResearchModeToolbar.vue'
import VariationTree from '../components/research/VariationTree.vue'
import ResearchEvaluation from '../components/research/ResearchEvaluation.vue'
import { useResearchAnalysis } from '../composables/useResearchAnalysis'
import { useResearchStore } from '../stores/research'
import { loadBoardStyle } from '../domain/boardTheme'
import { formatKomi } from '../domain/gameSetup'
import { positionFromCoordinate } from '../domain/go'
import { researchPath } from '../domain/researchTree'
import { importResearchSgf } from '../domain/researchSgf'
import { decodeSgfFile } from '../domain/sgf'
import { ownershipTerritory } from '../domain/territory'
import { downloadRecords, listLibrary, saveResearchRecord } from '../services/library'
import type { LibraryRecord } from '../types/library'
import type { CandidateMarker, MoveNumberMarker, Stone } from '../types/game'

const research = useResearchStore()
const { tree, current, mode, setupStone, markType, message, line, lineIndex, graph, canGoBack, canGoForward, canUndo, canRedo, onMainLine } = storeToRefs(research)
const ai = useResearchAnalysis(research)
const { analysis, candidates, history, status, error, live, preview, previewTree, displayNode, candidatesVisible, territoryVisible } = ai
const route = useRoute()
const router = useRouter()
const boardStyle = ref(loadBoardStyle())
const perspective = ref<'black' | 'white'>('black')
const moveNumbersVisible = ref(true)
const libraryVisible = ref(false)
const inspectorTab = ref('analysis')
const inspectorTabs: SidebarTab[] = [
  { id: 'analysis', label: '分析' },
  { id: 'tree', label: '变化树' },
]
const libraryRecords = ref<LibraryRecord[]>([])
const libraryQuery = ref('')
const libraryLoading = ref(false)
const currentRecordId = computed({ get: () => research.recordId, set: (id: string | null) => { research.recordId = id } })
const fileInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const documentMessage = ref('')
const confirmAction = ref<{ title: string; message: string; label: string; run: () => void } | null>(null)
const confirmDialog = ref<HTMLElement | null>(null)
const boardStage = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const filteredRecords = computed(() => {
  const query = libraryQuery.value.trim().toLowerCase()
  return libraryRecords.value.filter((record) => !record.deletedAt && (!query || [record.title, record.black, record.white].join(' ').toLowerCase().includes(query)))
})
const displayPath = computed(() => researchPath(previewTree.value ?? tree.value))
const moveNumbers = computed<MoveNumberMarker[]>(() => displayPath.value.flatMap((node) => node.move && !node.move.pass ? [{ row: node.move.row!, col: node.move.col!, moveNumber: node.snapshot.moveNumber, stone: node.move.stone }] : []))
const lastMove = computed(() => displayNode.value.snapshot.lastMove && displayNode.value.move ? { ...displayNode.value.snapshot.lastMove, stone: displayNode.value.move.stone } : null)
const candidateMarkers = computed<CandidateMarker[]>(() => !candidatesVisible.value || preview.value ? [] : candidates.value.flatMap((candidate, index) => {
  const position = positionFromCoordinate(candidate.move, tree.value.boardSize)
  return position ? [{ ...position, rank: index + 1, percentage: Math.round((perspective.value === 'black' ? candidate.winrate : 1 - candidate.winrate) * 100) }] : []
}))
const territory = computed(() => territoryVisible.value && analysis.value && !preview.value ? ownershipTerritory(current.value.snapshot.board, analysis.value.ownership, analysis.value.ownershipStdev) : [])
const previewStep = computed({ get: () => preview.value?.step ?? 0, set: (step: number) => { if (preview.value) preview.value = { ...preview.value, step } } })
const ruleLabel = computed(() => tree.value.ruleSet === 'chinese' ? '中国规则' : tree.value.ruleSet === 'aga' ? 'AGA 规则' : '日韩规则')

async function askConfirmation(title: string, text: string, label: string, run: () => void) {
  restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  confirmAction.value = { title, message: text, label, run }
  await nextTick()
  confirmDialog.value?.querySelector<HTMLElement>('button')?.focus()
}
function closeConfirmation() {
  confirmAction.value = null
  restoreFocus?.focus()
}
function acceptConfirmation() {
  const run = confirmAction.value?.run
  closeConfirmation()
  run?.()
}
function replaceGuard(run: () => void) {
  if (saving.value) return
  if (tree.value.dirty) void askConfirmation('替换当前研究？', '当前研究尚未保存，继续将替换当前棋谱。', '继续', run)
  else run()
}
function newDocument() {
  replaceGuard(() => { ai.stop(); research.reset(); currentRecordId.value = null; documentMessage.value = ''; void router.replace({ name: 'research' }) })
}
function editPoint(row: number, col: number) {
  if (preview.value) return
  if (mode.value === 'mark') { research.markPoint(row, col); return }
  if (mode.value === 'setup') {
    if (current.value.snapshot.board[row]?.[col] === setupStone.value) return
    const run = () => research.editSetup(row, col)
    if (current.value.children.length) void askConfirmation('修改当前局面？', '摆子会移除当前节点之后的变化，可通过撤销恢复。', '修改局面', run)
    else run()
    return
  }
  research.play(row, col)
}
function changePlayer(stone: Stone) {
  if (stone === current.value.snapshot.currentPlayer) return
  const run = () => research.setPlayer(stone)
  if (current.value.children.length) void askConfirmation('切换执子方？', '切换执子方会移除当前节点之后的变化，可通过撤销恢复。', '切换', run)
  else run()
}
function deleteBranch() {
  if (!current.value.parentId) return
  void askConfirmation('删除当前变化？', '当前节点及其后续变化将被删除，可通过撤销恢复。', '删除变化', research.deleteVariation)
}
async function openFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const contents = await decodeSgfFile(file)
    const next = importResearchSgf(contents)
    replaceGuard(() => {
      ai.stop(); research.openTree(next); currentRecordId.value = null; documentMessage.value = ''
      void router.replace({ name: 'research' })
    })
  } catch (cause) { documentMessage.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (fileInput.value) fileInput.value.value = '' }
}
async function refreshLibrary() {
  libraryLoading.value = true
  try { libraryRecords.value = (await listLibrary()).records }
  catch (cause) { documentMessage.value = cause instanceof Error ? cause.message : String(cause) }
  finally { libraryLoading.value = false }
}
function openRecord(record: LibraryRecord) {
  try {
    const next = importResearchSgf(record.sgf)
    let id = next.rootId
    for (const index of record.lastNodePath) { const child = next.nodes[id].children[index]; if (!child) break; id = child }
    next.currentNodeId = id
    replaceGuard(() => {
      ai.stop(); research.openTree(next); currentRecordId.value = record.id; documentMessage.value = ''
      void router.replace({ name: 'research', query: { record: record.id } })
    })
  } catch (cause) { documentMessage.value = cause instanceof Error ? cause.message : String(cause) }
}
async function saveDocument() {
  if (saving.value) return
  saving.value = true
  const snapshot = tree.value
  try {
    // The library boundary stores SGF komi in points; the research model uses the displayed Chinese zi value.
    const compatibleTree = {
      ...snapshot, komi: snapshot.ruleSet === 'chinese' ? snapshot.komi * 2 : snapshot.komi,
      nodes: Object.fromEntries(Object.values(snapshot.nodes).map((node) => [node.id, { ...node, sgfProperties: { ...node.properties, ...(node.setup ? { PL: [node.snapshot.currentPlayer === 'black' ? 'B' : 'W'] } : {}) } }])),
    }
    const record = await saveResearchRecord(currentRecordId.value, compatibleTree, { title: snapshot.title, black: snapshot.blackName, white: snapshot.whiteName })
    if (tree.value.rootId !== snapshot.rootId) return
    currentRecordId.value = record.id
    research.markSaved(snapshot)
    documentMessage.value = '已保存到棋谱库'
    await refreshLibrary()
  } catch (cause) { documentMessage.value = cause instanceof Error ? cause.message : String(cause) }
  finally { saving.value = false }
}
async function exportDocument() {
  try {
    const record = { title: tree.value.title, sgf: research.exportSgf() } as LibraryRecord
    const saved = await downloadRecords([record])
    if (saved) documentMessage.value = 'SGF 已导出'
  } catch (cause) { documentMessage.value = cause instanceof Error ? cause.message : String(cause) }
}
function handleKey(event: KeyboardEvent) {
  if (confirmAction.value) {
    if (event.key === 'Escape') { event.preventDefault(); closeConfirmation() }
    if (event.key === 'Tab' && confirmDialog.value) {
      const buttons = [...confirmDialog.value.querySelectorAll<HTMLElement>('button')]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    return
  }
  if (event.defaultPrevented) return
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveDocument() }
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); preview.value = null; event.shiftKey ? research.redo() : research.undo() }
    return
  }
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === 'Escape') { preview.value = null; return }
  if (preview.value) return
  if (event.key === 'ArrowLeft') { event.preventDefault(); research.goBack() }
  if (event.key === 'ArrowRight') { event.preventDefault(); research.goForward() }
  if (event.key === 'Home') { event.preventDefault(); research.goFirst() }
  if (event.key === 'End') { event.preventDefault(); research.goLast() }
}
function refreshTheme() { boardStyle.value = loadBoardStyle() }
watch(libraryVisible, (visible) => { if (visible) void refreshLibrary() })
watch(() => preview.value?.move, async (move) => {
  if (!move || window.innerWidth > 980) return
  await nextTick()
  boardStage.value?.scrollIntoView({ block: 'start' })
})
watch(() => route.query.record, async (id) => {
  if (typeof id !== 'string' || id === currentRecordId.value) return
  await refreshLibrary()
  const record = libraryRecords.value.find((item) => item.id === id && !item.deletedAt)
  if (record) openRecord(record)
  else documentMessage.value = '找不到这份棋谱'
}, { immediate: true })
onMounted(() => { window.addEventListener('keydown', handleKey); window.addEventListener('focus', refreshTheme) })
onBeforeUnmount(() => { window.removeEventListener('keydown', handleKey); window.removeEventListener('focus', refreshTheme) })
</script>

<template>
  <main class="research-workbench">
    <header class="workspace-toolbar document-toolbar">
      <button v-if="currentRecordId" class="workspace-icon" type="button" title="返回棋谱库" aria-label="返回棋谱库" :disabled="saving" @click="router.push({ name: 'library' })"><ArrowLeft :size="17" /></button>
      <button class="workspace-icon" type="button" title="棋谱库" aria-label="棋谱库" :aria-expanded="libraryVisible" :class="{ selected: libraryVisible }" @click="libraryVisible = !libraryVisible"><Library :size="17" /></button>
      <div class="document-name"><input aria-label="棋谱名称" :value="tree.title" maxlength="120" @change="research.setTitle(($event.target as HTMLInputElement).value)" /><span class="document-save-state" :class="{ 'is-dirty': tree.dirty }" role="status">{{ saving ? '保存中' : tree.dirty ? '未保存' : currentRecordId ? '已保存' : '本地草稿' }}</span></div>
      <div class="document-rules" role="group" aria-label="棋盘规则"><span>{{ tree.boardSize }} 路</span><span>{{ ruleLabel }}</span><span>贴 {{ formatKomi(tree.komi) }} {{ tree.ruleSet === 'chinese' ? '子' : '目' }}</span></div>
      <div class="document-actions">
        <button class="workspace-icon" type="button" title="新建研究" aria-label="新建研究" :disabled="saving" @click="newDocument"><FilePlus2 :size="16" /></button>
        <button class="workspace-icon" type="button" title="打开 SGF" aria-label="打开 SGF" :disabled="saving" @click="fileInput?.click()"><FolderOpen :size="16" /></button>
        <button class="workspace-icon" type="button" title="导出 SGF" aria-label="导出 SGF" @click="exportDocument"><Download :size="16" /></button>
        <button class="workspace-button primary" type="button" :disabled="saving" @click="saveDocument"><Save :size="15" /><span>{{ saving ? '保存中' : '保存' }}</span></button>
      </div>
      <input ref="fileInput" class="file-input" type="file" accept=".sgf,application/x-go-sgf" aria-label="选择 SGF 文件" @change="openFile" />
    </header>
    <div v-if="documentMessage || message" class="document-feedback" role="status"><span>{{ message || documentMessage }}</span><button class="workspace-icon" type="button" aria-label="关闭提示" title="关闭提示" @click="documentMessage = ''; message = ''"><X :size="14" /></button></div>
    <div class="research-layout" :class="{ 'library-open': libraryVisible }">
      <aside v-if="libraryVisible" class="research-library" aria-label="本地棋谱">
        <div class="library-heading"><h2>棋谱库</h2><button class="workspace-icon" type="button" aria-label="收起棋谱库" title="收起棋谱库" @click="libraryVisible = false"><X :size="15" /></button></div>
        <input v-model="libraryQuery" type="search" aria-label="搜索棋谱" placeholder="搜索棋谱" />
        <div class="library-records"><button v-for="record in filteredRecords" :key="record.id" type="button" :class="{ selected: record.id === currentRecordId }" @click="openRecord(record)"><strong>{{ record.title }}</strong><span>{{ record.black || '黑方' }} · {{ record.white || '白方' }}</span><small>{{ record.moves }} 手 · {{ record.date || '未设置日期' }}</small></button><div v-if="!filteredRecords.length" class="library-empty">{{ libraryLoading ? '正在读取棋谱…' : libraryQuery ? '没有匹配的棋谱' : '暂无棋谱' }}</div></div>
      </aside>
      <section class="research-board-area" aria-label="研究棋盘">
        <ResearchModeToolbar :mode="mode" :setup-stone="setupStone" :mark-type="markType" :current-player="current.snapshot.currentPlayer" :locked="Boolean(preview)" @update:mode="research.setMode" @update:setup-stone="research.setSetupStone" @update:mark-type="research.setMarkType" @update:current-player="changePlayer" @clear-marks="research.clearMarks">
        </ResearchModeToolbar>
        <div ref="boardStage" class="board-stage research-board-stage" :class="{ 'is-previewing': preview }">
          <div v-if="preview" class="preview-caption" role="status"><GitBranch :size="14" />AI 预览 · {{ preview.move === 'pass' ? '停一手' : preview.move }} · {{ preview.step }} 手</div>
          <GoBoard :board="displayNode.snapshot.board" :current-player="displayNode.snapshot.currentPlayer" :last-move="lastMove" :candidates="candidateMarkers" :territory="territory" territory-mode="ai" :show-star-points="true" :show-coordinates="true" :dead-stones="[]" :move-numbers="moveNumbers" :show-move-numbers="moveNumbersVisible || Boolean(preview)" :board-style="boardStyle" :disabled="Boolean(preview) || Boolean(confirmAction)" :busy="false" :marks="preview ? [] : current.marks" @place="editPoint" />
        </div>
        <div v-if="preview" class="preview-controls">
          <button class="workspace-icon" type="button" title="退出 AI 预览" aria-label="退出 AI 预览" @click="preview = null"><X :size="16" /></button>
          <span>AI 预览</span><input v-model.number="previewStep" type="range" min="1" :max="preview.coordinates.length" aria-label="预览变化手数" /><span>{{ preview.step }} / {{ preview.coordinates.length }}</span>
          <button class="workspace-button primary" type="button" @click="ai.commitPreview"><GitBranch :size="15" />加入变化</button>
        </div>
        <footer class="research-navigation">
          <div class="navigation-top">
            <div class="history-tools" role="group" aria-label="编辑历史"><button class="workspace-icon" type="button" title="撤销编辑" aria-label="撤销编辑" :disabled="!canUndo || Boolean(preview)" @click="research.undo"><Undo2 :size="16" /></button><button class="workspace-icon" type="button" title="重做编辑" aria-label="重做编辑" :disabled="!canRedo || Boolean(preview)" @click="research.redo"><Redo2 :size="16" /></button></div>
            <div class="move-navigation" role="group" aria-label="棋谱导航">
              <button class="workspace-icon" type="button" title="初始局面" aria-label="初始局面" :disabled="!canGoBack || Boolean(preview)" @click="research.goFirst"><ChevronsLeft :size="18" /></button>
              <button class="workspace-icon" type="button" title="上一手" aria-label="上一手" :disabled="!canGoBack || Boolean(preview)" @click="research.goBack"><ChevronLeft :size="18" /></button>
              <label class="move-position"><input type="number" :value="lineIndex" min="0" :max="line.length - 1" :disabled="Boolean(preview)" aria-label="跳转节点" @change="research.goToIndex(Number(($event.target as HTMLInputElement).value))" /><span>/ {{ line.length - 1 }}</span></label>
              <button class="workspace-icon" type="button" title="下一手" aria-label="下一手" :disabled="!canGoForward || Boolean(preview)" @click="research.goForward"><ChevronRight :size="18" /></button>
              <button class="workspace-icon" type="button" title="变化末尾" aria-label="变化末尾" :disabled="!canGoForward || Boolean(preview)" @click="research.goLast"><ChevronsRight :size="18" /></button>
            </div>
            <button class="pass-button" type="button" :disabled="Boolean(preview) || mode !== 'play'" @click="research.pass"><Pause :size="14" />停一手</button>
          </div>
          <!-- Update max before value so appended moves are not clamped to the old endpoint. -->
          <input class="move-timeline" type="range" min="0" :max="Math.max(1, line.length - 1)" :value="lineIndex" :disabled="line.length === 1 || Boolean(preview)" aria-label="棋谱进度" @input="research.goToIndex(Number(($event.target as HTMLInputElement).value))" />
          <div class="board-status"><span>{{ onMainLine ? '主线' : '变化' }} · 第 {{ current.snapshot.moveNumber }} 手{{ current.move ? ` · ${current.move.pass ? '停一手' : current.move.coordinate}` : '' }}</span><span>提子 黑 {{ current.snapshot.capturedByBlack }} / 白 {{ current.snapshot.capturedByWhite }}</span></div>
        </footer>
      </section>
      <SidebarShell v-model="inspectorTab" label="研究信息" title="研究内容" id-prefix="research-sidebar" :tabs="inspectorTabs">
        <div class="research-inspector-content">
          <div v-show="inspectorTab === 'analysis'" class="inspector-analysis"><ResearchEvaluation v-model:perspective="perspective" v-model:move-numbers-enabled="moveNumbersVisible" v-model:candidates-visible="candidatesVisible" v-model:territory-visible="territoryVisible" :analysis="analysis" :history="history" :status="status" :error="error" :preview-move="preview?.move" @request="ai.request" @stop="live = false; ai.stop()" /></div>
          <section v-show="inspectorTab === 'tree'" class="inspector-tree" aria-label="棋谱变化">
            <div class="section-heading"><h2><GitBranch :size="15" />变化树</h2><span>{{ Object.keys(tree.nodes).length }} 节点</span><div class="section-actions"><button class="workspace-icon" type="button" title="设为主线" aria-label="设为主线" :disabled="onMainLine || Boolean(preview)" @click="research.promoteVariation"><ArrowUpToLine :size="15" /></button><button class="workspace-icon" type="button" title="删除当前变化" aria-label="删除当前变化" :disabled="!current.parentId || Boolean(preview)" @click="deleteBranch"><Trash2 :size="15" /></button></div></div>
            <VariationTree :graph="graph" @select="preview = null; research.selectNode($event)" />
            <section class="inspector-notes" aria-label="节点备注"><div class="section-heading"><h2><MessageSquare :size="15" />节点备注</h2><span>第 {{ current.snapshot.moveNumber }} 手</span></div><textarea :value="current.comment" rows="3" aria-label="当前节点备注" placeholder="暂无备注" @input="research.setComment(($event.target as HTMLTextAreaElement).value)" /></section>
          </section>
        </div>
      </SidebarShell>
    </div>
    <div v-if="confirmAction" class="research-dialog-backdrop" @click.self="closeConfirmation"><section ref="confirmDialog" class="research-dialog" role="dialog" aria-modal="true" aria-labelledby="research-confirm-title" aria-describedby="research-confirm-message"><h2 id="research-confirm-title">{{ confirmAction.title }}</h2><p id="research-confirm-message">{{ confirmAction.message }}</p><div><button class="dialog-button" type="button" @click="closeConfirmation">取消</button><button class="workspace-button primary" type="button" @click="acceptConfirmation">{{ confirmAction.label }}</button></div></section></div>
  </main>
</template>

<style scoped>
.research-workbench :deep(.sidebar-tabs) { height: 38px; min-height: 38px; margin-block: 8px 9px; }
.research-workbench { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; color: var(--text); overflow: hidden; background: var(--shell); background-image: linear-gradient(rgba(243,242,241,.22), rgba(243,242,241,.22)), url('/home-background.png'); background-position: center; background-size: cover; }
.document-name { display: flex; height: 32px; align-items: center; gap: 10px; min-width: 0; }.document-name input { width: 150px; min-width: 72px; height: 32px; padding: 3px 6px; border: 1px solid transparent; border-radius: 4px; color: var(--text); background: transparent; font-size: 14px; font-weight: 600; line-height: 20px; }.document-name input:hover { border-color: var(--border); background: rgba(255,255,255,.45); }.document-name input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }.document-save-state { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; line-height: 20px; white-space: nowrap; }.document-save-state::before { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); content: ''; }.document-save-state.is-dirty::before { background: var(--accent-strong); }.document-rules { display: flex; height: 32px; align-items: center; color: var(--muted); font-size: 12px; line-height: 20px; white-space: nowrap; }.document-rules > span + span { margin-left: 10px; padding-left: 10px; border-left: 1px solid var(--border); }.document-rules > span:first-child { color: var(--text); font-weight: 500; }.document-actions { display: flex; gap: 3px; align-items: center; margin-left: auto; } .file-input { display: none; }
.document-feedback { display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 18px; color: var(--accent-strong); background: var(--accent-soft); font-size: 12px; }.document-feedback > span { overflow-wrap: anywhere; }
.research-layout { display: grid; grid-template-columns: minmax(0,1fr) 360px; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }.research-layout.library-open { grid-template-columns: 210px minmax(0,1fr) 360px; }
.research-board-area { display: grid; grid-template-rows: auto minmax(0,1fr) auto auto; min-width: 0; min-height: 0; }
.research-board-stage { min-height: 0; padding: 18px 24px; overflow: hidden; container-type: size; background: rgba(243,242,241,.2); backdrop-filter: blur(2px); }.research-board-stage :deep(.board-host) { width: min(100cqw,100cqh) !important; height: min(100cqw,100cqh) !important; min-width: 0; max-width: 100%; max-height: 100%; box-shadow: var(--shadow-md); }
.research-board-stage.is-previewing { padding-top: 38px; }
.preview-caption { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--accent-16); border-radius: 4px; color: var(--accent-strong); background: var(--surface); font-size: 11px; white-space: nowrap; z-index: 1; }
.preview-controls { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 18px; border-top: 1px solid var(--border); background: var(--accent-soft); font-size: 11px; }.preview-controls input { flex: 1; min-width: 40px; accent-color: var(--accent); }.preview-controls > span { white-space: nowrap; }
.research-navigation { padding: 10px 24px 12px; border-top: 1px solid var(--border); background: rgba(243,242,241,.2); backdrop-filter: blur(2px); }.navigation-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.history-tools, .move-navigation { display: flex; align-items: center; gap: 3px; }.move-position { display: flex; align-items: center; gap: 4px; min-width: 88px; justify-content: center; font-size: 11px; color: var(--muted); }.move-position input { width: 48px; height: 28px; padding: 2px 4px; font-size: 12px; text-align: center; }.pass-button { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: rgba(255,255,255,.72); font-size: 11px; }.pass-button:disabled { opacity: .4; }.move-timeline { display: block; width: 100%; height: 18px; margin: 6px 0; accent-color: var(--accent); }.board-status { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 10px; }
.research-inspector-content { display: flex; min-height: 100%; flex-direction: column; }.inspector-tree { display: flex; min-height: 190px; flex: 1; flex-direction: column; padding: 8px 0 12px; }.section-heading { display: flex; align-items: center; gap: 8px; min-height: 32px; margin-bottom: 8px; }.section-heading h2 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; font-weight: 600; }.section-heading h2 svg { color: var(--muted); }.section-heading > span { color: var(--muted); font-size: 10px; margin-left: auto; }.section-actions { display: flex; gap: 2px; }.section-actions .workspace-icon { width: 28px; height: 28px; flex-basis: 28px; }.inspector-tree :deep(.variation-viewport) { flex: 1; max-height: 250px; }.inspector-notes { margin-top: 12px; padding: 12px 0 4px; border-top: 1px solid var(--border); }.inspector-notes .section-heading { margin-bottom: 4px; }.inspector-notes textarea { display: block; width: 100%; min-height: 76px; max-height: 220px; resize: vertical; padding: 8px 10px; font: inherit; font-size: 12px; line-height: 1.5; }
.research-library { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px; border-right: 1px solid var(--border); background: transparent; }.library-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }.library-heading h2 { margin: 0; font-size: 13px; }.research-library > input { width: 100%; min-height: 32px; padding: 0 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 5px; }.library-records { flex: 1; min-height: 0; overflow: auto; margin-top: 10px; }.library-records button { display: grid; width: 100%; gap: 6px; padding: 12px 8px; border: 0; border-bottom: 1px solid var(--border); color: var(--text); background: transparent; text-align: left; overflow-wrap: anywhere; }.library-records button:hover, .library-records button.selected { background: var(--accent-soft); }.library-records strong { font-size: 12px; font-weight: 600; }.library-records span, .library-records small { color: var(--muted); font-size: 10px; }.library-empty { padding: 24px 8px; text-align: center; font-size: 12px; color: var(--muted); }
.research-dialog-backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px; background: rgba(50,49,48,.3); }.research-dialog { width: min(380px,100%); padding: 22px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-md); }.research-dialog h2 { margin: 0 0 12px; font-size: 16px; }.research-dialog p { color: var(--muted); font-size: 13px; line-height: 1.6; }.research-dialog > div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }.dialog-button { min-height: 32px; padding: 0 14px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--surface); font-size: 12px; }
@media (min-width: 981px) and (max-width: 1240px) { .research-layout.library-open { grid-template-columns: minmax(0,1fr) 340px; position: relative; }.library-open .research-library { position: absolute; left: 0; top: 0; bottom: 0; width: 220px; z-index: 3; box-shadow: var(--shadow-md); }.research-layout { grid-template-columns: minmax(0,1fr) 340px; }.document-rules { display: none; } }
@media (max-width: 980px) { .research-layout, .research-layout.library-open { display: block; overflow-y: auto; position: relative; }.research-board-area { height: 720px; min-height: 0; }.inspector-tree { min-height: 220px; }.research-library { position: absolute; top: 0; left: 0; bottom: 0; width: 240px; z-index: 3; box-shadow: var(--shadow-md); }.document-rules { display: none; } }
@media (max-width: 600px) { .document-toolbar { padding: 8px 10px; gap: 4px; }.document-name { flex: 1; gap: 6px; }.document-name input { width: 132px; }.document-save-state { font-size: 11px; }.document-actions { gap: 0; }.document-actions .workspace-icon { width: 28px; flex-basis: 28px; }.document-actions .workspace-button { padding: 0 8px; }.document-actions .workspace-button span { display: none; }.research-board-area { height: auto; grid-template-rows: auto auto auto auto; }.research-board-stage { height: auto; min-height: 0; aspect-ratio: 1; padding: 14px 12px; }.research-navigation { padding: 8px 12px 12px; }.navigation-top { flex-wrap: wrap; gap: 6px; }.history-tools { order: 2; }.move-navigation { order: 1; flex: 1 0 100%; justify-content: center; }.pass-button { order: 3; margin-left: auto; }.preview-controls { flex-wrap: wrap; padding: 6px 12px; }.preview-controls > span:first-of-type { display: none; }.document-feedback { padding-inline: 12px; }.inspector-notes textarea { font-size: 16px; } }
.research-library, .research-workbench :deep(.game-sidebar) { background: rgba(243,242,241,.2); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.research-library > input[type='search'] {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: rgba(255, 255, 255, .72);
  transition: border-color 140ms ease, outline-color 140ms ease, background-color 140ms ease;
}
.research-library > input[type='search']:hover:not(:focus-visible) { border-color: #a19f9d; }
.research-library > input[type='search']:focus-visible { border: 2px solid var(--accent); outline: none; background: var(--surface); }
.research-library > input[type='search']::placeholder { color: var(--text-subtle); opacity: 1; }
.library-records { display: grid; align-content: start; gap: 8px; }
.library-records button {
  gap: 5px;
  padding: 10px;
  border: 1px solid rgba(225, 225, 225, .9);
  border-radius: 6px;
  background: rgba(255, 255, 255, .66);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .04);
  backdrop-filter: blur(4px);
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}
.library-records button:not(.selected):hover { border-color: var(--accent-16); background: rgba(255, 255, 255, .86); box-shadow: var(--shadow-xs); }
.library-records button.selected { border-color: rgba(var(--accent-rgb), .32); background: rgba(222, 236, 249, .92); box-shadow: var(--shadow-xs); }
.library-records button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.library-records strong { font-size: 13px; }
.library-records span, .library-records small { font-size: 11px; line-height: 1.4; }
</style>
