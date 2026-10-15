<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Download, FileText, Save, Tag, Star, Trash2, Undo2 } from 'lucide-vue-next'
import RecordBoard from './RecordBoard.vue'
import { previewPositions, readSgf } from '../../domain/sgf'
import { REVIEW_LABELS, type LibraryRecord } from '../../types/library'
import { LIBRARY_PAGE_SIZE } from './workspace'

const props = defineProps<{
  records: LibraryRecord[]; selectedId: string | null; selectedIds: string[]
  view: 'list' | 'grid'; sort: string; ascending: boolean; page: number
  scrollTop?: number; busy?: boolean; savingIds?: string[]; trash?: boolean
}>()
const emit = defineEmits<{
  select: [id: string]; open: [id: string]; toggle: [id: string]; toggleAll: []
  favorite: [record: LibraryRecord]; organize: [id: string]; save: [id: string]; download: [id: string]; remove: [id: string]; restore: [id: string]; sort: [key: string]; page: [page: number]; scroll: [top: number]
}>()
const scrollHost = ref<HTMLElement | null>(null)
const contextMenu = ref<{ id: string; history: boolean; x: number; y: number } | null>(null)
const contextMenuElement = ref<HTMLElement | null>(null)
const rows = computed(() => props.records.slice(0, Math.min(props.records.length, props.page * LIBRARY_PAGE_SIZE)))
const selectedSet = computed(() => new Set(props.selectedIds))
const savingSet = computed(() => new Set(props.savingIds))
function favorite(record: LibraryRecord) {
  if (!savingSet.value.has(record.id)) emit('favorite', record)
}
const selectedCount = computed(() => props.records.filter(record => selectedSet.value.has(record.id)).length)
const allSelected = computed(() => props.records.length > 0 && selectedCount.value === props.records.length)
const thumbnails = computed(() => new Map(props.view === 'grid' ? rows.value.map(record => {
  try {
    const positions = previewPositions(readSgf(record.sgf)[0], record.lastNodePath)
    return [record.id, positions[positions.length - 1]] as const
  } catch { return [record.id, null] as const }
}) : []))
const columns = [
  { key: 'title', label: '棋谱名称' }, { key: 'players', label: '对局双方' },
  { key: 'result', label: '结果' }, { key: 'date', label: '对局日期' }, { key: 'reviewState', label: '复盘状态' },
]
function loadMoreIfNeeded() {
  const host = scrollHost.value
  if (host && host.scrollHeight - host.clientHeight - host.scrollTop < 320 && rows.value.length < props.records.length)
    emit('page', props.page + 1)
}
function onListScroll(event: Event) {
  const host = event.target as HTMLElement
  emit('scroll', host.scrollTop)
  loadMoreIfNeeded()
}
onMounted(async () => { await nextTick(); if (scrollHost.value) scrollHost.value.scrollTop = props.scrollTop ?? 0; loadMoreIfNeeded() })
watch(() => props.scrollTop, value => { if (scrollHost.value && value !== undefined) scrollHost.value.scrollTop = value })
watch(() => [props.view, props.sort, props.ascending], async () => {
  await nextTick()
  if (scrollHost.value) scrollHost.value.scrollTop = 0
  emit('scroll', 0)
})
watch(() => rows.value.length, async () => { await nextTick(); loadMoreIfNeeded() })
function navigate(event: KeyboardEvent, index: number) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? rows.value.length - 1
    : Math.max(0, Math.min(rows.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  scrollHost.value?.querySelectorAll<HTMLElement>('[data-record-focus]')[target]?.focus()
}
async function openContextMenu(event: MouseEvent, record: LibraryRecord) {
  event.preventDefault()
  if (props.busy) return
  contextMenu.value = {
    id: record.id,
    history: record.source === 'history',
    x: event.clientX,
    y: event.clientY,
  }
  await nextTick()
  const rect = contextMenuElement.value?.getBoundingClientRect()
  if (rect && contextMenu.value) {
    if (rect.right > window.innerWidth) contextMenu.value.x = Math.max(0, contextMenu.value.x - rect.width)
    if (rect.bottom > window.innerHeight) contextMenu.value.y = Math.max(0, contextMenu.value.y - rect.height)
  }
  await nextTick()
  contextMenuElement.value?.focus()
}
function runContextAction(action: 'organize' | 'save' | 'download' | 'remove' | 'restore') {
  const id = contextMenu.value?.id
  contextMenu.value = null
  if (!id) return
  if (action === 'organize') emit('organize', id)
  else if (action === 'save') emit('save', id)
  else if (action === 'download') emit('download', id)
  else if (action === 'restore') emit('restore', id)
  else emit('remove', id)
}
</script>

<template>
  <div ref="scrollHost" class="record-list-body" @scroll="onListScroll">
    <table v-if="view === 'list'" class="records-table" aria-label="棋谱列表">
      <thead><tr>
        <th class="check-column" scope="col"><input type="checkbox" aria-label="选择全部筛选结果" :checked="allSelected" :indeterminate="selectedCount > 0 && !allSelected" :disabled="busy" @change="emit('toggleAll')" /></th>
        <th v-for="column in columns" :key="column.key" :class="`column-${column.key}`" scope="col" :aria-sort="sort === column.key ? (ascending ? 'ascending' : 'descending') : 'none'">
          <button type="button" @click="emit('sort', column.key)">{{ column.label }}<component v-if="sort === column.key" :is="ascending ? ArrowUp : ArrowDown" :size="12" /></button>
        </th>
        <th class="star-column" scope="col"><span class="visually-hidden">收藏</span><Star :size="14" aria-hidden="true" /></th>
      </tr></thead>
      <tbody><tr v-for="(record, index) in rows" :key="record.id" :class="{ active: selectedId === record.id, checked: selectedSet.has(record.id) }" @click="emit('select', record.id)" @dblclick="!trash && !busy && emit('open', record.id)">
        <td class="check-column" @click.stop @dblclick.stop><input type="checkbox" :aria-label="`选择 ${record.title}`" :checked="selectedSet.has(record.id)" :disabled="busy" @change="emit('toggle', record.id)" /></td>
        <td class="column-title">
          <button class="record-title-button" data-record-focus type="button" :aria-label="`预览 ${record.title}`" :aria-pressed="selectedId === record.id" @click.stop="emit('select', record.id)" @keydown="navigate($event, index)" @keydown.enter.prevent="!trash && !busy && emit('open', record.id)">
            <FileText :size="18" aria-hidden="true" /><span class="record-name"><strong :title="record.title">{{ record.title }}</strong><small :title="record.event">{{ record.boardSize }} 路 · {{ record.moves }} 手<span v-if="record.event"> · {{ record.event }}</span></small><small class="compact-game-info">{{ record.date || '未注明日期' }} · {{ record.result || '未注明结果' }}</small></span>
          </button>
        </td>
        <td class="column-players"><div class="player-line"><i class="stone-dot black" aria-label="黑方" /><span :title="record.black">{{ record.black || '未注明' }}</span></div><div class="player-line"><i class="stone-dot white" aria-label="白方" /><span :title="record.white">{{ record.white || '未注明' }}</span></div></td>
        <td class="column-result"><span class="result-text" :title="record.result">{{ record.result || '-' }}</span></td>
        <td class="column-date">{{ record.date || '-' }}</td>
        <td class="column-reviewState"><span class="review-state" :class="record.reviewState"><i />{{ REVIEW_LABELS[record.reviewState] }}</span></td>
        <td class="star-column" @click.stop @dblclick.stop><button class="workspace-icon favorite-button" :class="{ marked: record.favorite }" type="button" :title="record.favorite ? '取消收藏' : '收藏'" :aria-label="`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`" :aria-pressed="record.favorite" :disabled="busy || trash" :aria-busy="savingSet.has(record.id) || undefined" @click="favorite(record)"><Star :size="15" :fill="record.favorite ? 'currentColor' : 'none'" /></button></td>
      </tr></tbody>
    </table>
    <template v-else>
      <div class="records-grid">
        <article v-for="(record, index) in rows" :key="record.id" class="record-tile" :class="{ active: selectedId === record.id, checked: selectedSet.has(record.id) }" @contextmenu="openContextMenu($event, record)">
          <div class="tile-top"><input type="checkbox" :aria-label="`选择 ${record.title}`" :checked="selectedSet.has(record.id)" :disabled="busy" @change="emit('toggle', record.id)" /><span>{{ record.boardSize }} 路 · {{ record.moves }} 手</span><button class="workspace-icon favorite-button" :class="{ marked: record.favorite }" type="button" :title="record.favorite ? '取消收藏' : '收藏'" :aria-label="`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`" :aria-pressed="record.favorite" :disabled="busy || trash" :aria-busy="savingSet.has(record.id) || undefined" @click="favorite(record)"><Star :size="15" :fill="record.favorite ? 'currentColor' : 'none'" /></button></div>
          <button class="tile-select" data-record-focus type="button" :aria-label="`预览 ${record.title}`" :aria-pressed="selectedId === record.id" @click="emit('select', record.id)" @dblclick="!trash && !busy && emit('open', record.id)" @keydown="navigate($event, index)" @keydown.enter.prevent="!trash && !busy && emit('open', record.id)">
            <div class="tile-board"><RecordBoard v-if="thumbnails.get(record.id)" :position="thumbnails.get(record.id)!" /><div v-else class="thumbnail-error"><FileText :size="24" /><span>预览不可用</span></div></div>
            <strong :title="record.title">{{ record.title }}</strong><span :title="`${record.black} / ${record.white}`">{{ record.black || '黑方' }} / {{ record.white || '白方' }}</span>
          </button>
          <div class="tile-footer"><span>{{ record.date || '未注明日期' }}</span><span class="review-state" :class="record.reviewState"><i />{{ REVIEW_LABELS[record.reviewState] }}</span></div>
        </article>
      </div>
    </template>
  </div>
  <Teleport to="body">
    <div v-if="contextMenu" class="record-context-backdrop" @pointerdown.self="contextMenu = null" @contextmenu.prevent @keydown.esc.stop.prevent="contextMenu = null">
      <div ref="contextMenuElement" class="record-context-menu" role="menu" aria-label="棋谱操作" tabindex="-1" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
        <button v-if="!trash" type="button" role="menuitem" @click="runContextAction('organize')"><Tag :size="15" />整理</button>
        <button v-if="contextMenu.history && !trash" type="button" role="menuitem" @click="runContextAction('save')"><Save :size="15" />保存</button>
        <button type="button" role="menuitem" @click="runContextAction('download')"><Download :size="15" />导出</button>
        <button v-if="trash" type="button" role="menuitem" @click="runContextAction('restore')"><Undo2 :size="15" />恢复</button>
        <button type="button" role="menuitem" class="danger" @click="runContextAction('remove')"><Trash2 :size="15" />{{ trash ? '永久删除' : '删除' }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.record-list-body { min-width: 0; min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
.records-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 12px; }
.records-table th { position: sticky; z-index: 1; top: 0; height: 40px; border-bottom: 1px solid var(--border); background: rgba(250, 249, 248, .95); backdrop-filter: blur(6px); color: var(--muted); font-weight: 400; }
.records-table th button { display: flex; align-items: center; gap: 4px; min-height: 32px; max-width: 100%; padding: 4px 0; border: 0; color: inherit; background: transparent; font-size: 11px; white-space: nowrap; }
.records-table th.column-title button { box-sizing: border-box; width: 100%; padding-left: 42px; }
.records-table td { height: 68px; padding: 10px 10px 10px 0; border-bottom: 1px solid rgba(225, 225, 225, .6); vertical-align: middle; }
.records-table tbody tr { cursor: pointer; transition: background-color 150ms; }
.records-table tbody tr:hover { background: rgba(255, 255, 255, .55); }
.records-table tr.active { background: var(--accent-06); }
.records-table tr.active td:first-child { box-shadow: inset 3px 0 var(--accent); }
.records-table tr.checked { background: var(--accent-10); }
.check-column { width: 42px; text-align: center; }
.records-table td.check-column { padding-right: 0; }
.column-title { width: auto; }
.column-players { width: 22%; }
.column-result { width: 10%; }
.column-date { width: 16%; font-variant-numeric: tabular-nums; }
.column-reviewState { width: 12%; }
.star-column { width: 40px; text-align: center; }
.records-table td.star-column { padding-right: 0; }
.star-column > svg { vertical-align: middle; }
.record-title-button { display: flex; width: 100%; min-width: 0; align-items: center; gap: 10px; padding: 0; border: 0; color: var(--text); background: transparent; text-align: left; }
.record-title-button > svg { flex-shrink: 0; color: var(--muted); }
.record-name { display: grid; min-width: 0; gap: 5px; }
.record-name strong, .record-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record-name strong { font-size: 13px; font-weight: 600; }
.record-name small { color: var(--muted); font-size: 11px; }
.record-name .compact-game-info { display: none; }
.player-line { display: flex; min-width: 0; align-items: center; gap: 6px; margin: 4px 0; }
.player-line span, .result-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-text { display: block; font-variant-numeric: tabular-nums; }
.favorite-button.marked { color: #b07b00; }
.records-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; padding: 16px 20px 24px; align-content: start; }
.record-tile { min-width: 0; padding: 10px; border: 1px solid rgba(225, 225, 225, .9); border-radius: 6px; background: rgba(255, 255, 255, .4); backdrop-filter: blur(6px); transition: border-color 150ms, background-color 150ms; }
.record-tile:hover { border-color: var(--accent); }
.record-tile.active { border-color: var(--accent); background: var(--accent-03); box-shadow: var(--shadow-xs); }
.record-tile.checked { background: var(--accent-10); }
.record-context-backdrop { position: fixed; z-index: 100; inset: 0; }
.record-context-menu { position: fixed; display: grid; width: max-content; min-width: 96px; gap: 2px; padding: 3px; border: 1px solid rgba(255, 255, 255, .52); border-radius: 6px; background: rgba(243, 242, 241, .58); box-shadow: var(--shadow-md); backdrop-filter: blur(16px) saturate(1.35); -webkit-backdrop-filter: blur(16px) saturate(1.35); }
.record-context-menu button { display: flex; min-height: 34px; align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid transparent; border-radius: 4px; color: var(--muted); background: transparent; font-size: 12px; font-weight: 500; text-align: left; white-space: nowrap; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.record-context-menu button:hover { border-color: rgba(255, 255, 255, .6); color: var(--text); background: rgba(255, 255, 255, .62); }
.record-context-menu button:active { transform: scale(.97); }
.record-context-menu button.danger { color: var(--danger); }
.record-context-menu button.danger:hover { color: var(--danger); }
.tile-top { display: flex; align-items: center; gap: 8px; height: 32px; margin-bottom: 8px; color: var(--muted); font-size: 11px; }
.tile-top > span { flex: 1; }
.tile-select { display: grid; width: 100%; min-width: 0; gap: 6px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; }
.tile-board { width: 100%; aspect-ratio: 1; overflow: hidden; }
.thumbnail-error { display: grid; height: 100%; place-content: center; justify-items: center; gap: 8px; border: 1px dashed var(--border); color: var(--muted); font-size: 12px; }
.tile-select strong, .tile-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-select strong { margin-top: 5px; font-size: 13px; }
.tile-select > span { color: var(--muted); font-size: 11px; }
.tile-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 5px; margin-top: 12px; color: var(--muted); font-size: 11px; }
@container library-content (max-width: 680px) {
  .record-title-button > svg { display: none; }
  .column-date { width: 18%; }
  .column-reviewState { width: 15%; }
  .column-players { width: 23%; }
}
@container library-content (max-width: 540px) {
  .column-result, .column-date { display: none; }
  .column-players { width: 25%; }
  .column-reviewState { width: 18%; }
  .check-column { width: 32px; }
  .star-column { width: 32px; }
  .records-table td { padding-right: 6px; }
  .record-name strong { font-size: 12px; }
  .record-name .compact-game-info { display: block; font-size: 10px; }
  .records-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px; }
  .tile-top { gap: 4px; font-size: 10px; }
  .tile-top .workspace-icon { width: 26px; flex-basis: 26px; }
}
</style>
