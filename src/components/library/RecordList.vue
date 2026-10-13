<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileText, Star } from 'lucide-vue-next'
import RecordBoard from './RecordBoard.vue'
import { previewPositions, readSgf } from '../../domain/sgf'
import { REVIEW_LABELS, type LibraryRecord } from '../../types/library'
import { LIBRARY_PAGE_SIZE, pageCount } from './workspace'

const props = defineProps<{
  records: LibraryRecord[]; selectedId: string | null; selectedIds: string[]
  view: 'list' | 'grid'; sort: string; ascending: boolean; page: number
  scrollTop?: number; busy?: boolean; trash?: boolean
}>()
const emit = defineEmits<{
  select: [id: string]; open: [id: string]; toggle: [id: string]; toggleAll: []
  favorite: [record: LibraryRecord]; sort: [key: string]; page: [page: number]; scroll: [top: number]
}>()
const scrollHost = ref<HTMLElement | null>(null)
const pages = computed(() => pageCount(props.records.length))
const currentPage = computed(() => Math.max(1, Math.min(props.page, pages.value)))
const start = computed(() => (currentPage.value - 1) * LIBRARY_PAGE_SIZE)
const rows = computed(() => props.records.slice(start.value, start.value + LIBRARY_PAGE_SIZE))
const selectedSet = computed(() => new Set(props.selectedIds))
const selectedCount = computed(() => props.records.filter(record => selectedSet.value.has(record.id)).length)
const allSelected = computed(() => props.records.length > 0 && selectedCount.value === props.records.length)
const thumbnails = computed(() => new Map(props.view === 'grid' ? rows.value.map(record => {
  try {
    const positions = previewPositions(readSgf(record.sgf)[0])
    return [record.id, positions[positions.length - 1]] as const
  } catch { return [record.id, null] as const }
}) : []))
const columns = [
  { key: 'title', label: '棋谱名称' }, { key: 'players', label: '对局双方' },
  { key: 'result', label: '结果' }, { key: 'date', label: '对局日期' }, { key: 'reviewState', label: '复盘状态' },
]
onMounted(async () => { await nextTick(); if (scrollHost.value) scrollHost.value.scrollTop = props.scrollTop ?? 0 })
watch(() => props.scrollTop, value => { if (scrollHost.value && value !== undefined) scrollHost.value.scrollTop = value })
watch(() => [props.page, props.view, props.sort, props.ascending], async () => {
  await nextTick()
  if (scrollHost.value) scrollHost.value.scrollTop = 0
  emit('scroll', 0)
})
function navigate(event: KeyboardEvent, index: number) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? rows.value.length - 1
    : Math.max(0, Math.min(rows.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  scrollHost.value?.querySelectorAll<HTMLElement>('[data-record-focus]')[target]?.focus()
}
</script>

<template>
  <div ref="scrollHost" class="record-list-body" @scroll="emit('scroll', ($event.target as HTMLElement).scrollTop)">
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
        <td class="star-column" @click.stop @dblclick.stop><button class="workspace-icon favorite-button" :class="{ marked: record.favorite }" type="button" :title="record.favorite ? '取消收藏' : '收藏'" :aria-label="`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`" :aria-pressed="record.favorite" :disabled="busy || trash" @click="emit('favorite', record)"><Star :size="15" :fill="record.favorite ? 'currentColor' : 'none'" /></button></td>
      </tr></tbody>
    </table>
    <template v-else>
      <div class="grid-selection"><label><input type="checkbox" :checked="allSelected" :indeterminate="selectedCount > 0 && !allSelected" :disabled="busy" @change="emit('toggleAll')" />选择全部筛选结果</label><span>{{ records.length }} 局棋谱</span></div>
      <div class="records-grid">
        <article v-for="(record, index) in rows" :key="record.id" class="record-tile" :class="{ active: selectedId === record.id, checked: selectedSet.has(record.id) }">
          <div class="tile-top"><input type="checkbox" :aria-label="`选择 ${record.title}`" :checked="selectedSet.has(record.id)" :disabled="busy" @change="emit('toggle', record.id)" /><span>{{ record.boardSize }} 路 · {{ record.moves }} 手</span><button class="workspace-icon favorite-button" :class="{ marked: record.favorite }" type="button" :title="record.favorite ? '取消收藏' : '收藏'" :aria-label="`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`" :aria-pressed="record.favorite" :disabled="busy || trash" @click="emit('favorite', record)"><Star :size="15" :fill="record.favorite ? 'currentColor' : 'none'" /></button></div>
          <button class="tile-select" data-record-focus type="button" :aria-label="`预览 ${record.title}`" :aria-pressed="selectedId === record.id" @click="emit('select', record.id)" @dblclick="!trash && !busy && emit('open', record.id)" @keydown="navigate($event, index)" @keydown.enter.prevent="!trash && !busy && emit('open', record.id)">
            <div class="tile-board"><RecordBoard v-if="thumbnails.get(record.id)" :position="thumbnails.get(record.id)!" /><div v-else class="thumbnail-error"><FileText :size="24" /><span>预览不可用</span></div></div>
            <strong :title="record.title">{{ record.title }}</strong><span :title="`${record.black} / ${record.white}`">{{ record.black || '黑方' }} / {{ record.white || '白方' }}</span>
          </button>
          <div class="tile-footer"><span>{{ record.date || '未注明日期' }}</span><span class="review-state" :class="record.reviewState"><i />{{ REVIEW_LABELS[record.reviewState] }}</span></div>
        </article>
      </div>
    </template>
  </div>
  <footer class="list-pagination">
    <span class="pagination-summary">{{ start + 1 }}-{{ Math.min(start + LIBRARY_PAGE_SIZE, records.length) }} / {{ records.length }} 局<span v-if="selectedCount" class="footer-selected"> · 已选 {{ selectedCount }}</span></span>
    <div class="page-controls"><button class="workspace-icon" type="button" title="上一页" aria-label="上一页" :disabled="currentPage <= 1" @click="emit('page', currentPage - 1)"><ChevronLeft :size="17" /></button><label class="page-number"><span class="visually-hidden">页码</span><input type="number" :value="currentPage" min="1" :max="pages" @change="emit('page', Math.max(1, Math.min(pages, Number(($event.target as HTMLInputElement).value) || 1)))" /><span>/ {{ pages }}</span></label><button class="workspace-icon" type="button" title="下一页" aria-label="下一页" :disabled="currentPage >= pages" @click="emit('page', currentPage + 1)"><ChevronRight :size="17" /></button></div>
  </footer>
</template>

<style scoped>
.record-list-body { min-width: 0; min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
.records-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 12px; }
.records-table th { position: sticky; z-index: 1; top: 0; height: 40px; border-bottom: 1px solid var(--border); background: rgba(250, 249, 248, .95); backdrop-filter: blur(6px); color: var(--muted); font-weight: 400; }
.records-table th button { display: flex; align-items: center; gap: 4px; min-height: 32px; max-width: 100%; padding: 4px 0; border: 0; color: inherit; background: transparent; font-size: 11px; white-space: nowrap; }
.records-table td { height: 68px; padding: 10px 10px 10px 0; border-bottom: 1px solid rgba(225, 225, 225, .6); vertical-align: middle; }
.records-table tbody tr { cursor: pointer; transition: background-color 150ms; }
.records-table tbody tr:hover { background: rgba(255, 255, 255, .55); }
.records-table tr.active { background: var(--accent-06); }
.records-table tr.active td:first-child { box-shadow: inset 3px 0 var(--accent); }
.records-table tr.checked { background: var(--accent-10); }
.check-column { width: 42px; text-align: center; }
.column-title { width: auto; }
.column-players { width: 22%; }
.column-result { width: 10%; }
.column-date { width: 16%; font-variant-numeric: tabular-nums; }
.column-reviewState { width: 12%; }
.star-column { width: 40px; text-align: center; }
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
.grid-selection { display: flex; position: sticky; top: 0; z-index: 1; justify-content: space-between; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--border); color: var(--muted); background: rgba(250, 249, 248, .95); font-size: 11px; }
.grid-selection label { display: flex; align-items: center; gap: 8px; }
.record-tile { min-width: 0; padding: 10px; border: 1px solid rgba(225, 225, 225, .9); border-radius: 6px; background: rgba(255, 255, 255, .4); backdrop-filter: blur(6px); transition: border-color 150ms, background-color 150ms; }
.record-tile:hover { border-color: var(--accent); }
.record-tile.active { border-color: var(--accent); background: var(--accent-03); box-shadow: var(--shadow-xs); }
.record-tile.checked { background: var(--accent-10); }
.tile-top { display: flex; align-items: center; gap: 8px; height: 32px; margin-bottom: 8px; color: var(--muted); font-size: 11px; }
.tile-top > span { flex: 1; }
.tile-select { display: grid; width: 100%; min-width: 0; gap: 6px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; }
.tile-board { width: 100%; aspect-ratio: 1; overflow: hidden; }
.thumbnail-error { display: grid; height: 100%; place-content: center; justify-items: center; gap: 8px; border: 1px dashed var(--border); color: var(--muted); font-size: 12px; }
.tile-select strong, .tile-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-select strong { margin-top: 5px; font-size: 13px; }
.tile-select > span { color: var(--muted); font-size: 11px; }
.tile-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 5px; margin-top: 12px; color: var(--muted); font-size: 11px; }
.list-pagination { display: flex; flex: 0 0 auto; min-height: 48px; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.footer-selected { color: var(--accent-strong); }
.page-controls, .page-number { display: flex; align-items: center; gap: 6px; }
.page-number input { width: 42px; height: 28px; padding: 0 4px; text-align: center; font-size: 11px; appearance: textfield; }
.page-number input::-webkit-inner-spin-button { appearance: none; }
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
  .grid-selection { padding-inline: 12px; }
  .tile-top { gap: 4px; font-size: 10px; }
  .tile-top .workspace-icon { width: 26px; flex-basis: 26px; }
  .list-pagination { padding-inline: 10px; }
  .footer-selected { display: none; }
}
</style>
