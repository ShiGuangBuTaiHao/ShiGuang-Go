import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const base = process.env.QA_URL || 'http://127.0.0.1:5180'
const output = join(tmpdir(), 'shiguang-research-save-stability')
await mkdir(output, { recursive: true })
const errors = []

async function startSampling(page) {
  await page.evaluate(() => {
    window.qaFrames = []
    window.qaSampling = true
    const frame = () => {
      if (!window.qaSampling) return
      window.qaFrames.push({
        nodes: Object.fromEntries(['.document-toolbar', '.document-back-slot', '.document-name', '.document-save-state', '.document-rules', '.document-actions', '.document-save-button', '.research-layout', '.research-board-stage', 'canvas', '.research-library', '.variation-viewport'].map(selector => {
          const node = document.querySelector(selector)
          if (!node) return [selector, null]
          const rect = node.getBoundingClientRect()
          return [selector, [rect.x, rect.y, rect.width, rect.height, node.scrollTop, node.scrollLeft, getComputedStyle(node).opacity]]
        })),
        disabled: document.querySelectorAll('.document-toolbar :disabled').length,
      })
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.waitForTimeout(40)
}
async function assertStable(page) {
  await page.waitForTimeout(50)
  const frames = await page.evaluate(() => { window.qaSampling = false; return window.qaFrames })
  assert.ok(frames.length > 5, 'must measure the delayed operation, not only the saved state')
  for (const frame of frames) assert.deepEqual(frame, frames[0], 'save must not change geometry, scrolling or unrelated disabled styles')
}
async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector('.document-save-button')?.getAttribute('aria-busy') !== 'true')
}

try {
  for (const width of [2560, 1440, 800, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/#/research`)
    await page.waitForSelector('.document-save-button')
    await page.evaluate(async () => {
      const { useResearchStore } = await import('/src/stores/research.ts')
      window.qaResearch = useResearchStore()
      window.qaDigestCalls = 0
      const digest = crypto.subtle.digest.bind(crypto.subtle)
      crypto.subtle.digest = async (...args) => {
        window.qaDigestCalls++
        await new Promise(resolve => setTimeout(resolve, 300))
        return digest(...args)
      }
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (window.qaFailNext && key === 'shiguang-go:library:v1') { window.qaFailNext = false; throw new Error('QA save failed') }
        return setItem.call(this, key, value)
      }
    })
    const save = page.getByRole('button', { name: '保存', exact: true })
    await startSampling(page)
    await save.dblclick()
    assert.equal(await save.getAttribute('aria-busy'), 'true')
    await waitSaved(page)
    await assertStable(page)
    assert.equal(await page.evaluate(() => window.qaDigestCalls), 1, 'double-click must not save twice')
    assert.equal(await page.getByRole('button', { name: '返回棋谱库', exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('shiguang-go:library:v1')).records.length), 1)
    console.log(`PASS ${width}px first save and duplicate-submit protection`)

    await page.getByRole('button', { name: '棋谱库', exact: true }).click()
    await page.waitForSelector('.library-records button')
    await page.evaluate(() => window.qaResearch.setTitle('Save stability'))
    await startSampling(page)
    await save.click()
    await waitSaved(page)
    await assertStable(page)
    assert.equal(await page.locator('.library-records strong').first().innerText(), 'Save stability')
    console.log(`PASS ${width}px repeated save with library open`)

    await page.evaluate(() => { window.qaResearch.setTitle('Retry save'); window.qaFailNext = true })
    await startSampling(page)
    await save.click()
    await waitSaved(page)
    await assertStable(page)
    assert.equal(await page.evaluate(() => window.qaResearch.tree.dirty), true)
    assert.ok((await page.locator('.research-toast.error').innerText()).includes('QA save failed'))
    await save.click()
    await waitSaved(page)
    assert.equal(await page.evaluate(() => window.qaResearch.tree.dirty), false)
    console.log(`PASS ${width}px failure retains unsaved changes and retry succeeds`)

    await page.evaluate(() => window.qaResearch.setTitle('Snapshot title'))
    await save.click()
    await page.evaluate(() => window.qaResearch.setTitle('Edited during save'))
    await waitSaved(page)
    assert.equal(await page.evaluate(() => window.qaResearch.tree.dirty), true, 'in-flight edits must remain dirty')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('shiguang-go:library:v1')).records[0].title), 'Snapshot title')
    await page.screenshot({ path: join(output, `research-save-${width}.png`) })
    console.log(`PASS ${width}px in-flight edits are not marked saved`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log(`Screenshots: ${output}`)
} finally { await browser.close() }
