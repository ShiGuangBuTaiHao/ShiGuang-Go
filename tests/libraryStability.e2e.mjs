import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(6000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = process.env.QA_URL || 'http://127.0.0.1:5180'
const output = join(tmpdir(), 'shiguang-library-stability')
const button = name => page.getByRole('button', { name, exact: true })
const checkbox = () => page.locator('.collection-list input').first()
const idle = () => page.waitForFunction(() => !document.querySelector('.record-preview[aria-busy="true"]') && !document.querySelector('.favorite-button[aria-busy="true"]'))
async function step(name, run) { await run(); console.log(`PASS ${name}`) }
async function geometry() {
  return page.evaluate(() => Object.fromEntries(['.app-header', '.library-main', '.library-command-row', '.record-list-body', '.record-preview', '.preview-scroll'].map(selector => {
    const node = document.querySelector(selector)
    if (!node) return [selector, null]
    const rect = node.getBoundingClientRect()
    return [selector, [rect.x, rect.y, rect.width, rect.height, node.scrollTop]]
  })))
}
async function observe() {
  await page.evaluate(() => {
    window.qaFrames = []
    window.qaObserving = true
    const frame = () => {
      if (!window.qaObserving) return
      window.qaFrames.push({
        disabled: document.querySelectorAll('.library-workspace :disabled').length,
        opacity: getComputedStyle(document.querySelector('.library-topbar button')).opacity,
        geometry: Object.fromEntries(['.library-main', '.record-list-body', '.preview-scroll'].map(selector => {
          const node = document.querySelector(selector), rect = node.getBoundingClientRect()
          return [selector, [rect.x, rect.y, rect.width, rect.height, node.scrollTop]]
        })),
      })
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.waitForTimeout(30)
}
async function assertStableFrames() {
  const frames = await page.evaluate(() => { window.qaObserving = false; return window.qaFrames })
  assert.ok(frames.length > 3, 'must sample the asynchronous save, not only its end state')
  for (const frame of frames) assert.deepEqual(frame, frames[0], 'unrelated controls and layout must stay stable during saving')
}

try {
  await mkdir(output, { recursive: true })
  await page.goto(`${base}/#/library`)
  await page.waitForSelector('.library-workspace')
  await page.evaluate(() => {
    const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]GN[Stability]PB[Black]PW[White]DT[2026-10-14]RE[B+R];B[dd];W[pp];B[pd];W[dp])'
    const records = Array.from({ length: 85 }, (_, i) => ({
      id: `record-${i}`, title: `Stability ${i}`, black: 'Black', white: 'White', blackRank: '1d', whiteRank: '2d',
      event: 'Training', date: '2026-10-14', result: 'B+R', boardSize: 19, ruleSet: 'chinese', komi: 7.5, moves: 4,
      sgf, originalSgf: sgf, fingerprint: `qa-${i}`, fileName: `${i}.sgf`, source: 'import', favorite: false,
      tags: [], collectionIds: [], reviewState: 'pending', lastNodePath: [],
      createdAt: new Date(Date.now() - i * 10000).toISOString(), updatedAt: new Date(Date.now() - i * 10000).toISOString(), openedAt: null, deletedAt: null,
    }))
    localStorage.setItem('shiguang-go:library:v1', JSON.stringify({ version: 1, revision: 0, records, collections: [{ id: 'collection-one', name: 'Training' }, { id: 'collection-two', name: 'Matches' }] }))
  })
  await page.reload()
  await page.waitForSelector('.record-tile')
  await page.evaluate(async () => {
    const { useLibraryStore } = await import('/src/stores/library.ts')
    window.qaStore = useLibraryStore()
    window.qaPatchCalls = 0
    const patch = window.qaStore.patch
    window.qaStore.patch = async (...args) => {
      window.qaPatchCalls++
      await new Promise(resolve => setTimeout(resolve, 300))
      if (window.qaFailNext) { window.qaFailNext = false; throw new Error('QA save failed') }
      return patch(...args)
    }
  })

  await step('collection saves preserve focus, scroll and unrelated control appearance', async () => {
    await checkbox().scrollIntoViewIfNeeded()
    const before = await geometry()
    await observe()
    await checkbox().check()
    await idle()
    await assertStableFrames()
    assert.deepEqual(await geometry(), before)
    assert.equal(await checkbox().evaluate(node => document.activeElement === node), true)
    assert.equal(await checkbox().isChecked(), true)
  })
  await step('failed collection saves restore the checkbox and allow retry', async () => {
    await page.evaluate(() => { window.qaFailNext = true })
    await checkbox().uncheck()
    await idle()
    assert.equal(await checkbox().isChecked(), true)
    assert.ok((await page.locator('.library-toast').innerText()).includes('QA save failed'))
    await checkbox().uncheck()
    await idle()
    assert.equal(await checkbox().isChecked(), false)
  })
  await step('repeated favorite clicks cannot race or flash the whole workspace', async () => {
    const favorite = page.locator('.record-tile .favorite-button').first()
    await favorite.scrollIntoViewIfNeeded()
    const calls = await page.evaluate(() => window.qaPatchCalls)
    await observe()
    await favorite.dblclick()
    await idle()
    await assertStableFrames()
    assert.equal(await page.evaluate(() => window.qaPatchCalls), calls + 1)
    assert.equal(await favorite.getAttribute('aria-pressed'), 'true')
  })
  await step('review state saves do not reset inspector or list scroll', async () => {
    await button('复盘状态').scrollIntoViewIfNeeded()
    const before = await geometry()
    await button('复盘状态').click()
    await page.getByRole('option', { name: '复盘中', exact: true }).click()
    await idle()
    assert.deepEqual(await geometry(), before)
    assert.equal(await button('复盘状态').innerText(), '复盘中')
  })
  await step('tag writes keep unrelated layout and controls stable', async () => {
    await page.getByRole('textbox', { name: '添加标签', exact: true }).fill('Practice')
    const before = await geometry()
    const collectionBefore = await page.locator('.collection-list').boundingBox()
    await button('确认添加标签').click()
    await idle()
    assert.equal(await button('删除标签 Practice').count(), 1)
    assert.deepEqual(await geometry(), before)
    assert.deepEqual(await page.locator('.collection-list').boundingBox(), collectionBefore)
    await button('删除标签 Practice').click()
    await idle()
    assert.equal(await button('删除标签 Practice').count(), 0)
    assert.deepEqual(await geometry(), before)
    assert.deepEqual(await page.locator('.collection-list').boundingBox(), collectionBefore)
    assert.equal(await page.locator('.library-topbar button').first().evaluate(node => getComputedStyle(node).opacity), '1')
  })
  await step('scrolled favorites and incremental loading retain the list position', async () => {
    await button('列表视图').click()
    await page.locator('.record-list-body').evaluate(node => { node.scrollTop = node.scrollHeight - node.clientHeight - 10 })
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 40)
    const before = (await geometry())['.record-list-body']
    assert.ok(before[4] > 0)
    const favorite = page.locator('tbody .favorite-button').nth(30)
    await favorite.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    const scrolled = await geometry()
    await observe()
    await favorite.click()
    await idle()
    await assertStableFrames()
    assert.deepEqual(await geometry(), scrolled)
  })
  await step('filter chips and search never move the list origin', async () => {
    const before = (await geometry())['.record-list-body'].slice(0, 4)
    await button('棋盘尺寸').click()
    await page.getByRole('option', { name: '19 路', exact: true }).click()
    assert.deepEqual((await geometry())['.record-list-body'].slice(0, 4), before)
    await page.getByRole('searchbox').fill('Stability')
    assert.deepEqual((await geometry())['.record-list-body'].slice(0, 4), before)
    await button('清空条件').click()
    assert.deepEqual((await geometry())['.record-list-body'].slice(0, 4), before)
  })
  await step('metadata dialog closes without scrolling its trigger into a new position', async () => {
    await button('编辑棋谱信息').first().scrollIntoViewIfNeeded()
    const before = await geometry()
    await button('编辑棋谱信息').first().click()
    const dialog = page.getByRole('dialog', { name: '编辑棋谱信息' })
    await dialog.getByLabel('赛事', { exact: true }).fill('Updated')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await geometry(), before)
  })
  await step('list and grid selection keep the content origin at desktop and mobile sizes', async () => {
    for (const width of [1440, 1024, 800, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const view of ['列表视图', '棋盘视图']) {
        await button(view).click()
        const select = page.getByRole('checkbox', { name: '选择 Stability 0', exact: true })
        await select.scrollIntoViewIfNeeded()
        const before = await geometry()
        await select.check()
        assert.deepEqual(await geometry(), before, `${width}px ${view} selection`)
        const overflow = await page.locator('.library-command-row').evaluate(node => {
          const rect = node.getBoundingClientRect()
          return [...node.querySelectorAll('button')].some(child => { const box = child.getBoundingClientRect(); return box.top < rect.top || box.bottom > rect.bottom || box.right > rect.right })
        })
        assert.equal(overflow, false, `${width}px batch commands must fit`)
        await button('取消选择').click()
        assert.deepEqual(await geometry(), before, `${width}px ${view} cancellation`)
      }
      await page.screenshot({ path: join(output, `library-${width}.png`) })
    }
  })
  assert.deepEqual(errors, [])
  console.log(`Screenshots: ${output}`)
} finally { await browser.close() }
