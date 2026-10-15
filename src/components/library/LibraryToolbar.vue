<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, Download, LayoutGrid, List, Search, Tag, Trash2, Undo2, X } from 'lucide-vue-next'
import { REVIEW_LABELS, SOURCE_LABELS } from '../../types/library'
import { filterChips, type FilterKey, type LibraryFilters } from './workspace'
import SetupDropdown, { type SetupDropdownOption } from '../ui/SetupDropdown.vue'
import DatePicker from '../ui/DatePicker.vue'

const props = defineProps<{
  query: string; filters: LibraryFilters
  sort: string; ascending: boolean; view: 'list' | 'grid'
  selectionCount: number; busy: boolean; trash: boolean
  selectableCount: number; allSelected: boolean; partiallySelected: boolean
}>()
const emit = defineEmits<{
  'update:query': [value: string]; 'update:sort': [value: string]; 'update:view': [value: 'list' | 'grid']
  filter: [key: FilterKey, value: string]; toggleDirection: []
  clear: []; cancel: []; organize: []; download: []; remove: []; restore: []; toggleAll: []
}>()
const chips = computed(() => filterChips(props.filters))
const sorting = [
  { value: 'updatedAt', label: '最近更新' }, { value: 'date', label: '对局日期' },
  { value: 'title', label: '棋谱名称' }, { value: 'players', label: '对局双方' },
  { value: 'result', label: '对局结果' }, { value: 'reviewState', label: '复盘状态' },
]
const sortOptions: SetupDropdownOption[] = sorting
const sizeOptions: SetupDropdownOption[] = [
  { value: '', label: '全部尺寸' }, { value: '19', label: '19 路' },
  { value: '13', label: '13 路' }, { value: '9', label: '9 路' },
]
const sourceOptions: SetupDropdownOption[] = [
  { value: '', label: '全部来源' },
  ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
]
const reviewOptions: SetupDropdownOption[] = [
  { value: '', label: '全部状态' },
  ...Object.entries(REVIEW_LABELS).map(([value, label]) => ({ value, label })),
]
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
          <div class="sort-control">
            <SetupDropdown class="sort-dropdown" :model-value="sort" :options="sortOptions" ariaLabel="棋谱排序" @update:model-value="emit('update:sort', $event)" />
            <button class="workspace-icon" type="button" :title="ascending ? '升序排列' : '降序排列'" :aria-label="ascending ? '切换为降序排列' : '切换为升序排列'" @click="emit('toggleDirection')"><component :is="ascending ? ArrowUp : ArrowDown" :size="16" /></button>
          </div>
          <div class="view-switch" role="group" aria-label="棋谱视图">
            <button class="workspace-icon" :class="{ selected: view === 'list' }" :aria-pressed="view === 'list'" type="button" title="列表视图" aria-label="列表视图" @click="emit('update:view', 'list')"><List :size="17" /></button>
            <button class="workspace-icon" :class="{ selected: view === 'grid' }" :aria-pressed="view === 'grid'" type="button" title="棋盘视图" aria-label="棋盘视图" @click="emit('update:view', 'grid')"><LayoutGrid :size="17" /></button>
          </div>
        </div>
      </template>
    </div>
    <div id="library-filter-panel" class="library-filter-panel">
      <label v-if="view === 'grid'" class="workspace-button select-all-control">
        <input type="checkbox" :checked="allSelected" :indeterminate="partiallySelected" :disabled="busy || !selectableCount" @change="emit('toggleAll')" />
        <span>全选</span>
      </label>
      <div class="filter-field"><SetupDropdown :model-value="filters.sizeFilter" :options="sizeOptions" ariaLabel="棋盘尺寸" @update:model-value="emit('filter', 'sizeFilter', $event)" /></div>
      <div class="filter-field"><SetupDropdown :model-value="filters.sourceFilter" :options="sourceOptions" ariaLabel="棋谱来源" @update:model-value="emit('filter', 'sourceFilter', $event)" /></div>
      <div class="filter-field"><SetupDropdown :model-value="filters.reviewFilter" :options="reviewOptions" ariaLabel="筛选复盘状态" @update:model-value="emit('filter', 'reviewFilter', $event)" /></div>
      <div class="filter-field"><DatePicker :model-value="filters.fromDate" ariaLabel="起始日期" :max="filters.toDate || undefined" @update:model-value="emit('filter', 'fromDate', $event)" /></div>
      <div class="filter-field"><DatePicker :model-value="filters.toDate" ariaLabel="截止日期" :min="filters.fromDate || undefined" @update:model-value="emit('filter', 'toDate', $event)" /></div>
    </div>
    <div v-if="chips.length > 0 || query.trim().length > 0" class="active-filters" aria-label="已生效的筛选条件">
      <span v-if="chips.length || query.trim()" class="filter-caption">当前条件</span>
      <button v-if="query.trim()" class="filter-chip" type="button" :title="query" aria-label="移除搜索条件" @click="emit('update:query', '')"><Search :size="12" /><span>{{ query.trim() }}</span><X :size="12" /></button>
      <button v-for="chip in chips" :key="chip.key" class="filter-chip" type="button" :aria-label="`移除筛选 ${chip.label}`" @click="emit('filter', chip.key, '')"><span>{{ chip.label }}</span><X :size="12" /></button>
      <button v-if="chips.length || query.trim()" class="text-command" type="button" @click="emit('clear')">清空条件</button>
    </div>
  </div>
</template>

<style scoped>
.library-tools { flex: 0 0 auto; border-bottom: 1px solid var(--border); }
.library-command-row { display: flex; height: 64px; min-height: 64px; align-items: center; gap: 12px; padding: 12px 20px; }
.library-search { display: flex; flex: 1; min-width: 120px; height: 36px; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); background: rgba(255, 255, 255, .72); }
.library-search:focus-within { border-color: var(--accent); outline: 1px solid var(--accent); }
.library-search input { width: 100%; min-width: 0; height: 100%; border: 0; outline: 0; padding: 0; font-size: 12px; color: var(--text); background: transparent; }
.library-search input::-webkit-search-cancel-button { display: none; }
.library-search > svg { flex-shrink: 0; }
.select-all-control { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 0 10px; color: var(--text); font-size: 12px; cursor: pointer; }
.select-all-control input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
.select-all-control:has(input:disabled) { cursor: not-allowed; opacity: .5; }
.library-command-options, .sort-control, .batch-commands { display: flex; min-width: 0; align-items: center; gap: 8px; }
.sort-control { gap: 2px; }
.sort-dropdown { width: 156px; flex: 0 0 156px; }
.sort-dropdown :deep(.setup-dropdown-trigger) { min-height: 36px; padding: 4px 8px; }
.sort-dropdown :deep(.setup-dropdown-copy strong) { font-size: 12px; font-weight: 500; }
.view-switch { display: flex; height: 36px; flex: 0 0 auto; align-items: stretch; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: 6px; background: rgba(237, 235, 233, .72); }
.view-switch .workspace-icon { width: 36px; height: auto; flex: 0 0 36px; border-color: transparent; border-radius: 4px; }
.view-switch .workspace-icon:hover:not(.selected) { border-color: rgba(255, 255, 255, .6); color: var(--text); background: rgba(255, 255, 255, .62); }
.view-switch .workspace-icon.selected { border-color: rgba(var(--accent-rgb), .16); color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); }
.view-switch .workspace-icon:active { transform: scale(.97); }
.library-filter-panel { display: flex; min-width: 0; align-items: center; gap: 10px; overflow-x: auto; padding: 12px 20px; }
.library-filter-panel .filter-field { display: flex; flex: 0 0 150px; min-width: 130px; align-items: center; }
.library-filter-panel :deep(.setup-dropdown), .library-filter-panel :deep(.date-picker) { width: 100%; min-width: 0; }
.library-filter-panel :deep(.setup-dropdown-trigger), .library-filter-panel :deep(.date-picker-trigger) { width: 100%; min-width: 100px; height: 36px; min-height: 36px; padding: 0 8px; font-size: 12px; }
.active-filters { display: flex; height: 40px; align-items: center; gap: 6px; overflow-x: auto; overflow-y: hidden; padding: 0 20px 12px; }
.active-filters > * { flex-shrink: 0; }
.filter-caption { margin-right: 4px; font-size: 11px; color: var(--muted); }
.filter-chip { display: flex; max-width: 100%; min-height: 28px; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: rgba(255, 255, 255, .7); color: var(--text); font-size: 11px; }
.filter-chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-chip svg { flex-shrink: 0; }
.filter-chip:hover { border-color: var(--accent); color: var(--accent-strong); }
.is-selecting { background: var(--accent-06); }
.selection-count { flex: 1; min-width: 100px; font-size: 13px; font-weight: 600; color: var(--accent-strong); }
@container library-content (max-width: 680px) {
  .library-command-row { height: 108px; flex-direction: column; align-items: stretch; justify-content: center; gap: 8px; }
  .library-command-row.is-selecting { display: grid; grid-template-columns: 32px minmax(0, 1fr); grid-template-rows: 32px 36px; flex-wrap: nowrap; }
  .library-command-row.is-selecting .batch-commands { grid-column: 1 / -1; }
  .library-search { width: 100%; flex: 0 0 36px; }
  .library-command-row.is-selecting > .selection-count { flex: 0 0 auto; }
  .library-command-options, .batch-commands { width: 100%; flex: 0 0 36px; }
  .sort-control { margin-left: auto; }
}
@container library-content (max-width: 460px) {
  .library-command-row { padding: 10px 12px; }
  .library-filter-panel { padding-inline: 12px; }
  .library-filter-panel .filter-field { flex-basis: 150px; }
  .active-filters { padding-inline: 12px; }
  .filter-caption { display: none; }
  .is-selecting { flex-wrap: wrap; gap: 6px; }
  .batch-commands { width: 100%; padding-left: 4px; }
}
@media (pointer: coarse) { .library-search { height: 42px; } .library-search input { font-size: 16px; } }
</style>
