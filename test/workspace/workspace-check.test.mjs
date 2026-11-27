import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')

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

test('agent workbench routes and API boundaries are registered', async () => {
  const router = await readFile(
    path.join(root, 'apps/web/src/router/index.ts'),
    'utf8',
  )
  const api = await readFile(
    path.join(root, 'apps/web/src/services/reflowApi.ts'),
    'utf8',
  )
  assert.match(router, /path:\s*['"]\/agents['"]/)
  assert.match(router, /path:\s*['"]\/agents\/:id['"]/)
  assert.match(router, /pages\/agents-page\/index\.vue/)
  for (const route of [
    '/api/agents',
    '/api/agent-conversations',
    '/api/agent-invocations',
  ]) {
    assert.match(api, new RegExp(route.replaceAll('/', '\\/')))
  }
  assert.match(api, /subscribeAgentInvocationEvents/)
})

test('agent workbench restores invocations and uses safe Markdown', async () => {
  const page = await readFile(
    path.join(root, 'apps/web/src/pages/agents-page/index.vue'),
    'utf8',
  )
  const markdown = await readFile(
    path.join(root, 'apps/web/src/pages/agents-page/markdown.ts'),
    'utf8',
  )
  assert.doesNotMatch(page, /\bfetch\(/)
  assert.doesNotMatch(page, /localStorage/)
  assert.match(page, /route\.query/)
  assert.match(page, /invocationId/)
  assert.match(markdown, /html:\s*false/)
})

test('agent settings scope form ids and conversation previews stay accurate', async () => {
  const settings = await readFile(
    path.join(root, 'apps/web/src/pages/agents-page/AgentSettingsPanel.vue'),
    'utf8',
  )
  const conversations = await readFile(
    path.join(root, 'apps/web/src/pages/agents-page/ConversationList.vue'),
    'utf8',
  )
  const page = await readFile(
    path.join(root, 'apps/web/src/pages/agents-page/index.vue'),
    'utf8',
  )
  assert.match(settings, /useId\(\)/)
  assert.doesNotMatch(settings, /id="agent-instructions"/)
  assert.match(conversations, /messageCount\s*\?\s*['"]等待回复['"]/)
  assert.match(page, /matchMedia\('\(min-width: 1540px\)'\)/)
  assert.match(page, /selectedAgent\s*&&\s*wideSettings/)
  assert.match(page, /!wideSettings/)
})

test('agent page line heights are explicit ratios', async () => {
  const sourceFiles = await listSourceFiles('apps/web/src/pages/agents-page')
  const offenders = []
  for (const file of sourceFiles) {
    const source = await readFile(path.join(root, file), 'utf8')
    if (/leading-\d/.test(source)) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

test('agent node inspector exposes the serializable runtime fields', async () => {
  const nodes = await readFile(
    path.join(root, 'apps/web/src/shared/nodes.ts'),
    'utf8',
  )
  for (const key of [
    'modelConnectionId',
    'instructions',
    'knowledge',
    'mcpTools',
    'maxSteps',
    'timeoutMs',
    'outputSchema',
    'memory',
  ]) {
    assert.match(nodes, new RegExp(`key:\\s*['"]${key}['"]`))
  }
  const inspector = await readFile(
    path.join(root, 'apps/web/src/workflow/inspector/InspectorPanel.vue'),
    'utf8',
  )
  assert.match(inspector, /node\.type\s*===\s*['"]agent['"]/)
})

test('knowledge UI follows real ingest jobs and renders degraded retrieval', async () => {
  const status = await readFile(
    path.join(root, 'apps/web/src/pages/knowledge-page/status.ts'),
    'utf8',
  )
  for (const [stage, label] of [
    ['queued', '排队中'],
    ['parsing', '解析中'],
    ['chunking', '分块中'],
    ['embedding', '向量化中'],
    ['ready', '已索引'],
    ['failed', '索引失败'],
  ]) {
    assert.match(status, new RegExp(`${stage}:\\s*['"]${label}['"]`))
  }

  const page = await readFile(
    path.join(root, 'apps/web/src/pages/knowledge-page/index.vue'),
    'utf8',
  )
  const api = await readFile(
    path.join(root, 'apps/web/src/services/reflowApi.ts'),
    'utf8',
  )
  const search = await readFile(
    path.join(
      root,
      'apps/web/src/pages/knowledge-page/components/KnowledgeSearchPanel.vue',
    ),
    'utf8',
  )
  const table = await readFile(
    path.join(
      root,
      'apps/web/src/pages/knowledge-page/components/KnowledgeDocumentTable.vue',
    ),
    'utf8',
  )
  const upload = await readFile(
    path.join(
      root,
      'apps/web/src/pages/knowledge-page/components/KnowledgeUploadZone.vue',
    ),
    'utf8',
  )

  assert.match(api, /KnowledgeIngestJobDto/)
  assert.match(api, /KnowledgeUploadResponse/)
  assert.match(page, /isActiveIngestStatus/)
  assert.match(page, /accepted\.document/)
  assert.match(page, /setTimeout/)
  assert.match(search, /warnings/)
  assert.match(search, /降级/)
  assert.doesNotMatch(search, /value="hybrid"\s+disabled/)
  assert.doesNotMatch(search, /value="vector"\s+disabled/)
  assert.match(table, /reindex/)
  assert.match(upload, /item\.error/)
})

test('knowledge creation uses the local 768d embedding policy', async () => {
  const page = await readFile(
    path.join(root, 'apps/web/src/pages/knowledge-page/index.vue'),
    'utf8',
  )
  const dialog = await readFile(
    path.join(
      root,
      'apps/web/src/pages/knowledge-page/components/KnowledgeBaseDialog.vue',
    ),
    'utf8',
  )
  assert.doesNotMatch(page, /text-embedding-3-small|embeddingDimension:\s*1536/)
  assert.doesNotMatch(dialog, />1536</)
  assert.match(dialog, /nomic-embed-text/)
  assert.match(dialog, />768</)
})
