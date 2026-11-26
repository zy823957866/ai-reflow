import {
  AppError,
  hashWorkflowDefinition,
  validateWorkflowDefinition,
  type RunKind,
  type RunStatus,
  type RunTrigger,
  type ValidationResult,
  type WorkflowCard,
  type WorkflowDefinition,
  type WorkflowDraft,
  type WorkflowVersion,
} from '@ai-reflow/core'
import { validateFileReferences } from '../../files/references'
import type { DatabaseClient } from '../client'
import {
  iso,
  previewGraph,
  toWorkflowDraft,
  toWorkflowVersion,
  type RunRow,
  type VersionRow,
  type WorkflowRow,
} from './dto'
import {
  asRecord,
  blankDefinition,
  jsonb,
  notFound,
  publicId,
  slugify,
} from './helpers'

const BUILTIN_P0 = new Set([
  'start',
  'output',
  'llm',
  'tool',
  'knowledge',
  'condition',
  'template',
  'variable',
])

export interface WorkflowListQuery {
  search?: string
  status?: string
  tag?: string
  sort?: 'updated' | 'runs' | 'count' | 'success'
  limit?: number
}

export interface ReadinessResult {
  ready: boolean
  blockers: Array<{ code: string; message: string; nodeId?: string; field?: string }>
  warnings: Array<{ code: string; message: string; nodeId?: string; field?: string }>
  checked: {
    models: number
    knowledgeBases: number
    mcpServers: number
    nodes: number
  }
}

/**
 * 工作流、发布版本与运行创建的数据访问层。
 */
export class WorkflowRepository {
  /**
   * 创建使用当前 workspace 的工作流仓库。
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询工作流列表并聚合卡片所需的运行统计。
   * @param query 搜索、筛选和排序条件。
   * @returns 卡片 DTO 列表。
   */
  async list(query: WorkflowListQuery = {}): Promise<WorkflowCard[]> {
    const rows = await this.sql<WorkflowRow[]>`
      select
        w.id, w.public_id, w.workspace_id, w.name, w.slug, w.description,
        w.status, w.tags, w.owner, w.draft_definition, w.revision,
        w.published_version_id, pv.public_id as published_version_public_id,
        w.published_version, w.created_at, w.updated_at
      from workflows w
      left join workflow_versions pv on pv.id = w.published_version_id
      where w.workspace_id = ${this.workspaceId}
        and w.archived_at is null
      order by w.updated_at desc
    `
    const runStats = await this.sql<Array<{
      workflow_id: string
      run_count: number
      succeeded_count: number
      last_run_id: string | null
      last_run_status: string | null
      last_run_at: Date | null
    }>>`
      select
        workflow_id,
        count(*)::int as run_count,
        count(*) filter (where status = 'succeeded')::int as succeeded_count,
        (array_agg(public_id order by created_at desc))[1] as last_run_id,
        (array_agg(status order by created_at desc))[1] as last_run_status,
        max(created_at) as last_run_at
      from runs
      where workspace_id = ${this.workspaceId}
      group by workflow_id
    `
    const statsMap = new Map(runStats.map((item) => [item.workflow_id, item]))
    const queryText = query.search?.trim().toLowerCase()
    const cards = rows
      .filter((row) => !query.status || query.status === 'all' || row.status === query.status)
      .filter((row) => !query.tag || row.tags.includes(query.tag))
      .filter((row) => {
        if (!queryText) return true
        return (
          row.name.toLowerCase().includes(queryText) ||
          row.description.toLowerCase().includes(queryText) ||
          row.tags.some((tag) => tag.toLowerCase().includes(queryText))
        )
      })
      .map((row): WorkflowCard => {
        const stats = statsMap.get(row.id)
        return {
          id: row.public_id,
          name: row.name,
          description: row.description,
          status: row.status,
          tags: row.tags,
          owner: row.owner,
          nodeCount: Array.isArray(row.draft_definition.nodes)
            ? row.draft_definition.nodes.length
            : 0,
          runCount: stats?.run_count ?? 0,
          successRate: stats?.run_count
            ? (stats.succeeded_count ?? 0) / stats.run_count
            : 0,
          updatedAt: iso(row.updated_at)!,
          publishedVersion: row.published_version ?? undefined,
          publishedVersionId: row.published_version_public_id ?? undefined,
          lastRun: stats?.last_run_id
            ? {
                runId: stats.last_run_id,
                status: (stats.last_run_status ?? 'pending') as RunStatus,
                at: iso(stats.last_run_at)!,
              }
            : undefined,
          previewGraph: previewGraph(row.draft_definition),
        }
      })
    cards.sort((left, right) => {
      if (query.sort === 'count') return right.runCount - left.runCount
      if (query.sort === 'success') return right.successRate - left.successRate
      if (query.sort === 'runs') {
        return (
          Date.parse(right.lastRun?.at ?? right.updatedAt) -
          Date.parse(left.lastRun?.at ?? left.updatedAt)
        )
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    })
    return cards.slice(0, Math.min(200, Math.max(1, query.limit ?? 100)))
  }

  /**
   * 读取工作流元数据与草稿定义。
   * @param workflowId 外部工作流 ID。
   * @returns 编辑器草稿 DTO。
   */
  async get(workflowId: string): Promise<WorkflowDraft> {
    return toWorkflowDraft(await this.requireWorkflow(workflowId))
  }

  /**
   * 创建空白工作流或从模板复制定义。
   * @param input 名称、描述、标签与可选模板定义。
   * @returns 新草稿 DTO。
   */
  async create(input: {
    name: string
    description?: string
    tags?: string[]
    definition?: WorkflowDefinition
  }): Promise<WorkflowDraft> {
    const definition = input.definition
      ? structuredClone(input.definition)
      : blankDefinition(input.name)
    definition.name = input.name
    const validation = validateWorkflowDefinition(definition)
    if (!validation.valid) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: '工作流定义未通过编译校验。',
        status: 422,
        issues: validation.errors,
      })
    }
    const slug = `${slugify(input.name)}-${publicId('x').slice(-6)}`
    const [row] = await this.sql<WorkflowRow[]>`
      insert into workflows (
        public_id, workspace_id, name, slug, description, tags,
        owner, draft_definition, revision
      )
      values (
        ${publicId('wf')}, ${this.workspaceId}, ${input.name}, ${slug},
        ${input.description ?? ''}, ${jsonb(this.sql, input.tags ?? [])},
        ${jsonb(this.sql, { id: 'demo', name: 'Demo', initials: 'D' })},
        ${jsonb(this.sql, definition)}, ${1}
      )
      returning
        id, public_id, workspace_id, name, slug, description, status, tags,
        owner, draft_definition, revision, published_version_id,
        published_version, created_at, updated_at
    `
    return toWorkflowDraft(row)
  }

  /**
   * 更新元数据或草稿定义，并用 revision 做乐观锁。
   * @param workflowId 外部工作流 ID。
   * @param input 修改字段与客户端 revision。
   * @returns 更新后的草稿 DTO。
   */
  async update(
    workflowId: string,
    input: {
      name?: string
      description?: string
      tags?: string[]
      definition?: WorkflowDefinition
      revision: number
    },
  ): Promise<WorkflowDraft> {
    if (input.definition) {
      const validation = validateWorkflowDefinition(input.definition)
      if (!validation.valid) {
        throw new AppError({
          code: 'WORKFLOW_INVALID',
          message: '工作流定义未通过编译校验。',
          status: 422,
          issues: validation.errors,
        })
      }
      input.definition.name = input.name ?? input.definition.name
    }
    const [row] = await this.sql<WorkflowRow[]>`
      update workflows
      set
        name = coalesce(${input.name ?? null}, name),
        description = coalesce(${input.description ?? null}, description),
        tags = case when ${input.tags ? 1 : 0} = 1
          then ${input.tags ? jsonb(this.sql, input.tags) : this.sql`tags`}
          else tags end,
        draft_definition = case when ${input.definition ? 1 : 0} = 1
          then ${input.definition ? jsonb(this.sql, input.definition) : this.sql`draft_definition`}
          else draft_definition end,
        revision = revision + 1,
        updated_at = now()
      where workspace_id = ${this.workspaceId}
        and public_id = ${workflowId}
        and revision = ${input.revision}
        and archived_at is null
      returning
        id, public_id, workspace_id, name, slug, description, status, tags,
        owner, draft_definition, revision, published_version_id,
        published_version, created_at, updated_at
    `
    if (!row) {
      await this.requireWorkflow(workflowId)
      throw new AppError({
        code: 'REVISION_CONFLICT',
        message: '工作流已在其他会话中更新，请刷新后重试。',
        status: 409,
      })
    }
    return this.get(workflowId)
  }

  /**
   * 归档工作流，保留版本与历史运行。
   * @param workflowId 外部工作流 ID。
   * @returns 是否归档成功。
   */
  async archive(workflowId: string): Promise<{ archived: true }> {
    const result = await this.sql`
      update workflows
      set status = 'archived', archived_at = now(), updated_at = now()
      where workspace_id = ${this.workspaceId}
        and public_id = ${workflowId}
        and archived_at is null
      returning id
    `
    if (!result.length) throw notFound('工作流')
    return { archived: true }
  }

  /**
   * 复制草稿为独立工作流，不复制发布版本和运行历史。
   * @param workflowId 源工作流 ID。
   * @returns 新工作流草稿。
   */
  async duplicate(workflowId: string): Promise<WorkflowDraft> {
    const source = await this.requireWorkflow(workflowId)
    return this.create({
      name: `${source.name} 副本`,
      description: source.description,
      tags: source.tags,
      definition: source.draft_definition,
    })
  }

  /**
   * 校验任意工作流定义。
   * @param definition 待校验定义。
   * @returns 结构化校验结果。
   */
  validate(definition: WorkflowDefinition): ValidationResult {
    return validateWorkflowDefinition(definition)
  }

  /**
   * 发布当前草稿为不可变版本。
   * @param workflowId 外部工作流 ID。
   * @param revision 客户端 revision。
   * @param changelog 版本说明。
   * @returns 新版本 ID 与版本号。
   */
  async publish(
    workflowId: string,
    revision: number,
    changelog = '',
  ): Promise<{ versionId: string; version: number; schemaHash: string }> {
    return this.sql.begin(async (transaction) => {
      const [workflow] = await transaction<WorkflowRow[]>`
        select
          id, public_id, workspace_id, name, slug, description, status, tags,
          owner, draft_definition, revision, published_version_id,
          null::text as published_version_public_id,
          published_version, created_at, updated_at
        from workflows
        where workspace_id = ${this.workspaceId}
          and public_id = ${workflowId}
          and archived_at is null
        for update
      `
      if (!workflow) throw notFound('工作流')
      if (workflow.revision !== revision) {
        throw new AppError({
          code: 'REVISION_CONFLICT',
          message: '发布前草稿已变化，请刷新后重试。',
          status: 409,
        })
      }
      const validation = validateWorkflowDefinition(workflow.draft_definition)
      if (!validation.valid) {
        throw new AppError({
          code: 'WORKFLOW_INVALID',
          message: '工作流定义未通过发布校验。',
          status: 422,
          issues: validation.errors,
        })
      }
      const [latest] = await transaction<{ version: number | null }[]>`
        select max(version)::int as version
        from workflow_versions
        where workspace_id = ${this.workspaceId}
          and workflow_id = ${workflow.id}
      `
      const version = (latest?.version ?? 0) + 1
      const versionPublicId = `ver_${workflow.slug.replaceAll('-', '_')}_${version}`
      const manifest = workflow.draft_definition.nodes.map((node) => ({
        type: node.type,
        version: node.manifestVersion ?? '1.0.0',
      }))
      const [created] = await transaction<VersionRow[]>`
        insert into workflow_versions (
          public_id, workspace_id, workflow_id, version, definition,
          schema_hash, manifest_snapshot, node_count, changelog
        )
        values (
          ${versionPublicId}, ${this.workspaceId}, ${workflow.id}, ${version},
          ${jsonb(transaction, workflow.draft_definition)},
          ${hashWorkflowDefinition(workflow.draft_definition)},
          ${jsonb(transaction, manifest)},
          ${workflow.draft_definition.nodes.length}, ${changelog.trim() || '发布新版本'}
        )
        returning *
      `
      await transaction`
        update workflows
        set
          published_version_id = ${created.id},
          published_version = ${version},
          status = 'published',
          updated_at = now()
        where id = ${workflow.id}
      `
      return {
        versionId: created.public_id,
        version,
        schemaHash: created.schema_hash,
      }
    })
  }

  /**
   * 查询指定工作流的不可变发布版本。
   * @param workflowId 外部工作流 ID。
   * @returns 按版本号倒序的版本列表。
   */
  async versions(workflowId: string): Promise<WorkflowVersion[]> {
    const workflow = await this.requireWorkflow(workflowId)
    const rows = await this.sql<VersionRow[]>`
      select v.*, w.public_id as workflow_public_id
      from workflow_versions v
      join workflows w on w.id = v.workflow_id
      where v.workspace_id = ${this.workspaceId}
        and v.workflow_id = ${workflow.id}
      order by v.version desc
    `
    return rows.map((row) => toWorkflowVersion(row, workflow.published_version_id))
  }

  /**
   * 读取固定版本定义与元数据。
   * @param workflowId 外部工作流 ID。
   * @param versionId 外部版本 ID。
   * @returns 版本 DTO。
   */
  async version(workflowId: string, versionId: string): Promise<WorkflowVersion> {
    const workflow = await this.requireWorkflow(workflowId)
    const [row] = await this.sql<VersionRow[]>`
      select v.*, w.public_id as workflow_public_id
      from workflow_versions v
      join workflows w on w.id = v.workflow_id
      where v.workspace_id = ${this.workspaceId}
        and v.workflow_id = ${workflow.id}
        and v.public_id = ${versionId}
      limit 1
    `
    if (!row) throw notFound('工作流版本')
    return toWorkflowVersion(row, workflow.published_version_id)
  }

  /**
   * 检查发布版本的节点执行器、模型、知识库和 MCP 依赖。
   * @param workflowId 外部工作流 ID。
   * @param versionId 外部版本 ID。
   * @returns 阻断项、警告与检查项计数。
   */
  async readiness(workflowId: string, versionId: string): Promise<ReadinessResult> {
    const version = await this.version(workflowId, versionId)
    const blockers: ReadinessResult['blockers'] = []
    const warnings: ReadinessResult['warnings'] = []
    const modelIds = new Set<string>()
    const knowledgeIds = new Set<string>()
    const mcpIds = new Set<string>()
    for (const node of version.definition.nodes) {
      if (!BUILTIN_P0.has(node.type)) {
        blockers.push({
          code: 'NODE_RUNTIME_UNAVAILABLE',
          message: `${node.title} 的节点类型 ${node.type} 尚未接入 P0 worker。`,
          nodeId: node.id,
          field: 'type',
        })
      }
      const config = asRecord(node.config)
      if (node.type === 'llm' && typeof config.modelConnectionId === 'string') {
        modelIds.add(config.modelConnectionId)
      }
      if (node.type === 'knowledge') {
        const value = config.knowledgeBaseId ?? config.knowledgeBaseIds
        if (Array.isArray(value)) value.map(String).forEach((id) => knowledgeIds.add(id))
        else if (typeof value === 'string') knowledgeIds.add(value)
        if (!knowledgeIds.size) {
          blockers.push({
            code: 'KNOWLEDGE_REQUIRED',
            message: `${node.title} 未配置知识库。`,
            nodeId: node.id,
            field: 'knowledgeBaseId',
          })
        }
      }
      if (node.type === 'tool' && config.kind === 'mcp' && typeof config.serverId === 'string') {
        mcpIds.add(config.serverId)
      }
    }
    const models = await this.sql<Array<{ public_id: string; enabled: boolean; has_credential: boolean }>>`
      select
        m.public_id, m.enabled,
        (m.credential_id is not null) as has_credential
      from model_connections m
      where m.workspace_id = ${this.workspaceId}
        and m.public_id = any(${[...modelIds]}::text[])
    `
    const modelMap = new Map(models.map((row) => [row.public_id, row]))
    modelIds.forEach((id) => {
      const model = modelMap.get(id)
      if (!model || !model.enabled) {
        blockers.push({ code: 'MODEL_NOT_READY', message: `模型连接 ${id} 不可用。`, field: 'modelConnectionId' })
      } else if (!model.has_credential) {
        warnings.push({ code: 'MODEL_CREDENTIAL_MISSING', message: `模型连接 ${id} 尚未配置凭据。`, field: 'modelConnectionId' })
      }
    })
    const knowledge = await this.sql<Array<{ public_id: string; status: string }>>`
      select public_id, status
      from knowledge_bases
      where workspace_id = ${this.workspaceId}
        and public_id = any(${[...knowledgeIds]}::text[])
    `
    const knowledgeMap = new Map(knowledge.map((row) => [row.public_id, row.status]))
    knowledgeIds.forEach((id) => {
      if (knowledgeMap.get(id) !== 'ready') {
        blockers.push({ code: 'KNOWLEDGE_NOT_READY', message: `知识库 ${id} 尚未就绪。`, field: 'knowledgeBaseId' })
      }
    })
    const mcp = await this.sql<Array<{ public_id: string; enabled: boolean; health_status: string }>>`
      select public_id, enabled, health_status
      from mcp_connections
      where workspace_id = ${this.workspaceId}
        and public_id = any(${[...mcpIds]}::text[])
    `
    const mcpMap = new Map(mcp.map((row) => [row.public_id, row]))
    mcpIds.forEach((id) => {
      const server = mcpMap.get(id)
      if (!server || !server.enabled) {
        blockers.push({ code: 'MCP_NOT_READY', message: `MCP Server ${id} 不可用。`, field: 'serverId' })
      } else if (server.health_status !== 'healthy') {
        warnings.push({ code: 'MCP_DEGRADED', message: `MCP Server ${id} 健康状态为 ${server.health_status}。`, field: 'serverId' })
      }
    })
    return {
      ready: blockers.length === 0,
      blockers,
      warnings,
      checked: {
        models: modelIds.size,
        knowledgeBases: knowledgeIds.size,
        mcpServers: mcpIds.size,
        nodes: version.nodeCount,
      },
    }
  }

  /**
   * 创建草稿预览运行，并固化客户端提交的定义快照。
   * @param workflowId 外部工作流 ID。
   * @param input 定义、运行输入与超时。
   * @returns 新运行摘要。
   */
  async createPreviewRun(
    workflowId: string,
    input: {
      definition: WorkflowDefinition
      input: Record<string, unknown>
      timeoutMs?: number
      idempotencyKey?: string
    },
  ) {
    const workflow = await this.requireWorkflow(workflowId)
    const validation = validateWorkflowDefinition(input.definition)
    if (!validation.valid) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: '预览定义未通过编译校验。',
        status: 422,
        issues: validation.errors,
      })
    }
    const normalizedInput = await this.normalizeRunInput(
      input.definition,
      input.input,
    )
    return this.insertRun({
      workflow,
      workflowVersionId: null,
      definition: input.definition,
      runKind: 'preview',
      trigger: 'manual_preview',
      input: normalizedInput,
      timeoutMs: input.timeoutMs ?? 120_000,
      idempotencyKey: input.idempotencyKey,
    })
  }

  /**
   * 创建固定发布版本运行。
   * @param workflowId 外部工作流 ID。
   * @param input 外部版本 ID、触发方式、输入与超时。
   * @returns 新运行摘要。
   */
  async createProductionRun(
    workflowId: string,
    input: {
      workflowVersionId: string
      trigger: Exclude<RunTrigger, 'manual_preview' | 'replay'>
      input: Record<string, unknown>
      timeoutMs?: number
      idempotencyKey?: string
      metadata?: Record<string, unknown>
    },
  ) {
    const workflow = await this.requireWorkflow(workflowId)
    const version = await this.version(workflowId, input.workflowVersionId)
    const [versionRow] = await this.sql<VersionRow[]>`
      select v.*
      from workflow_versions v
      where v.workspace_id = ${this.workspaceId}
        and v.workflow_id = ${workflow.id}
        and v.public_id = ${input.workflowVersionId}
      limit 1
    `
    if (!versionRow) throw notFound('工作流版本')
    const normalizedInput = await this.normalizeRunInput(
      version.definition,
      input.input,
    )
    return this.insertRun({
      workflow,
      workflowVersionId: versionRow.id,
      definition: version.definition,
      runKind: 'production',
      trigger: input.trigger,
      input: normalizedInput,
      timeoutMs: input.timeoutMs ?? 120_000,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    })
  }

  /**
   * 在同一事务中幂等写入运行记录。
   * @param input 运行快照和固定版本信息。
   * @returns 运行摘要。
   */
  private async insertRun(input: {
    workflow: WorkflowRow
    workflowVersionId: string | null
    definition: WorkflowDefinition
    runKind: RunKind
    trigger: RunTrigger
    input: Record<string, unknown>
    timeoutMs: number
    idempotencyKey?: string
    metadata?: Record<string, unknown>
  }) {
    if (input.idempotencyKey) {
      const [existing] = await this.sql<RunRow[]>`
        select
          r.*, w.public_id as workflow_public_id, w.name as workflow_name,
          v.public_id as version_public_id, v.version
        from runs r
        join workflows w on w.id = r.workflow_id
        left join workflow_versions v on v.id = r.workflow_version_id
        where r.workspace_id = ${this.workspaceId}
          and r.idempotency_key = ${input.idempotencyKey}
        limit 1
      `
      if (existing) {
        return {
          runId: existing.public_id,
          workflowVersionId: existing.version_public_id ?? undefined,
          runKind: existing.run_kind,
          trigger: existing.trigger,
          status: existing.status,
          links: {
            detail: `/runs/${existing.public_id}`,
            events: `/api/runs/${existing.public_id}/events`,
          },
        }
      }
    }
    const [row] = await this.sql<{ public_id: string }[]>`
      insert into runs (
        public_id, workspace_id, workflow_id, workflow_version_id,
        definition_snapshot, run_kind, trigger, status, input, metadata,
        idempotency_key
      )
      values (
        ${publicId('run')}, ${this.workspaceId}, ${input.workflow.id},
        ${input.workflowVersionId}, ${jsonb(this.sql, input.definition)},
        ${input.runKind}, ${input.trigger}, 'queued',
        ${jsonb(this.sql, input.input)},
        ${jsonb(this.sql, {
          timeoutMs: input.timeoutMs,
          actor: 'Demo',
          frozenAt: new Date().toISOString(),
          ...input.metadata,
        })},
        ${input.idempotencyKey ?? null}
      )
      returning public_id
    `
    return {
      runId: row.public_id,
      workflowVersionId: input.workflow
        ? input.definition && input.workflowVersionId
          ? await this.versionIdForRun(input.workflowVersionId)
          : undefined
        : undefined,
      runKind: input.runKind,
      trigger: input.trigger,
      status: 'queued' as const,
      links: {
        detail: `/runs/${row.public_id}`,
        events: `/api/runs/${row.public_id}/events`,
      },
    }
  }

  /**
   * 读取运行响应的外部版本 ID。
   * @param internalId 版本内部 UUID。
   * @returns 外部版本 ID。
   */
  private async versionIdForRun(internalId: string) {
    const [row] = await this.sql<{ public_id: string }[]>`
      select public_id from workflow_versions
      where workspace_id = ${this.workspaceId} and id = ${internalId}
    `
    return row?.public_id
  }

  /**
   * 按开始节点的输入 Schema 规范化运行附件引用。
   * @param definition 本次运行固化的工作流定义。
   * @param input 客户端提交的运行输入。
   * @returns 仅含当前 workspace 可信元数据的运行输入。
   */
  private async normalizeRunInput(
    definition: WorkflowDefinition,
    input: Record<string, unknown>,
  ) {
    const start = definition.nodes.find((node) => node.type === 'start')
    const schema = asRecord(start?.config.inputSchema)
    return validateFileReferences(
      input,
      schema,
      (id) => this.resolveFileReference(id),
    )
  }

  /**
   * 在当前 workspace 内读取附件公开元数据。
   * @param id 外部附件 ID。
   * @returns FileRef；不存在或跨 workspace 时返回 undefined。
   */
  private async resolveFileReference(id: string) {
    const [row] = await this.sql<Array<{
      public_id: string
      name: string
      mime: string
      size_bytes: number | string
      sha256: string
    }>>`
      select public_id, name, mime, size_bytes, sha256
      from file_assets
      where workspace_id = ${this.workspaceId}
        and public_id = ${id}
      limit 1
    `
    if (!row) return undefined
    return {
      id: row.public_id,
      name: row.name,
      mime: row.mime,
      size: Number(row.size_bytes),
      sha256: row.sha256,
    }
  }

  /**
   * 通过外部 ID 读取并校验工作流归属。
   * @param workflowId 外部工作流 ID。
   * @returns 工作流数据库记录。
   */
  async requireWorkflow(workflowId: string): Promise<WorkflowRow> {
    const [row] = await this.sql<WorkflowRow[]>`
      select
        w.id, w.public_id, w.workspace_id, w.name, w.slug, w.description,
        w.status, w.tags, w.owner, w.draft_definition, w.revision,
        w.published_version_id,
        pv.public_id as published_version_public_id,
        w.published_version, w.created_at, w.updated_at
      from workflows w
      left join workflow_versions pv on pv.id = w.published_version_id
      where w.workspace_id = ${this.workspaceId}
        and w.public_id = ${workflowId}
        and w.archived_at is null
      limit 1
    `
    if (!row) throw notFound('工作流')
    return row
  }
}
