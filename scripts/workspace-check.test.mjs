import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
}

async function listSourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(relativePath))
    } else if (/\.(?:ts|vue)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }
  return files
}

test('apps/web is a first-class workspace package', async () => {
  assert.equal(existsSync(path.join(root, 'apps/web/package.json')), true)
  const webPackage = await readJson('apps/web/package.json')
  assert.equal(webPackage.name, '@ai-reflow/web')
  assert.match(webPackage.scripts.build, /vite build/)
  assert.match(webPackage.scripts.typecheck, /vue-tsc/)
})

test('root scripts delegate app work to workspace packages', async () => {
  const rootPackage = await readJson('package.json')
  assert.equal(rootPackage.scripts['dev:web'], 'pnpm --filter @ai-reflow/web dev')
  assert.equal(rootPackage.scripts.build, 'pnpm --filter @ai-reflow/web build')
  assert.equal(rootPackage.scripts.typecheck, 'pnpm --filter @ai-reflow/web typecheck')
})

test('shared shadcn-vue components live in @ai-reflow/ui', async () => {
  const webPackage = await readJson('apps/web/package.json')
  const uiPackage = await readJson('packages/ui/package.json')

  assert.equal(webPackage.dependencies['@ai-reflow/ui'], 'workspace:*')
  assert.equal(uiPackage.name, '@ai-reflow/ui')
  assert.equal(uiPackage.exports?.['.'], './src/index.ts')
  assert.equal(uiPackage.exports?.['./styles.css'], './src/styles.css')
  assert.equal(Boolean(uiPackage.dependencies['reka-ui']), true)
  assert.equal(Boolean(uiPackage.dependencies['class-variance-authority']), true)
  assert.equal(existsSync(path.join(root, 'packages/ui/src/components/dialog/Dialog.vue')), true)
  assert.equal(existsSync(path.join(root, 'packages/ui/src/components/select/Select.vue')), true)
  assert.equal(existsSync(path.join(root, 'apps/web/src/components/ui')), false)
})

test('web production code uses the shared UI package boundary', async () => {
  const sourceFiles = await listSourceFiles('apps/web/src')
  const primitiveImports = []
  const deepUiImports = []
  for (const file of sourceFiles) {
    const source = await readFile(path.join(root, file), 'utf8')
    if (
      source.includes("from 'reka-ui'") ||
      source.includes('from "reka-ui"') ||
      source.includes("from '@headlessui/vue'") ||
      source.includes('from "@headlessui/vue"')
    ) {
      primitiveImports.push(file)
    }
    if (file.endsWith('.vue') && /from ['"]@ai-reflow\/ui\//.test(source)) {
      deepUiImports.push(file)
    }
  }
  assert.deepEqual(primitiveImports, [])
  assert.deepEqual(deepUiImports, [])
})

test('web forms use shared shadcn-vue controls', async () => {
  const sourceFiles = await listSourceFiles('apps/web/src')
  const offenders = []
  for (const file of sourceFiles.filter((item) => item.endsWith('.vue'))) {
    const source = await readFile(path.join(root, file), 'utf8')
    const lines = source.split('\n')
    for (const [index, line] of lines.entries()) {
      if (!/<(?:input|select|textarea)\b/.test(line)) continue
      const control = lines.slice(index, index + 12).join('\n')
      const isHiddenFileInput =
        /<input\b/.test(line) && /\btype=["']file["']/.test(control)
      if (!isHiddenFileInput) offenders.push(`${file}:${index + 1}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('web actions use the shared shadcn-vue Button', async () => {
  const sourceFiles = await listSourceFiles('apps/web/src')
  const offenders = []
  for (const file of sourceFiles.filter((item) => item.endsWith('.vue'))) {
    const source = await readFile(path.join(root, file), 'utf8')
    if (/<button\b|<\/button>/.test(source)) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

test('web imports the shared UI package through one entry per module', async () => {
  const sourceFiles = await listSourceFiles('apps/web/src')
  const offenders = []
  for (const file of sourceFiles.filter((item) => item.endsWith('.vue'))) {
    const source = await readFile(path.join(root, file), 'utf8')
    const imports = source.match(/from ['"]@ai-reflow\/ui['"]/g) ?? []
    if (imports.length > 1) offenders.push(`${file} (${imports.length})`)
  }
  assert.deepEqual(offenders, [])
})
