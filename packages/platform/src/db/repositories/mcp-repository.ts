import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { resolveSecretReference } from './credential-store'
import { iso } from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'

interface McpConnectionRow {
  id: string
  public_id: string
  scope_type: string
  scope_id: string | null
  name: string
  slug: string
  description: string
  transport: 'streamable-http' | 'sse' | 'stdio'
  endpoint: string | null
  command: string | null
  args: string[]
  auth_type: string
  credential_id: string | null
  credential_name: string | null
  allowed_hosts: string[]
  tool_allowlist: string[]
  timeouts: Record<string, unknown>
  retry_policy: Record<string, unknown>
  enabled: boolean
  health_status: 'healthy' | 'degraded' | 'offline' | 'error'
  last_checked_at: Date | null
  created_at: Date
  updated_at: Date
  tool_count: number
  call_count: number
  latency_ms: number | null
}

interface McpToolRow {
  id: string
  name: string
  title: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown> | null
  annotations: Record<string, unknown>
  schema_hash: string
  enabled: boolean
  last_seen_at: Date
  call_count: number
  latency_ms: number | null
}

interface McpCallRow {
  public_id: string
  direction: 'outbound' | 'inbound'
  server_public_id: string | null
  tool_name: string
  run_public_id: string | null
  client_id: string | null
  status: 'started' | 'succeeded' | 'failed' | 'cancelled'
  error_code: string | null
  duration_ms: number | null
  metadata: Record<string, unknown>
  created_at: Date
}

export interface McpServerInput {
  name: string
  slug: string
  description?: string
  transport: 'streamable-http' | 'sse' | 'stdio'
  endpoint?: string
  command?: string
  args?: string[]
  authType?: 'none' | 'bearer' | 'api-key' | 'basic' | 'custom-header' | 'oauth2'
  secretRef?: string
  allowlist?: string[]
  toolAllowlist?: string[]
  timeouts?: {
    connectMs?: number
    requestMs?: number
    sseMs?: number
  }
  enabled?: boolean
}

/**
 * 出站 MCP Server、工具缓存与测试调用的数据访问层。
 */
export class McpRepository {
  /**
   * 创建当前 workspace 的 MCP 仓库。
   *
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询 MCP Server 列表。
   *
   * @param query 名称、状态和传输筛选。
   * @returns 不含明文凭证的 Server DTO。
   */
  async list(query: { search?: string; status?: string; transport?: string } = {}) {
    const rows = await this.rows()
    const keyword = query.search?.trim().toLowerCase()
    return rows
      .filter((row) => query.status && query.status !== 'all'
        ? row.health_status === query.status
        : true)
      .filter((row) => query.transport ? row.transport === query.transport : true)
      .filter((row) => {
        if (!keyword) return true
        return (
          row.name.toLowerCase().includes(keyword) ||
          row.slug.toLowerCase().includes(keyword) ||
          (row.endpoint ?? row.command ?? '').toLowerCase().includes(keyword)
        )
      })
      .map((row) => this.toDto(row))
  }

  /**
   * 查询单个 MCP Server。
   *
   * @param serverId 外部 Server ID。
   * @returns Server DTO。
   */
  async get(serverId: string) {
    return this.toDto(await this.require(serverId))
  }

  /**
   * 创建出站 MCP Server。
   *
   * @param input 连接、安全与凭证引用。
   * @returns 新 Server DTO。
   */
  async create(input: McpServerInput) {
    return this.sql.begin(async (transaction) => {
      const credentialId = input.secretRef
        ? await resolveSecretReference(
            transaction,
            this.workspaceId,
            input.secretRef,
            { source: input.name, kind: credentialKind(input.authType) },
          )
        : null
      const [created] = await transaction<Array<{ public_id: string }>>`
        insert into mcp_connections (
          public_id, workspace_id, scope_type, name, slug, description, transport, endpoint,
          command, args, auth_type, credential_id, allowed_hosts, tool_allowlist,
          timeouts, enabled, health_status
        )
        values (
          ${publicId('mcp')}, ${this.workspaceId}, ${'workspace'}, ${input.name},
          ${input.slug}, ${input.description ?? ''}, ${input.transport}, ${input.endpoint ?? null},
          ${input.command ?? null}, ${jsonb(transaction, input.args ?? [])},
          ${input.authType ?? 'none'}, ${credentialId},
          ${jsonb(transaction, input.allowlist ?? [])},
          ${jsonb(transaction, input.toolAllowlist ?? [])},
          ${jsonb(transaction, input.timeouts ?? {})}, ${input.enabled ?? true},
          ${'offline'}
        )
        returning public_id
      `
      return created.public_id
    }).then((serverId) => this.get(serverId))
  }

  /**
   * 更新 MCP Server；未提供 secretRef 时保留原凭据引用。
   *
   * @param serverId 外部 Server ID。
   * @param input 部分更新字段。
   * @returns 更新后的 Server DTO。
   */
  async update(serverId: string, input: Omit<
    Partial<McpServerInput>,
    'endpoint' | 'command' | 'secretRef'
  > & {
    endpoint?: string | null
    command?: string | null
    secretRef?: string | null
  }) {
    return this.sql.begin(async (transaction) => {
      const existing = await this.require(serverId, transaction)
      const credentialId = input.secretRef === null
        ? null
        : input.secretRef
          ? await resolveSecretReference(
              transaction,
              this.workspaceId,
              input.secretRef,
              {
                source: input.name ?? existing.name,
                kind: credentialKind(input.authType ?? existing.auth_type),
              },
            )
          : existing.credential_id
      const transport = input.transport ?? existing.transport
      const endpoint = input.endpoint === undefined ? existing.endpoint : input.endpoint
      const command = input.command === undefined ? existing.command : input.command
      if (transport === 'stdio' && !command) {
        throw new AppError({
          code: 'MCP_COMMAND_REQUIRED',
          message: 'stdio 连接必须提供 command。',
          status: 422,
        })
      }
      if (transport !== 'stdio' && !endpoint) {
        throw new AppError({
          code: 'MCP_ENDPOINT_REQUIRED',
          message: '远程 MCP 连接必须提供 endpoint。',
          status: 422,
        })
      }
      await transaction`
        update mcp_connections
        set
          name = ${input.name ?? existing.name},
          slug = ${input.slug ?? existing.slug},
          description = ${input.description ?? existing.description},
          transport = ${transport},
          endpoint = ${endpoint},
          command = ${command},
          args = ${jsonb(transaction, input.args ?? existing.args)},
          auth_type = ${input.authType ?? existing.auth_type},
          credential_id = ${credentialId},
          allowed_hosts = ${jsonb(transaction, input.allowlist ?? existing.allowed_hosts)},
          tool_allowlist = ${jsonb(transaction, input.toolAllowlist ?? existing.tool_allowlist)},
          timeouts = ${jsonb(transaction, input.timeouts ?? existing.timeouts)},
          enabled = ${input.enabled ?? existing.enabled},
          health_status = ${input.enabled === false ? 'offline' : existing.health_status},
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and public_id = ${serverId}
      `
      return serverId
    }).then((updatedId) => this.get(updatedId))
  }

  /**
   * 删除未被工作流引用的 MCP Server。
   *
   * @param serverId 外部 Server ID。
   * @returns 删除确认。
   */
  async remove(serverId: string) {
    const server = await this.require(serverId)
    const [usage] = await this.sql<Array<{ versions: number; drafts: number }>>`
      select
        (
          select count(*)
          from workflow_versions v
          where v.workspace_id = ${this.workspaceId}
            and exists (
              select 1
              from jsonb_array_elements(v.definition->'nodes') node
              where node->'config'->>'serverId' = ${server.public_id}
            )
        )::int as versions,
        (
          select count(*)
          from workflows w
          where w.workspace_id = ${this.workspaceId}
            and exists (
              select 1
              from jsonb_array_elements(w.draft_definition->'nodes') node
              where node->'config'->>'serverId' = ${server.public_id}
            )
        )::int as drafts
    `
    if ((usage?.versions ?? 0) + (usage?.drafts ?? 0) > 0) {
      throw new AppError({
        code: 'MCP_SERVER_IN_USE',
        message: 'MCP Server 仍被工作流或发布版本引用，不能删除。',
        status: 409,
        details: usage,
      })
    }
    await this.sql`
      delete from mcp_connections
      where workspace_id = ${this.workspaceId}
        and public_id = ${serverId}
    `
    return { deleted: true as const }
  }

  /**
   * 停用 MCP Server，同时保留工具缓存和历史审计。
   *
   * @param serverId 外部 Server ID。
   * @returns 更新后的 Server DTO。
   */
  async disable(serverId: string) {
    return this.update(serverId, { enabled: false })
  }

  /**
   * 使用官方 MCP SDK 测试连接并刷新工具缓存。
   *
   * stdio 不在 API 进程执行，按文档返回 501，由 worker 托管启动。
   *
   * @param serverId 外部 Server ID。
   * @returns 延迟、协议版本和工具数量。
   */
  async test(serverId: string) {
    const server = await this.require(serverId)
    if (!server.enabled) {
      throw new AppError({
        code: 'MCP_SERVER_DISABLED',
        message: 'MCP Server 已停用，不能测试连接。',
        status: 409,
      })
    }
    if (server.transport === 'stdio') {
      throw new AppError({
        code: 'MCP_STDIO_REQUIRES_WORKER',
        message: 'stdio 连接只能由自托管 worker 启动，控制面 API 不执行命令。',
        status: 501,
      })
    }
    const startedAt = performance.now()
    let phase: 'connect' | 'discover' = 'connect'
    try {
      const connection = await this.connect(server)
      phase = 'discover'
      const tools = await this.discoverTools(connection.client, connection.requestTimeoutMs)
      const latencyMs = Math.round(performance.now() - startedAt)
      const protocolVersion =
        'protocolVersion' in connection.transport
          ? String(connection.transport.protocolVersion ?? '')
          : ''
      await connection.close()
      const changes = await this.cacheTools(server, tools)
      await this.sql`
        update mcp_connections
        set
          health_status = 'healthy',
          last_checked_at = now(),
          updated_at = now()
        where workspace_id = ${this.workspaceId} and id = ${server.id}
      `
      return {
        ok: true,
        latencyMs,
        protocolVersion: protocolVersion || undefined,
        toolCount: tools.length,
        schemaChanges: changes,
      }
    } catch (error) {
      await this.sql`
        update mcp_connections
        set health_status = 'offline', last_checked_at = now(), updated_at = now()
        where workspace_id = ${this.workspaceId} and id = ${server.id}
      `
      throw normalizeMcpError(error, {
        code: phase === 'connect' ? 'MCP_CONNECT_ERROR' : 'MCP_DISCOVERY_ERROR',
        message: phase === 'connect'
          ? '无法连接外部 MCP Server。'
          : '已连接，但读取 tools/list 失败。',
        details: { serverId, phase },
      })
    }
  }

  /**
   * 查询已缓存工具。
   *
   * @param serverId 外部 Server ID。
   * @returns 工具 schema、注解和调用统计。
   */
  async tools(serverId: string) {
    const server = await this.require(serverId)
    const rows = await this.sql<McpToolRow[]>`
      select
        t.id, t.name, t.title, t.description, t.input_schema, t.output_schema,
        t.annotations, t.schema_hash, t.enabled, t.last_seen_at,
        count(a.id)::int as call_count,
        avg(a.duration_ms)::int as latency_ms
      from mcp_tools t
      left join mcp_call_audit a
        on a.tool_id = t.id and a.workspace_id = t.workspace_id
      where t.workspace_id = ${this.workspaceId}
        and t.server_id = ${server.id}
      group by t.id
      order by t.name
    `
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      description: row.description,
      readOnly: Boolean(row.annotations.readOnlyHint),
      destructive: Boolean(row.annotations.destructiveHint),
      idempotent: Boolean(row.annotations.idempotentHint),
      openWorld: Boolean(row.annotations.openWorldHint),
      calls: row.call_count,
      latencyMs: row.latency_ms ?? 0,
      schema: row.input_schema,
      outputSchema: row.output_schema ?? undefined,
      schemaHash: row.schema_hash,
      enabled: row.enabled,
      lastSeenAt: iso(row.last_seen_at)!,
    }))
  }

  /**
   * 执行一次不写工作流的 MCP 测试调用，并写入最小化审计。
   *
   * @param serverId 外部 Server ID。
   * @param toolName 工具原始名称。
   * @param args 已解析参数。
   * @returns 标准化结果 envelope。
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    const server = await this.require(serverId)
    if (!server.enabled) {
      throw new AppError({
        code: 'MCP_SERVER_DISABLED',
        message: 'MCP Server 已停用。',
        status: 409,
      })
    }
    if (server.transport === 'stdio') {
      throw new AppError({
        code: 'MCP_STDIO_REQUIRES_WORKER',
        message: 'stdio 工具只能由 worker 执行。',
        status: 501,
      })
    }
    const [tool] = await this.sql<McpToolRow[]>`
      select
        t.id, t.name, t.title, t.description, t.input_schema, t.output_schema,
        t.annotations, t.schema_hash, t.enabled, t.last_seen_at,
        0::int as call_count, null::int as latency_ms
      from mcp_tools t
      where t.workspace_id = ${this.workspaceId}
        and t.server_id = ${server.id}
        and t.name = ${toolName}
      limit 1
    `
    if (!tool) {
      throw new AppError({
        code: 'TOOL_NOT_FOUND',
        message: `工具 ${toolName} 不在缓存中，请先刷新 schema。`,
        status: 404,
      })
    }
    if (!tool.enabled) {
      throw new AppError({
        code: 'TOOL_NOT_ALLOWED',
        message: '工具未在 allowlist 中启用。',
        status: 403,
      })
    }
    validateToolArguments(tool.input_schema, args)
    const [audit] = await this.sql<Array<{ id: string }>>`
      insert into mcp_call_audit (
        workspace_id, direction, server_id, tool_id, client_id, tool_name,
        status, metadata
      )
      values (
        ${this.workspaceId}, ${'outbound'}, ${server.id}, ${tool.id},
        ${'control-plane-test'}, ${tool.name}, ${'started'},
        ${jsonb(this.sql, { testInvocation: true, workflowRunCreated: false })}
      )
      returning id
    `
    const startedAt = performance.now()
    try {
      const connection = await this.connect(server)
      const result = await connection.client.callTool(
        { name: tool.name, arguments: args },
        undefined,
        { timeout: connection.requestTimeoutMs },
      )
      await connection.close()
      const durationMs = Math.round(performance.now() - startedAt)
      const envelope = {
        result,
        structuredContent: result.structuredContent,
        isError: Boolean(result.isError),
        usage: { durationMs },
        durationMs,
      }
      if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > 2 * 1024 * 1024) {
        throw new AppError({
          code: 'MCP_OUTPUT_TOO_LARGE',
          message: 'MCP 测试结果超过 2 MB 上限，未返回完整输出。',
          status: 502,
        })
      }
      await this.sql`
        update mcp_call_audit
        set
          status = ${result.isError ? 'failed' : 'succeeded'},
          error_code = ${result.isError ? 'MCP_TOOL_ERROR' : null},
          duration_ms = ${durationMs},
          metadata = ${jsonb(this.sql, {
            testInvocation: true,
            workflowRunCreated: false,
            schemaHash: tool.schema_hash,
          })}
        where id = ${audit.id}
      `
      return envelope
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt)
      const normalized = normalizeMcpError(error, {
        code: 'MCP_CALL_ERROR',
        message: 'MCP 工具调用失败。',
        details: { serverId, toolName },
      })
      await this.sql`
        update mcp_call_audit
        set
          status = 'failed',
          error_code = ${normalized.code},
          duration_ms = ${durationMs},
          metadata = ${jsonb(this.sql, {
            testInvocation: true,
            workflowRunCreated: false,
            schemaHash: tool.schema_hash,
          })}
        where id = ${audit.id}
      `
      throw normalized
    }
  }

  /**
   * 查询 MCP 调用审计。
   *
   * @param query 方向、状态、工具和客户端筛选。
   * @returns 已脱敏审计 DTO。
   */
  async calls(query: {
    direction?: string
    status?: string
    tool?: string
    client?: string
    limit?: number
  } = {}) {
    const rows = await this.sql<McpCallRow[]>`
      select
        a.id as public_id, a.direction, m.public_id as server_public_id,
        a.tool_name, r.public_id as run_public_id, a.client_id, a.status,
        a.error_code, a.duration_ms, a.metadata, a.created_at
      from mcp_call_audit a
      left join mcp_connections m on m.id = a.server_id
      left join runs r on r.id = a.run_id
      where a.workspace_id = ${this.workspaceId}
        ${query.direction ? this.sql`and a.direction = ${query.direction}` : this.sql``}
        ${query.status ? this.sql`and a.status = ${query.status}` : this.sql``}
        ${query.tool ? this.sql`and a.tool_name = ${query.tool}` : this.sql``}
        ${query.client ? this.sql`and a.client_id = ${query.client}` : this.sql``}
      order by a.created_at desc
      limit ${Math.min(200, Math.max(1, query.limit ?? 100))}
    `
    return rows.map((row) => ({
      id: row.public_id,
      direction: row.direction,
      serverId: row.server_public_id ?? undefined,
      toolName: row.tool_name,
      runId: row.run_public_id ?? undefined,
      clientId: row.client_id ?? undefined,
      status: row.status,
      errorCode: row.error_code ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      metadata: row.metadata,
      at: iso(row.created_at)!,
    }))
  }

  /**
   * 读取 Server 行并按 workspace 隔离。
   *
   * @param serverId 外部 Server ID。
   * @param reader 数据库连接或当前事务。
   * @returns 数据库行。
   */
  private async require(
    serverId: string,
    reader: DatabaseClient | Transaction = this.sql,
  ) {
    const [row] = await this.rows(serverId, reader)
    if (!row) throw notFound('MCP Server')
    return row
  }

  /**
   * 查询 MCP Server 行及聚合统计。
   *
   * @param serverId 可选外部 Server ID。
   * @param reader 数据库连接或当前事务。
   * @returns 数据库行。
   */
  private async rows(
    serverId?: string,
    reader: DatabaseClient | Transaction = this.sql,
  ) {
    return reader<McpConnectionRow[]>`
      select
        m.id, m.public_id, m.scope_type, m.scope_id, m.name, m.slug, m.description,
        m.transport, m.endpoint, m.command, m.args, m.auth_type,
        m.credential_id, c.name as credential_name, m.allowed_hosts,
        m.tool_allowlist, m.timeouts, m.retry_policy, m.enabled,
        m.health_status, m.last_checked_at, m.created_at, m.updated_at,
        count(distinct t.id)::int as tool_count,
        count(a.id)::int as call_count,
        avg(a.duration_ms)::int as latency_ms
      from mcp_connections m
      left join credentials c on c.id = m.credential_id
      left join mcp_tools t on t.server_id = m.id
      left join mcp_call_audit a on a.server_id = m.id
      where m.workspace_id = ${this.workspaceId}
        ${serverId ? reader`and m.public_id = ${serverId}` : reader``}
      group by m.id, c.name
      order by m.created_at
    `
  }

  /**
   * 建立官方 SDK Client 与远程传输。
   *
   * @param server MCP Server 行。
   * @returns Client、Transport、关闭函数与请求超时。
   */
  private async connect(server: McpConnectionRow) {
    const timeouts = server.timeouts
    const connectTimeoutMs = numberValue(timeouts.connectMs, 10_000)
    const requestTimeoutMs = numberValue(timeouts.requestMs, 30_000)
    const endpoint = await validateRemoteEndpoint(server.endpoint, server.allowed_hosts)
    const headers = await resolveMcpHeaders(server)
    const client = new Client(
      { name: 'ai-reflow-control-plane', version: '0.1.0' },
      { capabilities: {} },
    )
    const transport: Transport = server.transport === 'sse'
      ? new SSEClientTransport(endpoint, {
          requestInit: { headers },
          eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers }) },
        })
      : new StreamableHTTPClientTransport(endpoint, {
          requestInit: { headers },
          reconnectionOptions: {
            initialReconnectionDelay: 500,
            maxReconnectionDelay: 5_000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 1,
          },
        })
    await client.connect(transport, { timeout: connectTimeoutMs })
    return {
      client,
      transport,
      requestTimeoutMs,
      close: async () => {
        await client.close()
      },
    }
  }

  /**
   * 分页读取 tools/list，避免只缓存第一页。
   *
   * @param client 已连接的 MCP Client。
   * @param timeout 单次请求超时。
   * @returns 全部工具。
   */
  private async discoverTools(
    client: Client,
    timeout: number,
  ) {
    const tools: Array<{
      name: string
      title?: string
      description?: string
      inputSchema: Record<string, unknown>
      outputSchema?: Record<string, unknown>
      annotations?: Record<string, unknown>
    }> = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout })
      tools.push(
        ...page.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
          outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
          annotations: tool.annotations as Record<string, unknown> | undefined,
        })),
      )
      cursor = page.nextCursor
    } while (cursor)
    return tools
  }

  /**
   * 将发现结果写入工具缓存，并保留已消失工具供排查。
   *
   * @param server MCP Server 行。
   * @param tools 最新 tools/list 结果。
   * @returns 新增、更新和失效数量。
   */
  private async cacheTools(
    server: McpConnectionRow,
    tools: Array<{
      name: string
      title?: string
      description?: string
      inputSchema: Record<string, unknown>
      outputSchema?: Record<string, unknown>
      annotations?: Record<string, unknown>
    }>,
  ) {
    const seenNames = new Set(tools.map((tool) => tool.name))
    let added = 0
    let updated = 0
    for (const tool of tools) {
      const schemaHash = `sha256:${createHash('sha256')
        .update(JSON.stringify(tool.inputSchema))
        .digest('hex')}`
      const enabled = server.tool_allowlist.length > 0
        ? server.tool_allowlist.includes(tool.name)
        : false
      const [existing] = await this.sql<Array<{ schema_hash: string }>>`
        select schema_hash
        from mcp_tools
        where workspace_id = ${this.workspaceId}
          and server_id = ${server.id}
          and name = ${tool.name}
        limit 1
      `
      if (existing?.schema_hash !== schemaHash) {
        existing ? updated++ : added++
      }
      await this.sql`
        insert into mcp_tools (
          workspace_id, server_id, name, title, description, input_schema,
          output_schema, annotations, schema_hash, enabled, last_seen_at
        )
        values (
          ${this.workspaceId}, ${server.id}, ${tool.name},
          ${tool.title ?? tool.name}, ${tool.description ?? ''},
          ${jsonb(this.sql, tool.inputSchema)},
          ${tool.outputSchema ? jsonb(this.sql, tool.outputSchema) : null},
          ${jsonb(this.sql, tool.annotations ?? {})}, ${schemaHash},
          ${enabled}, now()
        )
        on conflict (server_id, name) do update
        set
          title = excluded.title,
          description = excluded.description,
          input_schema = excluded.input_schema,
          output_schema = excluded.output_schema,
          annotations = excluded.annotations,
          schema_hash = excluded.schema_hash,
          enabled = excluded.enabled,
          last_seen_at = now(),
          updated_at = now()
      `
    }
    const missing = await this.sql<Array<{ id: string }>>`
      update mcp_tools
      set enabled = false, updated_at = now()
      where workspace_id = ${this.workspaceId}
        and server_id = ${server.id}
        and not (name = any(${seenNames.size ? [...seenNames] : ['__none__']}))
      returning id
    `
    return { added, updated, disappeared: missing.length }
  }

  /**
   * 将 MCP Server 行映射为前端 DTO。
   *
   * @param row 数据库行。
   * @returns 不含密文和明文的 DTO。
   */
  private toDto(row: McpConnectionRow) {
    return {
      id: row.public_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      scopeType: row.scope_type,
      endpoint: row.endpoint ?? row.command ?? '',
      transport: row.transport,
      status: row.health_status,
      enabled: row.enabled,
      tools: row.tool_count,
      calls: row.call_count,
      latencyMs: row.latency_ms ?? 0,
      secretRef: row.credential_name
        ? `secret://workspace/${row.credential_name}`
        : undefined,
      authType: row.auth_type,
      allowlist: row.allowed_hosts,
      toolAllowlist: row.tool_allowlist,
      timeouts: row.timeouts,
      lastCheckedAt: iso(row.last_checked_at),
      updatedAt: iso(row.updated_at)!,
    }
  }
}

/**
 * 将 MCP 认证方式映射为凭据类型。
 *
 * @param authType MCP auth_type。
 * @returns 数据库凭据类型。
 */
function credentialKind(authType?: string) {
  if (authType === 'bearer') return 'bearer' as const
  if (authType === 'oauth2') return 'oauth2' as const
  if (authType === 'basic') return 'basic' as const
  return 'api_key' as const
}

/**
 * 读取合法的数字配置。
 *
 * @param value 任意配置值。
 * @param fallback 默认值。
 * @returns 正整数。
 */
function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

/**
 * 校验远程 endpoint 协议、allowlist 与私网地址。
 *
 * @param endpoint 远程 MCP URL。
 * @param allowedHosts 配置的 host allowlist。
 * @returns URL 对象。
 */
async function validateRemoteEndpoint(endpoint: string | null, allowedHosts: string[]) {
  if (!endpoint) {
    throw new AppError({
      code: 'MCP_ENDPOINT_REQUIRED',
      message: '远程 MCP 连接缺少 endpoint。',
      status: 422,
    })
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new AppError({
      code: 'MCP_ENDPOINT_INVALID',
      message: 'MCP endpoint 不是合法 URL。',
      status: 422,
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError({
      code: 'MCP_ENDPOINT_PROTOCOL_UNSUPPORTED',
      message: 'MCP endpoint 只支持 http/https。',
      status: 422,
    })
  }
  if (allowedHosts.length && !allowedHosts.includes(url.hostname)) {
    throw new AppError({
      code: 'MCP_HOST_NOT_ALLOWED',
      message: `host ${url.hostname} 不在 allowlist 中。`,
      status: 403,
    })
  }
  if (isPrivateHostname(url.hostname)) {
    throw new AppError({
      code: 'MCP_PRIVATE_HOST_BLOCKED',
      message: 'P0 默认拒绝访问回环、私网和链路本地地址。',
      status: 403,
    })
  }
  try {
    const addresses = await lookup(url.hostname, { all: true })
    if (addresses.some((item) => isPrivateHostname(item.address))) {
      throw new AppError({
        code: 'MCP_PRIVATE_HOST_BLOCKED',
        message: 'MCP host 解析到私网或回环地址，已按策略拒绝。',
        status: 403,
      })
    }
  } catch (error) {
    if (error instanceof AppError) throw error
  }
  return url
}

/**
 * 判断 hostname 是否属于回环、私网、链路本地或保留地址。
 *
 * @param hostname URL hostname 或解析后的 IP。
 * @returns 是否必须拒绝。
 */
function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  ) {
    return true
  }
  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!ipv4) return false
  const first = Number(ipv4[1])
  const second = Number(ipv4[2])
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

/**
 * 从环境变量解析 MCP 认证头。
 *
 * secret_ref 本身只描述密钥位置；当前部署通过环境变量提供实际值。
 *
 * @param server MCP Server 行。
 * @returns 不含日志的请求头。
 */
async function resolveMcpHeaders(server: McpConnectionRow) {
  const headers = new Headers()
  if (server.auth_type === 'none') return headers
  const envKey = [
    `AI_REFLOW_MCP_${server.slug.toUpperCase().replaceAll('-', '_')}_TOKEN`,
    `MCP_${server.slug.toUpperCase().replaceAll('-', '_')}_TOKEN`,
    server.credential_name?.toUpperCase().replaceAll('-', '_'),
  ].find((key) => key && process.env[key])
  const token = envKey ? process.env[envKey] : undefined
  if (!token) {
    throw new AppError({
      code: 'MCP_CREDENTIAL_UNRESOLVED',
      message: '服务端尚未解析 secret_ref 对应的 MCP 凭据。',
      status: 503,
      retryable: true,
    })
  }
  if (server.auth_type === 'api-key') {
    headers.set('X-API-Key', token)
    return headers
  }
  if (server.auth_type === 'custom-header') {
    throw new AppError({
      code: 'MCP_CUSTOM_HEADER_UNRESOLVED',
      message: 'custom-header 认证需要显式的 header 名称与密钥映射。',
      status: 501,
    })
  }
  headers.set('Authorization', `Bearer ${token}`)
  return headers
}

/**
 * 校验工具参数的必填、基础类型和枚举约束。
 *
 * @param schema JSON Schema。
 * @param args 调用参数。
 */
function validateToolArguments(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
) {
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []
  const missing = required.filter((key) => !(key in args))
  if (missing.length) {
    throw new AppError({
      code: 'SCHEMA_MISMATCH',
      message: `工具参数缺少必填字段：${missing.join(', ')}。`,
      status: 422,
      details: { missing },
    })
  }
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {}
  for (const [key, definition] of Object.entries(properties)) {
    if (!(key in args) || !definition || typeof definition !== 'object') continue
    const expected = definition.type
    if (typeof expected !== 'string') continue
    const valid = expectedValue(expected, args[key])
    if (!valid) {
      throw new AppError({
        code: 'SCHEMA_MISMATCH',
        message: `工具参数 ${key} 应为 ${expected}。`,
        status: 422,
      })
    }
    if (Array.isArray(definition.enum) && !definition.enum.includes(args[key])) {
      throw new AppError({
        code: 'SCHEMA_MISMATCH',
        message: `工具参数 ${key} 不在枚举范围内。`,
        status: 422,
      })
    }
  }
}

/**
 * 判断 JSON Schema 基础类型是否匹配。
 *
 * @param type JSON Schema type。
 * @param value 参数值。
 * @returns 是否匹配。
 */
function expectedValue(type: string, value: unknown) {
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
  }
  if (type === 'null') return value === null
  return true
}

/**
 * 把 SDK、超时和网络异常归一化为稳定 MCP 错误。
 *
 * @param error 原始异常。
 * @param fallback 默认错误码、消息和 details。
 * @returns AppError。
 */
function normalizeMcpError(
  error: unknown,
  fallback: {
    code: string
    message: string
    details?: Record<string, unknown>
  },
) {
  if (error instanceof AppError) return error
  const message = error instanceof Error ? error.message : String(error)
  const timeout =
    (error instanceof Error && error.name === 'TimeoutError') ||
    /timeout|timed out|ETIMEDOUT/i.test(message)
  return new AppError({
    code: timeout ? 'MCP_TIMEOUT' : fallback.code,
    message: timeout ? 'MCP 请求超时。' : fallback.message,
    status: timeout ? 504 : 502,
    retryable: true,
    details: {
      ...fallback.details,
      reason: message.slice(0, 300),
    },
  })
}
