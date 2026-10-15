import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function moduleUrl(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  for (const [specifier, url] of Object.entries(imports)) code = code.replaceAll(`'${specifier}'`, `'${url}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const types = moduleUrl('../src/types/library.ts')
const { filterChips, filterLibraryRecords, pageCount, preserveRecordOrder, LIBRARY_PAGE_SIZE } = await import(moduleUrl('../src/components/library/workspace.ts', { '../../types/library': types }))
const emptyFilters = { sizeFilter: '', sourceFilter: '', reviewFilter: '', fromDate: '', toDate: '' }
const records = [
  { id: 'a', title: 'Game 10', black: 'A', white: 'B', boardSize: 19, source: 'import', reviewState: 'pending', date: '2026-10-01', tags: ['training'], collectionIds: ['collection-1'], updatedAt: '2026-10-03', openedAt: '2026-10-02' },
  { id: 'b', title: 'Game 2', black: 'C', white: 'D', boardSize: 9, source: 'game', reviewState: 'completed', date: '2026-10-02', tags: [], collectionIds: [], updatedAt: '2026-10-02', openedAt: '2026-10-03' },
  { id: 'c', title: 'Game 1', black: 'E', white: 'F', boardSize: 19, source: 'research', reviewState: 'reviewing', date: '', tags: ['training'], collectionIds: ['collection-2'], updatedAt: '2026-10-01', openedAt: null },
]
const ids = values => values.map(record => record.id)

test('collection and tag views constrain the result without changing original records', () => {
  assert.deepEqual(ids(filterLibraryRecords(records, 'collection-1', emptyFilters, 'title', true)), ['a'])
  assert.deepEqual(ids(filterLibraryRecords(records, 'tag:training', emptyFilters, 'title', true)), ['c', 'a'])
  assert.deepEqual(ids(records), ['a', 'b', 'c'])
})
test('filters intersect and date boundaries are inclusive', () => {
  assert.deepEqual(ids(filterLibraryRecords(records, 'all', { ...emptyFilters, sizeFilter: '19', sourceFilter: 'import', reviewFilter: 'pending', fromDate: '2026-10-01', toDate: '2026-10-01' }, 'date', true)), ['a'])
  assert.deepEqual(ids(filterLibraryRecords(records, 'all', { ...emptyFilters, fromDate: '2026-10-02' }, 'date', true)), ['b'])
  assert.deepEqual(ids(filterLibraryRecords(records, 'all', { ...emptyFilters, fromDate: '2026-10-03', toDate: '2026-10-01' }, 'date', true)), [])
})
test('recent view defaults to opened time and both sort directions work', () => {
  assert.deepEqual(ids(filterLibraryRecords(records.slice(0, 2), 'recent', emptyFilters, 'updatedAt', false)), ['b', 'a'])
  assert.deepEqual(ids(filterLibraryRecords(records, 'all', emptyFilters, 'title', true)), ['c', 'b', 'a'])
  assert.deepEqual(ids(filterLibraryRecords(records, 'all', emptyFilters, 'title', false)), ['a', 'b', 'c'])
  assert.deepEqual(ids(filterLibraryRecords(records, 'all', emptyFilters, 'players', true)), ['a', 'b', 'c'])
})
test('record updates keep the visible order while new and filtered records remain predictable', () => {
  const updated = records.map(record => record.id === 'a' ? { ...record, updatedAt: '2026-10-05' } : record)
  const sorted = filterLibraryRecords(updated, 'all', emptyFilters, 'updatedAt', false)
  assert.deepEqual(ids(sorted), ['a', 'b', 'c'])
  assert.deepEqual(ids(preserveRecordOrder(sorted, ['b', 'c', 'a'])), ['b', 'c', 'a'])
  assert.deepEqual(ids(preserveRecordOrder(sorted.filter(record => record.id !== 'c'), ['b', 'c', 'a'])), ['b', 'a'])
  assert.deepEqual(ids(preserveRecordOrder([...sorted, { ...records[0], id: 'new' }], ['b', 'c', 'a'])), ['new', 'b', 'c', 'a'])
})
test('active chips retain individual removable filter keys', () => {
  assert.deepEqual(filterChips(emptyFilters), [])
  const chips = filterChips({ sizeFilter: '19', sourceFilter: 'import', reviewFilter: 'pending', fromDate: '2026-10-01', toDate: '2026-10-02' })
  assert.deepEqual(chips.map(chip => chip.key), Object.keys(emptyFilters))
  assert.equal(chips[0].label, '19 路')
  assert.equal(chips[1].label, 'SGF 导入')
  assert.equal(chips[2].label, '待复盘')
})
test('pagination has a stable size and always at least one page', () => {
  assert.equal(LIBRARY_PAGE_SIZE, 40)
  assert.equal(pageCount(0), 1)
  assert.equal(pageCount(40), 1)
  assert.equal(pageCount(41), 2)
  assert.equal(pageCount(80), 2)
})
