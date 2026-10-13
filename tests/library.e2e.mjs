import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
page.setDefaultTimeout(6000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = process.env.QA_URL || 'http://127.0.0.1:5173'
const output = join(tmpdir(), 'shiguang-library-qa')
await mkdir(output, { recursive: true })
const button = name => page.getByRole('button', { name, exact: true })
const modal = () => page.locator('.library-dialog[open]')
const search = () => page.getByRole('searchbox', { name: '搜索棋谱', exact: true })
const waitRows = count => page.waitForFunction(value => document.querySelectorAll('tbody tr').length === value, count)
const data = () => page.evaluate(() => JSON.parse(localStorage.getItem('shiguang-go:library:v1')))
async function screenshot(name) { await page.screenshot({ path: join(output, `${name}.png`) }) }
async function step(name, work) { await work(); console.log(`PASS ${name}`) }
async function noOverflow() {
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('.library-main')
    return { viewport: innerWidth, body: document.documentElement.scrollWidth, list: main?.clientWidth, listContent: main?.scrollWidth }
  })
  assert.ok(metrics.body <= metrics.viewport + 1, JSON.stringify(metrics))
  if (metrics.list) assert.ok(metrics.listContent <= metrics.list + 1, JSON.stringify(metrics))
}
async function headerStyle() {
  return page.locator('.app-header').evaluate(element => {
    const style = getComputedStyle(element)
    return Object.fromEntries(['height', 'backgroundColor', 'backdropFilter', 'paddingLeft'].map(key => [key, style[key]]))
  })
}

try {
  await page.goto(`${base}/#/library`)
  await step('empty state and shared app header', async () => {
    await page.getByRole('heading', { name: '暂无棋谱', exact: true }).waitFor()
    assert.equal(await page.locator('.app-header.workspace-header').count(), 1)
    assert.equal(await button('返回主菜单').count(), 0)
    assert.equal(await button('返回主界面').count(), 1)
    assert.equal(await page.locator('.library-topbar').evaluate(element => element.offsetHeight), 52)
    assert.deepEqual(await page.locator('.library-topbar .workspace-button.primary').evaluate(element => {
      const style = getComputedStyle(element)
      return { display: style.display, background: style.backgroundColor, radius: style.borderRadius }
    }), { display: 'flex', background: 'rgb(0, 120, 212)', radius: '5px' })
    assert.equal(await page.getByRole('navigation', { name: '棋谱分类', exact: true }).count(), 1)
    await screenshot('library-empty')
  })
  await step('SGF import and preview playback', async () => {
    await page.locator('input[type=file][accept=".sgf"]').setInputFiles([
      { name: 'training.sgf', mimeType: 'application/x-go-sgf', buffer: Buffer.from('(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]GN[训练棋谱]PB[黑方棋手]PW[白方棋手]DT[2026-10-14]RE[B+R]EV[练习赛];B[dd];W[pp];B[pd];W[dp])') },
      { name: 'small.sgf', mimeType: 'application/x-go-sgf', buffer: Buffer.from('(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[7.5]GN[九路练习]PB[甲]PW[乙]DT[2026-10-13];B[cc];W[gg])') },
    ])
    await button('开始导入').click()
    await button('完成').click()
    await waitRows(2)
    await button('预览 训练棋谱').click()
    await button('下一手').click()
    assert.match(await page.locator('.move-counter').innerText(), /^1 \/ 4/)
    await button('播放棋谱').click()
    await page.waitForFunction(() => document.querySelector('.move-counter')?.textContent?.startsWith('2'))
    await button('暂停播放').click()
    await button('终局局面').click()
    assert.match(await page.locator('.move-counter').innerText(), /^4 \/ 4/)
    await screenshot('library-desktop')
    await noOverflow()
  })
  await step('filters, search, batch organization, metadata and favorites', async () => {
    await button('筛选').click()
    await page.getByLabel('棋盘尺寸', { exact: true }).selectOption('19')
    await waitRows(1)
    await button('移除筛选 19 路').click()
    await waitRows(2)
    await search().fill('NO_MATCH')
    await page.getByRole('heading', { name: '没有符合条件的棋谱', exact: true }).waitFor()
    await button('清空搜索').click()
    await waitRows(2)
    await button('筛选').click()
    await page.getByRole('checkbox', { name: '选择 训练棋谱', exact: true }).check()
    assert.equal(await page.locator('.library-search').count(), 0)
    await button('整理').click()
    await modal().getByLabel('添加标签', { exact: true }).fill('布局训练')
    await modal().getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.library-dialog[open]'))
    await button('预览 训练棋谱').click()
    await button('编辑棋谱信息').first().click()
    await modal().getByLabel('棋谱名称', { exact: true }).fill('训练棋谱（已编辑）')
    await modal().getByRole('button', { name: '保存', exact: true }).click()
    await button('预览 训练棋谱（已编辑）').waitFor()
    await button('收藏 训练棋谱（已编辑）').click()
    await button('我的收藏 1').click()
    await waitRows(1)
    await button('全部棋谱 2').click()
    await waitRows(2)
    assert.ok((await data()).records.some(record => record.tags.includes('布局训练') && record.favorite))
  })
  await step('collections and backup export', async () => {
    await button('新建棋谱集').click()
    await modal().getByLabel('名称', { exact: true }).fill('训练集')
    await modal().getByRole('button', { name: '创建', exact: true }).click()
    await page.getByRole('heading', { name: '棋谱集为空', exact: true }).waitFor()
    await button('全部棋谱 2').click()
    await page.getByRole('checkbox', { name: '选择 训练棋谱（已编辑）', exact: true }).check()
    await button('整理').click()
    await modal().getByLabel(/^加入棋谱集/).selectOption({ label: '训练集' })
    await modal().getByRole('button', { name: '保存', exact: true }).click()
    await button('训练集 1').click()
    await waitRows(1)
    await button('全部棋谱 2').click()
    await page.getByLabel('棋谱库更多操作', { exact: true }).click()
    const [downloaded] = await Promise.all([page.waitForEvent('download'), button('导出整库备份').click()])
    assert.match(downloaded.suggestedFilename(), /\.json$/)
  })
  await step('trash restore and permanent removal', async () => {
    await page.getByRole('checkbox', { name: '选择 九路练习', exact: true }).check()
    await button('删除').click()
    await modal().getByRole('button', { name: '移入回收站', exact: true }).click()
    await waitRows(1)
    await button('回收站 1').click()
    await waitRows(1)
    await button('预览 九路练习').click()
    assert.equal(await button('在研究盘打开').count(), 0)
    await button('恢复棋谱').click()
    await page.getByRole('heading', { name: '回收站为空', exact: true }).waitFor()
    await button('全部棋谱 2').click()
    await page.getByRole('checkbox', { name: '选择 九路练习', exact: true }).check()
    await button('删除').click()
    await modal().getByRole('button', { name: '移入回收站', exact: true }).click()
    await waitRows(1)
    await button('回收站 1').click()
    await page.getByRole('checkbox', { name: '选择 九路练习', exact: true }).check()
    await button('永久删除').click()
    await modal().getByRole('button', { name: '永久删除', exact: true }).click()
    await page.getByRole('heading', { name: '回收站为空', exact: true }).waitFor()
    assert.equal((await data()).records.length, 1)
    await button('全部棋谱 1').click()
  })
  await step('grid thumbnails and responsive drawers', async () => {
    await button('棋盘视图').click()
    await page.locator('.tile-board .record-board').waitFor()
    await screenshot('library-grid')
    await button('列表视图').click()
    for (const width of [1280, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 800 })
      await noOverflow()
      await button('预览 训练棋谱（已编辑）').click()
      if (width < 1280) {
        await page.locator('.pane-right:modal').waitFor()
        assert.equal(await page.locator('.pane-right:modal').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
        await screenshot(`library-preview-${width}`)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('.pane-right:modal'))
        assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), /^预览 /)
      }
      if (width < 900) {
        await button('切换分类导航').click()
        await page.locator('.pane-left:modal').waitFor()
        await page.getByRole('button', { name: '我的收藏 1', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.pane-left:modal'))
        await waitRows(1)
        await button('切换分类导航').click()
        await page.getByRole('button', { name: '全部棋谱 1', exact: true }).click()
      }
      await screenshot(`library-${width}`)
      if (width < 500) {
        await button('棋盘视图').click()
        await page.locator('.tile-board .record-board').waitFor()
        await noOverflow()
        await screenshot(`library-grid-${width}`)
        await button('列表视图').click()
      }
    }
  })
  await step('research navigation and matching app-header styles', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const libraryHeader = await headerStyle()
    const libraryIcon = await button('切换棋谱详情').evaluate(element => {
      const style = getComputedStyle(element)
      return { width: style.width, height: style.height, background: style.backgroundColor, border: style.borderRadius }
    })
    await button('预览 训练棋谱（已编辑）').click()
    await button('在研究盘打开').click()
    await page.locator('.research-workbench').waitFor()
    assert.equal(await page.locator('.document-toolbar').evaluate(element => getComputedStyle(element).display), 'flex')
    assert.deepEqual(await headerStyle(), libraryHeader)
    assert.deepEqual(await button('返回棋谱库').evaluate(element => {
      const style = getComputedStyle(element)
      return { width: style.width, height: style.height, background: style.backgroundColor, border: style.borderRadius }
    }), libraryIcon)
    await screenshot('research-shared-style')
    await button('返回棋谱库').click()
    await page.locator('.library-workspace').waitFor()
    for (const route of ['play/human', 'play/ai']) {
      await page.goto(`${base}/#/${route}`)
      await page.locator('.game-area').waitFor()
      assert.deepEqual(await headerStyle(), libraryHeader)
      assert.equal(await page.locator('.sidebar-shell.workspace-surface').count(), 1)
      await screenshot(route.replace('/', '-'))
    }
  })
  await step('pagination and scroll reset', async () => {
    await page.goto(`${base}/#/library`)
    await page.locator('.library-workspace').waitFor()
    await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('shiguang-go:library:v1'))
      const template = value.records[0]
      value.records = Array.from({ length: 85 }, (_, index) => ({ ...template, id: `record-qa-${index}`, title: `棋谱 ${index + 1}` }))
      localStorage.setItem('shiguang-go:library:v1', JSON.stringify(value))
    })
    await page.reload()
    await waitRows(40)
    await button('下一页').click()
    await waitRows(40)
    assert.equal(await page.getByRole('spinbutton', { name: '页码' }).inputValue(), '2')
    await button('下一页').click()
    await waitRows(5)
    await search().fill('棋谱 85')
    await waitRows(1)
    assert.equal(await page.getByRole('spinbutton', { name: '页码' }).inputValue(), '1')
    await button('清空搜索').click()
    await waitRows(40)
    await page.locator('.record-list-body').evaluate(element => { element.scrollTop = 300 })
    await page.getByLabel('棋谱排序', { exact: true }).selectOption('title')
    await page.waitForFunction(() => document.querySelector('.record-list-body').scrollTop === 0)
  })
  await step('touch layout, drawer focus and app-header navigation', async () => {
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const touchPage = await touchContext.newPage()
    touchPage.on('pageerror', error => errors.push(error.message))
    await touchPage.goto(`${base}/#/library`)
    await touchPage.getByRole('heading', { name: '暂无棋谱', exact: true }).waitFor()
    await touchPage.getByRole('button', { name: '切换分类导航', exact: true }).click()
    await touchPage.locator('.pane-left:modal').waitFor()
    await touchPage.keyboard.press('Tab')
    assert.equal(await touchPage.evaluate(() => Boolean(document.activeElement?.closest('.pane-left'))), true)
    await touchPage.keyboard.press('Escape')
    await touchPage.waitForFunction(() => !document.querySelector('.pane-left:modal'))
    await touchPage.screenshot({ path: join(output, 'library-touch.png') })
    assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await touchPage.getByRole('button', { name: '打开设置', exact: true }).click()
    await touchPage.locator('.settings-page').waitFor()
    await touchPage.goto(`${base}/#/library`)
    await touchPage.getByRole('button', { name: '返回主界面', exact: true }).click()
    await touchPage.waitForURL(`${base}/#/`)
    await touchContext.close()
  })
  assert.deepEqual(errors, [])
  console.log(`Browser checks passed. Screenshots: ${output}`)
} catch (error) {
  await screenshot('failure')
  console.error(`Failure screenshot: ${output}`)
  console.error('Browser errors:', errors)
  console.error('Visible error:', await page.locator('.library-error').allTextContents())
  throw error
} finally {
  await browser.close()
}
