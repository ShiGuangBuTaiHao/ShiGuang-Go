import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const base = process.env.QA_URL || 'http://127.0.0.1:5173'
const output = join(tmpdir(), 'shiguang-research-timeline-qa')
await mkdir(output, { recursive: true })

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/#/research`)
    const timeline = page.getByRole('slider', { name: '棋谱进度', exact: true })
    const position = page.getByRole('spinbutton', { name: '跳转节点', exact: true })
    const button = name => page.getByRole('button', { name, exact: true })
    async function check(value, max) {
      await page.waitForFunction(({ value, max }) => {
        const slider = document.querySelector('.move-timeline')
        const position = document.querySelector('.move-position input')
        return position?.value === String(value) && slider?.max === String(max)
      }, { value, max })
      assert.deepEqual(await timeline.evaluate(element => ({ value: Number(element.value), max: Number(element.max) })), { value, max })
    }

    await check(0, 1)
    assert.equal(await timeline.isDisabled(), true)
    for (let move = 1; move <= 7; move++) {
      await button('停一手').click()
      await check(move, move)
    }
    await page.screenshot({ path: join(output, `last-move-${viewport.width}.png`) })
    await button('撤销编辑').click()
    await check(6, 6)
    await button('重做编辑').click()
    await check(7, 7)
    await position.fill('3')
    await position.press('Enter')
    await check(3, 7)
    await timeline.focus()
    await timeline.press('End')
    await check(7, 7)
    await timeline.press('Home')
    await check(0, 7)
    await timeline.press('ArrowRight')
    await check(1, 7)
    assert.deepEqual(errors, [])
    console.log(`PASS research timeline at ${viewport.width}px: append, undo, redo, seek and endpoints`)
    await context.close()
  }
  console.log(`Screenshots: ${output}`)
} finally {
  await browser.close()
}
