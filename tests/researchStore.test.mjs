import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { beforeEach, test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const packages = Object.fromEntries(['vue', 'pinia', '@sabaki/sgf', '@sabaki/go-board'].map((name) => [name, pathToFileURL(require.resolve(name)).href]))
function moduleUrl(path, imports = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  for (const [specifier, url] of Object.entries({ ...packages, ...imports })) code = code.replaceAll(`'${specifier}'`, `'${url}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const go = moduleUrl('../src/domain/go.ts')
const tree = moduleUrl('../src/domain/researchTree.ts', { './go': go })
const sgf = moduleUrl('../src/domain/researchSgf.ts', { './go': go, './researchTree': tree })
const { useResearchStore } = await import(moduleUrl('../src/stores/research.ts', { '../domain/researchTree': tree, '../domain/researchSgf': sgf }))
const { createPinia, setActivePinia } = await import(packages.pinia)
const { nextTick } = await import(packages.vue)
const { importResearchSgf, exportResearchSgf } = await import(sgf)
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
beforeEach(() => { storage.clear(); setActivePinia(createPinia()) })

test('saving establishes the undo/redo dirty baseline instead of trusting historical dirty flags', () => {
  const store = useResearchStore()
  store.play(3, 3)
  store.markSaved()
  assert.equal(store.tree.dirty, false)
  store.undo()
  assert.equal(store.tree.dirty, true)
  store.redo()
  assert.equal(store.tree.dirty, false)
  store.play(15, 15)
  store.undo()
  assert.equal(store.tree.dirty, false)
})

test('saving while navigating stays clean, but edits during an in-flight save remain dirty', () => {
  const store = useResearchStore()
  store.play(3, 3)
  const snapshot = store.tree
  store.goFirst()
  store.markSaved(snapshot)
  assert.equal(store.tree.dirty, false)
  store.goLast()
  store.setComment('Edited during save')
  store.markSaved(snapshot)
  assert.equal(store.tree.dirty, true)
  const newer = store.tree
  store.reset()
  store.markSaved(newer)
  assert.equal(Object.keys(store.tree.nodes).length, 1)
})

test('a saved comment starts a new undo group for later typing', () => {
  const store = useResearchStore()
  store.setComment('First')
  store.setComment('First note')
  store.markSaved()
  store.setComment('Second note')
  store.undo()
  assert.equal(store.current.comment, 'First note')
  assert.equal(store.tree.dirty, false)
})

test('draft restore keeps selected variation, saved record identity and exact komi', async () => {
  const store = useResearchStore()
  store.play(3, 3)
  store.play(15, 15)
  store.goBack()
  store.play(15, 3)
  store.recordId = 'record-existing'
  store.markSaved()
  await nextTick()
  const saved = JSON.parse(storage.get('shiguang-go:research-draft:v2'))
  assert.equal(saved.recordId, 'record-existing')
  assert.deepEqual(saved.path, [0, 1])
  setActivePinia(createPinia())
  const restored = useResearchStore()
  assert.equal(restored.recordId, 'record-existing')
  assert.equal(restored.current.move.coordinate, 'D4')
  assert.equal(restored.tree.komi, 3.75)
  assert.equal(restored.tree.dirty, false)
})

test('opening a parsed library tree does not convert Chinese komi twice', () => {
  const store = useResearchStore()
  const imported = importResearchSgf('(;GM[1]SZ[19]KM[7.5]RU[Chinese])')
  store.loadRecord('record-one', 'Library record', imported)
  assert.equal(store.tree.komi, 3.75)
  assert.equal(store.recordId, 'record-one')
  assert.match(exportResearchSgf(store.tree), /KM\[7.5\]/)
})
