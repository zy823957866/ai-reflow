import assert from 'node:assert/strict'
import { createDatabase } from '@ai-reflow/platform'

const apiBaseUrl = process.env.API_BASE_URL
  ?? `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? '8787'}`
const databaseUrl = process.env.DATABASE_URL
const runStamp = Date.now().toString(36)
const integrationPluginId = 'com.ai-reflow.integration.fixture'
const integrationPluginVersions = ['1.0.0', '1.1.0']
const integrationToolName = 'run_support_integration'
const results = []

/**
 * 等待异步任务完成并返回结果。
 *
 * @template T
 * @param {() => Promise<T>} task 待执行任务。
 * @returns {Promise<T>} 任务结果。
 */
async function execute(task) {
  return task()
}

/**
 * 执行一个带名称的集成测试步骤。
 *
 * @param {string} name 测试步骤名称。
 * @param {() => Promise<void>} task 测试逻辑。
 */
async function test(name, task) {
  const startedAt = Date.now()
  try {
    await task()
    const duration = Date.now() - startedAt
    results.push({ name, duration, ok: true })
    console.log(`✓ ${name} (${duration}ms)`)
  } catch (error) {
    const duration = Date.now() - startedAt
    results.push({ name, duration, ok: false, error })
    console.error(`✗ ${name} (${duration}ms)`)
    throw error
  }
}

/**
 * 解析响应正文，优先使用 JSON，无法解析时保留文本。
 *
 * @param {string} text 原始响应正文。
 * @param {string | null} contentType Content-Type 响应头。
 * @returns {unknown} 解析后的正文。
 */
function parseResponseBody(text, contentType) {
  if (!text) return null
  if (contentType?.includes('text/event-stream')) return parseEventStream(text)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 从 MCP SSE 响应中读取最后一个 JSON-RPC 消息。
 *
 * @param {string} text SSE 原始正文。
 * @returns {unknown} JSON-RPC 消息。
 */
function parseEventStream(text) {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
  if (!payloads.length) throw new Error('MCP SSE 响应中没有 data 消息。')
  const parsed = payloads.map((payload) => JSON.parse(payload))
  const response = parsed.findLast((item) => item?.id !== undefined && !item?.method)
  return response ?? parsed.at(-1)
}

/**
 * 调用真实 REST API，并校验期望状态码。
 *
 * @param {string} path API 路径。
 * @param {{
 *   method?: string,
 *   body?: unknown,
 *   headers?: Record<string, string>,
 *   expectedStatus?: number[]
 * }} options 请求选项。
 * @returns {Promise<{ status: number, data: any }>} 状态码与响应正文。
 */
async function api(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    expectedStatus = [200],
  } = options
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = parseResponseBody(text, response.headers.get('content-type'))
  if (!expectedStatus.includes(response.status)) {
    throw new Error(
      `${method} ${path} 返回 ${response.status}，预期 ${expectedStatus.join('/')}：`
      + `${typeof data === 'string' ? data : JSON.stringify(data)}`,
    )
  }
  return { status: response.status, data }
}

/**
 * 发送 MCP Streamable HTTP JSON-RPC 请求。
 *
 * @param {string} token 入站 MCP 访问令牌。
 * @param {Record<string, unknown>} payload JSON-RPC 消息。
 * @param {number[]} expectedStatus 期望 HTTP 状态码。
 * @returns {Promise<{ status: number, data: any }>} 状态码与 JSON-RPC 响应。
 */
async function mcpRequest(token, payload, expectedStatus = [200]) {
  const response = await fetch(`${apiBaseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-AI-Reflow-Client': `api-integration-${runStamp}`,
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  const data = parseResponseBody(text, response.headers.get('content-type'))
  if (!expectedStatus.includes(response.status)) {
    throw new Error(
      `MCP ${String(payload.method ?? 'response')} 返回 ${response.status}，`
      + `预期 ${expectedStatus.join('/')}：${JSON.stringify(data)}`,
    )
  }
  return { status: response.status, data }
}

/**
 * 读取 MCP tools/call 的 structuredContent，文本响应则解析 JSON。
 *
 * @param {any} response MCP tools/call 响应。
 * @returns {any} 工具业务结果。
 */
function toolContent(response) {
  const result = response?.result
  if (!result) throw new Error(`MCP 响应缺少 result：${JSON.stringify(response)}`)
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.structuredContent) return result.structuredContent
  const text = result.content?.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('MCP tools/call 响应没有可读取内容。')
  return JSON.parse(text)
}

/**
 * 将对象显式序列化为 PostgreSQL jsonb 参数。
 *
 * @param {import('@ai-reflow/platform').DatabaseClient} sql PostgreSQL 客户端。
 * @param {unknown} value 待写入的 JSON 值。
 * @returns {unknown} postgres.js 参数片段。
 */
function jsonb(sql, value) {
  return sql`${JSON.stringify(value)}::jsonb`
}

/**
 * 创建或更新插件升级测试所需的 registry 夹具。
 *
 * 该夹具只包含声明式 manifest，不执行第三方代码，不写入真实密钥。
 *
 * @param {import('@ai-reflow/platform').DatabaseClient} sql PostgreSQL 客户端。
 */
async function preparePluginFixture(sql) {
  const metadata = {
    pluginKind: 'tool',
    category: '集成测试',
    version: integrationPluginVersions.at(-1),
    nodes: 1,
    installs: 0,
    icon: 'plug',
    accent: 'sky',
    capabilities: ['连通性检查'],
    description: '用于验证安装、升级、回滚和软卸载的真实 registry 夹具。',
    tags: ['integration'],
  }
  await sql`
    insert into registry_entries (
      id, kind, name, publisher, summary, visibility, verified, metadata
    )
    values (
      ${integrationPluginId}, ${'plugin'}, ${'集成测试插件'},
      ${'AI Reflow Tests'}, ${'不执行代码的插件生命周期测试夹具。'},
      ${'verified'}, ${true}, ${jsonb(sql, metadata)}
    )
    on conflict (id) do update
    set
      name = excluded.name,
      publisher = excluded.publisher,
      summary = excluded.summary,
      visibility = excluded.visibility,
      verified = excluded.verified,
      metadata = excluded.metadata,
      updated_at = now()
  `
  for (const version of integrationPluginVersions) {
    const manifest = {
      id: integrationPluginId,
      name: '集成测试插件',
      version,
      schemaVersion: '1.0',
      engine: 'reflow-engine >=0.9',
      changelog: `集成测试版本 ${version}`,
      size: '1.0 KB',
      dependencies: [],
      permissions: {
        network: ['integration.example.com'],
        secrets: ['INTEGRATION_TOKEN'],
      },
      tools: [
        {
          name: 'ping',
          description: '返回固定测试结果。',
          nodeType: `plugin:${integrationPluginId}:ping`,
        },
      ],
    }
    await sql`
      insert into registry_versions (
        entry_id, version, manifest, tarball_key, checksum, signature,
        license, compatibility, deprecated
      )
      values (
        ${integrationPluginId}, ${version}, ${jsonb(sql, manifest)},
        ${`integration/${integrationPluginId}-${version}.tgz`},
        ${`sha256:${'0'.repeat(64)}`}, ${`integration:verified:${version}`},
        ${'MIT'},
        ${jsonb(sql, {
          app: '>=0.1.0 <1.0.0',
          engine: '>=0.9.0',
          schemaVersion: '1.0',
        })},
        ${false}
      )
      on conflict (entry_id, version) do update
      set
        manifest = excluded.manifest,
        tarball_key = excluded.tarball_key,
        checksum = excluded.checksum,
        signature = excluded.signature,
        license = excluded.license,
        compatibility = excluded.compatibility,
        deprecated = excluded.deprecated
    `
  }
}

/**
 * 验证模型连接 CRUD 与模型元数据读取。
 */
async function testModels() {
  const listed = await api('/api/model-connections')
  assert.ok(Array.isArray(listed.data), '模型连接列表必须是数组。')
  assert.ok(listed.data.length > 0, 'seed 后模型连接列表不能为空。')

  const created = await api('/api/model-connections', {
    method: 'POST',
    expectedStatus: [201],
    body: {
      name: `集成模型 ${runStamp}`,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4.1-mini',
      contextWindow: 8192,
      capabilities: ['text', 'structured'],
      fallbackOrder: ['gpt-4.1-mini'],
      secretRef: `secret://workspace/integration-model-${runStamp}`,
      enabled: false,
    },
  })
  const modelId = created.data.id
  assert.ok(modelId)

  const fetched = await api(`/api/model-connections/${modelId}`)
  assert.equal(fetched.data.id, modelId)
  const updated = await api(`/api/model-connections/${modelId}`, {
    method: 'PATCH',
    body: { contextWindow: 16384, enabled: true },
  })
  assert.equal(updated.data.contextWindow, 16384)
  assert.equal(updated.data.enabled, true)
  const models = await api(`/api/model-connections/${modelId}/models`)
  assert.ok(Array.isArray(models.data), '模型元数据必须返回数组。')
  assert.ok(models.data.some((model) => model.id === 'gpt-4.1-mini'))

  const removed = await api(`/api/model-connections/${modelId}`, {
    method: 'DELETE',
  })
  assert.equal(removed.data.deleted, true)
}

/**
 * 验证知识库 CRUD、统计与空检索路径。
 */
async function testKnowledge() {
  const created = await api('/api/knowledge-bases', {
    method: 'POST',
    expectedStatus: [201],
    body: {
      name: `集成知识库 ${runStamp}`,
      description: 'API 集成测试知识库。',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
    },
  })
  const knowledgeBaseId = created.data.id
  assert.ok(knowledgeBaseId)

  const fetched = await api(`/api/knowledge-bases/${knowledgeBaseId}`)
  assert.equal(fetched.data.id, knowledgeBaseId)
  const updated = await api(`/api/knowledge-bases/${knowledgeBaseId}`, {
    method: 'PATCH',
    body: { description: '已完成更新验证。' },
  })
  assert.equal(updated.data.description, '已完成更新验证。')
  const stats = await api(`/api/knowledge-bases/${knowledgeBaseId}/stats`)
  assert.equal(typeof stats.data.documents, 'number')
  assert.equal(typeof stats.data.chunks, 'number')
  const search = await api(`/api/knowledge-bases/${knowledgeBaseId}/search`, {
    method: 'POST',
    body: { query: '集成测试', retrievalMode: 'keyword', topK: 3 },
  })
  assert.ok(Array.isArray(search.data.chunks), '知识库检索必须返回 chunks 数组。')

  const removed = await api(`/api/knowledge-bases/${knowledgeBaseId}`, {
    method: 'DELETE',
  })
  assert.equal(removed.data.deleted, true)
}

/**
 * 验证出站 MCP CRUD、缓存工具读取与调用审计接口。
 */
async function testOutboundMcp() {
  const created = await api('/api/mcp/servers', {
    method: 'POST',
    expectedStatus: [201],
    body: {
      name: `集成 MCP ${runStamp}`,
      slug: `integration-${runStamp}`,
      description: 'API 集成测试出站连接。',
      transport: 'streamable-http',
      endpoint: 'https://integration.example.com/mcp',
      authType: 'bearer',
      secretRef: `secret://workspace/integration-mcp-${runStamp}`,
      allowlist: ['integration.example.com'],
      toolAllowlist: ['ping'],
      enabled: true,
    },
  })
  const serverId = created.data.id
  assert.ok(serverId)

  const fetched = await api(`/api/mcp/servers/${serverId}`)
  assert.equal(fetched.data.transport, 'streamable-http')
  assert.equal(fetched.data.description, 'API 集成测试出站连接。')
  const updated = await api(`/api/mcp/servers/${serverId}`, {
    method: 'PATCH',
    body: { description: '已完成更新验证。', enabled: false },
  })
  assert.equal(updated.data.enabled, false)
  const tools = await api(`/api/mcp/servers/${serverId}/tools`)
  assert.ok(Array.isArray(tools.data), 'MCP 工具缓存必须返回数组。')
  const calls = await api('/api/mcp/calls?limit=20')
  assert.ok(Array.isArray(calls.data), 'MCP 审计必须返回数组。')

  const removed = await api(`/api/mcp/servers/${serverId}`, {
    method: 'DELETE',
  })
  assert.equal(removed.data.deleted, true)
}

/**
 * 验证模板列表、详情、一次性克隆计划和真实草稿创建。
 */
async function testTemplates() {
  const templates = await api('/api/templates')
  assert.ok(Array.isArray(templates.data), '模板列表必须是数组。')
  assert.ok(templates.data.length > 0, 'seed 后模板列表不能为空。')
  const templateId = 'tpl_support'
  const detail = await api(`/api/templates/${templateId}`)
  assert.equal(detail.data.id, templateId)
  assert.ok(Array.isArray(detail.data.versions), '模板详情必须包含 versions。')
  const version = detail.data.latestVersion ?? detail.data.versions[0].version
  assert.ok(version)
  const versionDetail = await api(`/api/templates/${templateId}/versions/${version}`)
  assert.equal(versionDetail.data.version, version)
  assert.ok(versionDetail.data.definition?.nodes?.length, '模板版本必须返回可预览定义。')

  const targetName = `集成模板副本 ${runStamp}`
  const plan = await api(`/api/templates/${templateId}/clone-plan`, {
    method: 'POST',
    body: { targetName, version },
  })
  assert.ok(plan.data.planId)
  assert.equal(plan.data.templateId, templateId)
  assert.equal(plan.data.willWriteSecrets, false)
  assert.equal(plan.data.canClone, true, JSON.stringify(plan.data.blockingReasons))

  const cloned = await api(`/api/templates/${templateId}/clone`, {
    method: 'POST',
    expectedStatus: [201],
    body: { planId: plan.data.planId, targetName, version },
  })
  assert.ok(cloned.data.importId)
  assert.ok(cloned.data.workflow?.workflowId)
  assert.equal(cloned.data.workflow.forkOf.templateId, templateId)

  const imported = await api(`/api/template-imports/${cloned.data.importId}`)
  assert.equal(imported.data.templateId, templateId)
  const workflow = await api(`/api/workflows/${cloned.data.workflow.workflowId}`)
  assert.equal(workflow.data.name, targetName)
  assert.equal(workflow.data.definition.nodes.length, cloned.data.workflow.definition.nodes.length)
}

/**
 * 验证插件安装计划、凭据、启停、升级、回滚、审计与软卸载闭环。
 *
 * @param {import('@ai-reflow/platform').DatabaseClient} sql PostgreSQL 客户端。
 */
async function testPlugins(sql) {
  await preparePluginFixture(sql)
  const entry = await api(`/api/registry/entries/${integrationPluginId}`)
  assert.equal(entry.data.id, integrationPluginId)
  assert.ok(entry.data.versions.length >= 2)

  const installs = await api('/api/plugin-installs')
  const previous = installs.data.find((item) => item.entryId === integrationPluginId)
  if (previous?.installId) {
    await api(`/api/plugin-installs/${previous.installId}`, { method: 'DELETE' })
  }

  const sync = await api('/api/registry/sync-status')
  assert.equal(sync.data.source, 'local-seed')
  await api('/api/registry/sync', {
    method: 'POST',
    expectedStatus: [501],
    body: {},
  })

  const installPlan = await api('/api/registry/install-plan', {
    method: 'POST',
    body: {
      entryId: integrationPluginId,
      action: 'install',
      version: '1.0.0',
    },
  })
  assert.ok(installPlan.data.planId)
  assert.equal(installPlan.data.canInstall, true, JSON.stringify(installPlan.data.blockers))
  assert.equal(installPlan.data.credentials[0].state, 'missing')

  const installKey = `integration-install-${runStamp}`
  const installed = await api('/api/plugin-installs', {
    method: 'POST',
    expectedStatus: [201],
    headers: { 'Idempotency-Key': installKey },
    body: {
      planId: installPlan.data.planId,
      idempotencyKey: installKey,
      highRiskConfirmed: installPlan.data.highRisk === true,
    },
  })
  const installId = installed.data.installId
  assert.ok(installId)
  assert.equal(installed.data.version, '1.0.0')
  assert.equal(installed.data.status, 'config_required')

  const configured = await api(`/api/plugin-installs/${installId}`, {
    method: 'PATCH',
    body: {
      credentials: [
        {
          key: 'INTEGRATION_TOKEN',
          secretRef: `secret://workspace/integration-plugin-${runStamp}`,
          authType: 'api-key',
        },
      ],
    },
  })
  assert.equal(configured.data.credentials[0].state, 'configured')
  const enabled = await api(`/api/plugin-installs/${installId}`, {
    method: 'PATCH',
    body: { enabled: true },
  })
  assert.equal(enabled.data.enabled, true)
  assert.equal(enabled.data.status, 'enabled')
  const disabled = await api(`/api/plugin-installs/${installId}`, {
    method: 'PATCH',
    body: { enabled: false },
  })
  assert.equal(disabled.data.enabled, false)
  assert.equal(disabled.data.status, 'disabled')

  const upgradePlan = await api('/api/registry/install-plan', {
    method: 'POST',
    body: {
      entryId: integrationPluginId,
      action: 'upgrade',
      version: '1.1.0',
    },
  })
  assert.ok(upgradePlan.data.planId)
  assert.equal(upgradePlan.data.installId, installId)
  assert.equal(upgradePlan.data.canInstall, true, JSON.stringify(upgradePlan.data.blockers))
  const upgraded = await api(`/api/plugin-installs/${installId}/upgrade`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `integration-upgrade-${runStamp}` },
    body: {
      planId: upgradePlan.data.planId,
      idempotencyKey: `integration-upgrade-${runStamp}`,
      highRiskConfirmed: upgradePlan.data.highRisk === true,
    },
  })
  assert.equal(upgraded.data.version, '1.1.0')
  assert.equal(upgraded.data.previousVersion, '1.0.0')

  const rollbackPlan = await api('/api/registry/install-plan', {
    method: 'POST',
    body: {
      entryId: integrationPluginId,
      action: 'rollback',
      version: '1.0.0',
    },
  })
  assert.ok(rollbackPlan.data.planId)
  assert.equal(rollbackPlan.data.canInstall, true, JSON.stringify(rollbackPlan.data.blockers))
  const rolledBack = await api(`/api/plugin-installs/${installId}/rollback`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `integration-rollback-${runStamp}` },
    body: {
      planId: rollbackPlan.data.planId,
      idempotencyKey: `integration-rollback-${runStamp}`,
      highRiskConfirmed: rollbackPlan.data.highRisk === true,
    },
  })
  assert.equal(rolledBack.data.version, '1.0.0')
  assert.equal(rolledBack.data.previousVersion, '1.1.0')

  const audit = await api(`/api/plugin-installs/${installId}/audit`)
  const actions = new Set(audit.data.map((event) => event.action))
  for (const action of ['install', 'configure', 'enable', 'disable', 'upgrade', 'rollback']) {
    assert.ok(actions.has(action), `插件审计缺少 ${action}。`)
  }

  const uninstalled = await api(`/api/plugin-installs/${installId}`, {
    method: 'DELETE',
  })
  assert.equal(uninstalled.data.deleted, true)
  const remaining = await api('/api/plugin-installs')
  assert.ok(!remaining.data.some((item) => item.installId === installId), '软卸载后不应出现在活跃安装列表。')
}

/**
 * 验证 MCP initialize、工具发现、运行创建、查询、取消和令牌轮换失效。
 */
async function testInboundMcp() {
  const firstToken = `integration-mcp-token-${runStamp}-first-0001`
  const secondToken = `integration-mcp-token-${runStamp}-second-0002`
  const exposure = await api('/api/workflows/wf_support/mcp-exposure', {
    method: 'POST',
    body: {
      workflowVersionId: 'ver_support_12',
      enabled: true,
      toolName: integrationToolName,
      title: '集成测试客服工具',
      description: '通过真实 MCP 协议创建固定发布版本运行。',
      instructions: '传入 question 后创建生产运行。',
      outputMode: 'structured',
      visibility: 'private',
      authMode: 'api-key',
      accessToken: firstToken,
      timeoutMs: 60000,
      maxConcurrency: 2,
    },
  })
  assert.ok(exposure.data.id)
  assert.equal(exposure.data.workflowVersionId, 'ver_support_12')
  assert.equal(exposure.data.tokenStatus, 'active')

  const initialized = await mcpRequest(firstToken, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ai-reflow-api-integration', version: '1.0.0' },
    },
  })
  assert.equal(initialized.data.jsonrpc, '2.0')
  assert.ok(initialized.data.result?.serverInfo?.name)
  assert.ok(initialized.data.result?.capabilities?.tools)

  const listedTools = await mcpRequest(firstToken, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  })
  const names = new Set(listedTools.data.result.tools.map((tool) => tool.name))
  for (const name of [integrationToolName, 'get_run', 'cancel_run']) {
    assert.ok(names.has(name), `tools/list 缺少 ${name}。`)
  }

  const called = await mcpRequest(firstToken, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: integrationToolName,
      arguments: {
        question: '登录后收不到验证码，怎么办？',
        locale: 'zh-CN',
      },
    },
  })
  const run = toolContent(called.data)
  assert.ok(run.runId)
  assert.equal(run.runKind, 'production')
  assert.equal(run.trigger, 'mcp')
  assert.equal(run.workflowVersionId, 'ver_support_12')

  const queried = await mcpRequest(firstToken, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'get_run', arguments: { runId: run.runId } },
  })
  const queriedRun = toolContent(queried.data)
  assert.equal(queriedRun.runId, run.runId)

  const cancelled = await mcpRequest(firstToken, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'cancel_run', arguments: { runId: run.runId } },
  })
  const cancelledRun = toolContent(cancelled.data)
  assert.equal(cancelledRun.runId, run.runId)
  assert.ok(
    ['cancelled', 'running', 'queued', 'succeeded', 'failed'].includes(cancelledRun.status),
    `取消后的运行状态非法：${JSON.stringify(cancelledRun)}`,
  )

  const rotated = await api('/api/workflows/wf_support/mcp-exposure/rotate-token', {
    method: 'POST',
    body: {
      token: secondToken,
      scopes: ['workflow:run', 'run:read', 'run:cancel'],
    },
  })
  assert.equal(rotated.data.tokenStatus, 'active')
  assert.notEqual(rotated.data.tokenMasked, exposure.data.tokenMasked)

  await mcpRequest(firstToken, {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/list',
    params: {},
  }, [401])
  const secondList = await mcpRequest(secondToken, {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/list',
    params: {},
  })
  assert.ok(secondList.data.result.tools.some((tool) => tool.name === integrationToolName))

  const tokens = await api('/api/mcp/access-tokens')
  assert.ok(tokens.data.some((token) => token.exposureId === exposure.data.id && token.state === 'active'))
  assert.ok(tokens.data.some((token) => token.exposureId === exposure.data.id && token.state === 'revoked'))
  const calls = await api('/api/mcp/calls?direction=inbound&limit=100')
  assert.ok(calls.data.some((call) => call.toolName === integrationToolName))
  assert.ok(calls.data.some((call) => call.toolName === 'get_run'))
  assert.ok(calls.data.some((call) => call.toolName === 'cancel_run'))
}

/**
 * 顺序执行全部 API 集成测试并输出摘要。
 *
 * @returns {Promise<void>} 全部步骤成功时完成。
 */
async function runIntegrationSuite() {
  if (!databaseUrl) throw new Error('缺少 DATABASE_URL，无法准备插件 registry 夹具。')
  const { sql } = createDatabase(databaseUrl)
  try {
    await test('API health', async () => {
      const health = await api('/api/health')
      assert.equal(health.data.ok, true)
      assert.equal(health.data.database, 'up')
    })
    await test('模型连接闭环', testModels)
    await test('知识库闭环', testKnowledge)
    await test('出站 MCP 闭环', testOutboundMcp)
    await test('模板克隆闭环', testTemplates)
    await test('插件生命周期闭环', () => testPlugins(sql))
    await test('入站 MCP 协议闭环', testInboundMcp)
  } finally {
    await sql.end()
  }
  const total = results.reduce((sum, result) => sum + result.duration, 0)
  console.log(`API 集成测试通过：${results.length} 个步骤，${total}ms。`)
}

try {
  await execute(runIntegrationSuite)
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
}
