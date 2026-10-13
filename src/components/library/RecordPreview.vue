<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Edit3,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Play,
  Save,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-vue-next'
import RecordBoard from './RecordBoard.vue'
import LibraryDialog from './LibraryDialog.vue'
import {
  REVIEW_LABELS,
  type LibraryRecord,
  type RecordMetadata,
  type RecordCollection,
  type ReviewState,
} from '../../types/library'
import { previewPositions, readSgf } from '../../domain/sgf'
import { formatKomi } from '../../domain/gameSetup'
const props = defineProps<{
  record: LibraryRecord | null
  trash?: boolean
  busy?: boolean
  collections: RecordCollection[]
  saveMetadata: (record: LibraryRecord) => Promise<void>
}>()
const emit = defineEmits<{
  close: []
  open: [id: string]
  favorite: [record: LibraryRecord]
  remove: [record: LibraryRecord]
  restore: [record: LibraryRecord]
  addTag: [record: LibraryRecord, tag: string]
  removeTag: [record: LibraryRecord, tag: string]
  review: [record: LibraryRecord, state: ReviewState]
  download: [record: LibraryRecord]
  collection: [record: LibraryRecord, ids: string[]]
}>()
const move = ref(0),
  showEdit = ref(false),
  editInfo = ref<RecordMetadata | null>(null),
  editError = ref(''),
  editSaving = ref(false),
  tagValue = ref(''),
  playing = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
const positions = computed(() => {
  if (!props.record) return []
  try {
    return previewPositions(readSgf(props.record.sgf)[0])
  } catch {
    return []
  }
})
const position = computed(
  () =>
    positions.value[
      Math.min(move.value, Math.max(0, positions.value.length - 1))
    ],
)
function stop() {
  playing.value = false
  if (timer) clearInterval(timer)
  timer = undefined
}
function play() {
  if (playing.value) {
    stop()
    return
  }
  if (move.value >= positions.value.length - 1) move.value = 0
  playing.value = true
  timer = setInterval(() => {
    if (move.value >= positions.value.length - 1) stop()
    else move.value++
  }, 750)
}
watch(
  () => props.record?.id,
  () => {
    move.value = 0
    stop()
  },
)
onBeforeUnmount(stop)
function edit(record: LibraryRecord) {
  editError.value = ''
  editInfo.value = {
    title: record.title,
    black: record.black,
    white: record.white,
    blackRank: record.blackRank,
    whiteRank: record.whiteRank,
    event: record.event,
    date: record.date,
    result: record.result,
    boardSize: record.boardSize,
    ruleSet: record.ruleSet,
    komi: record.ruleSet === 'chinese' ? record.komi / 2 : record.komi,
    moves: record.moves,
  }
  showEdit.value = true
}
async function submitEdit() {
  if (!props.record || !editInfo.value || editSaving.value) return
  editSaving.value = true
  editError.value = ''
  try {
    await props.saveMetadata({
      ...props.record,
      ...editInfo.value,
      komi: editInfo.value.ruleSet === 'chinese'
        ? editInfo.value.komi * 2
        : editInfo.value.komi,
    })
    showEdit.value = false
  } catch (cause) {
    editError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    editSaving.value = false
  }
}
function addTag() {
  const value = tagValue.value.trim()
  if (props.record && value) emit('addTag', props.record, value)
  tagValue.value = ''
}
function collection(id: string, checked: boolean) {
  if (props.record)
    emit(
      'collection',
      props.record,
      checked
        ? [...new Set([...props.record.collectionIds, id])]
        : props.record.collectionIds.filter((value) => value !== id),
    )
}
</script>

<template>
  <aside
    class="record-preview"
    :class="{ empty: !record }"
    aria-label="棋谱预览"
  >
    <template v-if="record">
      <header class="preview-header">
        <div>
          <span class="preview-kicker">棋谱预览</span>
          <h2 :title="record.title">{{ record.title }}</h2>
        </div>
        <div class="preview-header-actions">
          <button
            class="lib-icon"
            type="button"
            :class="{ marked: record.favorite }"
            :title="record.favorite ? '取消收藏' : '收藏'"
            :aria-label="record.favorite ? '取消收藏' : '收藏'"
            :disabled="busy || trash"
            @click="emit('favorite', record)"
          >
            <Star
              :size="16"
              :fill="record.favorite ? 'currentColor' : 'none'"
            /></button
          ><button
            class="lib-icon"
            type="button"
            title="关闭预览"
            aria-label="关闭预览"
            @click="emit('close')"
          >
            <X :size="17" />
          </button>
        </div>
      </header>
      <div class="preview-scroll">
        <div class="board-wrap">
          <RecordBoard v-if="position" :position="position" />
          <div v-else class="board-error">棋谱预览不可用</div>
        </div>
        <div class="move-controls">
          <button
            class="lib-icon"
            type="button"
            title="上一手"
            aria-label="上一手"
            :disabled="move <= 0"
            @click="stop(); move--"
          >
            <ChevronLeft :size="18" /></button
          ><input
            v-model.number="move"
            type="range"
            min="0"
            :max="Math.max(0, positions.length - 1)"
            aria-label="棋谱手数"
          /><button
            class="lib-icon"
            type="button"
            title="下一手"
            aria-label="下一手"
            :disabled="move >= positions.length - 1"
            @click="stop(); move++"
          >
            <ChevronRight :size="18" /></button
          ><span
            >{{ position?.moveNumber ?? 0 }} /
            {{ record.moves }}</span
          >
        </div>
        <div class="playback-actions" role="group" aria-label="预览播放控制">
          <button class="lib-icon" type="button" title="初始局面" aria-label="初始局面" :disabled="move <= 0" @click="stop(); move = 0"><ChevronsLeft :size="17" /></button>
          <button class="lib-icon" type="button" :title="playing ? '暂停播放' : '播放棋谱'" :aria-label="playing ? '暂停播放' : '播放棋谱'" :disabled="positions.length <= 1" @click="play"><component :is="playing ? Pause : Play" :size="17" /></button>
          <button class="lib-icon" type="button" title="终局局面" aria-label="终局局面" :disabled="move >= positions.length - 1" @click="stop(); move = Math.max(0, positions.length - 1)"><ChevronsRight :size="17" /></button>
          <label class="jump-control">第<input type="number" aria-label="跳转预览节点" :value="move" :min="0" :max="positions.length - 1" @change="stop(); move = Math.max(0, Math.min(positions.length - 1, Number(($event.target as HTMLInputElement).value) || 0))" />节点</label>
        </div>
        <p v-if="position?.comment" class="preview-comment">
          {{ position.comment }}
        </p>
        <section class="preview-section players-section">
          <div class="player-card">
            <i class="stone-dot black" />
            <div>
              <span>黑方</span><strong>{{ record.black || '未注明' }}</strong
              ><small v-if="record.blackRank">{{ record.blackRank }}</small>
            </div>
          </div>
          <div class="player-card">
            <i class="stone-dot white" />
            <div>
              <span>白方</span><strong>{{ record.white || '未注明' }}</strong
              ><small v-if="record.whiteRank">{{ record.whiteRank }}</small>
            </div>
          </div>
        </section>
        <section class="preview-section">
          <div class="section-heading">
            <h3>对局信息</h3>
            <button v-if="!trash" class="text-button" type="button" :disabled="busy" @click="edit(record)">
              <Edit3 :size="13" />编辑
            </button>
          </div>
          <dl class="metadata-list">
            <div>
              <dt>结果</dt>
              <dd>{{ record.result || '未注明' }}</dd>
            </div>
            <div>
              <dt>日期</dt>
              <dd>{{ record.date || '未注明' }}</dd>
            </div>
            <div>
              <dt>赛事</dt>
              <dd>{{ record.event || '未注明' }}</dd>
            </div>
            <div>
              <dt>规则</dt>
              <dd>{{ record.boardSize }} 路 · 贴 {{ formatKomi(record.ruleSet === 'chinese' ? record.komi / 2 : record.komi) }}{{ record.ruleSet === 'chinese' ? '子' : '目' }}</dd>
            </div>
          </dl>
        </section>
        <section class="preview-section">
          <div class="section-heading">
            <h3><Tag :size="14" />标签</h3>
          </div>
          <div class="tag-list">
            <span v-for="tag in record.tags" :key="tag" class="tag-chip"
              >{{ tag
              }}<button
                type="button"
                :disabled="trash || busy"
                :aria-label="`删除标签 ${tag}`"
                @click="emit('removeTag', record, tag)"
              >
                <X :size="10" /></button
            ></span>
            <form v-if="!trash" class="tag-form" @submit.prevent="addTag">
              <input
                v-model="tagValue"
                maxlength="40"
                type="text"
                placeholder="添加标签"
                aria-label="添加标签"
              /><button
                type="submit"
                :disabled="busy"
                title="添加标签"
                aria-label="添加标签"
              >
                <Tag :size="12" />
              </button>
            </form>
          </div>
        </section>
        <section v-if="!trash" class="preview-section review-section">
          <label
            >复盘状态<select
              :value="record.reviewState"
              :disabled="busy"
              @change="
                emit(
                  'review',
                  record,
                  ($event.target as HTMLSelectElement).value as ReviewState,
                )
              "
            >
              <option
                v-for="(label, state) in REVIEW_LABELS"
                :key="state"
                :value="state"
              >
                {{ label }}
              </option>
            </select></label
          >
        </section>
      </div>
      <footer class="preview-footer">
        <button
          v-if="trash"
          class="secondary-action"
          type="button"
          :disabled="busy"
          @click="emit('restore', record)"
        >
          恢复棋谱</button
        ><button
          v-else
          class="secondary-action"
          type="button"
          title="删除棋谱"
          :disabled="busy"
          @click="emit('remove', record)"
        >
          <Trash2 :size="14" />删除</button
        ><button
          v-if="!trash"
          class="primary-action"
          type="button"
          :disabled="busy"
          @click="emit('open', record.id)"
        >
          <ExternalLink :size="14" />打开研究
        </button>
        <details class="preview-more">
          <summary class="lib-icon" title="更多操作" aria-label="更多操作">
            <MoreHorizontal :size="17" />
          </summary>
          <div class="preview-menu">
            <button
              type="button"
              :disabled="busy"
              @click="emit('download', record)"
            >
              <Download :size="14" />导出 SGF</button
            ><template v-if="!trash"
              ><label v-for="item in collections" :key="item.id"
                ><input
                  type="checkbox"
                  :checked="record.collectionIds.includes(item.id)"
                  :disabled="busy"
                  @change="
                    collection(
                      item.id,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />{{ item.name }}</label
              ></template
            >
          </div>
        </details>
      </footer>
    </template>
    <div v-else class="preview-empty">
      <div class="preview-empty-mark"><Save :size="22" /></div>
      <strong>选择一份棋谱</strong
      ><span>在列表中选择棋谱查看局面、属性与复盘状态。</span>
    </div>
  </aside>
  <LibraryDialog
    v-if="showEdit && editInfo"
    title="编辑棋谱信息"
    wide
    :busy="editSaving"
    @close="showEdit = false"
    ><form class="metadata-form" @submit.prevent="submitEdit">
      <label
        >棋谱名称<input v-model="editInfo.title" required maxlength="160"
      /></label>
      <div class="form-grid">
        <label>黑方<input v-model="editInfo.black" /></label
        ><label>白方<input v-model="editInfo.white" /></label
        ><label>黑方段位<input v-model="editInfo.blackRank" /></label
        ><label>白方段位<input v-model="editInfo.whiteRank" /></label
        ><label>赛事<input v-model="editInfo.event" /></label
        ><label>日期<input v-model="editInfo.date" /></label
        ><label
          >结果<input v-model="editInfo.result" placeholder="B+R / W+4.5"
        /></label>
      </div>
      <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
      <div class="dialog-actions">
        <button
          class="secondary-action"
          type="button"
          :disabled="editSaving"
          @click="showEdit = false"
        >
          取消</button
        ><button class="primary-action" type="submit" :disabled="editSaving">
          {{ editSaving ? '保存中' : '保存' }}
        </button>
      </div>
    </form></LibraryDialog
  >
</template>

<style scoped>
.record-preview {
  display: flex;
  min-width: 300px;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--surface);
}
.playback-actions { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
.jump-control { display: flex; align-items: center; gap: 5px; margin-left: auto; color: var(--muted); font-size: 10px; }
.jump-control input { width: 48px; height: 28px; padding: 0 5px; text-align: center; font-size: 11px; }
.preview-more { position: relative; }
.preview-more summary { list-style: none; cursor: pointer; }
.preview-more summary::-webkit-details-marker { display: none; }
.preview-menu { position: absolute; right: 0; bottom: 42px; z-index: 3; display: grid; min-width: 190px; max-height: 250px; overflow-y: auto; padding: 5px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow-md); }
.preview-menu button, .preview-menu label { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 8px; border: 0; border-radius: 4px; color: var(--text); background: transparent; text-align: left; font-size: 12px; }
.preview-menu button:hover, .preview-menu label:hover { background: var(--accent-soft); }
.review-section label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; }
.review-section select { min-height: 32px; padding: 0 8px; font-size: 12px; }
.preview-header {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.preview-header > div:first-child {
  min-width: 0;
}
.preview-kicker {
  color: var(--muted);
  font-size: 10px;
}
.preview-header h2 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 5px 0 0;
  font-size: 16px;
}
.preview-header-actions {
  display: flex;
  gap: 3px;
}
.preview-header-actions .marked {
  color: #b07b00;
}
.preview-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 18px 18px 22px;
}
.board-wrap {
  width: min(100%, 330px);
  margin: 0 auto;
}
.board-error {
  display: grid;
  aspect-ratio: 1;
  place-items: center;
  border: 1px dashed var(--border);
  color: var(--muted);
  font-size: 12px;
}
.move-controls {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 30px auto;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.move-controls input {
  min-width: 0;
}
.move-controls span {
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.preview-comment {
  padding: 10px 12px;
  margin: 12px 0 0;
  border-left: 3px solid var(--accent);
  background: var(--accent-03);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}
.preview-section {
  padding: 17px 0 4px;
  border-top: 1px solid var(--border);
  margin-top: 17px;
}
.players-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  border-top: 0;
  margin-top: 0;
  padding-top: 18px;
}
.player-card {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
}
.player-card > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.player-card span,
.player-card small {
  color: var(--muted);
  font-size: 10px;
}
.player-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.stone-dot {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  margin-top: 3px;
  border-radius: 50%;
}
.stone-dot.black {
  background: #323130;
}
.stone-dot.white {
  border: 1px solid #a19f9d;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-heading h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
}
.text-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px;
  border: 0;
  color: var(--accent-strong);
  background: transparent;
  font: inherit;
  font-size: 11px;
}
.metadata-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px 16px;
  margin: 15px 0 0;
}
.metadata-list div {
  display: grid;
  gap: 4px;
}
.metadata-list dt {
  color: var(--muted);
  font-size: 10px;
}
.metadata-list dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  font-size: 11px;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  border-radius: 4px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  font-size: 10px;
}
.tag-chip button {
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
}
.tag-form {
  display: inline-flex;
  height: 25px;
  border: 1px dashed var(--border);
  border-radius: 4px;
}
.tag-form input {
  width: 78px;
  padding: 0 6px;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 10px;
}
.tag-form button {
  width: 24px;
  border: 0;
  color: var(--accent);
  background: transparent;
  font-size: 15px;
}
.preview-footer {
  display: flex;
  min-height: 58px;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}
.preview-footer .primary-action {
  flex: 1;
}
.secondary-action,
.primary-action {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font: inherit;
  font-size: 11px;
}
.secondary-action {
  color: var(--muted);
  background: var(--surface);
}
.primary-action {
  border-color: var(--accent);
  color: white;
  background: var(--accent);
}
.secondary-action:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
  background: var(--accent-soft);
}
.primary-action:hover {
  background: var(--accent-strong);
}
.preview-empty {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 10px;
  min-height: 300px;
  padding: 28px;
  text-align: center;
  color: var(--muted);
}
.preview-empty-mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 6px;
}
.preview-empty strong {
  color: var(--text);
  font-size: 13px;
}
.preview-empty span {
  max-width: 220px;
  font-size: 11px;
  line-height: 1.5;
}
.metadata-form {
  display: grid;
  gap: 14px;
  padding: 18px 20px 20px;
}
.metadata-form label {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
}
.metadata-form input {
  min-height: 36px;
  padding: 0 9px;
  font-size: 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 5px;
}
.lib-icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--muted);
  background: transparent;
}
.lib-icon:hover:not(:disabled) {
  border-color: var(--border);
  color: var(--accent-strong);
  background: var(--accent-soft);
}
.lib-icon:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.record-preview.empty {
  border-left: 0;
}
.record-preview.empty .preview-empty {
  min-height: 100%;
}
.tag-form:focus-within {
  border-color: var(--accent);
}
@media (max-width: 760px) {
  .record-preview {
    position: fixed;
    z-index: 30;
    inset: 0;
    min-width: 0;
    border-left: 0;
  }
  .preview-scroll {
    padding: 14px 16px 20px;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
