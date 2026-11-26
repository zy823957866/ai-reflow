import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TransactionSql } from 'postgres'
import {
  createDemoWorkflowDefinitions,
  hashWorkflowDefinition,
  type WorkflowDefinition,
} from '@ai-reflow/core'
import { loadEnvironment } from '../config'
import { createDatabase } from './client'

const WORKSPACE_ID = '00000000-0000-7000-8000-000000000001'
const SUPPORT_WORKFLOW_ID = '10000000-0000-7000-8000-000000000001'
const LEAD_WORKFLOW_ID = '10000000-0000-7000-8000-000000000002'
const REPORT_WORKFLOW_ID = '10000000-0000-7000-8000-000000000003'
const SUPPORT_VERSION_ID = '20000000-0000-7000-8000-000000000012'

/**
 * 生成可嵌入 SQL 的 jsonb 参数片段。
 *
 * 使用显式 `::jsonb` 转换，避免驱动对 JSON 参数类型推断不一致。
 *
 * @param transaction 当前 seed 事务。
 * @param value 任意 JSON 兼容值。
 * @returns Postgres.js SQL 片段。
 */
function jsonb(transaction: SeedTransaction, value: unknown) {
  return transaction`${JSON.stringify(value)}::jsonb`
}

/**
 * 写入可重复执行的 demo 数据。
 *
 * 固定 ID 供前端深链与 smoke 使用；seed 不写真实密钥、OAuth token 或
 * 外部访问凭证。
 *
 * @param databaseUrl PostgreSQL 连接串。
 * @returns 各资源插入后是否首次生效的摘要。
 */
export async function seedDemoData(databaseUrl: string) {
  const { sql } = createDatabase(databaseUrl)
  const definitions = createDemoWorkflowDefinitions()
  try {
    return await sql.begin(async (transaction) => {
      await transaction`
        insert into workspaces (id, slug, name, settings)
        values (
          ${WORKSPACE_ID},
          ${'demo'},
          ${'Acme Demo'},
          ${jsonb(transaction, {
            runRetentionDays: 30,
            previewRetentionHours: 24,
            defaultConcurrency: 3,
          })}
        )
        on conflict (id) do nothing
      `

      await insertWorkflow(transaction, {
        id: SUPPORT_WORKFLOW_ID,
        publicId: 'wf_support',
        name: '客服知识问答',
        slug: 'support',
        description: '知识库检索、工具查询、条件路由与人工兜底。',
        status: 'published',
        tags: ['客服', '知识库', 'OpenAI'],
        definition: definitions.wf_support,
      })
      await insertWorkflow(transaction, {
        id: LEAD_WORKFLOW_ID,
        publicId: 'wf_lead_scoring',
        name: '销售线索评分',
        slug: 'lead-scoring',
        description: 'HTTP 拉取 CRM 数据并通过 BANT 规则评分。',
        status: 'draft',
        tags: ['销售', 'Webhook'],
        definition: definitions.wf_lead_scoring,
      })
      await insertWorkflow(transaction, {
        id: REPORT_WORKFLOW_ID,
        publicId: 'wf_weekly_report',
        name: '周报生成流水线',
        slug: 'weekly-report',
        description: '并行取数、汇总并生成结构化周报。',
        status: 'draft',
        tags: ['运营', '并行'],
        definition: definitions.wf_weekly_report,
      })

      const manifestSnapshot = definitions.wf_support.nodes.map((node) => ({
        type: node.type,
        version: node.manifestVersion ?? '1.0.0',
      }))
      await transaction`
        insert into workflow_versions (
          id,
          public_id,
          workspace_id,
          workflow_id,
          version,
          definition,
          schema_hash,
          manifest_snapshot,
          node_count,
          changelog,
          created_by
        )
        values (
          ${SUPPORT_VERSION_ID},
          ${'ver_support_12'},
          ${WORKSPACE_ID},
          ${SUPPORT_WORKFLOW_ID},
          ${12},
          ${jsonb(transaction, definitions.wf_support)},
          ${hashWorkflowDefinition(definitions.wf_support)},
          ${jsonb(transaction, manifestSnapshot)},
          ${definitions.wf_support.nodes.length},
          ${'发布 demo 固定版本'},
          ${'Demo'}
        )
        on conflict (id) do nothing
      `
      await transaction`
        update workflows
        set
          published_version_id = ${SUPPORT_VERSION_ID},
          published_version = 12
        where id = ${SUPPORT_WORKFLOW_ID}
          and published_version_id is null
      `

      await transaction`
        insert into knowledge_bases (
          id, public_id, workspace_id, name, description,
          embedding_provider, embedding_model, embedding_dimension, status, metadata
        )
        values
          (
            ${'30000000-0000-7000-8000-000000000001'},
            ${'kb_product_docs'},
            ${WORKSPACE_ID},
            ${'产品文档'},
            ${'Acme 产品帮助中心与版本说明'},
            ${'openai'},
            ${'text-embedding-3-small'},
            ${1536},
            ${'ready'},
            ${jsonb(transaction, { documentCount: 2, chunkCount: 4 })}
          ),
          (
            ${'30000000-0000-7000-8000-000000000002'},
            ${'kb_policies'},
            ${WORKSPACE_ID},
            ${'售后与政策'},
            ${'退款、退货、服务等级与合规政策'},
            ${'openai'},
            ${'text-embedding-3-small'},
            ${1536},
            ${'ready'},
            ${jsonb(transaction, { documentCount: 1, chunkCount: 2 })}
          ),
          (
            ${'30000000-0000-7000-8000-000000000003'},
            ${'kb_sales'},
            ${WORKSPACE_ID},
            ${'销售赋能'},
            ${'产品报价、竞品对比与销售话术'},
            ${'openai'},
            ${'text-embedding-3-small'},
            ${1536},
            ${'indexing'},
            ${jsonb(transaction, { documentCount: 1, chunkCount: 1 })}
          )
        on conflict (id) do nothing
      `

      await seedDocuments(transaction)

      await transaction`
        insert into model_connections (
          id, public_id, workspace_id, name, provider, base_url,
          default_model, capabilities, fallback_order, context_window,
          status, latency_ms, is_default, enabled
        )
        values
          (
            ${'40000000-0000-7000-8000-000000000001'},
            ${'mc_openai_gpt4o'},
            ${WORKSPACE_ID},
            ${'GPT-4o'},
            ${'openai'},
            ${'https://api.openai.com/v1'},
            ${'gpt-4o'},
            ${jsonb(transaction, ['text', 'structured', 'vision', 'tools'])},
            ${jsonb(transaction, ['mc_openai_mini', 'mc_claude'])},
            ${128000},
            ${'healthy'},
            ${820},
            ${true},
            ${true}
          ),
          (
            ${'40000000-0000-7000-8000-000000000002'},
            ${'mc_openai_mini'},
            ${WORKSPACE_ID},
            ${'GPT-4.1 mini'},
            ${'openai'},
            ${'https://api.openai.com/v1'},
            ${'gpt-4.1-mini'},
            ${jsonb(transaction, ['text', 'structured', 'tools'])},
            ${jsonb(transaction, [])},
            ${128000},
            ${'healthy'},
            ${430},
            ${false},
            ${true}
          ),
          (
            ${'40000000-0000-7000-8000-000000000003'},
            ${'mc_claude'},
            ${WORKSPACE_ID},
            ${'Claude Sonnet'},
            ${'anthropic'},
            ${'https://api.anthropic.com'},
            ${'claude-sonnet-4'},
            ${jsonb(transaction, ['text', 'structured', 'tools'])},
            ${jsonb(transaction, [])},
            ${200000},
            ${'healthy'},
            ${960},
            ${false},
            ${true}
          )
        on conflict (id) do update
          set context_window = excluded.context_window,
              updated_at = now()
      `

      await transaction`
        insert into mcp_connections (
          id, public_id, workspace_id, name, slug, transport, endpoint,
          auth_type, allowed_hosts, tool_allowlist, timeouts, retry_policy,
          enabled, health_status, last_checked_at
        )
        values
          (
            ${'50000000-0000-7000-8000-000000000001'},
            ${'mcp_github'},
            ${WORKSPACE_ID},
            ${'GitHub'},
            ${'github'},
            ${'streamable-http'},
            ${'https://mcp.github.com'},
            ${'none'},
            ${jsonb(transaction, ['mcp.github.com'])},
            ${jsonb(transaction, ['search_issues', 'get_issue', 'create_issue_comment'])},
            ${jsonb(transaction, { requestMs: 30000, sseMs: 120000 })},
            ${jsonb(transaction, { maxAttempts: 1 })},
            ${true},
            ${'healthy'},
            ${new Date().toISOString()}
          ),
          (
            ${'50000000-0000-7000-8000-000000000002'},
            ${'mcp_notion'},
            ${WORKSPACE_ID},
            ${'Notion'},
            ${'notion'},
            ${'stdio'},
            ${null},
            ${'none'},
            ${jsonb(transaction, [])},
            ${jsonb(transaction, ['search', 'fetch_page'])},
            ${jsonb(transaction, { requestMs: 30000 })},
            ${jsonb(transaction, {})},
            ${true},
            ${'healthy'},
            ${new Date().toISOString()}
          ),
          (
            ${'50000000-0000-7000-8000-000000000003'},
            ${'mcp_filesystem'},
            ${WORKSPACE_ID},
            ${'Filesystem'},
            ${'filesystem'},
            ${'stdio'},
            ${null},
            ${'none'},
            ${jsonb(transaction, [])},
            ${jsonb(transaction, ['read_file', 'list_directory'])},
            ${jsonb(transaction, {})},
            ${jsonb(transaction, {})},
            ${false},
            ${'error'},
            ${new Date().toISOString()}
          )
        on conflict (id) do nothing
      `

      await transaction`
        insert into mcp_tools (
          workspace_id, server_id, name, title, description,
          input_schema, schema_hash, enabled, last_seen_at
        )
        values
          (
            ${WORKSPACE_ID},
            ${'50000000-0000-7000-8000-000000000001'},
            ${'search_issues'},
            ${'搜索 Issue'},
            ${'搜索 GitHub issue 并返回结构化结果。'},
            ${jsonb(transaction, {
              type: 'object',
              properties: {
                query: { type: 'string' },
                limit: { type: 'number', default: 10 },
              },
              required: ['query'],
            })},
            ${'sha256:github-search-v1'},
            ${true},
            ${new Date().toISOString()}
          ),
          (
            ${WORKSPACE_ID},
            ${'50000000-0000-7000-8000-000000000002'},
            ${'search'},
            ${'搜索 Notion'},
            ${'搜索 workspace 内的页面。'},
            ${jsonb(transaction, {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            })},
            ${'sha256:notion-search-v1'},
            ${true},
            ${new Date().toISOString()}
          )
        on conflict (server_id, name) do nothing
      `

      await seedMarketplace(transaction, definitions)
      await seedSkills(transaction)

      return {
        workspaceId: WORKSPACE_ID,
        workflows: 3,
        supportVersionId: SUPPORT_VERSION_ID,
        templates: 3,
        plugins: 3,
      }
    })
  } finally {
    await sql.end()
  }
}

type SeedTransaction = TransactionSql<Record<string, never>>

/**
 * 插入单个 demo 工作流。
 * @param transaction 当前 seed 事务。
 * @param input 工作流元数据与定义。
 */
async function insertWorkflow(
  transaction: SeedTransaction,
  input: {
    id: string
    publicId: string
    name: string
    slug: string
    description: string
    status: string
    tags: string[]
    definition: WorkflowDefinition
  },
) {
  await transaction`
    insert into workflows (
      id, public_id, workspace_id, name, slug, description, status,
      tags, owner, draft_definition, revision
    )
    values (
      ${input.id},
      ${input.publicId},
      ${WORKSPACE_ID},
      ${input.name},
      ${input.slug},
      ${input.description},
      ${input.status},
      ${jsonb(transaction, input.tags)},
      ${jsonb(transaction, { id: 'demo', name: 'Demo', initials: 'D' })},
      ${jsonb(transaction, input.definition)},
      ${1}
    )
    on conflict (id) do nothing
  `
}

/**
 * 插入知识库示例文档与切片，供检索测试与 UI 预览使用。
 * @param transaction 当前 seed 事务。
 */
async function seedDocuments(transaction: SeedTransaction) {
  await transaction`
    insert into documents (
      id, public_id, workspace_id, kb_id, name, mime, extension,
      size_bytes, sha256, storage_key, status, preview_status, metadata
    )
    values
      (
        ${'70000000-0000-7000-8000-000000000001'},
        ${'doc_product_guide'},
        ${WORKSPACE_ID},
        ${'30000000-0000-7000-8000-000000000001'},
        ${'Acme 产品使用指南.md'},
        ${'text/markdown'},
        ${'md'},
        ${18420},
        ${'seed-product-guide'},
        ${'seed/knowledge/product-guide.md'},
        ${'ready'},
        ${'ready'},
        ${jsonb(transaction, { pages: 6, source: 'seed' })}
      ),
      (
        ${'70000000-0000-7000-8000-000000000002'},
        ${'doc_product_release'},
        ${WORKSPACE_ID},
        ${'30000000-0000-7000-8000-000000000001'},
        ${'Acme 版本说明.txt'},
        ${'text/plain'},
        ${'txt'},
        ${9420},
        ${'seed-product-release'},
        ${'seed/knowledge/product-release.txt'},
        ${'ready'},
        ${'ready'},
        ${jsonb(transaction, { source: 'seed' })}
      ),
      (
        ${'70000000-0000-7000-8000-000000000003'},
        ${'doc_refund_policy'},
        ${WORKSPACE_ID},
        ${'30000000-0000-7000-8000-000000000002'},
        ${'退款与售后政策.pdf'},
        ${'application/pdf'},
        ${'pdf'},
        ${128000},
        ${'seed-refund-policy'},
        ${'seed/knowledge/refund-policy.pdf'},
        ${'ready'},
        ${'ready'},
        ${jsonb(transaction, { pages: 12, source: 'seed' })}
      )
    on conflict (id) do nothing
  `
  await transaction`
    insert into document_chunks (
      workspace_id, document_id, chunk_index, content, token_count,
      metadata, embedding_model, embedding_status, tsv
    )
    values
      (
        ${WORKSPACE_ID},
        ${'70000000-0000-7000-8000-000000000001'},
        ${0},
        ${'企业版试用支持 14 天，申请时需要企业邮箱、公司名称与预计使用人数。'},
        ${35},
        ${jsonb(transaction, { title: '试用申请', source: 'seed' })},
        ${'text-embedding-3-small'},
        ${'pending'},
        ${transaction`to_tsvector('simple', ${'企业版试用 企业邮箱 公司名称 预计使用人数'})`}
      ),
      (
        ${WORKSPACE_ID},
        ${'70000000-0000-7000-8000-000000000001'},
        ${1},
        ${'产品文档支持 Markdown、PDF 与 DOCX 导入，预览会保留页码与标题层级。'},
        ${38},
        ${jsonb(transaction, { title: '文档导入', source: 'seed' })},
        ${'text-embedding-3-small'},
        ${'pending'},
        ${transaction`to_tsvector('simple', ${'产品文档 Markdown PDF DOCX 导入 页码 标题层级'})`}
      ),
      (
        ${WORKSPACE_ID},
        ${'70000000-0000-7000-8000-000000000003'},
        ${0},
        ${'未拆封商品支持 7 天无理由退货，企业版服务在订阅生效后 30 天内可申请退款。'},
        ${42},
        ${jsonb(transaction, { title: '退款政策', page: 3, source: 'seed' })},
        ${'text-embedding-3-small'},
        ${'pending'},
        ${transaction`to_tsvector('simple', ${'未拆封 7 天 无理由退货 企业版 30 天 退款'})`}
      )
    on conflict (document_id, chunk_index) do nothing
  `
}

/**
 * 插入模板与插件市场目录。
 * @param transaction 当前 seed 事务。
 * @param definitions demo 工作流定义。
 */
async function seedMarketplace(
  transaction: SeedTransaction,
  definitions: ReturnType<typeof createDemoWorkflowDefinitions>,
) {
  await transaction`
    insert into template_catalog (
      id, name, author, summary, category, tags, license, preview,
      visibility, usage_count
    )
    values
      (
        ${'tpl_support'},
        ${'客服知识问答'},
        ${'Reflow Labs'},
        ${'文档检索、引用与低置信度转人工。'},
        ${'客服'},
        ${jsonb(transaction, ['知识库', '条件分支', '人工兜底'])},
        ${'MIT'},
        ${jsonb(transaction, { nodes: 9, featured: true })},
        ${'verified'},
        ${1284}
      ),
      (
        ${'tpl_lead'},
        ${'销售线索评分'},
        ${'Reflow Labs'},
        ${'HTTP 拉取 CRM 数据并通过 BANT 规则评分。'},
        ${'销售'},
        ${jsonb(transaction, ['HTTP', '结构化输出'])},
        ${'MIT'},
        ${jsonb(transaction, { nodes: 5, featured: true })},
        ${'verified'},
        ${866}
      ),
      (
        ${'tpl_report'},
        ${'团队周报生成'},
        ${'Reflow Labs'},
        ${'并行取数、汇总并生成结构化周报。'},
        ${'运营'},
        ${jsonb(transaction, ['并行', '模板'])},
        ${'MIT'},
        ${jsonb(transaction, { nodes: 7, featured: false })},
        ${'verified'},
        ${521}
      )
    on conflict (id) do nothing
  `
  await transaction`
    insert into template_versions (
      id, template_id, version, manifest, workflow_definition, preview_graph,
      bundle_key, schema_version, required_plugins, required_models,
      required_secrets, required_knowledge
    )
    values
      (
        ${'60000000-0000-7000-8000-000000000001'},
        ${'tpl_support'},
        ${'1.0.0'},
        ${jsonb(transaction, { name: '客服知识问答', dependencies: ['kb_product_docs'] })},
        ${jsonb(transaction, definitions.wf_support)},
        ${jsonb(transaction, { nodes: 9 })},
        ${'seed/templates/support.zip'},
        ${'1.0'},
        ${jsonb(transaction, [])},
        ${jsonb(transaction, ['mc_openai_gpt4o'])},
        ${jsonb(transaction, [])},
        ${jsonb(transaction, ['kb_product_docs'])}
      ),
      (
        ${'60000000-0000-7000-8000-000000000002'},
        ${'tpl_lead'},
        ${'1.0.0'},
        ${jsonb(transaction, { name: '销售线索评分', dependencies: ['crm'] })},
        ${jsonb(transaction, definitions.wf_lead_scoring)},
        ${jsonb(transaction, { nodes: 5 })},
        ${'seed/templates/lead.zip'},
        ${'1.0'},
        ${jsonb(transaction, [])},
        ${jsonb(transaction, ['mc_openai_gpt4o'])},
        ${jsonb(transaction, ['CRM_API_KEY'])},
        ${jsonb(transaction, [])}
      ),
      (
        ${'60000000-0000-7000-8000-000000000003'},
        ${'tpl_report'},
        ${'1.0.0'},
        ${jsonb(transaction, { name: '团队周报生成', dependencies: [] })},
        ${jsonb(transaction, definitions.wf_weekly_report)},
        ${jsonb(transaction, { nodes: 7 })},
        ${'seed/templates/report.zip'},
        ${'1.0'},
        ${jsonb(transaction, [])},
        ${jsonb(transaction, ['mc_openai_gpt4o'])},
        ${jsonb(transaction, [])},
        ${jsonb(transaction, [])}
      )
    on conflict (id) do nothing
  `

  await transaction`
    insert into registry_entries (
      id, kind, name, publisher, summary, visibility, verified, metadata
    )
    values
      (
        ${'plugin_jira'},
        ${'plugin'},
        ${'Jira Connector'},
        ${'Reflow Labs'},
        ${'查询、创建与更新 Jira Issue。'},
        ${'verified'},
        ${true},
        ${jsonb(transaction, { category: '工具连接', version: '1.4.2', nodes: 3 })}
      ),
      (
        ${'plugin_feishu'},
        ${'plugin'},
        ${'飞书消息'},
        ${'Reflow Labs'},
        ${'发送卡片、文档与多维表消息。'},
        ${'verified'},
        ${true},
        ${jsonb(transaction, { category: '通知', version: '1.2.0', nodes: 2 })}
      ),
      (
        ${'plugin_sql'},
        ${'plugin'},
        ${'SQL Inspector'},
        ${'Reflow Labs'},
        ${'只读 SQL 预览、风险与查询计划。'},
        ${'verified'},
        ${true},
        ${jsonb(transaction, { category: '数据', version: '1.1.5', nodes: 2 })}
      )
    on conflict (id) do nothing
  `
  await transaction`
    insert into registry_versions (
      entry_id, version, manifest, tarball_key, checksum, license, compatibility
    )
    values
      (
        ${'plugin_jira'},
        ${'1.4.2'},
        ${jsonb(transaction, {
          id: 'plugin_jira',
          name: 'Jira Connector',
          permissions: { network: ['jira.example.com'], secrets: ['JIRA_TOKEN'] },
        })},
        ${'seed/plugins/jira-1.4.2.tgz'},
        ${'sha256:seed-jira-142'},
        ${'MIT'},
        ${jsonb(transaction, { app: '>=0.1.0' })}
      ),
      (
        ${'plugin_feishu'},
        ${'1.2.0'},
        ${jsonb(transaction, {
          id: 'plugin_feishu',
          name: '飞书消息',
          permissions: { network: ['open.feishu.cn'], secrets: ['FEISHU_APP_SECRET'] },
        })},
        ${'seed/plugins/feishu-1.2.0.tgz'},
        ${'sha256:seed-feishu-120'},
        ${'MIT'},
        ${jsonb(transaction, { app: '>=0.1.0' })}
      ),
      (
        ${'plugin_sql'},
        ${'1.1.5'},
        ${jsonb(transaction, {
          id: 'plugin_sql',
          name: 'SQL Inspector',
          permissions: { network: ['db.internal'], secrets: ['SQL_CONNECTION'] },
        })},
        ${'seed/plugins/sql-1.1.5.tgz'},
        ${'sha256:seed-sql-115'},
        ${'MIT'},
        ${jsonb(transaction, { app: '>=0.1.0' })}
      )
    on conflict (entry_id, version) do nothing
  `
  await seedPlugins(transaction)
}

interface SeedPlugin {
  id: string
  name: string
  publisher: string
  summary: string
  description: string
  pluginKind: 'tool' | 'toolkit' | 'model' | 'datasource' | 'trigger' | 'node-pack'
  category: string
  version: string
  nodes: number
  installs: number
  icon: string
  accent: string
  capabilities: string[]
  permissions: {
    network?: string[]
    files?: string | boolean
    secrets?: string[]
    mcp?: boolean
    code?: boolean
    resources?: string[]
  }
  tools: Array<{ name: string; description: string; nodeType?: string }>
  dependencies?: Array<{ id: string; name: string; version: string }>
}

/**
 * 官方 seed 插件目录，覆盖工具、工具包、模型、数据源、触发器与节点包。
 */
const PLUGIN_SEEDS: SeedPlugin[] = [
  {
    id: 'plugin_jira',
    name: 'Jira Connector',
    publisher: 'Reflow Labs',
    summary: '查询、创建与更新 Jira Issue。',
    description: '通过权限代理访问 Jira REST API，提供搜索、读取与写操作节点。',
    pluginKind: 'tool',
    category: '工具连接',
    version: '1.4.2',
    nodes: 3,
    installs: 2180,
    icon: 'ticket',
    accent: 'violet',
    capabilities: ['搜索 Issue', '创建 Issue', '更新状态'],
    permissions: { network: ['jira.example.com'], secrets: ['JIRA_TOKEN'] },
    tools: [
      { name: 'search_issues', description: '按 JQL 搜索 Issue。', nodeType: 'plugin:plugin_jira:search_issues' },
      { name: 'create_issue', description: '创建 Issue。', nodeType: 'plugin:plugin_jira:create_issue' },
    ],
  },
  {
    id: 'plugin_feishu',
    name: '飞书消息',
    publisher: 'Reflow Labs',
    summary: '发送卡片、文档与多维表消息。',
    description: '向飞书群聊或用户发送消息卡片，并保留失败审计。',
    pluginKind: 'tool',
    category: '通知',
    version: '1.2.0',
    nodes: 2,
    installs: 1940,
    icon: 'message',
    accent: 'sky',
    capabilities: ['发送卡片', '发送文本', '失败审计'],
    permissions: { network: ['open.feishu.cn'], secrets: ['FEISHU_APP_SECRET'] },
    tools: [
      { name: 'send_card', description: '发送交互卡片。', nodeType: 'plugin:plugin_feishu:send_card' },
    ],
  },
  {
    id: 'plugin_sql',
    name: 'SQL Inspector',
    publisher: 'Reflow Labs',
    summary: '只读 SQL 预览、风险与查询计划。',
    description: '只读检查 SQL 语法、风险等级和执行计划，不执行写操作。',
    pluginKind: 'datasource',
    category: '数据',
    version: '1.1.5',
    nodes: 2,
    installs: 1720,
    icon: 'database',
    accent: 'mint',
    capabilities: ['SQL 预览', '风险检查', '查询计划'],
    permissions: { network: ['db.internal'], secrets: ['SQL_CONNECTION'] },
    tools: [
      { name: 'inspect_sql', description: '检查只读 SQL。', nodeType: 'plugin:plugin_sql:inspect_sql' },
    ],
  },
  {
    id: 'plugin_crm_toolkit',
    name: 'CRM 工具包',
    publisher: 'Reflow Labs',
    summary: 'Salesforce / HubSpot 读写、字段映射与 Webhook 触发。',
    description: '把 CRM 查询、写入和字段映射包装为受权限代理约束的节点包。',
    pluginKind: 'toolkit',
    category: '工具包',
    version: '2.2.0',
    nodes: 5,
    installs: 2860,
    icon: 'contact',
    accent: 'violet',
    capabilities: ['查询客户', '创建线索', '字段映射', 'Webhook 触发'],
    permissions: { network: ['api.hubspot.com', '*.salesforce.com'], secrets: ['CRM_API_KEY'] },
    tools: [
      { name: 'crm_lookup', description: '按邮箱或域名查询客户。', nodeType: 'plugin:plugin_crm_toolkit:crm_lookup' },
      { name: 'crm_upsert', description: '创建或更新 CRM 线索。', nodeType: 'plugin:plugin_crm_toolkit:crm_upsert' },
    ],
  },
  {
    id: 'plugin_postgres',
    name: 'PostgreSQL 只读连接器',
    publisher: 'Reflow Labs',
    summary: '只读查询、Schema 浏览与 EXPLAIN。',
    description: '通过只读账号访问 PostgreSQL，限制语句类型并保留查询审计。',
    pluginKind: 'datasource',
    category: '数据源',
    version: '1.4.0',
    nodes: 2,
    installs: 1360,
    icon: 'database',
    accent: 'sky',
    capabilities: ['Schema 浏览', '只读查询', 'EXPLAIN'],
    permissions: { network: ['db.internal'], secrets: ['POSTGRES_READONLY_URL'] },
    tools: [
      { name: 'query_readonly', description: '执行只读查询。', nodeType: 'plugin:plugin_postgres:query' },
    ],
  },
  {
    id: 'plugin_crawler',
    name: '网页内容抓取',
    publisher: 'Reflow Labs',
    summary: '抓取公开网页并按标题层级输出 Markdown。',
    description: '受 allowlist 约束地抓取公开页面，自动清理样板内容并输出引用。',
    pluginKind: 'tool',
    category: '网络',
    version: '1.0.3',
    nodes: 2,
    installs: 1120,
    icon: 'globe',
    accent: 'amber',
    capabilities: ['网页抓取', 'Markdown 转换', '来源引用'],
    permissions: { network: ['*'], files: 'none', secrets: [] },
    tools: [{ name: 'crawl_page', description: '抓取单个公开页面。' }],
  },
  {
    id: 'plugin_gpt_adapter',
    name: '模型供应商适配器',
    publisher: 'Reflow Labs',
    summary: '统一 OpenAI 兼容接口、错误映射与 usage。',
    description: '为 OpenAI 兼容模型提供统一请求、重试、错误与 token usage 映射。',
    pluginKind: 'model',
    category: '模型',
    version: '3.0.1',
    nodes: 1,
    installs: 2360,
    icon: 'sparkles',
    accent: 'violet',
    capabilities: ['OpenAI 兼容', 'usage 统计', '错误归一化'],
    permissions: { network: ['api.openai.com'], secrets: ['OPENAI_API_KEY'] },
    tools: [{ name: 'chat_completion', description: '执行兼容 Chat Completions 请求。' }],
  },
  {
    id: 'plugin_schedule',
    name: '定时触发器',
    publisher: 'Reflow Labs',
    summary: 'Cron 与时区感知的工作流触发器。',
    description: '按 Cron 规则创建运行，支持时区、错过策略与幂等窗口。',
    pluginKind: 'trigger',
    category: '触发器',
    version: '1.1.0',
    nodes: 1,
    installs: 980,
    icon: 'clock',
    accent: 'mint',
    capabilities: ['Cron', '时区', '错过策略'],
    permissions: { resources: ['max 60 triggers'], code: false },
    tools: [],
  },
  {
    id: 'plugin_doc_parser',
    name: '文档解析工具包',
    publisher: 'Reflow Labs',
    summary: 'PDF、DOCX 与表格的统一结构解析。',
    description: '将上传文档解析为带页码、标题层级与表格的结构化片段。',
    pluginKind: 'toolkit',
    category: '文档',
    version: '1.0.0',
    nodes: 4,
    installs: 1540,
    icon: 'file',
    accent: 'amber',
    capabilities: ['PDF 解析', 'DOCX 解析', '表格抽取'],
    permissions: { files: 'workflow artifacts only', secrets: [] },
    tools: [{ name: 'parse_document', description: '解析工作流内上传文档。' }],
  },
  {
    id: 'plugin_slack',
    name: 'Slack Notifier',
    publisher: 'Reflow Labs',
    summary: '发送 Block Kit 消息并支持线程回复。',
    description: '向指定 Slack channel 或线程发送 Block Kit 消息。',
    pluginKind: 'tool',
    category: '通知',
    version: '1.3.1',
    nodes: 2,
    installs: 1180,
    icon: 'message',
    accent: 'sky',
    capabilities: ['Block Kit', '线程回复', '频道白名单'],
    permissions: { network: ['slack.com'], secrets: ['SLACK_BOT_TOKEN'] },
    tools: [{ name: 'post_message', description: '向 channel 发送消息。' }],
  },
  {
    id: 'plugin_pii',
    name: 'PII 脱敏',
    publisher: 'Reflow Labs',
    summary: '识别邮箱、手机号与证件号并脱敏。',
    description: '在进入模型或外部工具前识别常见个人信息并进行可逆或不可逆脱敏。',
    pluginKind: 'node-pack',
    category: '安全',
    version: '2.0.0',
    nodes: 3,
    installs: 760,
    icon: 'shield',
    accent: 'rose',
    capabilities: ['邮箱识别', '手机号识别', '脱敏策略'],
    permissions: { code: true, secrets: ['PII_MAPPING_KEY'] },
    tools: [{ name: 'redact_text', description: '脱敏文本中的个人信息。' }],
  },
  {
    id: 'plugin_s3_files',
    name: 'S3 文件工具',
    publisher: 'Reflow Labs',
    summary: '对象上传、下载与预签名 URL。',
    description: '在权限 allowlist 内上传、读取和生成短期对象 URL。',
    pluginKind: 'tool',
    category: '存储',
    version: '1.2.2',
    nodes: 3,
    installs: 690,
    icon: 'cloud',
    accent: 'mint',
    capabilities: ['上传对象', '读取对象', '预签名 URL'],
    permissions: { network: ['*.amazonaws.com'], files: 'workspace artifacts', secrets: ['S3_ACCESS_KEY'] },
    tools: [{ name: 'put_object', description: '上传工作流产物。' }],
  },
]

/**
 * 写入 12 个官方/已验证插件及其不可变版本清单。
 *
 * @param transaction 当前 seed 事务。
 */
async function seedPlugins(transaction: SeedTransaction) {
  for (const [index, plugin] of PLUGIN_SEEDS.entries()) {
    const checksum = `sha256:${String(index + 1).padStart(64, '0')}`
    const manifest = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      schemaVersion: '1.0',
      engine: 'reflow-engine >=0.9',
      changelog: '本地 seed 已验证版本。',
      size: `${(4 + index * 0.7).toFixed(1)} MB`,
      dependencies: plugin.dependencies ?? [],
      permissions: plugin.permissions,
      tools: plugin.tools,
    }
    await transaction`
      insert into registry_entries (
        id, kind, name, publisher, summary, visibility, verified, metadata
      )
      values (
        ${plugin.id}, ${'plugin'}, ${plugin.name}, ${plugin.publisher},
        ${plugin.summary}, ${'verified'}, ${true},
        ${jsonb(transaction, {
          pluginKind: plugin.pluginKind,
          category: plugin.category,
          version: plugin.version,
          nodes: plugin.nodes,
          installs: plugin.installs,
          icon: plugin.icon,
          accent: plugin.accent,
          capabilities: plugin.capabilities,
          description: plugin.description,
          tags: [plugin.category, plugin.pluginKind],
        })}
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
    await transaction`
      insert into registry_versions (
        entry_id, version, manifest, tarball_key, checksum, signature,
        license, compatibility, deprecated
      )
      values (
        ${plugin.id}, ${plugin.version}, ${jsonb(transaction, manifest)},
        ${`seed/plugins/${plugin.id}-${plugin.version}.tgz`},
        ${checksum}, ${`seed:verified:${plugin.id}:${plugin.version}`},
        ${'MIT'}, ${jsonb(transaction, {
          app: '>=0.1.0 <1.0.0',
          engine: '>=0.9.0',
          schemaVersion: '1.0',
        })}, ${false}
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
 * 插入 P1 Skill 展示数据。
 * @param transaction 当前 seed 事务。
 */
async function seedSkills(transaction: SeedTransaction) {
  await transaction`
    insert into skills (id, name, publisher, summary, type, visibility, metadata)
    values
      (
        ${'skill_customer_tone'},
        ${'客服语气规范'},
        ${'Reflow Labs'},
        ${'约束回复语气、引用方式与升级人工的条件。'},
        ${'prompt'},
        ${'verified'},
        ${jsonb(transaction, { version: '1.0.0' })}
      ),
      (
        ${'skill_sql_guard'},
        ${'SQL 安全审查'},
        ${'Community'},
        ${'识别只读查询、写操作与高风险语句。'},
        ${'tool'},
        ${'community'},
        ${jsonb(transaction, { version: '0.9.0' })}
      )
    on conflict (id) do nothing
  `
}

/**
 * 命令行 seed 入口。
 */
async function main() {
  const config = loadEnvironment()
  const result = await seedDemoData(config.DATABASE_URL)
  console.log(`Seed 完成：${JSON.stringify(result)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
