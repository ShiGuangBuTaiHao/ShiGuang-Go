import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  batchLibraryRecords,
  createLibraryRecord,
  deleteCollection,
  deleteLibraryRecords,
  getRecordResearch,
  importSgfFiles,
  listLibrary,
  saveHistoryRecord,
  restoreLibraryRecords,
  saveCollection,
  saveResearchRecord,
  updateLibraryRecord,
  updateRecordMetadata,
} from '../services/library'
import type {
  LibraryData,
  LibraryRecord,
  RecordMetadata,
  ReviewState,
} from '../types/library'
import { emptyLibrary } from '../types/library'

export const useLibraryStore = defineStore('library', () => {
  const data = ref<LibraryData>(emptyLibrary()),
    loading = ref(false),
    initialized = ref(false),
    error = ref(''),
    query = ref(''),
    category = ref('all'),
    selectedId = ref<string | null>(null),
    selectedIds = ref<string[]>([])
  const activeRecord = computed(
    () =>
      data.value.records.find((record) => record.id === selectedId.value) ??
      null,
  )
  const ui = reactive({ sidebarVisible: window.innerWidth > 760, previewVisible: window.innerWidth > 1100, filtersVisible: false, view: 'grid' as 'list' | 'grid', page: 1, sort: 'updatedAt', ascending: false, sizeFilter: '', sourceFilter: '', reviewFilter: '', fromDate: '', toDate: '', scrollTop: 0 })
  const visibleRecords = computed(() =>
    data.value.records
      .filter((record) =>
        category.value === 'trash'
          ? Boolean(record.deletedAt)
          : !record.deletedAt && (category.value === 'recent' || record.source !== 'history'),
      )
      .filter((record) => {
        if (category.value === 'favorites' && !record.favorite) return false
        if (category.value === 'recent' && !['game', 'history'].includes(record.source)) return false
        if (
          category.value === 'reviewing' &&
          record.reviewState !== 'reviewing'
        )
          return false
        const value = query.value.trim().toLowerCase()
        return (
          !value ||
          [
            record.title,
            record.black,
            record.white,
            record.event,
            record.date,
            record.result,
            ...record.tags,
          ]
            .join(' ')
            .toLowerCase()
            .includes(value)
        )
      }),
  )
  const counts = computed(() => ({
    all: data.value.records.filter((record) => !record.deletedAt && record.source !== 'history').length,
    favorites: data.value.records.filter(
      (record) => !record.deletedAt && record.favorite,
    ).length,
    recent: data.value.records.filter(
      (record) => !record.deletedAt && ['game', 'history'].includes(record.source),
    ).length,
    trash: data.value.records.filter((record) => Boolean(record.deletedAt))
      .length,
  }))
  async function init() {
    loading.value = true
    try {
      data.value = await listLibrary()
      initialized.value = true
      if (!selectedId.value || !data.value.records.some(record => record.id === selectedId.value))
        selectedId.value = visibleRecords.value[0]?.id ?? null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }
  async function importFiles(
    files: File[],
    options?: { duplicateMode?: 'skip' | 'copy'; collectionId?: string },
  ) {
    loading.value = true
    try {
      const result = await importSgfFiles(files, options)
      data.value = result.data
      selectedId.value =
        result.data.records.find((record) => record.source === 'import')?.id ??
        selectedId.value
      return result.results
    } finally {
      loading.value = false
    }
  }
  async function create(info: Partial<RecordMetadata>) {
    const record = await createLibraryRecord(info)
    data.value.records.unshift(record)
    selectedId.value = record.id
    return record
  }
  async function patch(id: string, patchValue: Partial<LibraryRecord>) {
    const record = await updateLibraryRecord(id, patchValue)
    const index = data.value.records.findIndex((item) => item.id === id)
    if (index >= 0) data.value.records[index] = record
    return record
  }
  async function saveHistory(id: string) {
    const record = await saveHistoryRecord(id)
    const index = data.value.records.findIndex(item => item.id === record.id)
    if (index >= 0) data.value.records[index] = record
    else data.value.records.unshift(record)
    return record
  }
  async function editMetadata(id: string, info: RecordMetadata) {
    const record = await updateRecordMetadata(id, info)
    const index = data.value.records.findIndex((item) => item.id === id)
    if (index >= 0) data.value.records[index] = record
    return record
  }
  async function remove(ids = selectedIds.value) {
    data.value = await deleteLibraryRecords(ids, category.value === 'trash')
    selectedIds.value = []
    if (
      selectedId.value &&
      !data.value.records.some(
        (record) => record.id === selectedId.value && !record.deletedAt,
      )
    )
      selectedId.value = visibleRecords.value[0]?.id ?? null
  }
  async function restore(ids = selectedIds.value) {
    data.value = await restoreLibraryRecords(ids)
    selectedIds.value = []
  }
  async function open(id: string) {
    selectedId.value = id
    const record = await patch(id, {
      openedAt: new Date().toISOString(),
      reviewState:
        activeRecord.value?.reviewState === 'pending'
          ? ('reviewing' as ReviewState)
          : activeRecord.value?.reviewState,
    })
    return record
  }
  async function saveResearch(
    id: string | null,
    tree: import('../types/research').ResearchTree,
    patchValue: Partial<RecordMetadata> = {},
  ) {
    const record = await saveResearchRecord(id, tree, patchValue)
    const index = data.value.records.findIndex((item) => item.id === record.id)
    if (index >= 0) data.value.records[index] = record
    else data.value.records.unshift(record)
    selectedId.value = record.id
    return record
  }
  async function addCollection(name: string) {
    const collection = { id: `collection-${crypto.randomUUID()}`, name }
    await saveCollection(collection)
    data.value.collections.push(collection)
    return collection
  }
  async function renameCollection(id: string, name: string) { const collection = await saveCollection({ id, name }); const index = data.value.collections.findIndex(item => item.id === id); if (index >= 0) data.value.collections[index] = collection }
  async function removeCollection(id: string) { data.value = await deleteCollection(id); if (category.value === id) category.value = 'all' }
  async function batch(
    ids: string[],
    options: {
      tag?: string
      collectionId?: string
      reviewState?: ReviewState | ''
    },
  ) {
    data.value = await batchLibraryRecords(ids, options)
  }
  return {
    data,
    loading,
    initialized,
    error,
    query,
    category,
    selectedId,
    selectedIds,
    activeRecord,
    visibleRecords,
    counts,
    init,
    importFiles,
    create,
    patch,
    saveHistory,
    editMetadata,
    remove,
    restore,
    open,
    saveResearch,
    addCollection,
    renameCollection,
    removeCollection,
    batch,
    getRecordResearch,
    ui,
  }
})
