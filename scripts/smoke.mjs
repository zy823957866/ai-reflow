import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173'
const outputDir = path.resolve('.artifacts/smoke')
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let previewProcess

/**
 * 等待本地预览服务可访问。
 * @param timeoutMs 最大等待时间。
 * @returns 服务就绪时完成。
 */
async function waitForServer(timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`预览服务启动超时：${baseUrl}`)
}

/**
 * 启动构建产物预览服务。
 * @returns 启动完成时完成。
 */
async function startPreview() {
  if (process.env.SMOKE_BASE_URL) return
  if (!existsSync(path.resolve('apps/web/dist/index.html'))) {
    throw new Error('未找到 apps/web/dist/index.html，请先运行 pnpm build。')
  }
  const viteCli = path.resolve('node_modules/vite/bin/vite.js')
  previewProcess = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForServer()
}

/**
 * 关闭脚本启动的预览服务。
 */
function stopPreview() {
  previewProcess?.kill()
}

/**
 * 检查页面是否产生横向溢出。
 * @param page Playwright 页面。
 * @returns 溢出详情。
 */
async function horizontalOverflow(page) {
  return page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))
}

/**
 * 打开页面并等待首屏稳定。
 * @param page Playwright 页面。
 * @param route 路由地址。
 */
async function openRoute(page, route) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.trim().length > 8)
  await page.waitForTimeout(350)
}

/**
 * 执行桌面与移动端关键路径验收。
 * @returns 验收摘要。
 */
async function runSmoke() {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await startPreview()

  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(chromePath) ? chromePath : undefined,
  })
  const failures = []
  const desktopRoutes = [
    ['home', '/'],
    ['runs', '/runs'],
    ['knowledge', '/knowledge'],
    ['mcp', '/mcp'],
    ['models', '/models'],
    ['nodes', '/nodes'],
    ['templates', '/templates'],
    ['plugins', '/plugins'],
    ['editor', '/workflows/wf_support'],
    ['versions', '/workflows/wf_support/versions'],
    ['trial', '/workflows/wf_support/trial?versionId=ver_support_12'],
    ['run-detail', '/runs'],
  ]

  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await desktop.newPage()
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    for (const [name, route] of desktopRoutes) {
      consoleErrors.length = 0
      await openRoute(page, route)
      if (name === 'run-detail') {
        const runLink = page.locator('a[href^="/runs/"]').first()
        if (await runLink.count()) {
          await runLink.click()
          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(350)
        }
      }
      const overflow = await horizontalOverflow(page)
      if (overflow.overflowing) failures.push(`${name} 横向溢出 ${overflow.documentWidth}px > ${overflow.viewport}px`)
      for (const error of consoleErrors) failures.push(`${name} 控制台错误：${error}`)
      await page.screenshot({ path: path.join(outputDir, `${name}-1440x900.png`), fullPage: true })
      if (name === 'editor') {
        const firstNode = page.locator('.vue-flow__node').first()
        if (await firstNode.count()) {
          await firstNode.click()
          await page.waitForTimeout(300)
          const inspectorOverflow = await horizontalOverflow(page)
          if (inspectorOverflow.overflowing) {
            failures.push(`选中节点后横向溢出 ${inspectorOverflow.documentWidth}px > ${inspectorOverflow.viewport}px`)
          }
          await page.screenshot({
            path: path.join(outputDir, 'editor-inspector-1440x900.png'),
            fullPage: true,
          })
        } else {
          failures.push('设计器未渲染可点击节点')
        }
      }
    }

    await openRoute(page, '/workflows/wf_support/trial?versionId=ver_support_12')
    const trialText = await page.locator('body').innerText()
    if (!trialText.includes('固定版本 v12') || !trialText.includes('schemaHash')) {
      failures.push('试运行页未显示固定版本 v12 与 schemaHash')
    }
    await desktop.close()

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const mobilePage = await mobile.newPage()
    await openRoute(mobilePage, '/')
    const overflow = await horizontalOverflow(mobilePage)
    if (overflow.overflowing) failures.push(`移动端首页横向溢出 ${overflow.documentWidth}px > ${overflow.viewport}px`)
    await mobilePage.getByLabel('打开导航').click()
    await mobilePage.waitForTimeout(250)
    const menuVisible = await mobilePage.locator('aside').evaluate((element) => {
      const transform = window.getComputedStyle(element).transform
      return transform === 'none' || !transform.includes('-236')
    })
    if (!menuVisible) failures.push('移动端侧栏未展开')
    await mobilePage.screenshot({ path: path.join(outputDir, 'home-mobile-menu-390x844.png'), fullPage: true })
    await openRoute(mobilePage, '/workflows/wf_support/trial?versionId=ver_support_12')
    await mobilePage.screenshot({ path: path.join(outputDir, 'trial-390x844.png'), fullPage: true })
    await mobile.close()
  } finally {
    await browser.close()
  }

  if (failures.length) throw new Error(`Smoke 验收失败：\n${failures.join('\n')}`)
  return `Smoke 验收通过：${desktopRoutes.length} 个桌面路由、移动端首页与固定版本试运行；截图位于 ${outputDir}`
}

try {
  const summary = await runSmoke()
  console.log(summary)
} finally {
  stopPreview()
}
