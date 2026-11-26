import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const baseUrl = process.env.WEB_URL ?? 'http://localhost:5174'
const outputDirectory = 'artifacts/ui-check'
const routes = ['/models', '/knowledge']
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]

await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})
const report = []

for (const route of routes) {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() => {
      const documentElement = document.documentElement
      const overflowing = [...document.querySelectorAll('*')]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.right > documentElement.clientWidth + 1 || rect.left < -1
        })
        .slice(0, 10)
        .map((element) => ({
          tag: element.tagName,
          className: String(element.className).slice(0, 120),
          right: Math.round(element.getBoundingClientRect().right),
        }))
      return {
        documentWidth: documentElement.scrollWidth,
        viewportWidth: documentElement.clientWidth,
        overflowing,
      }
    })
    const screenshot = `${outputDirectory}/${route.slice(1)}-${viewport.name}.png`
    await page.screenshot({ path: screenshot, fullPage: true })
    report.push({
      route,
      viewport: viewport.name,
      screenshot,
      errors,
      overflow,
    })
    await page.close()
  }
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
