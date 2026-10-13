<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, toRefs, watch } from 'vue'
import {
  Check,
  Download,
  FileUp,
  FolderPlus,
  LoaderCircle,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import LibraryNavigation from '../components/library/LibraryNavigation.vue'
import RecordList from '../components/library/RecordList.vue'
import RecordPreview from '../components/library/RecordPreview.vue'
import LibraryDialog from '../components/library/LibraryDialog.vue'
import LibraryToolbar from '../components/library/LibraryToolbar.vue'
import LibraryPane from '../components/library/LibraryPane.vue'
import { filterChips, filterLibraryRecords, pageCount, type FilterKey } from '../components/library/workspace'
import { useLibraryStore } from '../stores/library'
import { useResearchStore } from '../stores/research'
import { komiFor } from '../domain/gameSetup'
import {
  REVIEW_LABELS,
  type ImportResult,
  type LibraryRecord,
  type RecordMetadata,
  type ReviewState,
  type RecordCollection,
} from '../types/library'
import {
  downloadRecords,
  exportLibraryBackup,
  importLibraryBackup,
  readNativeSgfFiles,
} from '../services/library'

const router = useRouter(),
  library = useLibraryStore(),
  research = useResearchStore()
const fileInput = ref<HTMLInputElement | null>(null),
  backupInput = ref<HTMLInputElement | null>(null)
const { sidebarVisible, previewVisible, filtersVisible, view, page, sort, ascending, sizeFilter, sourceFilter, reviewFilter, fromDate, toDate } = toRefs(library.ui)
const viewportWidth = ref(window.innerWidth)
const navigationDrawer = computed(() => viewportWidth.value < 900)
const previewDrawer = computed(() => viewportWidth.value < 1280)
const navigationDrawerOpen = ref(false), previewDrawerOpen = ref(false)
const navigationShown = computed(() => navigationDrawer.value ? navigationDrawerOpen.value : sidebarVisible.value)
const previewShown = computed(() => previewDrawer.value ? previewDrawerOpen.value : previewVisible.value)
const backupMenu = ref<HTMLDetailsElement | null>(null)
function resizeWorkspace() { viewportWidth.value = window.innerWidth }
function closeNavigation() { if (navigationDrawer.value) navigationDrawerOpen.value = false; else sidebarVisible.value = false }
function closePreview() { if (previewDrawer.value) previewDrawerOpen.value = false; else previewVisible.value = false }
const modal = ref<
  | 'create'
  | 'import'
  | 'collection'
  | 'delete'
  | 'batch'
  | 'restore-backup'
  | 'switch-research'
  | 'manage-collection'
  | null
>(null)
const busy = ref(false),
  error = ref(''),
  toast = ref(''),
  dragging = ref(false),
  dragDepth = ref(0),
  results = ref<ImportResult[]>([]),
  importingName = ref(''),
  completed = ref(0),
  total = ref(0)
const collectionName = ref(''),
  batchTag = ref(''),
  batchCollection = ref(''),
  batchState = ref<ReviewState | ''>(''),
  deleteIds = ref<string[]>([]),
  lastDeleted = ref<string[]>([])
const importFiles = ref<File[]>([]),
  duplicateMode = ref<'skip' | 'copy'>('skip'),
  importCollection = ref(''),
  pendingBackup = ref<File | null>(null)
const pendingOpen = ref<string | 'create' | null>(null)
const managedCollection = ref<RecordCollection | null>(null)
const creation = ref({
  title: '',
  black: '',
  white: '',
  event: '',
  date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
  result: '',
  boardSize: 19,
  ruleSet: 'chinese' as RecordMetadata['ruleSet'],
  komi: 3.75,
})
let toastTimer: ReturnType<typeof setTimeout> | undefined,
  stopDrop: (() => void) | undefined
let unmounted = false
watch(() => creation.value.ruleSet, (ruleSet) => {
  creation.value.komi = komiFor(ruleSet, 0)
})
const tags = computed(() =>
  [
    ...new Set(
      library.data.records
        .filter((record) => !record.deletedAt)
        .flatMap((record) => record.tags),
    ),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN')),
)
const collectionCounts = computed(() =>
  Object.fromEntries(
    library.data.collections.map((collection) => [
      collection.id,
      library.data.records.filter(
        (record) =>
          !record.deletedAt && record.collectionIds.includes(collection.id),
      ).length,
    ]),
  ),
)
const tagCounts = computed(() =>
  Object.fromEntries(
    tags.value.map((tag) => [
      tag,
      library.data.records.filter(
        (record) => !record.deletedAt && record.tags.includes(tag),
      ).length,
    ]),
  ),
)
const heading = computed(
  () =>
    ({
      all: '全部棋谱',
      recent: '最近打开',
      favorites: '我的收藏',
      pending: '待复盘',
      trash: '回收站',
    })[library.category] ??
    library.data.collections.find(
      (collection) => collection.id === library.category,
    )?.name ??
    (library.category.startsWith('tag:')
      ? library.category.slice(4)
      : '全部棋谱'),
)
const filters = computed(() => ({ sizeFilter: sizeFilter.value, sourceFilter: sourceFilter.value, reviewFilter: reviewFilter.value, fromDate: fromDate.value, toDate: toDate.value }))
const filtered = computed(() => filterLibraryRecords(library.visibleRecords, library.category, filters.value, sort.value, ascending.value))
const hasConditions = computed(() => Boolean(library.query.trim() || filterChips(filters.value).length))
const emptyTitle = computed(() => {
  if (hasConditions.value) return '没有符合条件的棋谱'
  if (library.category === 'trash') return '回收站为空'
  if (library.category === 'favorites') return '暂无收藏棋谱'
  if (library.category === 'recent') return '暂无最近打开的棋谱'
  if (library.category === 'pending') return '暂无待复盘棋谱'
  if (library.category.startsWith('collection-')) return '棋谱集为空'
  if (library.category.startsWith('tag:')) return '此标签下暂无棋谱'
  return '暂无棋谱'
})
function updateFilter(key: FilterKey, value: string) { library.ui[key] = value }
const isTrash = computed(() => library.category === 'trash'),
  previewRecord = computed(
    () =>
      filtered.value.find((record) => record.id === library.selectedId) ?? null,
  )
const importSummary = computed(() => ({
  imported: results.value.filter((result) => result.status === 'imported')
    .length,
  duplicate: results.value.filter((result) => result.status === 'duplicate')
    .length,
  error: results.value.filter((result) => result.status === 'error').length,
}))
watch(
  [
    () => library.category,
    () => library.query,
    sizeFilter,
    sourceFilter,
    reviewFilter,
    fromDate,
    toDate,
  ],
  () => {
    page.value = 1
    library.ui.scrollTop = 0
    library.selectedIds = []
  },
)
watch(filtered, records => {
  page.value = Math.max(1, Math.min(page.value, pageCount(records.length)))
  const ids = new Set(records.map(record => record.id))
  library.selectedIds = library.selectedIds.filter(id => ids.has(id))
  if (library.selectedId && !ids.has(library.selectedId)) library.selectedId = null
})
watch([sort, ascending, view, page], () => { library.ui.scrollTop = 0 })
watch([sort, ascending], () => { page.value = 1 })
watch(navigationDrawer, () => { navigationDrawerOpen.value = false })
watch(previewDrawer, () => { previewDrawerOpen.value = false })
function notify(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 5000)
}
function clearError() { error.value = ''; library.error = '' }
async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await task()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
function select(id: string) {
  library.selectedId = id
  if (previewDrawer.value) previewDrawerOpen.value = true
  else previewVisible.value = true
}
function toggleSidebar() { if (navigationDrawer.value) navigationDrawerOpen.value = !navigationDrawerOpen.value; else sidebarVisible.value = !sidebarVisible.value }
function togglePreview() { if (previewDrawer.value) previewDrawerOpen.value = !previewDrawerOpen.value; else previewVisible.value = !previewVisible.value }
function manageCollection(collection: RecordCollection) { managedCollection.value = { ...collection }; modal.value = 'manage-collection' }
async function renameCollection() { await run(async () => { if (!managedCollection.value) return; await library.renameCollection(managedCollection.value.id, managedCollection.value.name); modal.value = null; notify('棋谱集已重命名') }) }
async function removeCollection() { await run(async () => { if (!managedCollection.value) return; await library.removeCollection(managedCollection.value.id); modal.value = null; notify('棋谱集已移除，棋谱已保留') }) }
function selectCategory(category: string) {
  library.category = category
  library.selectedIds = []
  navigationDrawerOpen.value = false
}
function toggle(id: string) {
  library.selectedIds = library.selectedIds.includes(id)
    ? library.selectedIds.filter((value) => value !== id)
    : [...library.selectedIds, id]
}
function toggleAll() {
  library.selectedIds = filtered.value.every((record) =>
    library.selectedIds.includes(record.id),
  )
    ? []
    : filtered.value.map((record) => record.id)
}
function sortBy(key: string) {
  if (sort.value === key) ascending.value = !ascending.value
  else {
    sort.value = key
    ascending.value = key === 'title' || key === 'players'
  }
  page.value = 1
}
function resetFilters() {
  sizeFilter.value = ''
  sourceFilter.value = ''
  reviewFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
  library.query = ''
}
function chooseFiles(files: File[]) {
  importFiles.value = files.filter((file) =>
    file.name.toLowerCase().endsWith('.sgf'),
  )
  if (!importFiles.value.length) { error.value = '请选择 SGF 棋谱文件'; return }
  results.value = []
  completed.value = 0
  total.value = importFiles.value.length
  importCollection.value = library.category.startsWith('collection-')
    ? library.category
    : ''
  modal.value = 'import'
}
function inputFiles(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) chooseFiles([...input.files])
  input.value = ''
}
async function startImport() {
  await run(async () => {
    results.value = []
    total.value = importFiles.value.length
    for (const [index, file] of importFiles.value.entries()) {
      importingName.value = file.name
      results.value.push(
        ...(await library.importFiles([file], {
          duplicateMode: duplicateMode.value,
          collectionId: importCollection.value,
        })),
      )
      completed.value = index + 1
      await nextTick()
    }
    importingName.value = ''
    notify(`导入完成：${importSummary.value.imported} 局棋谱`)
  })
}
async function createRecord() {
  if (research.tree.dirty) { pendingOpen.value = 'create'; modal.value = 'switch-research'; return }
  await run(async () => {
    if (research.tree.dirty) throw new Error('研究盘还有未保存的修改，请先保存或放弃修改后再新建棋谱')
    const record = await library.create({
      ...creation.value,
      title: creation.value.title.trim(),
      event: creation.value.event,
      komi: creation.value.ruleSet === 'chinese'
        ? creation.value.komi * 2
        : creation.value.komi,
    })
    modal.value = null
    await openResearch(record.id)
  })
}
async function openResearch(id: string) {
  const { record, tree } = await library.getRecordResearch(id)
  await library.open(id)
  research.loadRecord(record.id, record.title, tree)
  await router.push({ name: 'research', query: { record: id } })
}
function open(id: string) {
  if (research.tree.dirty) { pendingOpen.value = id; modal.value = 'switch-research'; return }
  void run(() => openResearch(id))
}
async function continueOpen(save: boolean) {
  await run(async () => {
    if (save) {
      const snapshot = research.tree
      const record = await library.saveResearch(research.recordId, { ...snapshot, komi: snapshot.ruleSet === 'chinese' ? snapshot.komi * 2 : snapshot.komi, nodes: Object.fromEntries(Object.values(snapshot.nodes).map(node => [node.id, { ...node, sgfProperties: { ...node.properties, ...(node.setup ? { PL: [node.snapshot.currentPlayer === 'black' ? 'B' : 'W'] } : {}) } }])) }, { title: snapshot.title, black: snapshot.blackName, white: snapshot.whiteName })
      research.recordId = record.id
      research.markSaved(snapshot)
      if (research.tree.dirty) throw new Error('研究内容在保存期间发生变化，请再次保存')
    }
    const id = pendingOpen.value
    if (id === 'create') {
      const record = await library.create({
        ...creation.value,
        title: creation.value.title.trim(),
        komi: creation.value.ruleSet === 'chinese'
          ? creation.value.komi * 2
          : creation.value.komi,
      })
      await openResearch(record.id)
    } else if (id) await openResearch(id)
    pendingOpen.value = null; modal.value = null
  })
}
function favorite(record: LibraryRecord) {
  void run(async () => {
    await library.patch(record.id, { favorite: !record.favorite })
  })
}
async function edit(record: LibraryRecord) {
  await library.editMetadata(record.id, record)
  notify('棋谱信息已保存')
}
function tag(record: LibraryRecord, value: string) {
  void run(async () => {
    await library.patch(record.id, {
      tags: [...new Set([...record.tags, value])],
    })
  })
}
function removeTag(record: LibraryRecord, value: string) {
  void run(async () => {
    await library.patch(record.id, {
      tags: record.tags.filter((tag) => tag !== value),
    })
  })
}
function review(record: LibraryRecord, state: ReviewState) {
  void run(async () => {
    await library.patch(record.id, { reviewState: state })
    notify('复盘状态已更新')
  })
}
function askDelete(ids: string[]) {
  deleteIds.value = ids
  modal.value = 'delete'
}
async function confirmDelete() {
  await run(async () => {
    const ids = [...deleteIds.value]
    await library.remove(ids)
    lastDeleted.value = isTrash.value ? [] : ids
    modal.value = null
    notify(isTrash.value ? '棋谱已永久删除' : '棋谱已移入回收站')
  })
}
function restore(ids: string[]) {
  void run(async () => {
    await library.restore(ids)
    lastDeleted.value = []
    notify('棋谱已恢复')
  })
}
async function createCollection() {
  await run(async () => {
    const name = collectionName.value.trim()
    if (!name) return
    const collection = await library.addCollection(name)
    modal.value = null
    collectionName.value = ''
    selectCategory(collection.id)
  })
}
async function applyBatch() {
  await run(async () => {
    await library.batch(library.selectedIds, {
      tag: batchTag.value.trim(),
      collectionId: batchCollection.value,
      reviewState: batchState.value,
    })
    modal.value = null
    library.selectedIds = []
    notify('批量整理已保存')
  })
}
function download(ids: string[]) {
  void run(async () => {
    const saved = await downloadRecords(
      library.data.records.filter((record) => ids.includes(record.id)),
    )
    if (saved) notify('已导出 SGF')
  })
}
function backup() {
  backupMenu.value?.removeAttribute('open')
  void run(async () => {
    if (await exportLibraryBackup(library.data)) notify('棋谱库备份已导出')
  })
}
function chooseBackup(event: Event) {
  backupMenu.value?.removeAttribute('open')
  const input = event.target as HTMLInputElement
  pendingBackup.value = input.files?.[0] ?? null
  input.value = ''
  if (pendingBackup.value) modal.value = 'restore-backup'
}
async function restoreBackup() {
  await run(async () => {
    if (!pendingBackup.value) return
    library.data = await importLibraryBackup(pendingBackup.value)
    modal.value = null
    notify('备份已合并到棋谱库')
  })
}
function drop(event: DragEvent) {
  event.preventDefault()
  dragging.value = false
  dragDepth.value = 0
  if (event.dataTransfer?.files.length && !busy.value)
    chooseFiles([...event.dataTransfer.files])
}
function dragEnter(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    dragDepth.value++
    dragging.value = true
  }
}
function dragLeave() {
  dragDepth.value--
  if (dragDepth.value <= 0) {
    dragging.value = false
    dragDepth.value = 0
  }
}
onMounted(async () => {
  window.addEventListener('resize', resizeWorkspace)
  await library.init()
  if (isTauri() && !unmounted) {
    try { const stop = await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'over' || payload.type === 'enter')
        dragging.value = true
      else if (payload.type === 'drop' && !busy.value) {
        dragging.value = false
        const paths = payload.paths
        void run(async () => chooseFiles(await readNativeSgfFiles(paths)))
      } else dragging.value = false
    }); if (unmounted) stop(); else stopDrop = stop }
    catch (cause) { error.value = `拖入文件不可用，请通过导入按钮选择文件：${String(cause)}` }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeWorkspace)
  unmounted = true
  stopDrop?.()
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <main
    class="library-workspace"
    @dragover.prevent
    @dragenter.prevent="dragEnter"
    @dragleave="dragLeave"
    @drop="drop"
  >
    <header class="workspace-toolbar library-topbar">
      <h1 class="visually-hidden">棋谱库</h1>
      <div class="topbar-actions">
        <button class="workspace-button" type="button" :disabled="busy" @click="fileInput?.click()"><FileUp :size="15" /><span>导入</span></button>
        <button class="workspace-button primary" type="button" :disabled="busy" @click="modal = 'create'"><Plus :size="16" /><span>新建</span></button>
        <div class="topbar-spacer" />
        <details ref="backupMenu" class="backup-menu" @keydown.esc.stop.prevent="backupMenu?.removeAttribute('open')">
          <summary class="workspace-icon" aria-label="棋谱库更多操作" title="棋谱库更多操作"><MoreHorizontal :size="18" /></summary>
          <div class="command-menu"><button type="button" :disabled="busy" @click="backup"><Download :size="15" />导出整库备份</button><button type="button" :disabled="busy" @click="backupInput?.click()"><FileUp :size="15" />从备份恢复</button></div>
        </details>
      </div>
    </header>
    <input ref="fileInput" class="visually-hidden" type="file" accept=".sgf" multiple @change="inputFiles" />
    <input ref="backupInput" class="visually-hidden" type="file" accept=".json" @change="chooseBackup" />
    <div v-if="error || library.error" class="library-error" role="alert"><span>{{ error || library.error }}</span><button class="workspace-icon" type="button" aria-label="关闭错误消息" title="关闭" @click="clearError"><X :size="15" /></button></div>
    <div class="library-layout" :class="{ 'has-navigation': navigationShown && !navigationDrawer, 'has-preview': previewShown && !previewDrawer }">
      <LibraryPane :visible="navigationShown" :drawer="navigationDrawer" side="left" label="棋谱分类导航" @close="closeNavigation">
        <LibraryNavigation :category="library.category" :counts="library.counts" :collections="library.data.collections" :tags="tags" :collection-counts="collectionCounts" :tag-counts="tagCounts" :drawer="navigationDrawer"
          @select="selectCategory" @create-collection="modal = 'collection'" @manage-collection="manageCollection" @close="closeNavigation" />
      </LibraryPane>
      <section class="library-main" aria-label="棋谱列表">
        <header class="library-list-heading">
          <div class="list-heading-title"><button class="workspace-icon" type="button" title="分类导航" aria-label="切换分类导航" :aria-expanded="navigationShown" @click="toggleSidebar"><PanelLeft :size="18" /></button><h2 :title="heading">{{ heading }}</h2><span class="category-count">{{ filtered.length }} 局</span></div>
          <button class="workspace-icon" type="button" title="棋谱详情" aria-label="切换棋谱详情" :aria-pressed="previewShown" @click="togglePreview"><PanelRight :size="18" /></button>
        </header>
        <LibraryToolbar v-model:query="library.query" v-model:view="view" :filters="filters" :filters-visible="filtersVisible" :sort="sort" :ascending="ascending" :selection-count="library.selectedIds.length" :busy="busy" :trash="isTrash"
          @update:sort="sortBy" @filter="updateFilter" @toggle-filters="filtersVisible = !filtersVisible" @toggle-direction="ascending = !ascending"
          @clear="resetFilters" @cancel="library.selectedIds = []" @organize="modal = 'batch'" @download="download(library.selectedIds)" @remove="askDelete(library.selectedIds)" @restore="restore(library.selectedIds)" />
        <div v-if="library.loading && !library.initialized" class="library-empty-state" role="status"><LoaderCircle class="spinning" :size="24" /><h3>正在读取棋谱库</h3></div>
        <RecordList v-else-if="filtered.length" :records="filtered" :selected-id="library.selectedId" :selected-ids="library.selectedIds" :view="view" :sort="sort" :ascending="ascending" :page="page" :scroll-top="library.ui.scrollTop" :busy="busy" :trash="isTrash"
          @select="select" @open="open" @toggle="toggle" @toggle-all="toggleAll" @favorite="favorite" @sort="sortBy" @page="page = $event" @scroll="library.ui.scrollTop = $event" />
        <div v-else class="library-empty-state">
          <div class="empty-library-image"><img src="/card-backgrounds/library.png" alt="围棋棋谱收藏" /></div>
          <h3>{{ emptyTitle }}</h3>
          <div class="empty-actions">
            <button v-if="hasConditions" class="workspace-button" type="button" @click="resetFilters"><Undo2 :size="15" />清除筛选</button>
            <button v-else-if="!isTrash" class="workspace-button primary" type="button" :disabled="busy" @click="fileInput?.click()"><FileUp :size="15" />导入棋谱</button>
            <button v-if="!hasConditions && !isTrash && library.category === 'all'" class="workspace-button" type="button" :disabled="busy" @click="modal = 'create'"><Plus :size="15" />新建棋谱</button>
          </div>
        </div>
      </section>
      <LibraryPane :visible="previewShown" :drawer="previewDrawer" side="right" label="棋谱详情" @close="closePreview">
        <RecordPreview :record="previewRecord" :trash="isTrash" :busy="busy" :active="previewShown" :collections="library.data.collections" :save-metadata="edit"
          @close="closePreview" @open="open" @favorite="favorite" @remove="(record) => askDelete([record.id])" @restore="(record) => restore([record.id])"
          @add-tag="tag" @remove-tag="removeTag" @review="review" @download="(record) => download([record.id])"
          @collection="(record, ids) => run(async () => { await library.patch(record.id, { collectionIds: ids }) })" />
      </LibraryPane>
    </div>
    <div v-if="dragging" class="library-drop-target">
      <FileUp :size="36" /><strong>导入 SGF 棋谱</strong>
    </div>
    <div v-if="toast" class="library-toast" role="status">
      <Check :size="16" /><span>{{ toast }}</span
      ><button
        v-if="lastDeleted.length"
        type="button"
        @click="restore(lastDeleted)"
      >
        撤销</button
      ><button
        class="workspace-icon"
        type="button"
        aria-label="关闭提示"
        title="关闭"
        @click="toast = ''"
      >
        <X :size="14" />
      </button>
    </div>
    <LibraryDialog
      v-if="modal === 'create'"
      title="新建棋谱"
      wide
      :busy="busy"
      @close="modal = null"
      ><form class="lib-form" @submit.prevent="createRecord">
        <label class="span-two"
          >棋谱名称<input
            v-model="creation.title"
            required
            maxlength="160"
            autofocus
            placeholder="棋谱名称" /></label
        ><label>黑方<input v-model="creation.black" maxlength="80" /></label
        ><label>白方<input v-model="creation.white" maxlength="80" /></label
        ><label
          >棋盘尺寸<select v-model.number="creation.boardSize">
            <option :value="19">19 路</option>
            <option :value="13">13 路</option>
            <option :value="9">9 路</option>
          </select></label
        ><label
          >规则<select v-model="creation.ruleSet">
            <option value="chinese">中国规则</option>
            <option value="japanese-korean">日韩规则</option>
            <option value="aga">AGA 规则</option>
          </select></label
        ><label
          >贴目（{{ creation.ruleSet === 'chinese' ? '子' : '目' }}）<input
            v-model.number="creation.komi"
            type="number"
            :step="creation.ruleSet === 'chinese' ? 0.25 : 0.5"
            min="-100"
            max="100"
            required /></label
        ><label>日期<input v-model="creation.date" type="date" /></label
        ><label class="span-two"
          >赛事<input v-model="creation.event" maxlength="160"
        /></label>
        <p v-if="error" class="form-error span-two" role="alert">{{ error }}</p>
        <div class="dialog-actions span-two">
          <button
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="modal = null"
          >
            取消</button
          ><button class="workspace-button primary" type="submit" :disabled="busy">
            <LoaderCircle v-if="busy" class="spinning" :size="15" />创建并打开
          </button>
        </div>
      </form></LibraryDialog
    >
    <LibraryDialog
      v-if="modal === 'collection'"
      title="新建棋谱集"
      :busy="busy"
      @close="modal = null"
      ><form class="lib-form single" @submit.prevent="createCollection">
        <label
          >名称<input
            v-model="collectionName"
            required
            maxlength="80"
            autofocus
        /></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="modal = null"
          >
            取消</button
          ><button class="workspace-button primary" type="submit" :disabled="busy">
            <FolderPlus :size="15" />创建
          </button>
        </div>
      </form></LibraryDialog
    >
    <LibraryDialog
      v-if="modal === 'import'"
      title="导入 SGF"
      wide
      :busy="busy"
      @close="modal = null"
      ><div class="import-dialog-content">
        <div v-if="!results.length && !busy" class="import-options">
          <strong>{{ importFiles.length }} 个文件</strong
          ><label
            >重复棋谱<select v-model="duplicateMode">
              <option value="skip">跳过重复</option>
              <option value="copy">另存副本</option>
            </select></label
          ><label
            >棋谱集<select v-model="importCollection">
              <option value="">不指定</option>
              <option
                v-for="collection in library.data.collections"
                :key="collection.id"
                :value="collection.id"
              >
                {{ collection.name }}
              </option>
            </select></label
          >
        </div>
        <div v-if="busy" class="import-progress" role="status">
          <div>
            <LoaderCircle class="spinning" :size="16" />{{ importingName
            }}<span>{{ completed }} / {{ total }}</span>
          </div>
          <progress :value="completed" :max="total" />
        </div>
        <div v-if="results.length" class="import-summary">
          <span class="success">成功 {{ importSummary.imported }}</span
          ><span>重复 {{ importSummary.duplicate }}</span
          ><span :class="{ danger: importSummary.error }"
            >失败 {{ importSummary.error }}</span
          >
        </div>
        <ul class="import-result-list">
          <li
            v-for="(result, index) in results.length
              ? results
              : importFiles.map((file) => ({
                  name: file.name,
                  status: 'waiting',
                  message: '等待导入',
                }))"
            :key="index"
          >
            <FileUp :size="15" />
            <div>
              <strong>{{ result.name }}</strong
              ><span :class="result.status">{{ result.message }}</span>
            </div>
            <Check
              v-if="result.status === 'imported'"
              :size="15"
              class="success"
            /><X v-if="result.status === 'error'" :size="15" class="danger" />
          </li>
        </ul>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button
            v-if="results.some((result) => result.status === 'error')"
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="fileInput?.click()"
          >
            重新选择文件</button
          ><button
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="modal = null"
          >
            {{ results.length ? '完成' : '取消' }}</button
          ><button
            v-if="!results.length"
            class="workspace-button primary"
            type="button"
            :disabled="busy || !importFiles.length"
            @click="startImport"
          >
            <FileUp :size="15" />开始导入
          </button>
        </div>
      </div></LibraryDialog
    >
    <LibraryDialog
      v-if="modal === 'delete'"
      :title="isTrash ? '永久删除棋谱' : '移入回收站'"
      :busy="busy"
      @close="modal = null"
      ><div class="confirmation-content">
        <p>
          {{
            isTrash
              ? `永久删除这 ${deleteIds.length} 局棋谱？此操作无法撤销。`
              : `将这 ${deleteIds.length} 局棋谱移入回收站？之后可以恢复。`
          }}
        </p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="modal = null"
          >
            取消</button
          ><button
            class="workspace-button danger-action"
            type="button"
            :disabled="busy"
            @click="confirmDelete"
          >
            <Trash2 :size="15" />{{ isTrash ? '永久删除' : '移入回收站' }}
          </button>
        </div>
      </div></LibraryDialog
    >
    <LibraryDialog
      v-if="modal === 'batch'"
      :title="`整理 ${library.selectedIds.length} 局棋谱`"
      :busy="busy"
      @close="modal = null"
      ><form class="lib-form single" @submit.prevent="applyBatch">
        <label
          >添加标签<input
            v-model="batchTag"
            maxlength="40"
            placeholder="不修改" /></label
        ><label
          >加入棋谱集<select v-model="batchCollection">
            <option value="">不修改</option>
            <option
              v-for="collection in library.data.collections"
              :key="collection.id"
              :value="collection.id"
            >
              {{ collection.name }}
            </option>
          </select></label
        ><label
          >复盘状态<select v-model="batchState">
            <option value="">不修改</option>
            <option
              v-for="(label, key) in REVIEW_LABELS"
              :key="key"
              :value="key"
            >
              {{ label }}
            </option>
          </select></label
        >
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="modal = null"
          >
            取消</button
          ><button class="workspace-button primary" type="submit" :disabled="busy">
            保存
          </button>
        </div>
      </form></LibraryDialog
    >
    <LibraryDialog
      v-if="modal === 'restore-backup'"
      title="恢复棋谱库备份"
      :busy="busy"
      @close="modal = null"
      ><div class="confirmation-content">
        <p>
          将 {{ pendingBackup?.name }} 合并到当前棋谱库，保留已有棋谱与棋谱集。
        </p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div class="dialog-actions">
          <button
            class="workspace-button"
            type="button"
            :disabled="busy"
            @click="modal = null"
          >
            取消</button
          ><button
            class="workspace-button primary"
            type="button"
            :disabled="busy"
            @click="restoreBackup"
          >
            恢复备份
          </button>
        </div>
      </div></LibraryDialog
    >
    <LibraryDialog v-if="modal === 'switch-research'" title="当前研究尚未保存" :busy="busy" @close="modal = null"><div class="confirmation-content"><p>打开另一份棋谱前，是否保存当前研究？</p><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="dialog-actions"><button class="workspace-button" type="button" :disabled="busy" @click="modal = null">取消</button><button class="workspace-button" type="button" :disabled="busy" @click="continueOpen(false)">放弃并打开</button><button class="workspace-button primary" type="button" :disabled="busy" @click="continueOpen(true)">保存并打开</button></div></div></LibraryDialog>
    <LibraryDialog v-if="modal === 'manage-collection' && managedCollection" title="管理棋谱集" :busy="busy" @close="modal = null"><form class="lib-form single" @submit.prevent="renameCollection"><label>名称<input v-model="managedCollection.name" required maxlength="80" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="dialog-actions"><button class="workspace-button" type="button" :disabled="busy" @click="removeCollection">移除棋谱集</button><button class="workspace-button" type="button" :disabled="busy" @click="modal = null">取消</button><button class="workspace-button primary" type="submit" :disabled="busy">保存</button></div></form></LibraryDialog>
  </main>
</template>

<style scoped>
.library-workspace {
  background-color: var(--shell);
  background-image: linear-gradient(rgba(243, 242, 241, 0.22), rgba(243, 242, 241, 0.22)), url('/home-background.png');
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  background-attachment: fixed;
}
</style>
<style src="../components/library/library.css"></style>
