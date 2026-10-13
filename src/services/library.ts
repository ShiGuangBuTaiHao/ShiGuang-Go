import { invoke, isTauri } from '@tauri-apps/api/core'
import { stringify } from '@sabaki/sgf'
import {
  createSgf,
  gameToSgf,
  decodeSgfFile,
  metadata,
  readSgf,
  sgfFingerprint,
  sgfToResearch,
  researchNodePath,
  researchToSgf,
  updateSgfMetadata,
} from '../domain/sgf'
import type { ResearchTree } from '../types/research'
import type { GameSnapshot } from '../types/game'
import type {
  LibraryData,
  LibraryRecord,
  RecordCollection,
  RecordMetadata,
  ImportResult,
  ReviewState,
} from '../types/library'
import { emptyLibrary } from '../types/library'

const STORAGE_KEY = 'shiguang-go:library:v1'
const fileNameFor = (title: string, extension = 'sgf') =>
  `${(title || '未命名棋谱').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.${extension}`
const now = () => new Date().toISOString()
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
let queue: Promise<unknown> = Promise.resolve()

async function loadData(): Promise<LibraryData> {
  if (isTauri()) return invoke<LibraryData>('library_load')
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return emptyLibrary()
  const parsed = JSON.parse(stored) as LibraryData
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.records) ||
    !Array.isArray(parsed.collections)
  )
    throw new Error('棋谱库数据损坏，请从备份恢复')
  return parsed
}
async function saveData(data: LibraryData) {
  const next = { ...data, revision: data.revision + 1 }
  if (isTauri()) await invoke('library_save', { data: next })
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
// Serialize read/modify/write operations inside this window; SQLite revisions guard
// against another desktop window overwriting a newer transaction.
function mutate<T>(
  operation: (data: LibraryData) => Promise<T> | T,
): Promise<T> {
  const next = queue.then(async () => {
    const data = await loadData()
    const result = await operation(data)
    await saveData(data)
    return result
  })
  queue = next.catch(() => {})
  return next
}
export async function listLibrary() {
  await queue
  return loadData()
}
function buildRecord(
  sgf: string,
  info: RecordMetadata,
  originalSgf = sgf,
  fileName = fileNameFor(info.title),
): LibraryRecord {
  const timestamp = now()
  return {
    ...info,
    id: uid('record'),
    sgf,
    originalSgf,
    fingerprint: '',
    fileName,
    source: 'import',
    favorite: false,
    tags: [],
    collectionIds: [],
    reviewState: 'pending',
    lastNodePath: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    openedAt: null,
    deletedAt: null,
  }
}
export function importSgfFiles(
  files: File[],
  options: { duplicateMode?: 'skip' | 'copy'; collectionId?: string } = {},
): Promise<{ data: LibraryData; results: ImportResult[] }> {
  return mutate(async (data) => {
    const results: ImportResult[] = []
    for (const file of files) {
      try {
        const original = await decodeSgfFile(file),
          roots = readSgf(original)
        for (const [index, root] of roots.entries()) {
          const text = roots.length === 1 ? original : stringify([root]),
            name = roots.length > 1 ? `${file.name} / ${index + 1}` : file.name
          const info = metadata(root, file.name.replace(/\.sgf$/i, ''))
          sgfToResearch(root)
          const fingerprint = await sgfFingerprint(text)
          if (
            options.duplicateMode !== 'copy' &&
            data.records.some(
              (record) =>
                !record.deletedAt && record.fingerprint === fingerprint,
            )
          ) {
            results.push({
              name,
              status: 'duplicate',
              message: '已存在相同棋谱',
            })
            continue
          }
          const record = buildRecord(text, info, original, file.name)
          record.fingerprint = fingerprint
          if (
            options.collectionId &&
            data.collections.some(
              (collection) => collection.id === options.collectionId,
            )
          )
            record.collectionIds = [options.collectionId]
          data.records.unshift(record)
          results.push({
            name,
            status: 'imported',
            message: `${info.black || '黑方'} / ${info.white || '白方'}`,
          })
        }
      } catch (cause) {
        results.push({
          name: file.name,
          status: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    return { data, results }
  }).then((result) => ({
    ...result,
    data: { ...result.data, revision: result.data.revision + 1 },
  }))
}
export function createLibraryRecord(info: Partial<RecordMetadata>) {
  return mutate(async (data) => {
    if (!info.title?.trim()) throw new Error('请输入棋谱名称')
    const sgf = createSgf(info),
      root = readSgf(sgf)[0],
      record = buildRecord(sgf, metadata(root))
    record.source = 'research'
    record.fingerprint = await sgfFingerprint(sgf)
    data.records.unshift(record)
    return record
  })
}
export function saveGameRecord(snapshot: GameSnapshot, info: Partial<RecordMetadata>) {
  return mutate(async data => {
    const sgf = gameToSgf(snapshot, info), fingerprint = await sgfFingerprint(sgf)
    const existing = data.records.find(record => !record.deletedAt && record.fingerprint === fingerprint)
    if (existing) return existing
    const record = buildRecord(sgf, metadata(readSgf(sgf)[0]))
    record.source = 'game'; record.fingerprint = fingerprint; data.records.unshift(record); return record
  })
}
export function updateLibraryRecord(id: string, patch: Partial<LibraryRecord>) {
  return mutate((data) => {
    const record = data.records.find(
      (item) => item.id === id && !item.deletedAt,
    )
    if (!record) throw new Error('找不到这份棋谱，或它已移入回收站')
    for (const key of [
      'favorite',
      'tags',
      'collectionIds',
      'reviewState',
      'lastNodePath',
      'openedAt',
    ] as const) {
      if (patch[key] !== undefined) Object.assign(record, { [key]: patch[key] })
    }
    record.updatedAt = now()
    return record
  })
}
export function updateRecordMetadata(id: string, info: RecordMetadata) {
  return mutate(async (data) => {
    const record = data.records.find(
      (item) => item.id === id && !item.deletedAt,
    )
    if (!record) throw new Error('找不到这份棋谱')
    if (!info.title.trim()) throw new Error('请输入棋谱名称')
    record.sgf = updateSgfMetadata(record.sgf, info)
    Object.assign(record, metadata(readSgf(record.sgf)[0]), {
      updatedAt: now(),
      fingerprint: await sgfFingerprint(record.sgf),
    })
    return record
  })
}
export async function deleteLibraryRecords(ids: string[], permanent = false) {
  await mutate((data) => {
    if (permanent)
      data.records = data.records.filter(
        (record) => !(ids.includes(record.id) && record.deletedAt),
      )
    else
      data.records.forEach((record) => {
        if (ids.includes(record.id)) record.deletedAt = now()
      })
  })
  return listLibrary()
}
export async function restoreLibraryRecords(ids: string[]) {
  await mutate((data) =>
    data.records.forEach((record) => {
      if (ids.includes(record.id)) record.deletedAt = null
    }),
  )
  return listLibrary()
}
export function saveResearchRecord(
  id: string | null,
  tree: ResearchTree,
  patch: Partial<RecordMetadata> = {},
) {
  return mutate(async (data) => {
    const existing = id
      ? data.records.find((record) => record.id === id)
      : undefined
    if (id && (!existing || existing.deletedAt))
      throw new Error('原棋谱已删除，请另存为新棋谱')
    const sgf = researchToSgf(tree, {
        ...(existing
          ? {
              title: existing.title,
              black: existing.black,
              white: existing.white,
            }
          : {}),
        ...patch,
      }),
      info = metadata(readSgf(sgf)[0], '研究棋谱')
    if (existing) {
      Object.assign(existing, info, {
        sgf,
        reviewState: 'reviewing',
        lastNodePath: researchNodePath(tree),
        updatedAt: now(),
        fingerprint: await sgfFingerprint(sgf),
      })
      return existing
    }
    const record = buildRecord(sgf, info)
    record.source = 'research'
    record.reviewState = 'reviewing'
    record.lastNodePath = researchNodePath(tree)
    record.fingerprint = await sgfFingerprint(sgf)
    data.records.unshift(record)
    return record
  })
}
export async function getRecordResearch(id: string) {
  const data = await listLibrary(),
    record = data.records.find((item) => item.id === id && !item.deletedAt)
  if (!record) throw new Error('找不到这份棋谱')
  return {
    record,
    tree: sgfToResearch(readSgf(record.sgf)[0], record.lastNodePath),
  }
}
export function saveCollection(collection: RecordCollection) {
  return mutate((data) => {
    const name = collection.name.trim()
    if (
      !name ||
      data.collections.some(
        (item) => item.id !== collection.id && item.name === name,
      )
    )
      throw new Error('棋谱集名称为空或已存在')
    const next = { ...collection, name }
    const existing = data.collections.find((item) => item.id === next.id)
    if (existing) Object.assign(existing, next)
    else data.collections.push(next)
    return next
  })
}
export async function deleteCollection(id: string) {
  await mutate(data => { data.collections = data.collections.filter(collection => collection.id !== id); data.records.forEach(record => { record.collectionIds = record.collectionIds.filter(value => value !== id) }) })
  return listLibrary()
}
export async function batchLibraryRecords(
  ids: string[],
  options: {
    tag?: string
    collectionId?: string
    reviewState?: ReviewState | ''
  },
) {
  await mutate((data) => {
    data.records
      .filter((record) => !record.deletedAt && ids.includes(record.id))
      .forEach((record) => {
        if (options.tag)
          record.tags = [...new Set([...record.tags, options.tag])]
        if (
          options.collectionId &&
          data.collections.some(
            (collection) => collection.id === options.collectionId,
          )
        )
          record.collectionIds = [
            ...new Set([...record.collectionIds, options.collectionId]),
          ]
        if (options.reviewState) record.reviewState = options.reviewState
        record.updatedAt = now()
      })
  })
  return listLibrary()
}
function browserDownload(contents: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type })),
    anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportFile(
  contents: string,
  name: string,
  kind: 'sgf' | 'json',
): Promise<boolean> {
  if (isTauri())
    return invoke<boolean>('library_export_file', { contents, name, kind })
  browserDownload(
    contents,
    name,
    kind === 'sgf'
      ? 'application/x-go-sgf;charset=utf-8'
      : 'application/json;charset=utf-8',
  )
  return true
}
export async function downloadRecords(records: LibraryRecord[]) {
  if (!records.length) throw new Error('没有选择棋谱')
  return exportFile(
    records.map((record) => record.sgf).join('\n'),
    records.length === 1
      ? fileNameFor(records[0].title)
      : `棋谱集-${records.length}局.sgf`,
    'sgf',
  )
}
export function exportLibraryBackup(data: LibraryData) {
  return exportFile(
    JSON.stringify({ ...data, exportedAt: now() }, null, 2),
    `shiguang-go-library-${new Date().toISOString().slice(0, 10)}.json`,
    'json',
  )
}
export function importLibraryBackup(file: File) {
  return mutate(async (current) => {
    if (file.size > 100 * 1024 * 1024)
      throw new Error('备份文件不能超过 100 MB')
    const parsed = JSON.parse(await file.text()) as LibraryData
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.records) ||
      !Array.isArray(parsed.collections)
    )
      throw new Error('备份文件格式不正确')
    const ids = new Set(current.records.map((record) => record.id)),
      collectionMap = new Map<string, string>()
    for (const collection of parsed.collections) {
      if (typeof collection.id !== 'string' || !collection.name?.trim())
        throw new Error('备份棋谱集格式不正确')
      const same = current.collections.find(
        (item) => item.name === collection.name,
      )
      const id =
        same?.id ??
        (current.collections.some((item) => item.id === collection.id)
          ? uid('collection')
          : collection.id)
      collectionMap.set(collection.id, id)
      if (!same) current.collections.push({ id, name: collection.name })
    }
    for (const source of parsed.records) {
      if (
        typeof source.sgf !== 'string' ||
        typeof source.id !== 'string' ||
        !Array.isArray(source.tags) ||
        source.tags.some((tag) => typeof tag !== 'string') ||
        !Array.isArray(source.collectionIds) ||
        !['pending', 'reviewing', 'completed'].includes(source.reviewState)
      )
        throw new Error('备份棋谱格式不正确')
      const root = readSgf(source.sgf)[0]
      sgfToResearch(root)
      const fingerprint = await sgfFingerprint(source.sgf)
      if (current.records.some(record => record.id === source.id && record.fingerprint === fingerprint)) continue
      const record = buildRecord(
        source.sgf,
        metadata(root),
        typeof source.originalSgf === 'string'
          ? source.originalSgf
          : source.sgf,
      )
      Object.assign(record, {
        id: ids.has(source.id) ? uid('record') : source.id,
        fingerprint,
        favorite: Boolean(source.favorite),
        tags: source.tags,
        collectionIds: source.collectionIds
          .map((id) => collectionMap.get(id))
          .filter((id): id is string => Boolean(id)),
        reviewState: source.reviewState,
        lastNodePath:
          Array.isArray(source.lastNodePath) &&
          source.lastNodePath.every(
            (value) => Number.isInteger(value) && value >= 0,
          )
            ? source.lastNodePath
            : [],
        deletedAt:
          typeof source.deletedAt === 'string' ? source.deletedAt : null,
        source: ['import', 'research', 'game'].includes(source.source)
          ? source.source
          : 'import',
        fileName: typeof source.fileName === 'string' ? source.fileName : record.fileName,
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : record.createdAt,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : record.updatedAt,
        openedAt: typeof source.openedAt === 'string' ? source.openedAt : null,
      })
      current.records.push(record)
      ids.add(record.id)
    }
  }).then(() => listLibrary())
}
export async function readNativeSgfFiles(paths: string[]): Promise<File[]> {
  const result = await invoke<Array<{ name: string; bytes: number[] }>>(
    'library_read_files',
    { paths },
  )
  return result.map(
    (file) =>
      new File([new Uint8Array(file.bytes)], file.name, {
        type: 'application/x-go-sgf',
      }),
  )
}
