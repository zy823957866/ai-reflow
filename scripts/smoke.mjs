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
 * 查找所有直接渲染可见文字且字号低于 12px 的元素。
 * @param page Playwright 页面。
 * @returns 字号违规列表。
 */
async function visibleFontViolations(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('body *')]
      .filter((element) => {
        if (element.closest('[aria-hidden="true"]')) return false
        const style = window.getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
        const rect = element.getBoundingClientRect()
        if (!rect.width || !rect.height) return false
        const text = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim() ?? '')
          .join(' ')
          .trim()
        return text.length > 0
      })
      .map((element) => {
        const style = window.getComputedStyle(element)
        return {
          tag: element.tagName.toLowerCase(),
          text: [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent?.trim() ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 48),
          size: Number.parseFloat(style.fontSize),
        }
      })
      .filter((item) => item.size < 11.95)
  })
}

/**
 * 验收统一 Header、内容宽度与可见字号。
 * @param page Playwright 页面。
 * @param name 路由名称。
 * @param failures 失败列表。
 */
async function auditStandardPage(page, name, failures) {
  const violations = await visibleFontViolations(page)
  for (const item of violations.slice(0, 8)) {
    failures.push(`${name} 可见文字字号 ${item.size}px < 12px：<${item.tag}> ${item.text}`)
  }
  if (violations.length > 8) failures.push(`${name} 另有 ${violations.length - 8} 处字号违规`)
  if (name === 'editor') return

  const header = page.getByTestId('app-header')
  if (!(await header.count())) {
    failures.push(`${name} 缺少统一 Header`)
    return
  }

  const before = await header.boundingBox()
  const mainScroll = await page.locator('main').first().evaluate((element) => {
    const beforeTop = element.scrollTop
    element.scrollTop = Math.min(element.scrollHeight, element.clientHeight + 240)
    return { beforeTop, afterTop: element.scrollTop }
  })
  await page.waitForTimeout(120)
  const after = await header.boundingBox()
  if (!before || !after || Math.abs(after.y - before.y) > 1) {
    failures.push(`${name} Header 滚动后未保持固定`)
  }
  await page.locator('main').first().evaluate((element, top) => {
    element.scrollTop = top
  }, mainScroll.beforeTop)

  const contentBox = await page.getByTestId('app-content').boundingBox()
  if (contentBox && contentBox.width > 1441) {
    failures.push(`${name} 内容宽度 ${contentBox.width}px > 1440px`)
  }
}

/**
 * 清理 smoke 创建的临时知识库，避免验收中断后残留数据。
 * @param name 临时知识库名称。
 */
async function cleanupKnowledgeBase(name) {
  try {
    const response = await fetch(`${baseUrl}/api/knowledge-bases?search=${encodeURIComponent(name)}`)
    if (!response.ok) return
    const items = await response.json()
    const match = items.find((item) => item.name === name)
    if (match) {
      await fetch(`${baseUrl}/api/knowledge-bases/${match.id}`, { method: 'DELETE' })
    }
  } catch {
    // 清理失败不覆盖主验收结果。
  }
}

/**
 * 通过页面创建、编辑、上传并删除临时知识库。
 * @param page Playwright 页面。
 * @param groupPanel 可见的知识库分组面板。
 * @param failures 失败列表。
 * @param outputDir 截图目录。
 */
async function auditKnowledgeCrud(page, groupPanel, failures, outputDir) {
  const name = `Smoke 临时知识库 ${Date.now()}`
  let createdId = ''
  try {
    await groupPanel.getByRole('button', { name: '新建', exact: true }).click()
    await page.locator('input[placeholder="例如：售后政策中心"]').fill(name)
    await page.locator('textarea[placeholder="说明文档范围与使用场景"]').fill('用于自动验收临时创建的数据。')
    const createResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/knowledge-bases') &&
      response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '创建知识库', exact: true }).click()
    const createResponse = await createResponsePromise
    if (!createResponse.ok()) {
      failures.push(`知识库创建失败：HTTP ${createResponse.status()}`)
      return
    }
    const created = await createResponse.json()
    createdId = String(created.id ?? '')
    await page.waitForTimeout(350)
    if (!(await groupPanel.getByRole('button', { name: new RegExp(name) }).isVisible())) {
      failures.push('知识库创建后未出现在分组列表')
    }

    await groupPanel.getByRole('button', { name: '编辑', exact: true }).click()
    await page.locator('textarea[placeholder="说明文档范围与使用场景"]').fill('已通过编辑验收。')
    const updateResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/knowledge-bases/${createdId}`) &&
      response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    const updateResponse = await updateResponsePromise
    if (!updateResponse.ok()) failures.push(`知识库编辑失败：HTTP ${updateResponse.status()}`)

    await page.route('**/api/knowledge-bases/*/documents', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'doc_smoke_upload',
          kbId: createdId,
          name: 'smoke-upload.txt',
          mime: 'text/plain',
          extension: 'txt',
          size: '24 B',
          sizeBytes: 24,
          chunks: 1,
          chunkStrategy: 'heading',
          status: 'ready',
          previewStatus: 'ready',
          progress: 100,
          metadata: {},
          updatedAt: new Date().toISOString(),
        }),
      })
    })
    const uploadInput = page.locator('[data-testid="knowledge-document-panel"]:visible input[type="file"]').first()
    await uploadInput.setInputFiles({
      name: 'smoke-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('知识库上传自动验收内容。'),
    })
    await page.waitForTimeout(350)
    if (!(await page.locator('[data-testid="knowledge-document-panel"]:visible').getByText('smoke-upload.txt', { exact: true }).first().isVisible())) {
      failures.push('知识库上传后未显示上传记录')
    }
    await page.screenshot({ path: path.join(outputDir, 'knowledge-crud-upload-1440x900.png'), fullPage: true })

    page.once('dialog', (dialog) => void dialog.accept())
    const deleteResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/knowledge-bases/${createdId}`) &&
      response.request().method() === 'DELETE',
    )
    await groupPanel.getByRole('button', { name: '删除', exact: true }).click()
    const deleteResponse = await deleteResponsePromise
    if (!deleteResponse.ok()) {
      failures.push(`知识库删除失败：HTTP ${deleteResponse.status()}`)
    } else {
      createdId = ''
    }
  } catch (error) {
    failures.push(`知识库 CRUD/上传流程异常：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (createdId) await cleanupKnowledgeBase(name)
    await page.unroute('**/api/knowledge-bases/*/documents').catch(() => undefined)
  }
}

/**
 * 验收知识库桌面三栏、平板堆叠与移动三标签布局。
 * @param browser Playwright 浏览器实例。
 * @param failures 失败列表。
 * @param outputDir 截图目录。
 */
async function auditKnowledgeLayouts(browser, failures, outputDir) {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await desktop.newPage()
  await openRoute(page, '/knowledge')
  const desktopGrid = page.locator('[data-testid="knowledge-grid-desktop"]:visible')
  if (!(await desktopGrid.count())) {
    failures.push('知识库桌面端未显示三栏布局')
  } else {
    const panels = []
    for (const testId of ['knowledge-group-panel', 'knowledge-document-panel', 'knowledge-search-panel']) {
      const panel = page.locator(`[data-testid="${testId}"]:visible`).first()
      const box = await panel.boundingBox()
      if (!box || box.height < 420) failures.push(`知识库桌面端 ${testId} 未占满内容区高度`)
      if (box) panels.push(box)
      const scrollable = await panel.evaluate((element) => {
        const candidates = [element, ...element.querySelectorAll('*')]
        return candidates.some((candidate) => {
          const style = window.getComputedStyle(candidate)
          return ['auto', 'scroll'].includes(style.overflowY) && candidate.clientHeight >= 80
        })
      })
      if (!scrollable) failures.push(`知识库桌面端 ${testId} 缺少独立滚动容器`)
    }
    if (
      panels.length === 3 &&
      (Math.abs(panels[0].y - panels[1].y) > 2 ||
        Math.abs(panels[1].y - panels[2].y) > 2 ||
        panels[0].x >= panels[1].x ||
        panels[1].x >= panels[2].x)
    ) {
      failures.push('知识库桌面端三栏未按左中右并排')
    }
  }

  const productKnowledge = page.getByRole('button', { name: /产品文档/ }).first()
  if ((await productKnowledge.count()) && (await productKnowledge.isVisible())) {
    await productKnowledge.click()
    await page.waitForTimeout(350)
    const previewButton = page.getByTitle('查看切片与原文').first()
    if ((await previewButton.count()) && (await previewButton.isVisible())) {
      await previewButton.click()
      await page.waitForTimeout(350)
      if (!(await page.getByLabel('关闭预览').isVisible())) failures.push('知识库文档预览未打开')
      await page.getByLabel('关闭预览').click()
    } else {
      failures.push('知识库已选分组未显示文档预览入口')
    }
  } else {
    failures.push('知识库没有可用的“产品文档”样例分组')
  }

  const searchInput = desktopGrid.locator('textarea[placeholder="输入要检索的问题..."]')
  if ((await searchInput.count()) && (await searchInput.isVisible())) {
    await page.getByRole('button', { name: '运行检索', exact: true }).click()
    await page.waitForTimeout(500)
  } else {
    failures.push('知识库桌面端缺少检索测试面板')
  }
  await auditKnowledgeCrud(page, page.locator('[data-testid="knowledge-group-panel"]:visible').first(), failures, outputDir)
  await page.screenshot({ path: path.join(outputDir, 'knowledge-desktop-audit-1440x900.png'), fullPage: true })
  await desktop.close()

  const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  const tabletPage = await tablet.newPage()
  await openRoute(tabletPage, '/knowledge')
  const tabletGrid = tabletPage.locator('[data-testid="knowledge-grid-tablet"]:visible')
  if (!(await tabletGrid.count())) failures.push('知识库平板端未显示堆叠布局')
  const groupBox = await tabletPage.locator('[data-testid="knowledge-group-panel"]:visible').first().boundingBox()
  const documentBox = await tabletPage.locator('[data-testid="knowledge-document-panel"]:visible').first().boundingBox()
  const searchBox = await tabletPage.locator('[data-testid="knowledge-search-panel"]:visible').first().boundingBox()
  if (
    groupBox &&
    documentBox &&
    searchBox &&
    (documentBox.x <= groupBox.x || Math.abs(documentBox.x - searchBox.x) > 2 || documentBox.y >= searchBox.y)
  ) {
    failures.push('知识库平板端未按左侧分组、右侧上下堆叠')
  }
  const tabletOverflow = await horizontalOverflow(tabletPage)
  if (tabletOverflow.overflowing) failures.push(`知识库平板端横向溢出 ${tabletOverflow.documentWidth}px > ${tabletOverflow.viewport}px`)
  await tabletPage.screenshot({ path: path.join(outputDir, 'knowledge-tablet-1024x768.png'), fullPage: true })
  await tablet.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobilePage = await mobile.newPage()
  await openRoute(mobilePage, '/knowledge')
  const mobileRoot = mobilePage.locator('[data-testid="knowledge-mobile"]:visible')
  if (!(await mobileRoot.count())) failures.push('知识库手机端未显示标签布局')
  for (const tab of ['groups', 'documents', 'search']) {
    if (!(await mobilePage.getByTestId(`knowledge-mobile-tab-${tab}`).isVisible())) {
      failures.push(`知识库手机端缺少 ${tab} 标签`)
    }
  }
  await mobilePage.getByTestId('knowledge-mobile-tab-documents').click()
  await mobilePage.waitForTimeout(150)
  if (!(await mobileRoot.getByText('拖入 PDF、Word、Excel、CSV、Markdown 或 TXT', { exact: true }).isVisible())) {
    failures.push('知识库手机端“文档”标签未切换文档面板')
  }
  await mobilePage.getByTestId('knowledge-mobile-tab-search').click()
  await mobilePage.waitForTimeout(150)
  if (!(await mobileRoot.getByRole('heading', { name: '检索测试', exact: true }).isVisible())) {
    failures.push('知识库手机端“检索”标签未切换检索面板')
  }
  const mobileOverflow = await horizontalOverflow(mobilePage)
  if (mobileOverflow.overflowing) failures.push(`知识库手机端横向溢出 ${mobileOverflow.documentWidth}px > ${mobileOverflow.viewport}px`)
  await mobilePage.screenshot({ path: path.join(outputDir, 'knowledge-mobile-search-390x844.png'), fullPage: true })
  await mobile.close()
}

/**
 * 验收普通输入框与复合搜索框的焦点边框。
 * @param page Playwright 页面。
 * @param failures 失败列表。
 */
async function auditFormFocus(page, failures) {
  const shellInput = page.locator('[data-testid="knowledge-grid-desktop"]:visible input[placeholder="搜索知识库..."]')
  if (!(await shellInput.count())) {
    failures.push('知识库复合搜索框不存在')
    return
  }
  const shell = shellInput.locator('xpath=..')
  await page.getByRole('heading', { name: '知识库分组' }).click()
  await page.waitForTimeout(220)
  const shellBlurred = await shell.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      borderWidth: Number.parseFloat(style.borderTopWidth),
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    }
  })
  await shellInput.focus()
  await page.waitForTimeout(220)
  const shellFocused = await shell.evaluate((element) => {
    const style = window.getComputedStyle(element)
    const inputStyle = window.getComputedStyle(element.querySelector('input'))
    return {
      borderColor: style.borderTopColor,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      inputBorderWidth: Number.parseFloat(inputStyle.borderTopWidth),
      inputOutlineWidth: Number.parseFloat(inputStyle.outlineWidth),
      inputBoxShadow: inputStyle.boxShadow,
    }
  })
  if (
    shellBlurred.borderWidth !== 1 ||
    shellBlurred.outlineWidth !== 2 ||
    shellBlurred.boxShadow !== 'none' ||
    shellFocused.borderColor !== 'rgba(0, 0, 0, 0)' ||
    shellFocused.outlineWidth !== 2 ||
    shellFocused.outlineColor === 'rgba(0, 0, 0, 0)' ||
    shellFocused.inputBorderWidth !== 0 ||
    shellFocused.inputOutlineWidth !== 0 ||
    shellFocused.inputBoxShadow !== 'none'
  ) {
    failures.push(`知识库复合搜索框焦点样式异常：${JSON.stringify({ shellBlurred, shellFocused })}`)
  }

  const newButton = page.locator('[data-testid="knowledge-group-panel"]:visible').getByRole('button', { name: '新建', exact: true })
  await newButton.click()
  const regularInput = page.locator('input[placeholder="例如：售后政策中心"]')
  if (!(await regularInput.count())) {
    failures.push('知识库表单输入框不存在')
    return
  }
  const controlSpacing = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="例如：售后政策中心"]')
    const textarea = document.querySelector('textarea[placeholder="说明文档范围与使用场景"]')
    if (!input || !textarea) return null
    const inputStyle = window.getComputedStyle(input)
    const textareaStyle = window.getComputedStyle(textarea)
    return {
      inputHeight: input.getBoundingClientRect().height,
      inputPaddingTop: Number.parseFloat(inputStyle.paddingTop),
      inputPaddingLeft: Number.parseFloat(inputStyle.paddingLeft),
      textareaHeight: textarea.getBoundingClientRect().height,
      textareaPaddingTop: Number.parseFloat(textareaStyle.paddingTop),
      textareaPaddingLeft: Number.parseFloat(textareaStyle.paddingLeft),
    }
  })
  if (
    !controlSpacing ||
    controlSpacing.inputHeight < 34 ||
    controlSpacing.inputPaddingTop < 6 ||
    controlSpacing.inputPaddingLeft < 8 ||
    controlSpacing.textareaHeight < 70 ||
    controlSpacing.textareaPaddingTop < 6 ||
    controlSpacing.textareaPaddingLeft < 8
  ) {
    failures.push(`知识库表单控件内边距或高度异常：${JSON.stringify(controlSpacing)}`)
  }
  await regularInput.blur()
  await page.waitForTimeout(220)
  const inputBlurred = await regularInput.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      borderWidth: Number.parseFloat(style.borderTopWidth),
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    }
  })
  await regularInput.focus()
  await page.waitForTimeout(220)
  const inputFocused = await regularInput.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      borderColor: style.borderTopColor,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    }
  })
  if (
    inputBlurred.borderWidth !== 1 ||
    inputBlurred.outlineWidth !== 2 ||
    inputBlurred.outlineColor !== 'rgba(0, 0, 0, 0)' ||
    inputBlurred.boxShadow !== 'none' ||
    inputFocused.borderColor !== 'rgba(0, 0, 0, 0)' ||
    inputFocused.outlineWidth !== 2 ||
    inputFocused.outlineColor === 'rgba(0, 0, 0, 0)' ||
    inputFocused.boxShadow !== 'none'
  ) {
    failures.push(`知识库普通输入框焦点样式异常：${JSON.stringify({ inputBlurred, inputFocused })}`)
  }
  await page.getByRole('button', { name: '取消', exact: true }).click()
}

/**
 * 模拟知识库列表接口失败，确认错误只进入 Toast。
 * @param browser Playwright 浏览器实例。
 * @param failures 失败列表。
 * @param outputDir 截图目录。
 */
async function auditKnowledgeErrorToast(browser, failures, outputDir) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route('**/api/knowledge-bases*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SMOKE_KNOWLEDGE_FAILURE',
            message: '模拟知识库列表接口失败。',
            retryable: true,
          },
        }),
      })
      return
    }
    await route.continue()
  })
  const page = await context.newPage()
  await openRoute(page, '/knowledge')
  const toast = page.getByTestId('app-toast').first()
  await toast.waitFor({ state: 'visible', timeout: 5000 })
  const toastText = await toast.innerText()
  if (!toastText.includes('知识库列表加载失败') || !toastText.includes('SMOKE_KNOWLEDGE_FAILURE')) {
    failures.push('知识库接口失败未显示包含错误码的 Toast')
  }
  const inlineError = await page.locator('main').getByText('知识库列表加载失败', { exact: true }).count()
  if (inlineError) failures.push('知识库接口失败仍保留内联错误占位')
  if ((await page.getByTestId('app-toast').count()) > 3) failures.push('Toast 同屏超过 3 条')
  if (!(await toast.getByLabel('关闭通知').isVisible())) failures.push('Toast 缺少关闭按钮')
  await page.screenshot({ path: path.join(outputDir, 'knowledge-error-toast-1440x900.png'), fullPage: true })
  await context.close()
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
      await auditStandardPage(page, name, failures)
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

    const wide = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const widePage = await wide.newPage()
    await openRoute(widePage, '/')
    const wideContentBox = await widePage.getByTestId('app-content').boundingBox()
    if (!wideContentBox || wideContentBox.width > 1440.5) {
      failures.push(`宽屏内容宽度 ${wideContentBox?.width ?? 'unknown'}px 超过 1440px`)
    }
    await auditStandardPage(widePage, 'home-wide', failures)
    await widePage.screenshot({ path: path.join(outputDir, 'home-1920x1080.png'), fullPage: true })
    await wide.close()

    await auditKnowledgeLayouts(browser, failures, outputDir)
    const focusContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const focusPage = await focusContext.newPage()
    await openRoute(focusPage, '/knowledge')
    await auditFormFocus(focusPage, failures)
    await focusContext.close()
    await auditKnowledgeErrorToast(browser, failures, outputDir)

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
