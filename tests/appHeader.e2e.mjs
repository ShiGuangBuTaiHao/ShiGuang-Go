import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const base = process.env.QA_URL || 'http://127.0.0.1:5173'
const entries = [
  ['/play/ai', '人机对局'],
  ['/play/human', '本地对局'],
  ['/play/lan', '局域网对局'],
  ['/research', '研究盘'],
  ['/library', '棋谱库'],
  ['/settings', '设置'],
  ['/', ''],
]

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    for (const [path, label] of entries) {
      await page.goto(`${base}/#${path}`)
      const expected = `时光围棋${label ? `·${label}` : ''}`
      await page.waitForFunction(expected => document.querySelector('.brand-title')?.textContent.replace(/\s+/g, '') === expected, expected)
      const metrics = await page.locator('.app-header').evaluate(element => {
        const brand = element.querySelector('.brand').getBoundingClientRect()
        const actions = element.querySelector('.header-actions, .home-header-right')?.getBoundingClientRect()
        return {
          overlap: actions ? brand.right > actions.left + 1 : false,
          overflow: element.scrollWidth > element.clientWidth + 1,
        }
      })
      assert.deepEqual(metrics, { overlap: false, overflow: false }, `${path} at ${width}px`)
      if (label) {
        const typography = await page.locator('.brand-title').evaluate(element => {
          const main = element.firstElementChild
          const subtitle = element.querySelector('.brand-subtitle')
          const mainRect = main.getBoundingClientRect()
          const subtitleRect = subtitle.getBoundingClientRect()
          return {
            weight: getComputedStyle(subtitle).fontWeight,
            mainWeight: getComputedStyle(main).fontWeight,
            color: getComputedStyle(subtitle).color,
            mainColor: getComputedStyle(main).color,
            fontSize: getComputedStyle(subtitle).fontSize,
            mainFontSize: getComputedStyle(main).fontSize,
            lineHeight: getComputedStyle(subtitle).lineHeight,
            mainLineHeight: getComputedStyle(main).lineHeight,
            alignment: getComputedStyle(element).alignItems,
            centerOffset: Math.abs((mainRect.top + mainRect.bottom - subtitleRect.top - subtitleRect.bottom) / 2),
            sameRow: Math.abs(mainRect.left - subtitleRect.left) > 1,
          }
        })
        assert.equal(typography.weight, '600')
        assert.equal(typography.weight, typography.mainWeight)
        assert.equal(typography.color, typography.mainColor)
        assert.equal(typography.fontSize, typography.mainFontSize)
        assert.equal(typography.lineHeight, typography.mainLineHeight)
        assert.equal(typography.alignment, 'center')
        if (typography.sameRow) assert.ok(typography.centerOffset < 1, `${path} at ${width}px`)
      }
    }
    await page.goto(`${base}/#/play/ai`)
    await page.waitForFunction(() => document.querySelector('.brand-subtitle')?.textContent.includes('人机对局'))
    await page.screenshot({ path: join(tmpdir(), `shiguang-header-${width}.png`) })
    await context.close()
    console.log(`PASS entry titles and header layout at ${width}px`)
  }
} finally {
  await browser.close()
}
