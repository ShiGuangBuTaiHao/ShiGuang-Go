<script setup lang="ts">
import { computed, onMounted, ref, nextTick } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  Star,
} from 'lucide-vue-next'
import RecordBoard from './RecordBoard.vue'
import { previewPositions, readSgf } from '../../domain/sgf'
import { REVIEW_LABELS, type LibraryRecord } from '../../types/library'
const props = defineProps<{
  records: LibraryRecord[]
  selectedId: string | null
  selectedIds: string[]
  view: 'list' | 'grid'
  sort: string
  ascending: boolean
  page: number
  scrollTop?: number
}>()
const emit = defineEmits<{
  select: [id: string]
  open: [id: string]
  toggle: [id: string]
  toggleAll: []
  favorite: [record: LibraryRecord]
  sort: [key: string]
  page: [page: number]
  scroll: [top: number]
}>()
const scrollHost = ref<HTMLElement | null>(null)
onMounted(async () => { await nextTick(); if (scrollHost.value) scrollHost.value.scrollTop = props.scrollTop ?? 0 })
const pageSize = 40
const pages = computed(() =>
  Math.max(1, Math.ceil(props.records.length / pageSize)),
)
const rows = computed(() =>
  props.records.slice((props.page - 1) * pageSize, props.page * pageSize),
)
const allSelected = computed(
  () =>
    props.records.length > 0 &&
    props.records.every((record) => props.selectedIds.includes(record.id)),
)
const thumbnails = computed(
  () =>
    new Map(
      props.view === 'grid'
        ? rows.value.map((record) => {
            try {
              const positions = previewPositions(readSgf(record.sgf)[0])
              return [record.id, positions[positions.length - 1]] as const
            } catch {
              return [record.id, null] as const
            }
          })
        : [],
    ),
)
const columns = [
  { key: 'title', label: '棋谱' },
  { key: 'players', label: '对局双方' },
  { key: 'result', label: '结果' },
  { key: 'date', label: '日期' },
  { key: 'reviewState', label: '复盘' },
]
</script>

<template>
  <div ref="scrollHost" class="record-list-body" @scroll="emit('scroll', ($event.target as HTMLElement).scrollTop)">
    <table v-if="view === 'list'" class="records-table">
      <thead>
        <tr>
          <th class="check-column">
            <input
              type="checkbox"
              aria-label="选择全部筛选结果"
              :checked="allSelected"
              :indeterminate="selectedIds.length > 0 && !allSelected"
              @change="emit('toggleAll')"
            />
          </th>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="`column-${column.key}`"
            :aria-sort="
              sort === column.key
                ? ascending
                  ? 'ascending'
                  : 'descending'
                : 'none'
            "
          >
            <button type="button" @click="emit('sort', column.key)">
              {{ column.label
              }}<component
                :is="ascending ? ArrowUp : ArrowDown"
                v-if="sort === column.key"
                :size="12"
              />
            </button>
          </th>
          <th class="star-column"><Star :size="13" aria-label="收藏" /></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="record in rows"
          :key="record.id"
          :class="{
            active: selectedId === record.id,
            checked: selectedIds.includes(record.id),
          }"
          @click="emit('select', record.id)"
          @dblclick="emit('open', record.id)"
        >
          <td class="check-column" @click.stop>
            <input
              type="checkbox"
              :aria-label="`选择 ${record.title}`"
              :checked="selectedIds.includes(record.id)"
              @change="emit('toggle', record.id)"
            />
          </td>
          <td class="column-title">
            <button
              class="record-title-button"
              type="button"
              @click="emit('select', record.id)"
              @keydown.enter.prevent="emit('open', record.id)"
            >
              <FileText :size="17" /><span
                ><strong :title="record.title">{{ record.title }}</strong
                ><small
                  >{{ record.boardSize }} 路<span class="inline-separator" />{{
                    record.moves
                  }}
                  手<span v-if="record.event" class="event-label">
                    / {{ record.event }}</span
                  ></small
                ></span
              >
            </button>
          </td>
          <td class="column-players">
            <div class="player-line">
              <i class="stone-dot black" /><span :title="record.black">{{
                record.black || '未注明'
              }}</span>
            </div>
            <div class="player-line">
              <i class="stone-dot white" /><span :title="record.white">{{
                record.white || '未注明'
              }}</span>
            </div>
          </td>
          <td class="column-result">
            <span class="result-text">{{ record.result || '—' }}</span>
          </td>
          <td class="column-date">{{ record.date || '—' }}</td>
          <td class="column-reviewState">
            <span class="review-state" :class="record.reviewState"
              ><i />{{ REVIEW_LABELS[record.reviewState] }}</span
            >
          </td>
          <td class="star-column" @click.stop>
            <button
              class="lib-icon favorite-button"
              :class="{ marked: record.favorite }"
              type="button"
              :title="record.favorite ? '取消收藏' : '收藏'"
              :aria-label="`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`"
              :aria-pressed="record.favorite"
              @click="emit('favorite', record)"
            >
              <Star
                :size="15"
                :fill="record.favorite ? 'currentColor' : 'none'"
              />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="records-grid">
      <article
        v-for="record in rows"
        :key="record.id"
        class="record-tile"
        :class="{ active: selectedId === record.id }"
      >
        <div class="tile-top">
          <input
            type="checkbox"
            :aria-label="`选择 ${record.title}`"
            :checked="selectedIds.includes(record.id)"
            @change="emit('toggle', record.id)"
          /><span>{{ record.boardSize }} 路 / {{ record.moves }} 手</span
          ><button
            class="lib-icon favorite-button"
            :class="{ marked: record.favorite }"
            type="button"
            :title="record.favorite ? '取消收藏' : '收藏'"
            :aria-label="record.favorite ? '取消收藏' : '收藏'"
            @click="emit('favorite', record)"
          >
            <Star
              :size="15"
              :fill="record.favorite ? 'currentColor' : 'none'"
            />
          </button>
        </div>
        <button
          class="tile-select"
          type="button"
          @click="emit('select', record.id)"
          @dblclick="emit('open', record.id)"
          @keydown.enter.prevent="emit('open', record.id)"
        >
          <RecordBoard
            v-if="thumbnails.get(record.id)"
            :position="thumbnails.get(record.id)!"
          /><strong :title="record.title">{{ record.title }}</strong
          ><span
            >{{ record.black || '黑方' }} / {{ record.white || '白方' }}</span
          >
        </button>
        <div class="tile-footer">
          <span>{{ record.date || '未注明日期' }}</span
          ><span class="review-state" :class="record.reviewState"
            ><i />{{ REVIEW_LABELS[record.reviewState] }}</span
          >
        </div>
      </article>
    </div>
  </div>
  <footer class="list-pagination">
    <span
      >{{
        records.length
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, records.length)}`
          : '0'
      }}
      / {{ records.length }} 局</span
    >
    <div>
      <button
        class="lib-icon"
        type="button"
        title="上一页"
        aria-label="上一页"
        :disabled="page <= 1"
        @click="emit('page', page - 1)"
      >
        <ChevronLeft :size="16" /></button
      ><span>{{ page }} / {{ pages }}</span
      ><button
        class="lib-icon"
        type="button"
        title="下一页"
        aria-label="下一页"
        :disabled="page >= pages"
        @click="emit('page', page + 1)"
      >
        <ChevronRight :size="16" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.record-list-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.records-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}
.records-table th {
  position: sticky;
  z-index: 1;
  top: 0;
  height: 39px;
  border-bottom: 1px solid var(--border);
  background: #faf9f8;
  font-weight: 400;
  color: var(--muted);
}
.records-table th button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 0;
  border: 0;
  color: inherit;
  background: transparent;
  font-size: 11px;
}
.records-table td {
  height: 70px;
  border-bottom: 1px solid #edebe9;
  padding: 9px 8px 9px 0;
  vertical-align: middle;
}
.records-table tbody tr {
  cursor: pointer;
}
.records-table tr:hover {
  background: #f8f7f6;
}
.records-table tr.active {
  background: var(--accent-06);
}
.records-table tr.active td:first-child {
  box-shadow: inset 3px 0 var(--accent);
}
.records-table tr.checked {
  background: var(--accent-10);
}
.check-column {
  width: 42px;
  text-align: center;
}
.column-title {
  width: auto;
}
.column-players {
  width: 20%;
}
.column-result {
  width: 12%;
}
.column-date {
  width: 17%;
}
.column-reviewState {
  width: 14%;
}
.star-column {
  width: 38px;
}
.record-title-button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  color: var(--text);
  background: transparent;
  text-align: left;
}
.record-title-button > svg {
  flex-shrink: 0;
  color: var(--muted);
}
.record-title-button > span {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.record-title-button strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.record-title-button small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}
.inline-separator {
  display: inline-block;
  width: 1px;
  height: 9px;
  margin: 0 7px;
  background: var(--border);
}
.player-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
}
.player-line span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stone-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.stone-dot.black {
  background: #323130;
}
.stone-dot.white {
  border: 1px solid #a19f9d;
  background: white;
}
.review-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--muted);
}
.review-state i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #a19f9d;
}
.review-state.reviewing {
  color: var(--accent-strong);
}
.review-state.reviewing i {
  background: var(--accent);
}
.review-state.completed {
  color: #107c10;
}
.review-state.completed i {
  background: #107c10;
}
.favorite-button.marked {
  color: #b07b00;
}
.result-text {
  font-variant-numeric: tabular-nums;
}
.records-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
  padding: 18px;
  align-content: start;
}
.record-tile {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.record-tile.active {
  border-color: var(--accent);
  background: var(--accent-03);
}
.tile-top {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 10px;
}
.tile-top span {
  flex: 1;
}
.tile-select {
  display: grid;
  width: 100%;
  gap: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 12px;
}
.tile-select strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
}
.tile-select > span {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.tile-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  color: var(--muted);
  font-size: 10px;
}
.list-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}
.list-pagination > div {
  display: flex;
  align-items: center;
  gap: 6px;
}
@media (max-width: 1250px) {
  .column-date {
    width: 20%;
  }
  .column-reviewState {
    width: 17%;
  }
  .column-players {
    width: 23%;
  }
  .record-title-button > svg {
    display: none;
  }
}
@media (max-width: 600px) {
  .column-result,
  .column-date {
    display: none;
  }
  .column-players {
    width: 30%;
  }
  .column-reviewState {
    width: 19%;
  }
  .check-column {
    width: 32px;
  }
  .star-column {
    width: 29px;
  }
  .records-table td {
    padding-right: 4px;
  }
  .record-title-button strong {
    font-size: 12px;
  }
  .event-label {
    display: none;
  }
  .records-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;
  }
  .tile-footer {
    flex-wrap: wrap;
  }
}
</style>
