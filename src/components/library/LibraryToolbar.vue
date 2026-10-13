<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, Download, LayoutGrid, List, Search, SlidersHorizontal, Tag, Trash2, Undo2, X } from 'lucide-vue-next'
import { REVIEW_LABELS, SOURCE_LABELS } from '../../types/library'
import { filterChips, type FilterKey, type LibraryFilters } from './workspace'

const props = defineProps<{
  query: string; filters: LibraryFilters; filtersVisible: boolean
  sort: string; ascending: boolean; view: 'list' | 'grid'
  selectionCount: number; busy: boolean; trash: boolean
}>()
const emit = defineEmits<{
  'update:query': [value: string]; 'update:sort': [value: string]; 'update:view': [value: 'list' | 'grid']
  filter: [key: FilterKey, value: string]; toggleFilters: []; toggleDirection: []
  clear: []; cancel: []; organize: []; download: []; remove: []; restore: []
}>()
const chips = computed(() => filterChips(props.filters))
const sorting = [
  { value: 'updatedAt', label: '最近更新' }, { value: 'date', label: '对局日期' },
  { value: 'title', label: '棋谱名称' }, { value: 'players', label: '对局双方' },
  { value: 'result', label: '对局结果' }, { value: 'reviewState', label: '复盘状态' },
]
function changeFilter(key: FilterKey, event: Event) {
  emit('filter', key, (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="library-tools">
    <div class="library-command-row" :class="{ 'is-selecting': selectionCount }">
      <template v-if="selectionCount">
        <button class="workspace-icon" type="button" title="取消选择" aria-label="取消选择" @click="emit('cancel')"><X :size="17" /></button>
        <strong class="selection-count">已选择 {{ selectionCount }} 局</strong>
        <div class="batch-commands">
          <button v-if="!trash" class="workspace-button" type="button" :disabled="busy" @click="emit('organize')"><Tag :size="15" />整理</button>
          <button class="workspace-button" type="button" :disabled="busy" @click="emit('download')"><Download :size="15" />导出</button>
          <button v-if="trash" class="workspace-button" type="button" :disabled="busy" @click="emit('restore')"><Undo2 :size="15" />恢复</button>
          <button class="workspace-button danger" type="button" :disabled="busy" @click="emit('remove')"><Trash2 :size="15" />{{ trash ? '永久删除' : '删除' }}</button>
        </div>
      </template>
      <template v-else>
        <label class="library-search">
          <Search :size="16" aria-hidden="true" /><span class="visually-hidden">搜索棋谱</span>
          <input :value="query" type="search" placeholder="搜索棋谱、棋手、赛事或标签" @input="emit('update:query', ($event.target as HTMLInputElement).value)" />
          <button v-if="query" class="workspace-icon" type="button" title="清空搜索" aria-label="清空搜索" @click="emit('update:query', '')"><X :size="14" /></button>
        </label>
        <div class="library-command-options">
          <button class="workspace-button filter-toggle" :class="{ active: filtersVisible || chips.length }" type="button" :aria-expanded="filtersVisible" aria-controls="library-filter-panel" @click="emit('toggleFilters')"><SlidersHorizontal :size="15" />筛选<span v-if="chips.length" class="filter-count">{{ chips.length }}</span></button>
          <div class="sort-control">
            <select :value="sort" aria-label="棋谱排序" @change="emit('update:sort', ($event.target as HTMLSelectElement).value)"><option v-for="item in sorting" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <button class="workspace-icon" type="button" :title="ascending ? '升序排列' : '降序排列'" :aria-label="ascending ? '切换为降序排列' : '切换为升序排列'" @click="emit('toggleDirection')"><component :is="ascending ? ArrowUp : ArrowDown" :size="16" /></button>
          </div>
          <div class="view-switch" role="group" aria-label="棋谱视图">
            <button class="workspace-icon" :class="{ selected: view === 'list' }" :aria-pressed="view === 'list'" type="button" title="列表视图" aria-label="列表视图" @click="emit('update:view', 'list')"><List :size="17" /></button>
            <button class="workspace-icon" :class="{ selected: view === 'grid' }" :aria-pressed="view === 'grid'" type="button" title="棋盘视图" aria-label="棋盘视图" @click="emit('update:view', 'grid')"><LayoutGrid :size="17" /></button>
          </div>
        </div>
      </template>
    </div>
    <div v-if="!selectionCount && filtersVisible" id="library-filter-panel" class="library-filter-panel">
      <label>棋盘尺寸<select :value="filters.sizeFilter" aria-label="棋盘尺寸" @change="changeFilter('sizeFilter', $event)"><option value="">全部尺寸</option><option value="19">19 路</option><option value="13">13 路</option><option value="9">9 路</option></select></label>
      <label>棋谱来源<select :value="filters.sourceFilter" aria-label="棋谱来源" @change="changeFilter('sourceFilter', $event)"><option value="">全部来源</option><option v-for="(label, key) in SOURCE_LABELS" :key="key" :value="key">{{ label }}</option></select></label>
      <label>复盘状态<select :value="filters.reviewFilter" aria-label="筛选复盘状态" @change="changeFilter('reviewFilter', $event)"><option value="">全部状态</option><option v-for="(label, key) in REVIEW_LABELS" :key="key" :value="key">{{ label }}</option></select></label>
      <label>起始日期<input :value="filters.fromDate" type="date" :max="filters.toDate || undefined" @change="changeFilter('fromDate', $event)" /></label>
      <label>截止日期<input :value="filters.toDate" type="date" :min="filters.fromDate || undefined" @change="changeFilter('toDate', $event)" /></label>
    </div>
    <div v-if="!selectionCount && (chips.length || query.trim())" class="active-filters" aria-label="已生效的筛选条件">
      <span class="filter-caption">当前条件</span>
      <button v-if="query.trim()" class="filter-chip" type="button" :title="query" aria-label="移除搜索条件" @click="emit('update:query', '')"><Search :size="12" /><span>{{ query.trim() }}</span><X :size="12" /></button>
      <button v-for="chip in chips" :key="chip.key" class="filter-chip" type="button" :aria-label="`移除筛选 ${chip.label}`" @click="emit('filter', chip.key, '')"><span>{{ chip.label }}</span><X :size="12" /></button>
      <button class="text-command" type="button" @click="emit('clear')">清空条件</button>
    </div>
  </div>
</template>

<style scoped>
.library-tools { flex: 0 0 auto; border-bottom: 1px solid var(--border); }
.library-command-row { display: flex; min-height: 64px; align-items: center; gap: 12px; padding: 12px 20px; }
.library-search { display: flex; flex: 1; min-width: 120px; height: 36px; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); background: rgba(255, 255, 255, .72); }
.library-search:focus-within { border-color: var(--accent); outline: 1px solid var(--accent); }
.library-search input { width: 100%; min-width: 0; height: 100%; border: 0; outline: 0; padding: 0; font-size: 12px; color: var(--text); background: transparent; }
.library-search input::-webkit-search-cancel-button { display: none; }
.library-search > svg { flex-shrink: 0; }
.library-command-options, .sort-control, .batch-commands { display: flex; min-width: 0; align-items: center; gap: 8px; }
.sort-control { gap: 2px; }
.sort-control select { width: 106px; height: 34px; padding: 0 7px; font-size: 12px; }
.view-switch { display: flex; flex: 0 0 auto; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 5px; background: rgba(255, 255, 255, .3); }
.view-switch .workspace-icon { width: 28px; height: 28px; flex-basis: 28px; }
.filter-toggle.active { color: var(--accent-strong); border-color: var(--accent); background: var(--accent-soft); }
.filter-count { font-size: 11px; font-variant-numeric: tabular-nums; }
.library-filter-panel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; max-height: 220px; overflow-y: auto; padding: 0 20px 16px; }
.library-filter-panel label { display: grid; min-width: 0; gap: 6px; font-size: 11px; color: var(--muted); }
.library-filter-panel select, .library-filter-panel input { width: 100%; height: 34px; padding: 0 8px; font-size: 12px; }
.active-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; max-height: 100px; overflow-y: auto; padding: 0 20px 12px; }
.filter-caption { margin-right: 4px; font-size: 11px; color: var(--muted); }
.filter-chip { display: flex; max-width: 100%; min-height: 28px; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: rgba(255, 255, 255, .7); color: var(--text); font-size: 11px; }
.filter-chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-chip svg { flex-shrink: 0; }
.filter-chip:hover { border-color: var(--accent); color: var(--accent-strong); }
.is-selecting { background: var(--accent-06); }
.selection-count { flex: 1; min-width: 100px; font-size: 13px; font-weight: 600; color: var(--accent-strong); }
@container library-content (max-width: 680px) {
  .library-command-row:not(.is-selecting) { flex-wrap: wrap; gap: 8px; }
  .library-search { flex-basis: 100%; }
  .library-command-options { width: 100%; }
  .sort-control { margin-left: auto; }
}
@container library-content (max-width: 460px) {
  .library-command-row { padding: 10px 12px; }
  .library-filter-panel { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-inline: 12px; }
  .active-filters { padding-inline: 12px; }
  .filter-caption { display: none; }
  .is-selecting { flex-wrap: wrap; gap: 6px; }
  .batch-commands { width: 100%; padding-left: 4px; }
}
@media (pointer: coarse) { .library-search { height: 42px; } .library-search input { font-size: 16px; } }
</style>
