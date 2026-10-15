<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Edit3, ExternalLink, FileText, MoreHorizontal, Pause, Play, Plus, Star, Trash2, Undo2, X } from 'lucide-vue-next'
import RecordBoard from './RecordBoard.vue'
import LibraryDialog from './LibraryDialog.vue'
import SetupDropdown, { type SetupDropdownOption } from '../ui/SetupDropdown.vue'
import { REVIEW_LABELS, SOURCE_LABELS, type LibraryRecord, type RecordMetadata, type RecordCollection, type ReviewState } from '../../types/library'
import { previewPositions, readSgf } from '../../domain/sgf'
import { formatKomi } from '../../domain/gameSetup'
import type { BoardStyle } from '../../domain/boardTheme'

const props = defineProps<{
  record: LibraryRecord | null; trash?: boolean; busy?: boolean; saving?: boolean; active?: boolean
  coordinates: boolean; moveNumbers: boolean; boardStyle: BoardStyle
  collections: RecordCollection[]; saveMetadata: (record: LibraryRecord) => Promise<void>
}>()
const emit = defineEmits<{
  close: []; open: [id: string]; favorite: [record: LibraryRecord]; remove: [record: LibraryRecord]
  restore: [record: LibraryRecord]; addTag: [record: LibraryRecord, tag: string]
  removeTag: [record: LibraryRecord, tag: string]; review: [record: LibraryRecord, state: ReviewState]
  download: [record: LibraryRecord]; collection: [record: LibraryRecord, ids: string[]]
  error: [message: string]
}>()
const move = ref(0), playing = ref(false), tagValue = ref('')
const reviewOptions: SetupDropdownOption[] = Object.entries(REVIEW_LABELS).map(([value, label]) => ({ value, label }))
const showEdit = ref(false), editInfo = ref<RecordMetadata | null>(null), editSaving = ref(false)
const actionsMenu = ref<HTMLDetailsElement | null>(null)
const collectionList = ref<HTMLElement | null>(null)
watch(() => props.saving, async saving => {
  if (saving) return
  await nextTick()
  // A failed write leaves the model unchanged, so Vue will not reset native checked state.
  collectionList.value?.querySelectorAll<HTMLInputElement>('input').forEach((input, index) => {
    const item = props.collections[index]
    input.checked = Boolean(item && props.record?.collectionIds.includes(item.id))
  })
})
let timer: ReturnType<typeof setInterval> | undefined
const positions = computed(() => {
  if (!props.record) return []
  try { return previewPositions(readSgf(props.record.sgf)[0], props.record.lastNodePath) } catch { return [] }
})
const lastNode = computed(() => Math.max(0, positions.value.length - 1))
const position = computed(() => positions.value[Math.min(move.value, lastNode.value)])
function stop() { playing.value = false; if (timer) clearInterval(timer); timer = undefined }
function seek(value: number) { stop(); move.value = Math.max(0, Math.min(lastNode.value, Number.isFinite(value) ? value : 0)) }
function play() {
  if (playing.value) { stop(); return }
  if (positions.value.length <= 1) return
  if (move.value >= lastNode.value) move.value = 0
  playing.value = true
  timer = setInterval(() => {
    move.value = Math.min(lastNode.value, move.value + 1)
    if (move.value >= lastNode.value) stop()
  }, 750)
}
watch(() => props.record?.id, () => {
  move.value = lastNode.value; tagValue.value = ''; showEdit.value = false; stop()
  actionsMenu.value?.removeAttribute('open')
}, { immediate: true })
watch(() => props.active, active => { if (!active) stop() })
watch(lastNode, value => { if (move.value > value) seek(value) })
onBeforeUnmount(stop)
function edit(record: LibraryRecord) {
  if (props.saving) return
  actionsMenu.value?.removeAttribute('open')
  editInfo.value = {
    title: record.title, black: record.black, white: record.white, blackRank: record.blackRank,
    whiteRank: record.whiteRank, event: record.event, date: record.date, result: record.result,
    boardSize: record.boardSize, ruleSet: record.ruleSet,
    komi: record.ruleSet === 'chinese' ? record.komi / 2 : record.komi, moves: record.moves,
  }
  showEdit.value = true
}
async function submitEdit() {
  if (!props.record || !editInfo.value || editSaving.value) return
  editSaving.value = true
  try {
    await props.saveMetadata({ ...props.record, ...editInfo.value, title: editInfo.value.title.trim(), komi: editInfo.value.ruleSet === 'chinese' ? editInfo.value.komi * 2 : editInfo.value.komi })
    showEdit.value = false
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : String(cause)) }
  finally { editSaving.value = false }
}
function addTag() {
  const value = tagValue.value.trim()
  if (!props.record || !value || props.busy || props.saving || props.trash) return
  emit('addTag', props.record, value); tagValue.value = ''
}
function collection(id: string, checked: boolean) {
  if (!props.record) return
  emit('collection', props.record, checked ? [...new Set([...props.record.collectionIds, id])] : props.record.collectionIds.filter(value => value !== id))
}
function guardSaving(event: MouseEvent) {
  if (!props.saving || !(event.target instanceof Element)) return
  if (!event.target.closest('.favorite-button, .review-control, .tag-list, .tag-form, .collection-list')) return
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <aside class="record-preview workspace-surface" aria-label="棋谱详情" :aria-busy="saving || undefined" @click.capture="guardSaving">
    <header class="inspector-header"><h2>棋谱详情</h2><button class="workspace-icon" type="button" title="关闭详情" aria-label="关闭详情" @click="emit('close')"><X :size="17" /></button></header>
    <template v-if="record">
      <div class="preview-scroll">
        <section class="record-identity">
          <div class="identity-title"><h3 :title="record.title">{{ record.title }}</h3><button class="workspace-icon favorite-button" :class="{ marked: record.favorite }" type="button" :title="record.favorite ? '取消收藏' : '收藏'" :aria-label="record.favorite ? '取消收藏' : '收藏'" :aria-pressed="record.favorite" :disabled="busy || trash" @click="emit('favorite', record)"><Star :size="16" :fill="record.favorite ? 'currentColor' : 'none'" /></button></div>
          <div class="preview-players"><div><i class="stone-dot black" aria-hidden="true" /><span class="visually-hidden">黑方</span><strong :title="record.black">{{ record.black || '未注明' }}</strong><small v-if="record.blackRank">{{ record.blackRank }}</small></div><div><i class="stone-dot white" aria-hidden="true" /><span class="visually-hidden">白方</span><strong :title="record.white">{{ record.white || '未注明' }}</strong><small v-if="record.whiteRank">{{ record.whiteRank }}</small></div></div>
        </section>
        <section class="preview-board-section" aria-label="棋盘预览">
          <div class="board-wrap"><RecordBoard v-if="position" :position="position" :coordinates="coordinates" :move-numbers="moveNumbers" :board-style="boardStyle" /><div v-else class="board-error"><FileText :size="24" /><span>棋谱预览不可用</span></div></div>
          <div class="playback-toolbar" role="group" aria-label="预览播放控制">
            <button class="workspace-icon" type="button" title="初始局面" aria-label="初始局面" :disabled="move <= 0" @click="seek(0)"><ChevronsLeft :size="17" /></button>
            <button class="workspace-icon" type="button" title="上一手" aria-label="上一手" :disabled="move <= 0" @click="seek(move - 1)"><ChevronLeft :size="17" /></button>
            <button class="workspace-icon play-command" type="button" :title="playing ? '暂停播放' : '播放棋谱'" :aria-label="playing ? '暂停播放' : '播放棋谱'" :aria-pressed="playing" :disabled="positions.length <= 1" @click="play"><component :is="playing ? Pause : Play" :size="17" /></button>
            <button class="workspace-icon" type="button" title="下一手" aria-label="下一手" :disabled="move >= lastNode" @click="seek(move + 1)"><ChevronRight :size="17" /></button>
            <button class="workspace-icon" type="button" title="终局局面" aria-label="终局局面" :disabled="move >= lastNode" @click="seek(lastNode)"><ChevronsRight :size="17" /></button>
            <span class="move-counter">{{ position?.moveNumber ?? 0 }} / {{ record.moves }} 手</span>
          </div>
          <div class="preview-progress">
            <!-- Update max before value so a longer record is not clamped to the previous range. -->
            <input
              class="move-timeline"
              type="range"
              min="0"
              :max="lastNode"
              :value="move"
              :style="{ '--timeline-progress': `${(move / Math.max(1, lastNode)) * 100}%` }"
              :disabled="!positions.length"
              aria-label="棋谱进度"
              @input="seek(Number(($event.target as HTMLInputElement).value))"
            />
            <label><span class="visually-hidden">跳转预览节点</span><input type="number" :value="move" min="0" :max="lastNode" :disabled="!positions.length" @change="seek(Number(($event.target as HTMLInputElement).value))" /></label>
          </div>
          <p v-if="position?.comment" class="preview-comment">{{ position.comment }}</p>
        </section>
        <section class="preview-section">
          <div class="section-heading"><h3>对局信息</h3><button v-if="!trash" class="workspace-icon" type="button" title="编辑棋谱信息" aria-label="编辑棋谱信息" :disabled="busy" @click="edit(record)"><Edit3 :size="15" /></button></div>
          <dl class="metadata-list"><div><dt>结果</dt><dd>{{ record.result || '未注明' }}</dd></div><div><dt>日期</dt><dd>{{ record.date || '未注明' }}</dd></div><div><dt>赛事</dt><dd>{{ record.event || '未注明' }}</dd></div><div><dt>棋盘</dt><dd>{{ record.boardSize }} 路 · {{ record.moves }} 手</dd></div><div><dt>规则</dt><dd>{{ record.ruleSet === 'chinese' ? '中国规则' : record.ruleSet === 'aga' ? 'AGA 规则' : '日韩规则' }} · 贴 {{ formatKomi(record.ruleSet === 'chinese' ? record.komi / 2 : record.komi) }}{{ record.ruleSet === 'chinese' ? '子' : '目' }}</dd></div><div><dt>来源</dt><dd>{{ SOURCE_LABELS[record.source] }}</dd></div></dl>
        </section>
        <section class="preview-section">
          <div class="section-heading"><h3>整理</h3></div>
          <div class="review-control"><span>复盘状态</span><SetupDropdown :model-value="record.reviewState" :options="reviewOptions" ariaLabel="复盘状态" :disabled="busy || trash" @update:model-value="emit('review', record, $event as ReviewState)" /></div>
          <h4>标签</h4>
          <div class="tag-list"><span v-for="tag in record.tags" :key="tag" class="tag-chip"><span>{{ tag }}</span><button v-if="!trash" type="button" :disabled="busy" :title="`删除标签 ${tag}`" :aria-label="`删除标签 ${tag}`" @click="emit('removeTag', record, tag)"><X :size="12" /></button></span><span v-if="!record.tags.length" class="inspector-muted">暂无标签</span></div>
          <form v-if="!trash" class="tag-form" @submit.prevent="addTag"><input v-model="tagValue" maxlength="40" type="text" placeholder="添加标签" aria-label="添加标签" :disabled="busy" /><button class="workspace-icon" type="submit" :disabled="busy || !tagValue.trim()" title="添加标签" aria-label="确认添加标签"><Plus :size="16" /></button></form>
          <template v-if="collections.length"><h4>棋谱集合</h4><div ref="collectionList" class="collection-list"><label v-for="item in collections" :key="item.id"><input type="checkbox" :checked="record.collectionIds.includes(item.id)" :disabled="busy || trash" @change="collection(item.id, ($event.target as HTMLInputElement).checked)" /><span :title="item.name">{{ item.name }}</span></label></div></template>
        </section>
      </div>
      <footer class="preview-footer">
        <button v-if="trash" class="workspace-button primary inspector-primary" type="button" :disabled="busy" @click="emit('restore', record)"><Undo2 :size="15" />恢复棋谱</button>
        <button v-else class="workspace-button primary inspector-primary" type="button" :disabled="busy" @click="emit('open', record.id)"><ExternalLink :size="15" />在研究盘打开</button>
        <details ref="actionsMenu" class="preview-more" @keydown.esc.stop.prevent="actionsMenu?.removeAttribute('open')"><summary class="workspace-icon" title="棋谱操作" aria-label="棋谱操作"><MoreHorizontal :size="18" /></summary><div class="command-menu preview-menu">
          <button v-if="!trash" type="button" :disabled="busy" @click="edit(record)"><Edit3 :size="15" />编辑棋谱信息</button>
          <button type="button" :disabled="busy" @click="emit('download', record); actionsMenu?.removeAttribute('open')"><Download :size="15" />导出 SGF</button>
          <button class="danger" type="button" :disabled="busy" @click="emit('remove', record); actionsMenu?.removeAttribute('open')"><Trash2 :size="15" />{{ trash ? '永久删除' : '移入回收站' }}</button>
        </div></details>
      </footer>
    </template>
    <div v-else class="preview-empty"><FileText :size="30" aria-hidden="true" /><h3>未选择棋谱</h3></div>
  </aside>
  <LibraryDialog v-if="showEdit && editInfo" title="编辑棋谱信息" wide :busy="editSaving" @close="showEdit = false">
    <form class="lib-form" @submit.prevent="submitEdit">
      <label class="span-two">棋谱名称<input v-model="editInfo.title" required maxlength="160" /></label>
      <label>黑方<input v-model="editInfo.black" maxlength="80" /></label><label>白方<input v-model="editInfo.white" maxlength="80" /></label><label>黑方段位<input v-model="editInfo.blackRank" maxlength="40" /></label><label>白方段位<input v-model="editInfo.whiteRank" maxlength="40" /></label><label>日期<input v-model="editInfo.date" /></label><label>结果<input v-model="editInfo.result" placeholder="B+R / W+4.5" /></label><label class="span-two">赛事<input v-model="editInfo.event" maxlength="160" /></label>
      <div class="dialog-actions span-two"><button class="workspace-button" type="button" :disabled="editSaving" @click="showEdit = false">取消</button><button class="workspace-button primary" type="submit" :disabled="editSaving || !editInfo.title.trim()">{{ editSaving ? '保存中' : '保存' }}</button></div>
    </form>
  </LibraryDialog>
</template>

<style scoped>
.record-preview { display: flex; width: 100%; min-width: 0; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; border-left: 1px solid var(--border); }
.inspector-header { display: flex; height: 54px; flex: 0 0 54px; align-items: center; justify-content: space-between; gap: 8px; padding: 0 16px; }
.inspector-header h2 { margin: 0; color: var(--muted); font-size: 12px; font-weight: 600; }
.preview-scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 16px 18px 24px; overscroll-behavior: contain; scrollbar-gutter: stable; }
.preview-scroll::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.identity-title { display: flex; align-items: flex-start; gap: 8px; }
.identity-title h3 { flex: 1; min-width: 0; margin: 3px 0 10px; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
.favorite-button.marked { color: #b07b00; }
.preview-players { display: grid; gap: 8px; margin-bottom: 16px; }
.preview-players > div { display: flex; min-width: 0; align-items: center; gap: 7px; }
.preview-players strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
.preview-players small { flex-shrink: 0; color: var(--muted); font-size: 11px; }
.board-wrap { width: 100%; max-width: 360px; margin-inline: auto; aspect-ratio: 1; }
.board-error { display: grid; width: 100%; height: 100%; place-content: center; justify-items: center; gap: 10px; border: 1px dashed var(--border); color: var(--muted); font-size: 12px; }
.playback-toolbar { display: flex; align-items: center; gap: 1px; margin-top: 10px; }
.playback-toolbar .workspace-icon { width: 28px; height: 30px; flex-basis: 28px; }
.play-command { color: var(--accent-strong); }
.move-counter { margin-left: auto; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.preview-progress { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.preview-progress > .move-timeline { min-width: 0; flex: 1; width: 100%; height: 24px; margin: 0; padding: 0; appearance: none; -webkit-appearance: none; background: transparent; cursor: pointer; }
.move-timeline::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--accent) 0 var(--timeline-progress), var(--border) var(--timeline-progress) 100%); }
.move-timeline::-moz-range-track { height: 4px; border-radius: 4px; background: var(--border); }
.move-timeline::-moz-range-progress { height: 4px; border-radius: 4px; background: var(--accent); }
.move-timeline::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; appearance: none; -webkit-appearance: none; border: 2px solid var(--accent); border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .22); transition: transform 120ms ease, box-shadow 120ms ease; }
.move-timeline::-moz-range-thumb { width: 10px; height: 10px; border: 2px solid var(--accent); border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .22); transition: transform 120ms ease, box-shadow 120ms ease; }
.move-timeline:hover::-webkit-slider-thumb, .move-timeline:active::-webkit-slider-thumb { transform: scale(1.12); box-shadow: 0 0 0 4px var(--accent-soft); }
.move-timeline:hover::-moz-range-thumb, .move-timeline:active::-moz-range-thumb { transform: scale(1.12); box-shadow: 0 0 0 4px var(--accent-soft); }
.move-timeline:focus-visible { outline: none; }
.move-timeline:focus-visible::-webkit-slider-thumb, .move-timeline:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px var(--accent-soft); }
.move-timeline:disabled { cursor: default; opacity: .48; }
.preview-progress label input { width: 44px; height: 28px; padding: 0 4px; text-align: center; font-size: 11px; }
.preview-comment { margin: 12px 0 0; padding: 8px 10px; border-left: 2px solid var(--accent); background: var(--accent-06); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.preview-section { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border); }
.section-heading { display: flex; min-height: 30px; align-items: center; justify-content: space-between; }
.section-heading h3 { margin: 0; font-size: 12px; font-weight: 600; }
.metadata-list { display: grid; gap: 10px; margin: 10px 0 0; font-size: 12px; }
.metadata-list > div { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; }
.metadata-list dt { color: var(--muted); }
.metadata-list dd { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.review-control { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; color: var(--muted); font-size: 12px; }
.review-control .setup-dropdown { width: min(180px, 65%); }
.review-control :deep(.setup-dropdown-trigger) { min-height: 40px; padding: 6px 10px; }
.preview-section h4 { margin: 18px 0 10px; color: var(--muted); font-size: 11px; font-weight: 500; }
.tag-list { display: flex; height: 64px; flex-wrap: wrap; align-content: flex-start; align-items: flex-start; gap: 6px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.tag-chip { display: inline-flex; max-width: 100%; align-items: center; gap: 5px; min-height: 26px; padding: 2px 6px 2px 8px; border: 1px solid var(--border); border-radius: 4px; background: rgba(255, 255, 255, .7); color: var(--text); font-size: 11px; }
.tag-chip > span { overflow-wrap: anywhere; min-width: 0; }
.tag-chip button { display: grid; width: 22px; height: 22px; flex: 0 0 22px; place-items: center; padding: 0; border: 0; color: var(--muted); background: transparent; border-radius: 3px; }
.tag-chip button:hover { color: var(--danger); background: var(--danger-soft); }
.tag-form { display: flex; gap: 6px; margin-top: 10px; }
.tag-form input { min-width: 0; flex: 1; height: 32px; padding: 0 8px; font-size: 12px; }
.inspector-muted { color: var(--muted); font-size: 11px; }
.collection-list { display: grid; gap: 3px; padding: 4px; border: 1px solid var(--border); border-radius: 6px; background: rgba(237, 235, 233, .72); }
.collection-list label { display: flex; min-width: 0; align-items: center; gap: 8px; min-height: 34px; padding: 0 8px; border: 1px solid transparent; border-radius: 4px; color: var(--muted); font-size: 12px; cursor: pointer; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out; }
.collection-list label:hover { border-color: rgba(255, 255, 255, .72); color: var(--text); background: rgba(255, 255, 255, .62); }
.collection-list label:has(input:checked) { border-color: rgba(var(--accent-rgb), .16); color: var(--accent-strong); background: var(--surface); }
.collection-list label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.collection-list label:has(input:disabled) { cursor: not-allowed; opacity: .55; }
.collection-list span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-footer { display: flex; height: 60px; flex: 0 0 60px; align-items: center; gap: 10px; padding: 0 16px; }
.inspector-primary { flex: 1; min-height: 36px; }
.preview-more { position: relative; }
.preview-more summary { list-style: none; cursor: pointer; }
.preview-more summary::-webkit-details-marker { display: none; }
.preview-menu { top: auto; bottom: 42px; }
.preview-empty { display: grid; flex: 1; align-content: center; justify-items: center; gap: 12px; padding: 20px; color: var(--muted); }
.preview-empty h3 { margin: 0; font-size: 13px; font-weight: 500; }
@media (pointer: coarse) { .preview-footer .workspace-button { min-height: 44px; } .tag-form input { min-height: 40px; font-size: 16px; } }
</style>
