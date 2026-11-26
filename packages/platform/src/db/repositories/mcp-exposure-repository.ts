import { createHash } from 'node:crypto'
import {
  AppError,
  type RunRecord,
  type WorkflowDefinition,
} from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { storeInboundMcpToken } from './credential-store'
import { iso } from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'
import { RunRepository } from './run-repository'
import { WorkflowRepository } from './workflow-repository'

interface WorkflowRow {
  id: string
  public_id: string
  name: string
  slug: string
}

interface WorkflowVersionRow {
  id: string
  public_id: string
  version: number
  definition: WorkflowDefinition
  schema_hash: string
}

interface ExposureRow {
  id: string
  public_id: string
  workflow_id: string
  workflow_public_id: string
  workflow_name: string
  workflow_slug: string
  workflow_version_id: string
  workflow_version_public_id: string
  workflow_version: number
  definition: WorkflowDefinition
  version_schema_hash: string
  tool_name: string
  title: string
  description: string
  instructions: string | null
  input_schema_projection: Record<string, unknown>
  output_mode: 'text' | 'structured'
  visibility: 'private' | 'public'
  auth_mode: 'none' | 'bearer' | 'api-key' | 'oauth2'
  access_credential_id: string | null
  credential_masked: string | null
  credential_metadata: Record<string, unknown> | null
  rate_limit: Record<string, unknown>
  timeout_ms: number
  max_concurrency: number
  enabled: boolean
  created_at: Date | string
  updated_at: Date | string
}

interface AccessTokenRow {
  credential_id: string
  credential_name: string
  masked_hint: string
  metadata: Record<string, unknown>
  exposure_public_id: string
  workflow_public_id: string
  tool_name: string
  enabled: boolean | null
  created_at: Date | string
  updated_at: Date | string
}

export interface McpExposureInput {
  workflowVersionId: string
  enabled: boolean
  toolName: string
  title: string
  description: string
  instructions?: string | null
  outputMode: 'text' | 'structured'
  visibility: 'private' | 'public'
  authMode: 'none' | 'bearer' | 'api-key'
  accessToken?: string
  expiresAt?: string | null
  timeoutMs: number
  maxConcurrency: number
}

export interface McpExposureTokenInput {
  token: string
  expiresAt?: string | null
  scopes: Array<'workflow:run' | 'run:read' | 'run:cancel'>
}

export interface AuthenticatedMcpExposure {
  id: string
  publicId: string
  workflowPublicId: string
  workflowSlug: string
  workflowVersionPublicId: string
  workflowVersion: number
  definition: WorkflowDefinition
  versionSchemaHash: string
  toolName: string
  title: string
  description: string
  instructions?: string
  inputSchema: Record<string, unknown>
  outputMode: 'text' | 'structured'
  timeoutMs: number
  maxConcurrency: number
  clientId: string
  scopes: string[]
}

const DEFAULT_MCP_SCOPES = ['workflow:run', 'run:read', 'run:cancel']
const RESERVED_MCP_TOOL_NAMES = new Set(['get_run', 'cancel_run'])

/**
 * 入站 MCP 暴露、访问令牌、外部运行和审计仓库。
 *
 * 出站连接与入站暴露使用独立数据模型和认证路径，避免生命周期互相影响。
 */
export class McpExposureRepository {
  /**
   * 创建当前 workspace 的入站 MCP 仓库。
   *
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询工作流入站暴露状态。
   *
   * @param workflowId 外部工作流 ID。
   * @returns 工作流摘要和可选暴露配置。
   */
  async getForWorkflow(workflowId: string) {
    const workflow = await this.requireWorkflow(workflowId)
    const [row] = await this.exposureRows({ workflowId })
    return {
      workflowId: workflow.public_id,
      workflowName: workflow.name,
      configured: Boolean(row),
      exposure: row ? this.toDto(row) : null,
    }
  }

  /**
   * 查询当前 workspace 的全部入站暴露。
   *
   * @returns 暴露 DTO 列表。
   */
  async list() {
    return (await this.exposureRows()).map((row) => this.toDto(row))
  }

  /**
   * 创建或显式切换工作流暴露的固定发布版本。
   *
   * @param workflowId 外部工作流 ID。
   * @param input 发布版本、工具定义、认证和并发限制。
   * @returns 更新后的暴露 DTO。
   */
  async upsert(workflowId: string, input: McpExposureInput) {
    if (RESERVED_MCP_TOOL_NAMES.has(input.toolName)) {
      throw new AppError({
        code: 'MCP_TOOL_NAME_RESERVED',
        message: `工具名 ${input.toolName} 为入站协议保留名称。`,
        status: 409,
      })
    }
    return this.sql.begin(async (transaction) => {
      const workflow = await this.requireWorkflow(workflowId, transaction)
      const version = await this.requireVersion(
        workflow.id,
        input.workflowVersionId,
        transaction,
      )
      const [existing] = await this.exposureRows({ workflowId }, transaction)
      const [nameConflict] = await transaction<Array<{ workflow_public_id: string }>>`
        select w.public_id as workflow_public_id
        from workflow_mcp_exposures e
        join workflows w on w.id = e.workflow_id
        where e.workspace_id = ${this.workspaceId}
          and e.tool_name = ${input.toolName}
          and e.workflow_id <> ${workflow.id}
        limit 1
      `
      if (nameConflict) {
        throw new AppError({
          code: 'MCP_TOOL_NAME_CONFLICT',
          message: `工具名 ${input.toolName} 已被工作流 ${nameConflict.workflow_public_id} 使用。`,
          status: 409,
        })
      }

      const exposurePublicId = existing?.public_id ?? publicId('mcpx')
      let credentialId = input.authMode === 'none'
        ? null
        : existing?.access_credential_id ?? null
      if (input.authMode !== 'none' && !input.accessToken && !credentialId) {
        throw new AppError({
          code: 'MCP_ACCESS_TOKEN_REQUIRED',
          message: '启用入站认证时必须提供访问令牌。',
          status: 422,
        })
      }
      if (input.authMode === 'none' && existing?.access_credential_id) {
        await revokeCredential(
          transaction,
          this.workspaceId,
          existing.access_credential_id,
        )
      }
      if (input.accessToken && input.authMode !== 'none') {
        if (existing?.access_credential_id) {
          await revokeCredential(
            transaction,
            this.workspaceId,
            existing.access_credential_id,
          )
        }
        const stored = await storeInboundMcpToken(
          transaction,
          this.workspaceId,
          {
            exposurePublicId,
            token: input.accessToken,
            scopes: DEFAULT_MCP_SCOPES,
            expiresAt: input.expiresAt,
          },
        )
        credentialId = stored.credentialId
      }
      const inputSchema = inputSchemaFor(version.definition)

      if (existing) {
        await transaction`
          update workflow_mcp_exposures
          set
            workflow_version_id = ${version.id},
            tool_name = ${input.toolName},
            title = ${input.title},
            description = ${input.description},
            instructions = ${input.instructions ?? null},
            input_schema_projection = ${jsonb(transaction, inputSchema)},
            output_mode = ${input.outputMode},
            visibility = ${input.visibility},
            auth_mode = ${input.authMode},
            access_credential_id = ${credentialId},
            timeout_ms = ${input.timeoutMs},
            max_concurrency = ${input.maxConcurrency},
            enabled = ${input.enabled},
            updated_at = now()
          where workspace_id = ${this.workspaceId}
            and id = ${existing.id}
        `
      } else {
        await transaction`
          insert into workflow_mcp_exposures (
            public_id, workspace_id, workflow_id, workflow_version_id,
            tool_name, title, description, instructions,
            input_schema_projection, output_mode, visibility, auth_mode,
            access_credential_id, timeout_ms, max_concurrency, enabled
          )
          values (
            ${exposurePublicId}, ${this.workspaceId}, ${workflow.id},
            ${version.id}, ${input.toolName}, ${input.title},
            ${input.description}, ${input.instructions ?? null},
            ${jsonb(transaction, inputSchema)}, ${input.outputMode},
            ${input.visibility}, ${input.authMode}, ${credentialId},
            ${input.timeoutMs}, ${input.maxConcurrency}, ${input.enabled}
          )
        `
      }
      const [updated] = await this.exposureRows({ workflowId }, transaction)
      return this.toDto(updated)
    })
  }

  /**
   * 轮换工作流级访问令牌并使旧令牌立即失效。
   *
   * 新令牌只加密落库并返回掩码、摘要和元数据，不返回明文。
   *
   * @param workflowId 外部工作流 ID。
   * @param input 新令牌、作用域和可选过期时间。
   * @returns 新访问令牌元数据。
   */
  async rotateToken(workflowId: string, input: McpExposureTokenInput) {
    return this.sql.begin(async (transaction) => {
      const workflow = await this.requireWorkflow(workflowId, transaction)
      const [exposure] = await this.exposureRows({ workflowId }, transaction)
      if (!exposure) throw notFound('MCP 入站暴露')
      if (exposure.auth_mode === 'none') {
        throw new AppError({
          code: 'MCP_AUTH_DISABLED',
          message: '当前暴露未启用认证，请先切换为 bearer 或 api-key。',
          status: 409,
        })
      }
      if (exposure.access_credential_id) {
        await revokeCredential(
          transaction,
          this.workspaceId,
          exposure.access_credential_id,
        )
      }
      return this.rotateExposureToken(
        transaction,
        exposure,
        workflow.public_id,
        input,
      )
    })
  }

  /**
   * 按暴露 ID 轮换访问令牌，供统一凭据管理接口使用。
   *
   * @param exposureId 外部暴露 ID。
   * @param input 新令牌、作用域和可选过期时间。
   * @returns 新令牌元数据。
   */
  async rotateTokenByExposure(
    exposureId: string,
    input: McpExposureTokenInput,
  ) {
    return this.sql.begin(async (transaction) => {
      const [exposure] = await this.exposureRows({ exposureId }, transaction)
      if (!exposure) throw notFound('MCP 入站暴露')
      if (exposure.auth_mode === 'none') {
        throw new AppError({
          code: 'MCP_AUTH_DISABLED',
          message: '当前暴露未启用认证，请先切换为 bearer 或 api-key。',
          status: 409,
        })
      }
      if (exposure.access_credential_id) {
        await revokeCredential(
          transaction,
          this.workspaceId,
          exposure.access_credential_id,
        )
      }
      return this.rotateExposureToken(
        transaction,
        exposure,
        exposure.workflow_public_id,
        input,
      )
    })
  }

  /**
   * 查询入站访问令牌元数据，不返回任何明文或密文。
   *
   * @returns 令牌掩码、作用域、状态和关联暴露。
   */
  async accessTokens() {
    const rows = await this.sql<AccessTokenRow[]>`
      select
        c.id as credential_id, c.name as credential_name, c.masked_hint,
        c.metadata,
        coalesce(e.public_id, c.metadata->>'exposurePublicId') as exposure_public_id,
        w.public_id as workflow_public_id,
        coalesce(e.tool_name, c.metadata->>'toolName', '') as tool_name,
        e.enabled,
        c.created_at, c.updated_at
      from credentials c
      left join workflow_mcp_exposures e
        on e.workspace_id = c.workspace_id
        and e.public_id = c.metadata->>'exposurePublicId'
      left join workflows w on w.id = e.workflow_id
      where c.workspace_id = ${this.workspaceId}
        and c.metadata->>'type' = 'mcp-inbound'
      order by c.created_at desc
    `
    return rows.map((row) => {
      const revokedAt = typeof row.metadata.revokedAt === 'string'
        ? row.metadata.revokedAt
        : undefined
      const expiresAt = typeof row.metadata.expiresAt === 'string'
        ? row.metadata.expiresAt
        : undefined
      return {
        id: row.credential_id,
        name: row.credential_name,
        maskedHint: row.masked_hint,
        exposureId: row.exposure_public_id,
        workflowId: row.workflow_public_id ?? undefined,
        toolName: row.tool_name,
        scopes: stringArray(row.metadata.scopes),
        state: revokedAt
          ? 'revoked'
          : expiresAt && new Date(expiresAt).getTime() <= Date.now()
            ? 'expired'
            : row.enabled === true
              ? 'active'
              : 'disabled',
        expiresAt,
        revokedAt,
        createdAt: iso(row.created_at)!,
        updatedAt: iso(row.updated_at)!,
      }
    })
  }

  /**
   * 校验请求令牌，并返回其作用域内的入站暴露。
   *
   * @param authorization 可选 Authorization 请求头。
   * @param apiKey 可选 X-API-Key 请求头。
   * @param allowUnauthenticated 是否允许回环开发环境下的无认证工具。
   * @returns 已认证暴露列表。
   */
  async authenticate(
    authorization: string | undefined,
    apiKey: string | undefined,
    allowUnauthenticated: boolean,
  ): Promise<AuthenticatedMcpExposure[]> {
    const token = bearerToken(authorization) ?? apiKey?.trim()
    if (!token) {
      if (!allowUnauthenticated) {
        throw new AppError({
          code: 'MCP_AUTH_REQUIRED',
          message: '非回环监听地址必须提供 Bearer 或 API Key。',
          status: 401,
        })
      }
      const rows = await this.exposureRows({ authNone: true, enabled: true })
      return rows.map((row) =>
        toAuthenticated(row, DEFAULT_MCP_SCOPES, 'anonymous'),
      )
    }

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const rows = await this.exposureRows({ tokenHash, enabled: true })
    if (!rows.length) {
      throw new AppError({
        code: 'MCP_TOKEN_INVALID',
        message: 'MCP 访问令牌无效、已轮换或已过期。',
        status: 401,
      })
    }
    return rows.map((row) =>
      toAuthenticated(
        row,
        stringArray(row.credential_metadata?.scopes),
        'authenticated-client',
      ),
    )
  }

  /**
   * 创建 `trigger=mcp` 的生产运行，并记录开始与终态审计。
   *
   * @param exposure 已认证暴露。
   * @param args 已按发布版本 inputSchema 校验的输入。
   * @param clientId 外部客户端标识。
   * @param idempotencyKey 可选请求幂等键。
   * @returns 外部运行摘要。
   */
  async runExposure(
    exposure: AuthenticatedMcpExposure,
    args: Record<string, unknown>,
    clientId: string,
    idempotencyKey?: string,
  ) {
    if (!exposure.scopes.includes('workflow:run') && !exposure.scopes.includes('anonymous')) {
      throw new AppError({
        code: 'MCP_SCOPE_DENIED',
        message: '当前访问令牌没有 workflow:run 作用域。',
        status: 403,
      })
    }
    validateInputSchema(exposure.inputSchema, args)
    const [active] = await this.sql<Array<{ count: number }>>`
      select count(*)::int as count
      from runs
      where workspace_id = ${this.workspaceId}
        and status in ('queued', 'pending', 'running', 'waiting')
        and metadata->'mcp'->>'exposureId' = ${exposure.publicId}
    `
    if (active.count >= exposure.maxConcurrency) {
      throw new AppError({
        code: 'MCP_CONCURRENCY_LIMIT',
        message: `当前工具最多同时运行 ${exposure.maxConcurrency} 个任务，请稍后重试。`,
        status: 429,
      })
    }
    const auditId = await this.startInboundCall(exposure, exposure.toolName, clientId)
    const startedAt = performance.now()
    try {
      const workflow = new WorkflowRepository(this.sql, this.workspaceId)
      const result = await workflow.createProductionRun(exposure.workflowPublicId, {
        workflowVersionId: exposure.workflowVersionPublicId,
        trigger: 'mcp',
        input: args,
        timeoutMs: exposure.timeoutMs,
        idempotencyKey: `mcp:${exposure.publicId}:${idempotencyKey ?? publicId('call')}`,
        metadata: {
          mcp: {
            exposureId: exposure.publicId,
            toolName: exposure.toolName,
            clientId,
            workflowVersionId: exposure.workflowVersionPublicId,
          },
        },
      })
      await this.finishInboundCall(auditId, {
        status: 'succeeded',
        durationMs: Math.round(performance.now() - startedAt),
        runId: result.runId,
        metadata: {
          exposureId: exposure.publicId,
          schemaHash: exposure.versionSchemaHash,
        },
      })
      return result
    } catch (error) {
      await this.finishInboundCall(auditId, {
        status: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        errorCode: error instanceof AppError ? error.code : 'MCP_RUN_CREATE_FAILED',
        metadata: {
          exposureId: exposure.publicId,
          schemaHash: exposure.versionSchemaHash,
        },
      })
      throw error
    }
  }

  /**
   * 在令牌作用域内查询运行。
   *
   * @param runId 外部运行 ID。
   * @param exposures 当前令牌允许访问的暴露。
   * @param clientId 外部客户端标识。
   * @returns 运行记录。
   */
  async getRunScoped(
    runId: string,
    exposures: AuthenticatedMcpExposure[],
    clientId: string,
  ) {
    if (!exposures.some((item) => item.scopes.includes('run:read'))) {
      throw new AppError({
        code: 'MCP_SCOPE_DENIED',
        message: '当前访问令牌没有 run:read 作用域。',
        status: 403,
      })
    }
    const run = await scopedRun(this.sql, this.workspaceId, runId, exposures)
    const auditId = await this.startInboundCall(exposures[0], 'get_run', clientId)
    await this.finishInboundCall(auditId, {
      status: 'succeeded',
      durationMs: 1,
      runId,
      metadata: { exposureIds: exposures.map((item) => item.publicId) },
    })
    return toMcpRunResult(run)
  }

  /**
   * 在令牌作用域内取消运行。
   *
   * @param runId 外部运行 ID。
   * @param exposures 当前令牌允许访问的暴露。
   * @param clientId 外部客户端标识。
   * @returns 最新运行状态。
   */
  async cancelRunScoped(
    runId: string,
    exposures: AuthenticatedMcpExposure[],
    clientId: string,
  ) {
    if (!exposures.some((item) => item.scopes.includes('run:cancel'))) {
      throw new AppError({
        code: 'MCP_SCOPE_DENIED',
        message: '当前访问令牌没有 run:cancel 作用域。',
        status: 403,
      })
    }
    await scopedRun(this.sql, this.workspaceId, runId, exposures)
    const auditId = await this.startInboundCall(exposures[0], 'cancel_run', clientId)
    const startedAt = performance.now()
    try {
      const result = await new RunRepository(this.sql, this.workspaceId).cancel(runId)
      await this.finishInboundCall(auditId, {
        status: 'succeeded',
        durationMs: Math.round(performance.now() - startedAt),
        runId,
        metadata: { exposureIds: exposures.map((item) => item.publicId) },
      })
      const latest = await scopedRun(this.sql, this.workspaceId, result.runId, exposures)
      return toMcpRunResult(latest)
    } catch (error) {
      await this.finishInboundCall(auditId, {
        status: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        runId,
        errorCode: error instanceof AppError ? error.code : 'MCP_RUN_CANCEL_FAILED',
      })
      throw error
    }
  }

  /**
   * 写入入站调用开始审计。
   *
   * @param exposure 当前暴露。
   * @param toolName 实际调用的 MCP 工具。
   * @param clientId 外部客户端标识。
   * @returns 审计记录内部 ID。
   */
  async startInboundCall(
    exposure: AuthenticatedMcpExposure,
    toolName: string,
    clientId: string,
  ) {
    const [audit] = await this.sql<Array<{ id: string }>>`
      insert into mcp_call_audit (
        workspace_id, direction, client_id, tool_name, status, metadata
      )
      values (
        ${this.workspaceId}, ${'inbound'}, ${clientId}, ${toolName}, ${'started'},
        ${jsonb(this.sql, {
          exposureId: exposure.publicId,
          workflowVersionId: exposure.workflowVersionPublicId,
        })}
      )
      returning id
    `
    return audit.id
  }

  /**
   * 更新入站调用终态，并关联已创建运行。
   *
   * @param auditId 审计内部 ID。
   * @param input 状态、耗时、运行 ID、错误与脱敏 metadata。
   */
  async finishInboundCall(
    auditId: string,
    input: {
      status: 'succeeded' | 'failed' | 'cancelled'
      durationMs: number
      runId?: string
      errorCode?: string
      metadata?: Record<string, unknown>
    },
  ) {
    await this.sql`
      update mcp_call_audit
      set
        status = ${input.status},
        duration_ms = ${input.durationMs},
        error_code = ${input.errorCode ?? null},
        run_id = (
          select id from runs
          where workspace_id = ${this.workspaceId}
            ${input.runId ? this.sql`and public_id = ${input.runId}` : this.sql`and false`}
          limit 1
        ),
        metadata = ${jsonb(this.sql, input.metadata ?? {})}
      where id = ${auditId}
    `
  }

  /**
   * 查询暴露行并关联固定发布版本。
   *
   * @param query 工作流、认证模式、启用状态或令牌摘要。
   * @param sql 数据库连接或事务。
   * @returns 暴露行列表。
   */
  private async exposureRows(
    query: {
      workflowId?: string
      exposureId?: string
      enabled?: boolean
      authNone?: boolean
      tokenHash?: string
    } = {},
    sql: DatabaseClient | Transaction = this.sql,
  ) {
    return sql<ExposureRow[]>`
      select
        e.id, e.public_id, e.workflow_id,
        w.public_id as workflow_public_id, w.name as workflow_name,
        w.slug as workflow_slug, e.workflow_version_id,
        v.public_id as workflow_version_public_id, v.version as workflow_version,
        v.definition, v.schema_hash as version_schema_hash,
        e.tool_name, e.title, e.description, e.instructions,
        e.input_schema_projection, e.output_mode, e.visibility, e.auth_mode,
        e.access_credential_id, c.masked_hint as credential_masked,
        c.metadata as credential_metadata, e.rate_limit, e.timeout_ms,
        e.max_concurrency, e.enabled, e.created_at, e.updated_at
      from workflow_mcp_exposures e
      join workflows w on w.id = e.workflow_id
      join workflow_versions v on v.id = e.workflow_version_id
      left join credentials c on c.id = e.access_credential_id
      where e.workspace_id = ${this.workspaceId}
        ${query.workflowId ? sql`and w.public_id = ${query.workflowId}` : sql``}
        ${query.exposureId ? sql`and e.public_id = ${query.exposureId}` : sql``}
        ${query.enabled === undefined ? sql`` : sql`and e.enabled = ${query.enabled}`}
        ${query.authNone ? sql`and e.auth_mode = 'none'` : sql``}
        ${query.tokenHash ? sql`
          and e.auth_mode <> 'none'
          and c.metadata->>'tokenHash' = ${query.tokenHash}
          and c.metadata->>'revokedAt' is null
          and (
            c.metadata->>'expiresAt' is null
            or (c.metadata->>'expiresAt')::timestamptz > now()
          )
        ` : sql``}
      order by e.updated_at desc
    `
  }

  /**
   * 读取工作流并校验 workspace。
   *
   * @param workflowId 外部工作流 ID。
   * @param sql 数据库连接或事务。
   * @returns 工作流行。
   */
  private async requireWorkflow(
    workflowId: string,
    sql: DatabaseClient | Transaction = this.sql,
  ) {
    const [row] = await sql<WorkflowRow[]>`
      select id, public_id, name, slug
      from workflows
      where workspace_id = ${this.workspaceId}
        and public_id = ${workflowId}
        and archived_at is null
      limit 1
    `
    if (!row) throw notFound('工作流')
    return row
  }

  /**
   * 读取工作流固定发布版本并校验归属。
   *
   * @param workflowInternalId 工作流内部 ID。
   * @param versionPublicId 外部版本 ID。
   * @param sql 数据库连接或事务。
   * @returns 固定版本行。
   */
  private async requireVersion(
    workflowInternalId: string,
    versionPublicId: string,
    sql: DatabaseClient | Transaction = this.sql,
  ) {
    const [row] = await sql<WorkflowVersionRow[]>`
      select id, public_id, version, definition, schema_hash
      from workflow_versions
      where workspace_id = ${this.workspaceId}
        and workflow_id = ${workflowInternalId}
        and public_id = ${versionPublicId}
      limit 1
    `
    if (!row) throw notFound('工作流发布版本')
    return row
  }

  /**
   * 将暴露行映射为不含凭证明文的 DTO。
   *
   * @param row 暴露行。
   * @returns 入站暴露 DTO。
   */
  private toDto(row: ExposureRow) {
    const expiresAt = typeof row.credential_metadata?.expiresAt === 'string'
      ? row.credential_metadata.expiresAt
      : undefined
    return {
      id: row.public_id,
      workflowId: row.workflow_public_id,
      workflowName: row.workflow_name,
      workflowSlug: row.workflow_slug,
      workflowVersionId: row.workflow_version_public_id,
      workflowVersion: row.workflow_version,
      versionSchemaHash: row.version_schema_hash,
      toolName: row.tool_name,
      title: row.title,
      description: row.description,
      instructions: row.instructions ?? undefined,
      inputSchema: row.input_schema_projection,
      outputMode: row.output_mode,
      visibility: row.visibility,
      authMode: row.auth_mode,
      tokenStatus: row.auth_mode === 'none'
        ? 'not_required'
        : row.access_credential_id
          ? 'active'
          : 'missing',
      tokenMasked: row.credential_masked ?? undefined,
      scopes: stringArray(row.credential_metadata?.scopes),
      expiresAt,
      timeoutMs: row.timeout_ms,
      maxConcurrency: row.max_concurrency,
      rateLimit: row.rate_limit,
      enabled: row.enabled,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    }
  }

  /**
   * 原子写入新凭据并切换暴露指向的当前凭据。
   *
   * @param transaction 当前事务。
   * @param exposure 当前暴露行。
   * @param workflowPublicId 外部工作流 ID。
   * @param input 新令牌信息。
   * @returns 不含明文的轮换结果。
   */
  private async rotateExposureToken(
    transaction: Transaction,
    exposure: ExposureRow,
    workflowPublicId: string,
    input: McpExposureTokenInput,
  ) {
    const stored = await storeInboundMcpToken(
      transaction,
      this.workspaceId,
      {
        exposurePublicId: exposure.public_id,
        token: input.token,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      },
    )
    await transaction`
      update workflow_mcp_exposures
      set access_credential_id = ${stored.credentialId}, updated_at = now()
      where workspace_id = ${this.workspaceId} and id = ${exposure.id}
    `
    return {
      exposureId: exposure.public_id,
      workflowId: workflowPublicId,
      credentialRef: `secret://workspace/${stored.name}`,
      tokenStatus: 'active' as const,
      tokenMasked: stored.maskedHint,
      maskedHint: stored.maskedHint,
      tokenHash: stored.tokenHash,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? undefined,
      rotatedAt: iso(new Date())!,
      plaintextReturned: false as const,
    }
  }
}

/**
 * 将暴露行转换为认证上下文。
 *
 * @param row 暴露行。
 * @param scopes 当前令牌作用域。
 * @param clientId 客户端标识。
 * @returns 已认证暴露。
 */
function toAuthenticated(
  row: ExposureRow,
  scopes: string[],
  clientId: string,
): AuthenticatedMcpExposure {
  return {
    id: row.id,
    publicId: row.public_id,
    workflowPublicId: row.workflow_public_id,
    workflowSlug: row.workflow_slug,
    workflowVersionPublicId: row.workflow_version_public_id,
    workflowVersion: row.workflow_version,
    definition: row.definition,
    versionSchemaHash: row.version_schema_hash,
    toolName: row.tool_name,
    title: row.title,
    description: row.description,
    instructions: row.instructions ?? undefined,
    inputSchema: row.input_schema_projection,
    outputMode: row.output_mode,
    timeoutMs: row.timeout_ms,
    maxConcurrency: row.max_concurrency,
    clientId,
    scopes,
  }
}

/**
 * 从发布版本开始节点提取 MCP 工具输入 schema。
 *
 * @param definition 固定工作流定义。
 * @returns 与 start.inputSchema 一致的 JSON Schema。
 */
export function inputSchemaFor(definition: WorkflowDefinition) {
  const start = definition.nodes.find((node) => node.type === 'start')
  const schema = start?.config.inputSchema
  return schema && typeof schema === 'object' && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : { type: 'object', properties: {}, additionalProperties: false }
}

/**
 * 校验 MCP 工具参数的基础 JSON Schema 约束。
 *
 * @param schema 发布时锁定的 inputSchema。
 * @param args 外部客户端参数。
 */
export function validateInputSchema(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
) {
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []
  const missing = required.filter((key) => !(key in args))
  if (missing.length) {
    throw new AppError({
      code: 'MCP_INPUT_INVALID',
      message: `缺少必填参数：${missing.join(', ')}。`,
      status: 422,
      details: { missing },
    })
  }
  const properties = asRecord(schema.properties)
  for (const [key, rawDefinition] of Object.entries(properties)) {
    if (!(key in args)) continue
    const definition = asRecord(rawDefinition)
    const expected = definition.type
    if (typeof expected === 'string' && !matchesType(expected, args[key])) {
      throw new AppError({
        code: 'MCP_INPUT_INVALID',
        message: `参数 ${key} 应为 ${expected}。`,
        status: 422,
      })
    }
    if (Array.isArray(definition.enum) && !definition.enum.includes(args[key])) {
      throw new AppError({
        code: 'MCP_INPUT_INVALID',
        message: `参数 ${key} 不在允许的枚举范围内。`,
        status: 422,
      })
    }
  }
}

/**
 * 校验运行是否属于当前令牌授权的暴露。
 *
 * @param sql 数据库连接。
 * @param workspaceId 当前 workspace。
 * @param runId 外部运行 ID。
 * @param exposures 当前令牌授权暴露。
 * @returns 运行记录。
 */
async function scopedRun(
  sql: DatabaseClient,
  workspaceId: string,
  runId: string,
  exposures: AuthenticatedMcpExposure[],
) {
  const run = await new RunRepository(sql, workspaceId).get(runId)
  const mcp = asRecord(run.metadata.mcp)
  const exposureId = String(mcp.exposureId ?? '')
  if (
    run.trigger !== 'mcp' ||
    !exposures.some((exposure) => exposure.publicId === exposureId)
  ) {
    throw new AppError({
      code: 'MCP_RUN_OUT_OF_SCOPE',
      message: '运行不存在或不在当前 MCP 访问令牌作用域内。',
      status: 404,
    })
  }
  return run as RunRecord
}

/**
 * 将运行 DTO 投影为 MCP 对外结果。
 *
 * MCP 客户端使用 `runId`，不返回内部定义快照和节点明细。
 *
 * @param run 运行记录。
 * @returns 包含 runId、状态、发布版本和可选输出的最小结果。
 */
function toMcpRunResult(run: RunRecord) {
  return {
    runId: run.id,
    workflowId: run.workflowId,
    workflowVersionId: run.versionId,
    runKind: run.runKind,
    trigger: run.trigger,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    output: run.output,
    error: run.error,
  }
}

/**
 * 将已轮换的凭据标记为失效，保留历史元数据。
 *
 * @param transaction 当前事务。
 * @param credentialId 旧凭据内部 ID。
 */
async function revokeCredential(
  transaction: Transaction,
  workspaceId: string,
  credentialId: string,
) {
  await transaction`
    update credentials
    set
      metadata = metadata || jsonb_build_object('revokedAt', now()::text),
      updated_at = now()
    where workspace_id = ${workspaceId}
      and id = ${credentialId}
  `
}

/**
 * 从 Authorization 请求头提取 Bearer token。
 *
 * @param authorization 原始请求头。
 * @returns Bearer token。
 */
function bearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1]
}

/**
 * 将任意 JSON 值读取为对象。
 *
 * @param value 任意值。
 * @returns 对象或空对象。
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * 将任意 JSON 值读取为字符串数组。
 *
 * @param value 任意值。
 * @returns 字符串数组。
 */
function stringArray(value: unknown) {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.map(String)
}

/**
 * 判断 JSON Schema 基础类型是否匹配。
 *
 * @param type JSON Schema type。
 * @param value 参数值。
 * @returns 是否匹配。
 */
function matchesType(type: string, value: unknown) {
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value))
  if (type === 'null') return value === null
  return true
}
