import type { DatabaseClient } from '../client'
import { iso } from './dto'
import { jsonb, notFound } from './helpers'

/**
 * 知识库、模型、MCP、模板、插件和 Skills 的只读目录仓库。
 */
export class CatalogRepository {
  /**
   * 创建使用当前 workspace 的目录仓库。
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询知识库及其文档、切片聚合计数。
   * @returns 知识库列表 DTO。
   */
  async knowledgeBases() {
    const rows = await this.sql<Array<{
      public_id: string
      name: string
      description: string
      status: string
      embedding_model: string
      embedding_dimension: number
      updated_at: Date
      documents: number
      chunks: number
    }>>`
      select
        kb.public_id, kb.name, kb.description, kb.status,
        kb.embedding_model, kb.embedding_dimension, kb.updated_at,
        count(distinct d.id)::int as documents,
        count(c.id)::int as chunks
      from knowledge_bases kb
      left join documents d
        on d.kb_id = kb.id and d.workspace_id = kb.workspace_id
      left join document_chunks c
        on c.document_id = d.id and c.workspace_id = kb.workspace_id
      where kb.workspace_id = ${this.workspaceId}
      group by kb.id
      order by kb.updated_at desc
    `
    return rows.map((row) => ({
      id: row.public_id,
      name: row.name,
      description: row.description,
      documents: row.documents,
      chunks: row.chunks,
      status: row.status,
      embeddingModel: row.embedding_model,
      dimensions: row.embedding_dimension,
      updatedAt: iso(row.updated_at)!,
    }))
  }

  /**
   * 查询知识库内文档列表。
   * @param knowledgeBaseId 外部知识库 ID。
   * @returns 文档列表 DTO。
   */
  async documents(knowledgeBaseId: string) {
    const [kb] = await this.sql<Array<{ id: string }>>`
      select id from knowledge_bases
      where workspace_id = ${this.workspaceId} and public_id = ${knowledgeBaseId}
    `
    if (!kb) throw notFound('知识库')
    const rows = await this.sql<Array<{
      public_id: string
      name: string
      extension: string
      mime: string
      size_bytes: number
      status: string
      preview_status: string
      stage_error: Record<string, unknown> | null
      metadata: Record<string, unknown>
      updated_at: Date
      chunks: number
    }>>`
      select
        d.public_id, d.name, d.extension, d.mime, d.size_bytes, d.status,
        d.preview_status, d.stage_error, d.metadata, d.updated_at,
        count(c.id)::int as chunks
      from documents d
      left join document_chunks c on c.document_id = d.id
      where d.workspace_id = ${this.workspaceId} and d.kb_id = ${kb.id}
      group by d.id
      order by d.updated_at desc
    `
    return rows.map((row) => ({
      id: row.public_id,
      name: row.name,
      extension: row.extension,
      mime: row.mime,
      size: formatBytes(row.size_bytes),
      sizeBytes: row.size_bytes,
      chunks: row.chunks,
      chunkStrategy: String(row.metadata.chunkStrategy ?? 'semantic · 800/120'),
      status: row.status,
      previewStatus: row.preview_status,
      progress: row.status === 'ready' ? 100 : 0,
      error: row.stage_error?.message,
      updatedAt: iso(row.updated_at)!,
    }))
  }

  /**
   * 使用 PostgreSQL 全文检索验证知识库引用定位。
   * @param knowledgeBaseId 外部知识库 ID。
   * @param query 查询文本。
   * @param topK 返回条数。
   * @returns 命中切片与可复制引用。
   */
  async retrieve(knowledgeBaseId: string, query: string, topK = 5) {
    const [kb] = await this.sql<Array<{ id: string }>>`
      select id from knowledge_bases
      where workspace_id = ${this.workspaceId} and public_id = ${knowledgeBaseId}
    `
    if (!kb) throw notFound('知识库')
    const rows = await this.sql<Array<{
      id: string
      content: string
      chunk_index: number
      metadata: Record<string, unknown>
      document_public_id: string
      document_name: string
      rank: number
    }>>`
      select
        c.id, c.content, c.chunk_index, c.metadata,
        d.public_id as document_public_id, d.name as document_name,
        ts_rank(c.tsv, plainto_tsquery('simple', ${query}))::float as rank
      from document_chunks c
      join documents d on d.id = c.document_id
      where c.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
        and c.tsv @@ plainto_tsquery('simple', ${query})
      order by rank desc, c.chunk_index
      limit ${Math.min(20, Math.max(1, topK))}
    `
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_public_id,
      documentName: row.document_name,
      chunkIndex: row.chunk_index,
      snippet: row.content,
      location: `chunk ${row.chunk_index + 1}`,
      score: Number(row.rank),
      fulltextScore: Number(row.rank),
      metadata: row.metadata,
    }))
  }

  /**
   * 查询模型连接目录。
   * @returns 模型连接 DTO 列表。
   */
  async models() {
    const rows = await this.sql<Array<{
      public_id: string
      name: string
      provider: string
      base_url: string | null
      default_model: string
      capabilities: string[]
      fallback_order: string[]
      status: string
      latency_ms: number | null
      is_default: boolean
      enabled: boolean
      credential_hint: string | null
    }>>`
      select
        m.public_id, m.name, m.provider, m.base_url, m.default_model,
        m.capabilities, m.fallback_order, m.status, m.latency_ms,
        m.is_default, m.enabled, c.masked_hint as credential_hint
      from model_connections m
      left join credentials c on c.id = m.credential_id
      where m.workspace_id = ${this.workspaceId}
      order by m.is_default desc, m.created_at
    `
    return rows.map((row) => ({
      id: row.public_id,
      provider: row.provider,
      name: row.name,
      model: row.default_model,
      baseUrl: row.base_url ?? 'provider default',
      status: row.enabled ? row.status : 'failed',
      default: row.is_default,
      isDefault: row.is_default,
      usage: 0,
      latencyMs: row.latency_ms ?? 0,
      capabilities: row.capabilities,
      fallbackOrder: row.fallback_order,
      credentialMask: row.credential_hint ?? '未配置',
      credentialStatus: row.credential_hint ? 'valid' : 'expiring',
    }))
  }

  /**
   * 查询 MCP 连接、工具数量和调用统计。
   * @returns MCP Server DTO 列表。
   */
  async mcpServers() {
    const rows = await this.sql<Array<{
      public_id: string
      name: string
      endpoint: string | null
      transport: string
      health_status: string
      tools: number
      calls: number
      latency_ms: number | null
    }>>`
      select
        m.public_id, m.name, m.endpoint, m.transport, m.health_status,
        count(distinct t.id)::int as tools,
        count(a.id)::int as calls,
        avg(a.duration_ms)::int as latency_ms
      from mcp_connections m
      left join mcp_tools t on t.server_id = m.id
      left join mcp_call_audit a on a.server_id = m.id
      where m.workspace_id = ${this.workspaceId}
      group by m.id
      order by m.created_at
    `
    return rows.map((row) => ({
      id: row.public_id,
      name: row.name,
      endpoint:
        row.endpoint ??
        (row.transport === 'stdio' ? `stdio://${row.name.toLowerCase()}-mcp` : ''),
      status: row.health_status === 'healthy' ? 'online' : row.health_status,
      tools: row.tools,
      calls: row.calls,
      latencyMs: row.latency_ms ?? 0,
    }))
  }

  /**
   * 查询模板市场目录。
   * @returns 模板 DTO 列表。
   */
  async templates() {
    const rows = await this.sql<Array<{
      id: string
      name: string
      summary: string
      category: string
      usage_count: number
      preview: Record<string, unknown>
    }>>`
      select id, name, summary, category, usage_count, preview
      from template_catalog
      order by usage_count desc
    `
    const versions = await this.sql<Array<{
      template_id: string
      workflow_definition: { nodes?: unknown[] }
    }>>`
      select distinct on (template_id) template_id, workflow_definition
      from template_versions
      order by template_id, created_at desc
    `
    const versionMap = new Map(versions.map((row) => [row.template_id, row]))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.summary,
      category: row.category,
      nodes: versionMap.get(row.id)?.workflow_definition.nodes?.length ?? 0,
      installs: row.usage_count,
      featured: row.preview.featured === true,
    }))
  }

  /**
   * 查询插件目录并合并当前 workspace 安装状态。
   * @returns 插件 DTO 列表。
   */
  async plugins() {
    const rows = await this.sql<Array<{
      id: string
      name: string
      publisher: string
      summary: string
      metadata: Record<string, unknown>
      version: string | null
      installed: boolean
      enabled: boolean
    }>>`
      select
        e.id, e.name, e.publisher, e.summary, e.metadata,
        (select rv.version from registry_versions rv
          where rv.entry_id = e.id order by rv.created_at desc limit 1) as version,
        (pi.id is not null) as installed,
        coalesce(pi.enabled, false) as enabled
      from registry_entries e
      left join plugin_installs pi
        on pi.entry_id = e.id and pi.workspace_id = ${this.workspaceId}
      where e.kind = 'plugin'
      order by e.name
    `
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      author: row.publisher,
      description: row.summary,
      category: String(row.metadata.category ?? ''),
      nodes: Number(row.metadata.nodes ?? 0),
      installed: row.installed,
      enabled: row.enabled,
      version: row.version ?? '0.0.0',
    }))
  }

  /**
   * 查询 Skills 目录。
   * @returns Skills DTO 列表。
   */
  async skills() {
    const rows = await this.sql<Array<{
      id: string
      name: string
      publisher: string
      summary: string
      type: string
      visibility: string
      metadata: Record<string, unknown>
    }>>`
      select id, name, publisher, summary, type, visibility, metadata
      from skills
      order by name
    `
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      publisher: row.publisher,
      summary: row.summary,
      type: row.type,
      visibility: row.visibility,
      version: String(row.metadata.version ?? '0.0.0'),
      status: 'available',
    }))
  }

  /**
   * 查询模板的固定版本工作流定义，用于克隆草稿。
   * @param templateId 模板 ID。
   * @returns 模板版本定义。
   */
  async templateDefinition(templateId: string) {
    const [row] = await this.sql<Array<{
      version: string
      workflow_definition: Record<string, unknown>
    }>>`
      select version, workflow_definition
      from template_versions
      where template_id = ${templateId}
      order by created_at desc
      limit 1
    `
    if (!row) throw notFound('模板')
    return {
      templateId,
      version: row.version,
      definition: row.workflow_definition,
    }
  }
}

/**
 * 将字节数格式化为紧凑文件大小。
 * @param value 字节数。
 * @returns 文件大小文本。
 */
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
