<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowLeft,
  ArrowUpToLine,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  Download,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Library,
  MessageSquare,
  Pause,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-vue-next";
import GoBoard from "../components/board/GoBoard.vue";
import SidebarShell, {
  type SidebarTab,
} from "../components/game/SidebarShell.vue";
import ResearchModeToolbar from "../components/research/ResearchModeToolbar.vue";
import VariationTree from "../components/research/VariationTree.vue";
import ResearchEvaluation from "../components/research/ResearchEvaluation.vue";
import GameSettingsDialog from "../components/game/GameSettingsDialog.vue";
import { useResearchAnalysis } from "../composables/useResearchAnalysis";
import { useResearchStore } from "../stores/research";
import { loadBoardStyle, saveBoardStyle } from "../domain/boardTheme";
import { loadResearchDisplaySettings, saveResearchDisplaySettings } from "../domain/viewSettings";
import { formatKomi } from "../domain/gameSetup";
import { positionFromCoordinate } from "../domain/go";
import { researchPath } from "../domain/researchTree";
import { importResearchSgf } from "../domain/researchSgf";
import { decodeSgfFile } from "../domain/sgf";
import { gnuGoTerritory } from "../domain/gnugoEstimate";
import {
  downloadRecords,
  listLibrary,
  saveResearchRecord,
} from "../services/library";
import type { LibraryRecord } from "../types/library";
import type { CandidateMarker, MoveNumberMarker, Stone } from "../types/game";

const research = useResearchStore();
const {
  tree,
  current,
  mode,
  setupStone,
  markType,
  message,
  line,
  lineIndex,
  graph,
  canGoBack,
  canGoForward,
  canUndo,
  canRedo,
  onMainLine,
} = storeToRefs(research);
const ai = useResearchAnalysis(research);
const {
  analysis,
  candidates,
  history,
  status,
  error,
  preview,
  previewTree,
  displayNode,
  candidatesVisible,
  territoryVisible,
  territoryEstimate,
  territoryStatus,
  territoryError,
} = ai;
const route = useRoute();
const router = useRouter();
const boardStyle = ref(loadBoardStyle());
const savedDisplaySettings = loadResearchDisplaySettings();
const settingsOpen = ref(false);
const coordinatesVisible = ref(savedDisplaySettings.coordinates);
const perspective = ref<"black" | "white">("black");
const moveNumbersVisible = ref(savedDisplaySettings.moveNumbers);
candidatesVisible.value = savedDisplaySettings.candidates;
territoryVisible.value = savedDisplaySettings.territory;
const libraryVisible = ref(false);
const inspectorTab = ref("analysis");
const inspectorTabs: SidebarTab[] = [
  { id: "analysis", label: "分析" },
  { id: "tree", label: "变化树" },
];
const libraryRecords = ref<LibraryRecord[]>([]);
const libraryQuery = ref("");
const libraryLoading = ref(false);
const currentRecordId = computed({
  get: () => research.recordId,
  set: (id: string | null) => {
    research.recordId = id;
  },
});
const fileInput = ref<HTMLInputElement | null>(null);
const saving = ref(false);
const feedback = ref<{
  id: number;
  text: string;
  type: "success" | "error";
} | null>(null);
const confirmAction = ref<{
  title: string;
  message: string;
  label: string;
  run: () => void;
} | null>(null);
const confirmDialog = ref<HTMLElement | null>(null);
const boardStage = ref<HTMLElement | null>(null);
const notesHeight = ref(100);
let notesResizeStart: { pointerY: number; height: number } | null = null;
let restoreFocus: HTMLElement | null = null;
let feedbackTimer: number | undefined;
let feedbackId = 0;

function dismissFeedback() {
  if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
  feedbackTimer = undefined;
  feedback.value = null;
}
function closeFeedback() {
  message.value = "";
  dismissFeedback();
}
function showFeedback(text: string, type: "success" | "error" = "error") {
  dismissFeedback();
  feedback.value = { id: ++feedbackId, text, type };
  if (type === "success")
    feedbackTimer = window.setTimeout(dismissFeedback, 3200);
}
function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function startNotesResize(event: PointerEvent) {
  if (event.button !== 0) return;
  notesResizeStart = { pointerY: event.clientY, height: notesHeight.value };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}
function moveNotesResize(event: PointerEvent) {
  if (!notesResizeStart) return;
  notesHeight.value = Math.max(
    76,
    Math.min(
      220,
      notesResizeStart.height + notesResizeStart.pointerY - event.clientY,
    ),
  );
}
function stopNotesResize() {
  notesResizeStart = null;
}
function keyNotesResize(event: KeyboardEvent) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  notesHeight.value = Math.max(
    76,
    Math.min(220, notesHeight.value + (event.key === "ArrowUp" ? 12 : -12)),
  );
}

const filteredRecords = computed(() => {
  const query = libraryQuery.value.trim().toLowerCase();
  return libraryRecords.value.filter(
    (record) =>
      !record.deletedAt &&
      (!query ||
        [record.title, record.black, record.white]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );
});
const displayPath = computed(() =>
  researchPath(previewTree.value ?? tree.value),
);
const moveNumbers = computed<MoveNumberMarker[]>(() =>
  displayPath.value.flatMap((node) =>
    node.move && !node.move.pass
      ? [
          {
            row: node.move.row!,
            col: node.move.col!,
            moveNumber: node.snapshot.moveNumber,
            stone: node.move.stone,
          },
        ]
      : [],
  ),
);
const lastMove = computed(() =>
  displayNode.value.snapshot.lastMove && displayNode.value.move
    ? {
        ...displayNode.value.snapshot.lastMove,
        stone: displayNode.value.move.stone,
      }
    : null,
);
const candidateMarkers = computed<CandidateMarker[]>(() =>
  !candidatesVisible.value || preview.value
    ? []
    : candidates.value.flatMap((candidate, index) => {
        const position = positionFromCoordinate(
          candidate.move,
          tree.value.boardSize,
        );
        return position
          ? [
              {
                ...position,
                rank: index + 1,
                percentage: Math.round(
                  (current.value.snapshot.currentPlayer === "black"
                    ? candidate.winrate
                    : 1 - candidate.winrate) * 100,
                ),
              },
            ]
          : [];
      }),
);
const territory = computed(() =>
  territoryVisible.value && territoryEstimate.value && !preview.value
    ? gnuGoTerritory(
        current.value.snapshot.board,
        territoryEstimate.value.influenceRegions,
      )
    : [],
);
const deadStones = computed(() =>
  territoryVisible.value && !preview.value ? ai.territoryDeadStones() : [],
);

function requestResearchAnalysis(kind: "candidates" | "territory") {
  if (kind === "territory") void ai.requestTerritory();
  else void ai.request();
}
function stopResearchAnalysis(kind: "candidates" | "territory") {
  if (kind === "territory") ai.stopTerritory();
  else ai.stop();
}
const previewStep = computed({
  get: () => preview.value?.step ?? 0,
  set: (step: number) => {
    if (preview.value) preview.value = { ...preview.value, step };
  },
});
const ruleLabel = computed(() =>
  tree.value.ruleSet === "chinese"
    ? "中国规则"
    : tree.value.ruleSet === "aga"
      ? "AGA 规则"
      : "日韩规则",
);

async function askConfirmation(
  title: string,
  text: string,
  label: string,
  run: () => void,
) {
  restoreFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  confirmAction.value = { title, message: text, label, run };
  await nextTick();
  confirmDialog.value?.querySelector<HTMLElement>("button")?.focus();
}
function closeConfirmation() {
  confirmAction.value = null;
  restoreFocus?.focus();
}
function acceptConfirmation() {
  const run = confirmAction.value?.run;
  closeConfirmation();
  run?.();
}
function replaceGuard(run: () => void) {
  if (saving.value) return;
  if (tree.value.dirty)
    void askConfirmation(
      "替换当前研究？",
      "当前研究尚未保存，继续将替换当前棋谱。",
      "继续",
      run,
    );
  else run();
}
function newDocument() {
  replaceGuard(() => {
    ai.stop();
    research.reset();
    currentRecordId.value = null;
    dismissFeedback();
    void router.replace({ name: "research" });
  });
}
function editPoint(row: number, col: number) {
  if (preview.value) return;
  if (mode.value === "mark") {
    research.markPoint(row, col);
    return;
  }
  if (mode.value === "setup") {
    if (current.value.snapshot.board[row]?.[col] === setupStone.value) return;
    const run = () => research.editSetup(row, col);
    if (current.value.children.length)
      void askConfirmation(
        "修改当前局面？",
        "摆子会移除当前节点之后的变化，可通过撤销恢复。",
        "修改局面",
        run,
      );
    else run();
    return;
  }
  if (research.play(row, col)) {
    candidatesVisible.value = false;
    territoryVisible.value = false;
  }
}
function changePlayer(stone: Stone) {
  if (stone === current.value.snapshot.currentPlayer) return;
  const run = () => research.setPlayer(stone);
  if (current.value.children.length)
    void askConfirmation(
      "切换执子方？",
      "切换执子方会移除当前节点之后的变化，可通过撤销恢复。",
      "切换",
      run,
    );
  else run();
}
function deleteBranch() {
  if (!current.value.parentId) return;
  void askConfirmation(
    "删除当前变化？",
    "当前节点及其后续变化将被删除，可通过撤销恢复。",
    "删除变化",
    research.deleteVariation,
  );
}
async function openFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const contents = await decodeSgfFile(file);
    const next = importResearchSgf(contents);
    replaceGuard(() => {
      ai.stop();
      research.openTree(next);
      currentRecordId.value = null;
      dismissFeedback();
      void router.replace({ name: "research" });
    });
  } catch (cause) {
    showFeedback(errorText(cause));
  } finally {
    if (fileInput.value) fileInput.value.value = "";
  }
}
async function refreshLibrary() {
  libraryLoading.value = true;
  try {
    libraryRecords.value = (await listLibrary()).records;
  } catch (cause) {
    showFeedback(errorText(cause));
  } finally {
    libraryLoading.value = false;
  }
}
function openRecord(record: LibraryRecord) {
  try {
    const next = importResearchSgf(record.sgf);
    let id = next.rootId;
    for (const index of record.lastNodePath) {
      const child = next.nodes[id].children[index];
      if (!child) break;
      id = child;
    }
    next.currentNodeId = id;
    replaceGuard(() => {
      ai.stop();
      research.openTree(next);
      currentRecordId.value = record.id;
      dismissFeedback();
      void router.replace({ name: "research", query: { record: record.id } });
    });
  } catch (cause) {
    showFeedback(errorText(cause));
  }
}
async function saveDocument() {
  if (saving.value) return;
  saving.value = true;
  const snapshot = tree.value;
  try {
    // The library boundary stores SGF komi in points; the research model uses the displayed Chinese zi value.
    const compatibleTree = {
      ...snapshot,
      komi: snapshot.ruleSet === "chinese" ? snapshot.komi * 2 : snapshot.komi,
      nodes: Object.fromEntries(
        Object.values(snapshot.nodes).map((node) => [
          node.id,
          {
            ...node,
            sgfProperties: {
              ...node.properties,
              ...(node.setup
                ? { PL: [node.snapshot.currentPlayer === "black" ? "B" : "W"] }
                : {}),
            },
          },
        ]),
      ),
    };
    const record = await saveResearchRecord(
      currentRecordId.value,
      compatibleTree,
      {
        title: snapshot.title,
        black: snapshot.blackName,
        white: snapshot.whiteName,
      },
    );
    if (tree.value.rootId !== snapshot.rootId) return;
    currentRecordId.value = record.id;
    research.markSaved(snapshot);
    showFeedback("已保存到棋谱库", "success");
    const index = libraryRecords.value.findIndex(item => item.id === record.id);
    if (index >= 0) libraryRecords.value[index] = record;
    else libraryRecords.value = [record, ...libraryRecords.value];
  } catch (cause) {
    showFeedback(errorText(cause));
  } finally {
    saving.value = false;
  }
}
function returnToLibrary() {
  if (!saving.value) void router.push({ name: "library" });
}
function chooseSgfFile() {
  if (!saving.value) fileInput.value?.click();
}
async function exportDocument() {
  try {
    const record = {
      title: tree.value.title,
      sgf: research.exportSgf(),
    } as LibraryRecord;
    const saved = await downloadRecords([record]);
    if (saved) showFeedback("SGF 已导出", "success");
  } catch (cause) {
    showFeedback(errorText(cause));
  }
}
function handleKey(event: KeyboardEvent) {
  if (confirmAction.value) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
    }
    if (event.key === "Tab" && confirmDialog.value) {
      const buttons = [
        ...confirmDialog.value.querySelectorAll<HTMLElement>("button"),
      ];
      const first = buttons[0],
        last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if (event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveDocument();
    }
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      preview.value = null;
      event.shiftKey ? research.redo() : research.undo();
    }
    return;
  }
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable="true"]'))
    return;
  if (event.key === "Escape") {
    preview.value = null;
    return;
  }
  if (preview.value) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    research.goBack();
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    research.goForward();
  }
  if (event.key === "Home") {
    event.preventDefault();
    research.goFirst();
  }
  if (event.key === "End") {
    event.preventDefault();
    research.goLast();
  }
}
function refreshTheme() {
  boardStyle.value = loadBoardStyle();
}
watch(boardStyle, saveBoardStyle);
function openSettings() { settingsOpen.value = true; }
function persistDisplaySettings() {
  saveResearchDisplaySettings({
    coordinates: coordinatesVisible.value,
    moveNumbers: moveNumbersVisible.value,
    candidates: candidatesVisible.value,
    territory: territoryVisible.value,
  });
}
watch([coordinatesVisible, moveNumbersVisible, candidatesVisible, territoryVisible], persistDisplaySettings);
watch(libraryVisible, (visible) => {
  if (visible) void refreshLibrary();
});
watch(
  () => preview.value?.move,
  async (move) => {
    if (!move || window.innerWidth > 980) return;
    await nextTick();
    boardStage.value?.scrollIntoView({ block: "start" });
  },
);
watch(message, (text) => {
  if (text) showFeedback(text);
});
watch(
  () => route.query.record,
  async (id) => {
    if (typeof id !== "string" || id === currentRecordId.value) return;
    await refreshLibrary();
    const record = libraryRecords.value.find(
      (item) => item.id === id && !item.deletedAt,
    );
    if (record) openRecord(record);
    else showFeedback("找不到这份棋谱");
  },
  { immediate: true },
);
onMounted(() => {
  window.addEventListener("keydown", handleKey);
  window.addEventListener("focus", refreshTheme);
  window.addEventListener("open-workspace-settings", openSettings);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKey);
  window.removeEventListener("focus", refreshTheme);
  window.removeEventListener("open-workspace-settings", openSettings);
  if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
});
</script>

<template>
  <main class="research-workbench">
    <header class="workspace-toolbar document-toolbar">
      <span class="document-back-slot">
      <button
        v-if="currentRecordId"
        class="workspace-icon"
        type="button"
        title="返回棋谱库"
        aria-label="返回棋谱库"
        :aria-disabled="saving || undefined"
        @click="returnToLibrary"
      >
        <ArrowLeft :size="17" />
      </button>
      </span>
      <button
        class="workspace-icon"
        type="button"
        title="棋谱库"
        aria-label="棋谱库"
        :aria-expanded="libraryVisible"
        :class="{ selected: libraryVisible }"
        @click="libraryVisible = !libraryVisible"
      >
        <Library :size="17" />
      </button>
      <div class="document-name">
        <input
          aria-label="棋谱名称"
          :value="tree.title"
          maxlength="120"
          @change="research.setTitle(($event.target as HTMLInputElement).value)"
        /><span
          class="document-save-state"
          :class="{ 'is-dirty': tree.dirty }"
          role="status"
          >{{
            saving
              ? "保存中"
              : tree.dirty
                ? "未保存"
                : currentRecordId
                  ? "已保存"
                  : "本地草稿"
          }}</span
        >
      </div>
      <div class="document-rules" role="group" aria-label="棋盘规则">
        <span>{{ tree.boardSize }} 路</span><span>{{ ruleLabel }}</span
        ><span
          >贴 {{ formatKomi(tree.komi) }}
          {{ tree.ruleSet === "chinese" ? "子" : "目" }}</span
        >
      </div>
      <div class="document-actions">
        <button
          class="workspace-icon"
          type="button"
          title="新建研究"
          aria-label="新建研究"
          :aria-disabled="saving || undefined"
          @click="newDocument"
        >
          <FilePlus2 :size="16" />
        </button>
        <button
          class="workspace-icon"
          type="button"
          title="打开 SGF"
          aria-label="打开 SGF"
          :aria-disabled="saving || undefined"
          @click="chooseSgfFile"
        >
          <FolderOpen :size="16" />
        </button>
        <button
          class="workspace-icon"
          type="button"
          title="导出 SGF"
          aria-label="导出 SGF"
          @click="exportDocument"
        >
          <Download :size="16" />
        </button>
        <button
          class="workspace-button primary document-save-button"
          type="button"
          aria-label="保存"
          title="保存"
          :aria-disabled="saving || undefined"
          :aria-busy="saving || undefined"
          @click="saveDocument"
        >
          <Save :size="15" /><span>保存</span>
        </button>
      </div>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".sgf,application/x-go-sgf"
        aria-label="选择 SGF 文件"
        @change="openFile"
      />
    </header>
    <Teleport to="body">
      <Transition name="research-toast">
        <div v-if="feedback" :key="feedback.id" class="research-toast-layer">
          <div
            class="research-toast"
            :class="feedback.type"
            :role="feedback.type === 'error' ? 'alert' : 'status'"
            aria-atomic="true"
          >
            <CircleAlert
              v-if="feedback.type === 'error'"
              :size="17"
              aria-hidden="true"
            />
            <CheckCircle2 v-else :size="17" aria-hidden="true" />
            <span>{{ feedback.text }}</span>
            <button
              class="research-toast-close"
              type="button"
              aria-label="关闭提示"
              title="关闭提示"
              @click="closeFeedback"
            >
              <X :size="15" />
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
    <div class="research-layout" :class="{ 'library-open': libraryVisible }">
      <aside
        v-if="libraryVisible"
        class="research-library"
        aria-label="本地棋谱"
      >
        <div class="library-heading">
          <h2>棋谱库</h2>
          <button
            class="workspace-icon"
            type="button"
            aria-label="收起棋谱库"
            title="收起棋谱库"
            @click="libraryVisible = false"
          >
            <X :size="15" />
          </button>
        </div>
        <input
          v-model="libraryQuery"
          type="search"
          aria-label="搜索棋谱"
          placeholder="搜索棋谱"
        />
        <div class="library-records">
          <button
            v-for="record in filteredRecords"
            :key="record.id"
            type="button"
            :class="{ selected: record.id === currentRecordId }"
            @click="openRecord(record)"
          >
            <strong>{{ record.title }}</strong
            ><span
              >{{ record.black || "黑方" }} · {{ record.white || "白方" }}</span
            ><small
              >{{ record.moves }} 手 · {{ record.date || "未设置日期" }}</small
            >
          </button>
          <div v-if="!filteredRecords.length" class="library-empty">
            {{
              libraryLoading
                ? "正在读取棋谱…"
                : libraryQuery
                  ? "没有匹配的棋谱"
                  : "暂无棋谱"
            }}
          </div>
        </div>
      </aside>
      <section class="research-board-area" aria-label="研究棋盘">
        <ResearchModeToolbar
          :mode="mode"
          :setup-stone="setupStone"
          :mark-type="markType"
          :current-player="current.snapshot.currentPlayer"
          :locked="Boolean(preview)"
          @update:mode="research.setMode"
          @update:setup-stone="research.setSetupStone"
          @update:mark-type="research.setMarkType"
          @update:current-player="changePlayer"
          @clear-marks="research.clearMarks"
        >
          <div class="research-toolbar-status" aria-label="当前局面信息">
            <span class="toolbar-move"
              >第 {{ current.snapshot.moveNumber }} 手</span
            >
            <span class="toolbar-context"
              >{{ onMainLine ? "主线" : "变化"
              }}<template v-if="current.move">
                ·
                {{
                  current.move.pass ? "停一手" : current.move.coordinate
                }}</template
              ></span
            >
            <span class="toolbar-captures"
              >提子 <b>黑 {{ current.snapshot.capturedByBlack }}</b
              ><i></i><b>白 {{ current.snapshot.capturedByWhite }}</b></span
            >
          </div>
        </ResearchModeToolbar>
        <div
          ref="boardStage"
          class="board-stage research-board-stage"
          :class="{ 'is-previewing': preview }"
        >
          <div v-if="preview" class="preview-caption" role="status">
            <GitBranch :size="14" />AI 预览 ·
            {{ preview.move === "pass" ? "停一手" : preview.move }} ·
            {{ preview.step }} 手
          </div>
          <GoBoard
            :board="displayNode.snapshot.board"
            :current-player="displayNode.snapshot.currentPlayer"
            :last-move="lastMove"
            :candidates="candidateMarkers"
            :territory="territory"
            territory-mode="ai"
            :show-star-points="true"
            :show-coordinates="coordinatesVisible"
            :dead-stones="deadStones"
            :move-numbers="moveNumbers"
            :show-move-numbers="moveNumbersVisible || Boolean(preview)"
            :board-style="boardStyle"
            :disabled="Boolean(preview) || Boolean(confirmAction)"
            :busy="false"
            :marks="preview ? [] : current.marks"
            :mark-preview-type="mode === 'mark' && !preview ? markType : null"
            @place="editPoint"
          />
        </div>
        <div v-if="preview" class="preview-controls">
          <button
            class="workspace-icon"
            type="button"
            title="退出 AI 预览"
            aria-label="退出 AI 预览"
            @click="preview = null"
          >
            <X :size="16" />
          </button>
          <span>AI 预览</span
          ><input
            v-model.number="previewStep"
            type="range"
            min="1"
            :max="preview.coordinates.length"
            aria-label="预览变化手数"
          /><span>{{ preview.step }} / {{ preview.coordinates.length }}</span>
          <button
            class="workspace-button primary"
            type="button"
            @click="ai.commitPreview"
          >
            <GitBranch :size="15" />加入变化
          </button>
        </div>
        <footer class="research-navigation">
          <div class="navigation-top">
            <div class="history-tools" role="group" aria-label="编辑历史">
              <button
                class="workspace-icon"
                type="button"
                title="撤销编辑"
                aria-label="撤销编辑"
                :disabled="!canUndo || Boolean(preview)"
                @click="research.undo"
              >
                <Undo2 :size="16" /></button
              ><button
                class="workspace-icon"
                type="button"
                title="重做编辑"
                aria-label="重做编辑"
                :disabled="!canRedo || Boolean(preview)"
                @click="research.redo"
              >
                <Redo2 :size="16" />
              </button>
            </div>
            <div class="move-navigation" role="group" aria-label="棋谱导航">
              <button
                class="workspace-icon"
                type="button"
                title="初始局面"
                aria-label="初始局面"
                :disabled="!canGoBack || Boolean(preview)"
                @click="research.goFirst"
              >
                <ChevronsLeft :size="18" />
              </button>
              <button
                class="workspace-icon"
                type="button"
                title="上一手"
                aria-label="上一手"
                :disabled="!canGoBack || Boolean(preview)"
                @click="research.goBack"
              >
                <ChevronLeft :size="18" />
              </button>
              <label class="move-position"
                ><input
                  type="number"
                  :value="lineIndex"
                  min="0"
                  :max="line.length - 1"
                  :disabled="Boolean(preview)"
                  aria-label="跳转节点"
                  @change="
                    research.goToIndex(
                      Number(($event.target as HTMLInputElement).value),
                    )
                  "
                /><span>/ {{ line.length - 1 }}</span></label
              >
              <button
                class="workspace-icon"
                type="button"
                title="下一手"
                aria-label="下一手"
                :disabled="!canGoForward || Boolean(preview)"
                @click="research.goForward"
              >
                <ChevronRight :size="18" />
              </button>
              <button
                class="workspace-icon"
                type="button"
                title="变化末尾"
                aria-label="变化末尾"
                :disabled="!canGoForward || Boolean(preview)"
                @click="research.goLast"
              >
                <ChevronsRight :size="18" />
              </button>
            </div>
            <button
              class="pass-button"
              type="button"
              :disabled="Boolean(preview) || mode !== 'play'"
              @click="research.pass"
            >
              <Pause :size="14" />停一手
            </button>
          </div>
          <div class="timeline-control">
            <!-- Update max before value so appended moves are not clamped to the old endpoint. -->
            <input
              class="move-timeline"
              type="range"
              min="0"
              :max="Math.max(1, line.length - 1)"
              :value="lineIndex"
              :style="{
                '--timeline-progress': `${(lineIndex / Math.max(1, line.length - 1)) * 100}%`,
              }"
              :disabled="line.length === 1 || Boolean(preview)"
              aria-label="棋谱进度"
              @input="
                research.goToIndex(
                  Number(($event.target as HTMLInputElement).value),
                )
              "
            />
          </div>
        </footer>
      </section>
      <SidebarShell
        v-model="inspectorTab"
        label="研究信息"
        title="研究内容"
        id-prefix="research-sidebar"
        :tabs="inspectorTabs"
      >
        <div class="research-inspector-content">
          <div v-show="inspectorTab === 'analysis'" class="inspector-analysis">
            <ResearchEvaluation
              v-model:perspective="perspective"
              v-model:move-numbers-enabled="moveNumbersVisible"
              v-model:candidates-visible="candidatesVisible"
              v-model:territory-visible="territoryVisible"
              :analysis="analysis"
              :history="history"
              :status="status"
              :error="error"
              :territory-status="territoryStatus"
              :territory-error="territoryError"
              :territory-available="Boolean(territoryEstimate)"
              :preview-move="preview?.move"
              @request="requestResearchAnalysis"
              @stop="stopResearchAnalysis"
            />
          </div>
          <section
            v-if="inspectorTab === 'tree'"
            class="inspector-tree"
            aria-label="棋谱变化"
          >
            <div class="section-heading">
              <h2><GitBranch :size="15" />变化树</h2>
              <span>{{ Object.keys(tree.nodes).length }} 节点</span>
              <div class="section-actions">
                <button
                  class="workspace-icon"
                  type="button"
                  title="设为主线"
                  aria-label="设为主线"
                  :disabled="onMainLine || Boolean(preview)"
                  @click="research.promoteVariation"
                >
                  <ArrowUpToLine :size="15" /></button
                ><button
                  class="workspace-icon"
                  type="button"
                  title="删除当前变化"
                  aria-label="删除当前变化"
                  :disabled="!current.parentId || Boolean(preview)"
                  @click="deleteBranch"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>
            <VariationTree
              :graph="graph"
              :tree="tree"
              @select="
                preview = null;
                research.selectNode($event);
              "
            />
            <section
              class="inspector-notes"
              aria-label="节点备注"
              :style="{ '--notes-height': `${notesHeight}px` }"
            >
              <div class="section-heading">
                <h2><MessageSquare :size="15" />节点备注</h2>
                <button
                  class="notes-resize"
                  type="button"
                  aria-label="调整备注区域高度"
                  title="拖动调整备注区域高度"
                  @pointerdown="startNotesResize"
                  @pointermove="moveNotesResize"
                  @pointerup="stopNotesResize"
                  @pointercancel="stopNotesResize"
                  @keydown="keyNotesResize"
                >
                  <span />
                </button>
              </div>
              <textarea
                :value="current.comment"
                rows="3"
                aria-label="当前节点备注"
                placeholder="暂无备注"
                @input="
                  research.setComment(
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </section>
          </section>
        </div>
      </SidebarShell>
    </div>
    <div
      v-if="confirmAction"
      class="research-dialog-backdrop"
      @click.self="closeConfirmation"
    >
      <section
        ref="confirmDialog"
        class="research-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-confirm-title"
        aria-describedby="research-confirm-message"
      >
        <button
          class="research-dialog-close"
          type="button"
          aria-label="关闭确认弹窗"
          title="关闭"
          @click="closeConfirmation"
        >
          <X :size="18" aria-hidden="true" />
        </button>
        <div class="research-dialog-body">
          <h2 id="research-confirm-title">{{ confirmAction.title }}</h2>
          <p id="research-confirm-message">{{ confirmAction.message }}</p>
        </div>
        <div class="research-dialog-actions">
          <button
            class="research-dialog-cancel"
            type="button"
            @click="closeConfirmation"
          >
            取消</button
          ><button
            class="workspace-button primary"
            type="button"
            @click="acceptConfirmation"
          >
            {{ confirmAction.label }}
          </button>
        </div>
      </section>
    </div>
    <GameSettingsDialog
      :open="settingsOpen"
      context="research"
      :coordinates-enabled="coordinatesVisible"
      :move-numbers-enabled="moveNumbersVisible"
      :candidates-enabled="candidatesVisible"
      :territory-enabled="territoryVisible"
      :immersive-enabled="false"
      :board-style="boardStyle"
      recommendation-strength="auto"
      @close="settingsOpen = false"
      @update:coordinates-enabled="coordinatesVisible = $event"
      @update:move-numbers-enabled="moveNumbersVisible = $event"
      @update:candidates-enabled="candidatesVisible = $event"
      @update:territory-enabled="territoryVisible = $event"
      @update:board-style="boardStyle = $event"
    />
  </main>
</template>

<style scoped>
.research-workbench :deep(.sidebar-tabs) {
  height: 38px;
  min-height: 38px;
  margin-block: 8px 9px;
}
.research-workbench {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  background: var(--shell);
  background-image:
    linear-gradient(rgba(243, 242, 241, 0.22), rgba(243, 242, 241, 0.22)),
    url("/home-background.png");
  background-position: center;
  background-size: cover;
}
.document-back-slot {
  display: flex;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
}
.document-name {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.document-name input {
  width: 150px;
  min-width: 72px;
  height: 32px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text);
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
.document-name input:hover {
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.45);
}
.document-name input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.document-save-state {
  display: inline-flex;
  width: 56px;
  flex: 0 0 56px;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
}
.document-save-state::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  content: "";
}
.document-save-state.is-dirty::before {
  background: var(--accent-strong);
}
.document-rules {
  display: flex;
  height: 32px;
  align-items: center;
  color: var(--muted);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}
.document-rules > span + span {
  margin-left: 10px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.document-rules > span:first-child {
  color: var(--text);
  font-weight: 500;
}
.document-actions {
  display: flex;
  gap: 3px;
  align-items: center;
  margin-left: auto;
}
.file-input {
  display: none;
}
.research-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.research-layout.library-open {
  grid-template-columns: 210px minmax(0, 1fr) 360px;
}
.research-board-area {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-width: 0;
  min-height: 0;
}
.research-board-stage {
  min-height: 0;
  padding: 18px 24px;
  overflow: hidden;
  container-type: size;
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
}
.research-board-stage :deep(.board-host) {
  width: min(100cqw, 100cqh) !important;
  height: min(100cqw, 100cqh) !important;
  min-width: 0;
  max-width: 100%;
  max-height: 100%;
  box-shadow: var(--shadow-md);
}
.research-board-stage.is-previewing {
  padding-top: 38px;
}
.preview-caption {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--accent-16);
  border-radius: 4px;
  color: var(--accent-strong);
  background: var(--surface);
  font-size: 11px;
  white-space: nowrap;
  z-index: 1;
}
.preview-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 6px 18px;
  border-top: 1px solid var(--border);
  background: var(--accent-soft);
  font-size: 11px;
}
.preview-controls input {
  flex: 1;
  min-width: 40px;
  accent-color: var(--accent);
}
.preview-controls > span {
  white-space: nowrap;
}
.research-navigation {
  padding: 10px 24px 12px;
  border-top: 1px solid var(--border);
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
}
.navigation-top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.history-tools,
.move-navigation {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
}
.move-navigation {
  margin-inline: auto;
}
.move-position {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 88px;
  justify-content: center;
  font-size: 11px;
  color: var(--muted);
}
.move-position input {
  width: 48px;
  height: 28px;
  padding: 2px 4px;
  font-size: 12px;
  text-align: center;
}
.pass-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.72);
  font-size: 11px;
  flex: 0 0 auto;
}
.pass-button:disabled {
  opacity: 0.4;
}
.research-workbench :deep(.research-tools) {
  gap: 10px;
}
.research-toolbar-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-left: auto;
  padding-left: 12px;
  border-left: 1px solid var(--border);
  white-space: nowrap;
}
.toolbar-move {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}
.toolbar-context {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
}
.toolbar-captures {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
}
.toolbar-captures b {
  color: var(--text);
  font-weight: 500;
}
.toolbar-captures i {
  width: 1px;
  height: 9px;
  background: var(--border);
}
.timeline-control {
  padding: 7px 2px 0;
}
.move-timeline {
  display: block;
  width: 100%;
  height: 24px;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}
.move-timeline::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    var(--accent) 0 var(--timeline-progress),
    var(--border) var(--timeline-progress) 100%
  );
}
.move-timeline::-moz-range-track {
  height: 4px;
  border-radius: 4px;
  background: var(--border);
}
.move-timeline::-moz-range-progress {
  height: 4px;
  border-radius: 4px;
  background: var(--accent);
}
.move-timeline::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  appearance: none;
  -webkit-appearance: none;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
  transition:
    transform 120ms ease,
    box-shadow 120ms ease;
}
.move-timeline::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
  transition:
    transform 120ms ease,
    box-shadow 120ms ease;
}
.move-timeline:hover::-webkit-slider-thumb,
.move-timeline:active::-webkit-slider-thumb {
  transform: scale(1.12);
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.move-timeline:hover::-moz-range-thumb,
.move-timeline:active::-moz-range-thumb {
  transform: scale(1.12);
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.move-timeline:focus-visible {
  outline: none;
}
.move-timeline:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.move-timeline:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.move-timeline:disabled {
  cursor: default;
  opacity: 0.48;
}
.research-inspector-content {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.inspector-tree {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 0;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  margin-bottom: 8px;
}
.section-heading h2 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.section-heading h2 svg {
  color: var(--muted);
}
.section-heading > span {
  color: var(--muted);
  font-size: 10px;
  margin-left: auto;
}
.section-actions {
  display: flex;
  gap: 2px;
}
.section-actions .workspace-icon {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
}
.inspector-tree :deep(.variation-navigator) {
  min-height: 0;
  flex: 1;
}
.inspector-notes {
  flex: 0 0 auto;
  margin-top: auto;
  padding: 0;
  border-top: 0;
}
.inspector-notes .section-heading {
  margin-bottom: 4px;
}
.inspector-notes textarea {
  display: block;
  width: 100%;
  min-height: 76px;
  max-height: 220px;
  resize: vertical;
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}
.research-library {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  border-right: 1px solid var(--border);
  background: transparent;
}
.library-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.library-heading h2 {
  margin: 0;
  font-size: 13px;
}
.research-library > input {
  width: 100%;
  min-height: 32px;
  padding: 0 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
}
.library-records {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin-top: 10px;
}
.library-records button {
  display: grid;
  width: 100%;
  gap: 6px;
  padding: 12px 8px;
  border: 0;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  background: transparent;
  text-align: left;
  overflow-wrap: anywhere;
}
.library-records button:hover,
.library-records button.selected {
  background: var(--accent-soft);
}
.library-records strong {
  font-size: 12px;
  font-weight: 600;
}
.library-records span,
.library-records small {
  color: var(--muted);
  font-size: 10px;
}
.library-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
.research-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(32, 32, 32, 0.16);
  backdrop-filter: blur(4px);
}
.research-dialog {
  position: relative;
  display: grid;
  width: min(420px, 100%);
  min-height: 216px;
  grid-template-rows: 1fr auto;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.84);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.68);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.research-dialog-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #323130;
  background: transparent;
  transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out;
}
.research-dialog-close:hover {
  color: #0078d4;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: var(--shadow-xs);
}
.research-dialog-close:active,
.research-dialog-cancel:active,
.research-dialog .workspace-button:active {
  transform: scale(0.97);
}
.research-dialog-body {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 10px;
  min-height: 0;
  padding: 42px 48px 18px;
  text-align: center;
}
.research-dialog-body h2 {
  margin: 0;
  color: #323130;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}
.research-dialog-body p {
  margin: 0;
  color: #605e5c;
  font-size: 13px;
  line-height: 1.6;
}
.research-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  min-height: 70px;
  align-items: center;
  padding: 10px 24px 20px;
}
.research-dialog-cancel {
  min-width: 76px;
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid rgba(96, 94, 92, 0.35);
  border-radius: 6px;
  color: #323130;
  background: rgba(255, 255, 255, 0.72);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}
.research-dialog .workspace-button.primary {
  min-width: 76px;
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid #0078d4;
  border-radius: 6px;
  color: #fff;
  background: #0078d4;
  box-shadow: var(--shadow-xs);
  font-size: 13px;
  font-weight: 600;
}
.research-dialog .workspace-button.primary:hover {
  background: #106ebe;
  box-shadow: var(--shadow-sm);
}
.research-dialog .workspace-button.primary:active {
  background: #005a9e;
  box-shadow: none;
}
.research-dialog-close:focus-visible,
.research-dialog-cancel:focus-visible,
.research-dialog .workspace-button:focus-visible {
  outline: 2px solid #0078d4;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.4), 0 0 0 6px #0078d4;
}
@media (max-width: 520px) {
  .research-dialog-backdrop { padding: 14px; }
  .research-dialog-body { padding-inline: 28px; }
  .research-dialog-body h2 { font-size: 20px; }
  .research-dialog-actions { padding-right: 18px; padding-bottom: 18px; }
}
.inspector-notes textarea {
  height: var(--notes-height);
  resize: none;
}
.inspector-notes .section-heading {
  position: relative;
}
.inspector-notes .notes-resize {
  position: absolute;
  left: 50%;
  display: grid;
  width: 44px;
  height: 32px;
  place-items: center;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  transform: translateX(-50%);
  cursor: ns-resize;
  touch-action: none;
}
.notes-resize span {
  width: 30px;
  height: 3px;
  border-radius: 2px;
  background: var(--muted);
  transition:
    background-color 120ms ease,
    width 120ms ease;
}
.notes-resize:hover span,
.notes-resize:focus-visible span {
  width: 42px;
  background: var(--accent);
}
.notes-resize:focus-visible {
  outline: none;
}
@media (min-width: 981px) and (max-width: 1240px) {
  .research-layout.library-open {
    grid-template-columns: minmax(0, 1fr) 340px;
    position: relative;
  }
  .library-open .research-library {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 220px;
    z-index: 3;
    box-shadow: var(--shadow-md);
  }
  .research-layout {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
  .document-rules {
    display: none;
  }
}
@media (max-width: 980px) {
  .research-layout,
  .research-layout.library-open {
    display: block;
    overflow-y: auto;
    position: relative;
  }
  .research-board-area {
    height: 720px;
    min-height: 0;
  }
  .inspector-tree {
    min-height: 220px;
  }
  .research-library {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 240px;
    z-index: 3;
    box-shadow: var(--shadow-md);
  }
  .document-rules {
    display: none;
  }
}
@media (max-width: 600px) {
  .document-toolbar {
    padding: 8px 10px;
    gap: 4px;
  }
  .document-name {
    flex: 1;
    gap: 6px;
  }
  .document-name input {
    width: 132px;
  }
  .document-save-state {
    font-size: 11px;
  }
  .document-actions {
    gap: 0;
  }
  .document-actions .workspace-icon {
    width: 28px;
    flex-basis: 28px;
  }
  .document-actions .workspace-button {
    padding: 0 8px;
  }
  .document-actions .workspace-button span {
    display: none;
  }
  .research-board-area {
    height: auto;
    grid-template-rows: auto auto auto auto;
  }
  .research-board-stage {
    height: auto;
    min-height: 0;
    aspect-ratio: 1;
    padding: 14px 12px;
  }
  .research-navigation {
    padding: 8px 12px 12px;
  }
  .navigation-top {
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  .history-tools {
    order: 2;
  }
  .move-navigation {
    order: 1;
    flex: 1 0 100%;
    justify-content: center;
    margin-inline: 0;
  }
  .pass-button {
    order: 3;
    margin-left: auto;
  }
  .research-toolbar-status {
    flex: 1 0 100%;
    justify-content: flex-end;
    margin-left: 0;
    padding: 5px 0 0;
    border-left: 0;
    border-top: 1px solid var(--border);
  }
  .preview-controls {
    flex-wrap: wrap;
    padding: 6px 12px;
  }
  .preview-controls > span:first-of-type {
    display: none;
  }
  .document-feedback {
    padding-inline: 12px;
  }
  .inspector-notes textarea {
    font-size: 16px;
  }
}
.research-library,
.research-workbench :deep(.game-sidebar) {
  background: rgba(243, 242, 241, 0.2);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.research-library > input[type="search"] {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.72);
  transition:
    border-color 140ms ease,
    outline-color 140ms ease,
    background-color 140ms ease;
}
.research-library > input[type="search"]:hover:not(:focus-visible) {
  border-color: #a19f9d;
}
.research-library > input[type="search"]:focus-visible {
  border: 2px solid var(--accent);
  outline: none;
  background: var(--surface);
}
.research-library > input[type="search"]::placeholder {
  color: var(--text-subtle);
  opacity: 1;
}
.library-records {
  display: grid;
  align-content: start;
  gap: 8px;
}
.library-records button {
  gap: 5px;
  padding: 10px;
  border: 1px solid rgba(225, 225, 225, 0.9);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.66);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  backdrop-filter: blur(4px);
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease;
}
.library-records button:not(.selected):hover {
  border-color: var(--accent-16);
  background: rgba(255, 255, 255, 0.86);
  box-shadow: var(--shadow-xs);
}
.library-records button.selected {
  border-color: rgba(var(--accent-rgb), 0.32);
  background: rgba(222, 236, 249, 0.92);
  box-shadow: var(--shadow-xs);
}
.library-records button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.library-records strong {
  font-size: 13px;
}
.library-records span,
.library-records small {
  font-size: 11px;
  line-height: 1.4;
}
.research-toast-layer {
  position: fixed;
  z-index: 90;
  top: max(65px, calc(env(safe-area-inset-top) + 16px));
  left: 50%;
  width: min(420px, calc(100vw - 32px));
  transform: translateX(-50%);
  pointer-events: none;
}
.research-toast {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  max-height: 40vh;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.97);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  pointer-events: auto;
}
.research-toast.error > svg {
  color: #b0443d;
}
.research-toast.success > svg {
  color: var(--accent-strong);
}
.research-toast-close {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}
.research-toast-close:hover {
  color: var(--text);
  background: var(--accent-soft);
}
.research-toast-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
@media (max-width: 600px) {
  .research-toast-layer {
    top: max(124px, calc(env(safe-area-inset-top) + 124px));
  }
}
.research-toast-enter-active,
.research-toast-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.research-toast-enter-from,
.research-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}
@media (prefers-reduced-motion: reduce) {
  .research-toast-enter-active,
  .research-toast-leave-active {
    transition: none;
  }
}
</style>
