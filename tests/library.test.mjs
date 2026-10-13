import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test, beforeEach } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function moduleUrl(path, imports = {}) {
  let code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText
  for (const [specifier, url] of Object.entries(imports))
    code = code.replaceAll(`'${specifier}'`, `'${url}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const sgfCommonjs = pathToFileURL(require.resolve('@sabaki/sgf')).href
const sgfLibrary = `data:text/javascript;base64,${Buffer.from(`import sgf from '${sgfCommonjs}'; export const { parse, stringify, tokenizeIter } = sgf;`).toString('base64')}`
const boardLibrary = pathToFileURL(require.resolve('@sabaki/go-board')).href
const sgfUrl = moduleUrl('../src/domain/sgf.ts', {
  '@sabaki/sgf': sgfLibrary,
  '@sabaki/go-board': boardLibrary,
})
const domain = await import(sgfUrl)
const typesUrl = moduleUrl('../src/types/library.ts')
const tauriStub = `data:text/javascript;base64,${Buffer.from('export const isTauri = () => false; export const invoke = () => { throw new Error("unexpected native call") }').toString('base64')}`
const service = await import(
  moduleUrl('../src/services/library.ts', {
    '@tauri-apps/api/core': tauriStub,
    '@sabaki/sgf': sgfLibrary,
    '../domain/sgf': sgfUrl,
    '../types/library': typesUrl,
  })
)
const storage = new Map()
let failWrites = false
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    if (failWrites) throw new Error('disk full')
    storage.set(key, value)
  },
}
beforeEach(() => {
  storage.clear()
  failWrites = false
})
const contents =
  '(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]GN[中文棋谱]PB[黑方]PW[白方]XX[unknown]AB[dd][pd]HA[2]C[中文\\]备注];W[pp](;B[dp]TR[dp]C[主线])(;B[qq]LB[qq:A]))'

test('SGF preserves branches, setup, comments, marks and unknown properties', () => {
  const root = domain.readSgf(contents)[0]
  const tree = domain.sgfToResearch(root, [0, 1])
  assert.equal(tree.komi, 3.75)
  assert.equal(tree.nodes[tree.rootId].snapshot.currentPlayer, 'white')
  assert.equal(tree.nodes[tree.rootId].snapshot.board[3][3], 'black')
  assert.equal(tree.nodes[tree.currentNodeId].move.coordinate, 'R3')
  assert.deepEqual(domain.researchNodePath(tree), [0, 1])
  const exported = domain.researchToSgf({ ...tree, komi: 7.5 })
  const again = domain.readSgf(exported)[0]
  assert.deepEqual(again.data.XX, ['unknown'])
  assert.equal(again.data.C[0], '中文]备注')
  assert.equal(again.children[0].children.length, 2)
  assert.equal(again.children[0].children[1].data.LB[0], 'qq:A')
  assert.equal(domain.metadata(again).moves, 2)
})
test('invalid and incomplete SGF fails before insertion', () => {
  for (const text of [
    'not sgf',
    '(;GM[1]',
    '(;GM[2])',
    '(;GM[1]SZ[12])',
    '(;GM[1]KM[nan])',
  ])
    assert.throws(() => domain.readSgf(text))
})
test('imports multi-game collections and skips equivalent SGF', async () => {
  const file = new File([contents], 'one.sgf')
  const first = await service.importSgfFiles([file])
  assert.equal(first.results[0].status, 'imported')
  const second = await service.importSgfFiles([file])
  assert.equal(second.results[0].status, 'duplicate')
  const copied = await service.importSgfFiles([file], { duplicateMode: 'copy' })
  assert.equal(copied.data.records.length, 2)
  const collection = await service.importSgfFiles([
    new File(['(;GM[1]SZ[9]GN[one])(;GM[1]SZ[13]GN[two])'], 'collection.sgf'),
  ])
  assert.equal(collection.results.length, 2)
  assert.equal(collection.data.records.length, 4)
})
test('metadata edits update SGF and cannot replace content with stale record fields', async () => {
  const { data } = await service.importSgfFiles([
    new File([contents], 'one.sgf'),
  ])
  const record = data.records[0]
  const next = await service.updateRecordMetadata(record.id, {
    ...record,
    title: '新名称',
    event: '赛事',
  })
  assert.equal(domain.readSgf(next.sgf)[0].data.GN[0], '新名称')
  assert.equal(next.originalSgf, contents)
  assert.equal(next.title, '新名称')
})
test('serialized updates do not lose concurrent favorite and tag edits', async () => {
  const record = await service.createLibraryRecord({
    title: 'test',
    boardSize: 9,
  })
  await Promise.all([
    service.updateLibraryRecord(record.id, { favorite: true }),
    service.updateLibraryRecord(record.id, { tags: ['训练'] }),
  ])
  const saved = (await service.listLibrary()).records[0]
  assert.equal(saved.favorite, true)
  assert.deepEqual(saved.tags, ['训练'])
})
test('trash is restorable and permanent deletion only removes trashed records', async () => {
  const record = await service.createLibraryRecord({ title: 'test' })
  await service.deleteLibraryRecords([record.id], true)
  assert.equal((await service.listLibrary()).records.length, 1)
  await service.deleteLibraryRecords([record.id])
  assert.ok((await service.listLibrary()).records[0].deletedAt)
  await service.restoreLibraryRecords([record.id])
  assert.equal((await service.listLibrary()).records[0].deletedAt, null)
  await service.deleteLibraryRecords([record.id])
  await service.deleteLibraryRecords([record.id], true)
  assert.equal((await service.listLibrary()).records.length, 0)
})
test('storage failure propagates and does not silently claim success', async () => {
  failWrites = true
  await assert.rejects(
    service.createLibraryRecord({ title: 'test' }),
    /disk full/,
  )
  failWrites = false
  assert.equal((await service.listLibrary()).records.length, 0)
})
test('damaged storage is not overwritten with an empty library', async () => {
  storage.set('shiguang-go:library:v1', '{broken')
  await assert.rejects(service.listLibrary())
  assert.equal(storage.get('shiguang-go:library:v1'), '{broken')
})
test('backup merge resolves id collisions, validates content and keeps current records', async () => {
  const record = await service.createLibraryRecord({ title: 'existing' })
  const source = {
    ...record,
    title: 'new',
    sgf: '(;GM[1]SZ[9]GN[new])',
    fingerprint: 'different',
    favorite: true,
  }
  const restored = await service.importLibraryBackup(
    new File(
      [JSON.stringify({ version: 1, records: [source], collections: [] })],
      'backup.json',
    ),
  )
  assert.equal(restored.records.length, 2)
  assert.notEqual(restored.records[0].id, restored.records[1].id)
  assert.equal(restored.records[1].favorite, true)
})
test('game archiving preserves moves, passes and authoritative referee result', async () => {
  const snapshot = { board: Array.from({ length: 19 }, () => Array(19).fill(null)), moves: [{ stone: 'black', coordinate: 'D16' }, { stone: 'white', coordinate: 'pass' }], result: { winner: 'black', loser: 'white', reason: 'score', score: { engine: 'gnugo', finalScore: 'B+4.5', margin: 4.5 } } }
  const record = await service.saveGameRecord(snapshot, { title: '对局', ruleSet: 'chinese', komi: 7.5 })
  assert.equal(record.source, 'game')
  assert.equal(record.moves, 2)
  const root = domain.readSgf(record.sgf)[0]
  assert.deepEqual(root.data.RE, ['B+4.5'])
  assert.deepEqual(root.data.KM, ['7.5'])
  assert.deepEqual(root.children[0].data.B, ['dd'])
  assert.deepEqual(root.children[0].children[0].data.W, [''])
  await service.saveGameRecord(snapshot, { title: '对局', ruleSet: 'chinese', komi: 7.5 })
  assert.equal((await service.listLibrary()).records.length, 1)
})
test('backup keeps deliberate duplicates and recent-open metadata', async () => {
  await service.importSgfFiles([new File([contents], 'a.sgf')])
  await service.importSgfFiles([new File([contents], 'a.sgf')], { duplicateMode: 'copy' })
  const data = await service.listLibrary()
  data.records[0].openedAt = '2026-10-14T00:00:00Z'
  storage.clear()
  const restored = await service.importLibraryBackup(new File([JSON.stringify(data)], 'backup.json'))
  assert.equal(restored.records.length, 2)
  assert.equal(restored.records[0].openedAt, '2026-10-14T00:00:00Z')
})
test('collection rename/delete only changes organization, not game content', async () => {
  const collection = await service.saveCollection({ id: 'collection-a', name: '训练' })
  const { data } = await service.importSgfFiles([new File([contents], 'a.sgf')], { collectionId: collection.id })
  assert.deepEqual(data.records[0].collectionIds, [collection.id])
  await service.saveCollection({ id: collection.id, name: '复盘训练' })
  const next = await service.deleteCollection(collection.id)
  assert.equal(next.records.length, 1)
  assert.deepEqual(next.records[0].collectionIds, [])
  assert.equal(next.records[0].sgf, contents)
})
test('saving further research resets completed state and preserves exact Chinese komi', async () => {
  const record = await service.createLibraryRecord({ title: '训练', ruleSet: 'chinese', komi: 7.5 })
  await service.updateLibraryRecord(record.id, { reviewState: 'completed' })
  const tree = (await service.getRecordResearch(record.id)).tree
  assert.equal(tree.komi, 3.75)
  tree.nodes[tree.rootId].comment = '新增复盘'
  const saved = await service.saveResearchRecord(record.id, { ...tree, komi: tree.komi * 2 })
  assert.equal(saved.komi, 7.5)
  assert.equal(saved.reviewState, 'reviewing')
  assert.match(saved.sgf, /新增复盘/)
})
