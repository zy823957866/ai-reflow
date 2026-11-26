import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { resolveSecretReference } from './credential-store'
import { iso } from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'

interface ModelRow {
  id: string
  public_id: string
  name: string
  provider: string
  base_url: string | null
  default_model: string
  capabilities: string[]
  credential_id: string | null
  credential_hint: string | null
  credential_name: string | null
  fallback_order: string[]
  context_window: number
  status: 'healthy' | 'degraded' | 'failed'
  latency_ms: number | null
  is_default: boolean
  enabled: boolean
  updated_at: Date
}

export interface ModelConnectionInput {
  name: string
  provider: string
  baseUrl?: string | null
  defaultModel: string
  contextWindow?: number
  capabilities?: string[]
  fallbackOrder?: string[]
  secretRef?: string
  isDefault?: boolean
  enabled?: boolean
}

/**
 * 模型连接、凭据引用和真实供应商测试的数据访问层。
 */
export class ModelRepository {
  /**
   * 创建当前 workspace 的模型连接仓库。
   *
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询模型连接及其脱敏凭据提示。
   *
   * @returns 模型连接 DTO 列表。
   */
  async list() {
    const rows = await this.rows()
    return rows.map((row) => this.toDto(row))
  }

  /**
   * 查询单个模型连接。
   *
   * @param connectionId 外部模型连接 ID。
   * @returns 模型连接 DTO。
   */
  async get(connectionId: string) {
    return this.toDto(await this.require(connectionId))
  }

  /**
   * 创建模型连接并保存加密的 secret_ref。
   *
   * @param input 连接配置。
   * @returns 新建连接 DTO。
   */
  async create(input: ModelConnectionInput) {
    const created = await this.sql.begin(async (transaction) => {
      const credentialId = input.secretRef
        ? await this.resolveCredential(transaction, input.secretRef, input.provider)
        : null
      if (input.isDefault) {
        await transaction`
          update model_connections
          set is_default = false, updated_at = now()
          where workspace_id = ${this.workspaceId} and is_default = true
        `
      }
      const [created] = await transaction<{ public_id: string }[]>`
        insert into model_connections (
          public_id, workspace_id, name, provider, base_url, default_model,
          capabilities, credential_id, fallback_order, context_window,
          is_default, enabled
        )
        values (
          ${publicId('mc')}, ${this.workspaceId}, ${input.name}, ${input.provider},
          ${input.baseUrl ?? null}, ${input.defaultModel},
          ${jsonb(transaction, input.capabilities ?? [])}, ${credentialId},
          ${jsonb(transaction, input.fallbackOrder ?? [])},
          ${input.contextWindow ?? 0}, ${Boolean(input.isDefault)}, ${input.enabled ?? true}
        )
        returning public_id
      `
      return created.public_id
    })
    return this.get(created)
  }

  /**
   * 更新模型连接。未提供 secretRef 时保留现有加密凭据。
   *
   * @param connectionId 外部模型连接 ID。
   * @param input 部分更新字段。
   * @returns 更新后的连接 DTO。
   */
  async update(connectionId: string, input: Partial<ModelConnectionInput>) {
    await this.sql.begin(async (transaction) => {
      const existing = await this.require(connectionId)
      const credentialId = input.secretRef
        ? await this.resolveCredential(
            transaction,
            input.secretRef,
            input.provider ?? existing.provider,
          )
        : existing.credential_id
      if (input.isDefault === true) {
        await transaction`
          update model_connections
          set is_default = false, updated_at = now()
          where workspace_id = ${this.workspaceId}
            and id <> ${existing.id}
            and is_default = true
        `
      }
      await transaction`
        update model_connections
        set
          name = ${input.name ?? existing.name},
          provider = ${input.provider ?? existing.provider},
          base_url = ${input.baseUrl === undefined ? existing.base_url : input.baseUrl},
          default_model = ${input.defaultModel ?? existing.default_model},
          capabilities = ${jsonb(transaction, input.capabilities ?? existing.capabilities)},
          credential_id = ${credentialId},
          fallback_order = ${jsonb(transaction, input.fallbackOrder ?? existing.fallback_order)},
          context_window = ${input.contextWindow ?? existing.context_window},
          is_default = ${input.isDefault ?? existing.is_default},
          enabled = ${input.enabled ?? existing.enabled},
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and public_id = ${connectionId}
      `
    })
    return this.get(connectionId)
  }

  /**
   * 删除未被工作流引用的模型连接。
   *
   * @param connectionId 外部模型连接 ID。
   * @returns 删除确认。
   */
  async remove(connectionId: string) {
    const model = await this.require(connectionId)
    const [usage] = await this.sql<Array<{ versions: number; drafts: number }>>`
      select
        (
          select count(*)
          from workflow_versions v
          where v.workspace_id = ${this.workspaceId}
            and exists (
              select 1
              from jsonb_array_elements(v.definition->'nodes') node
              where node->'config'->>'modelConnectionId' = ${model.public_id}
            )
        )::int as versions,
        (
          select count(*)
          from workflows w
          where w.workspace_id = ${this.workspaceId}
            and exists (
              select 1
              from jsonb_array_elements(w.draft_definition->'nodes') node
              where node->'config'->>'modelConnectionId' = ${model.public_id}
            )
        )::int as drafts
    `
    if ((usage?.versions ?? 0) + (usage?.drafts ?? 0) > 0) {
      throw new AppError({
        code: 'MODEL_IN_USE',
        message: '模型连接仍被工作流或发布版本引用，不能删除。',
        status: 409,
        details: usage,
      })
    }
    await this.sql`
      delete from model_connections
      where workspace_id = ${this.workspaceId}
        and public_id = ${connectionId}
    `
    return { deleted: true as const }
  }

  /**
   * 使用真实供应商 endpoint 测试连接并持久化健康状态。
   *
   * @param connectionId 外部模型连接 ID。
   * @returns 延迟、模型列表与归一化错误。
   */
  async test(connectionId: string) {
    const model = await this.require(connectionId)
    if (model.provider !== 'openai' && model.provider !== 'custom') {
      throw new AppError({
        code: 'MODEL_PROVIDER_NOT_IMPLEMENTED',
        message: `供应商 ${model.provider} 的测试适配器尚未接入。`,
        status: 501,
      })
    }
    const apiKey =
      process.env.AI_REFLOW_MODEL_API_KEY ??
      process.env.OPENAI_API_KEY
    if (!apiKey) {
      await this.markStatus(model.id, 'failed')
      throw new AppError({
        code: 'MODEL_CREDENTIAL_UNRESOLVED',
        message: '服务端缺少可解析的模型密钥，无法执行真实连接测试。',
        status: 503,
        retryable: true,
      })
    }
    const baseUrl = (model.base_url ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    const startedAt = performance.now()
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      })
      const latencyMs = Math.round(performance.now() - startedAt)
      if (!response.ok) {
        await this.markStatus(model.id, response.status === 429 ? 'degraded' : 'failed', latencyMs)
        throw new AppError({
          code: `MODEL_HTTP_${response.status}`,
          message: `模型供应商返回 HTTP ${response.status}。`,
          status: response.status === 401 || response.status === 403 ? 422 : 502,
          retryable: response.status === 429 || response.status >= 500,
        })
      }
      const body = await response.json() as { data?: Array<{ id?: unknown }> }
      const models = Array.isArray(body.data)
        ? body.data
            .map((item) => String(item.id ?? ''))
            .filter(Boolean)
        : []
      await this.markStatus(model.id, 'healthy', latencyMs)
      return {
        ok: true,
        latencyMs,
        models,
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      await this.markStatus(model.id, 'failed')
      throw new AppError({
        code: 'MODEL_CONNECT_ERROR',
        message:
          error instanceof Error ? error.message : '无法连接模型供应商。',
        status: 502,
        retryable: true,
      })
    }
  }

  /**
   * 查询连接配置中的默认模型和能力。
   *
   * @param connectionId 外部模型连接 ID。
   * @returns 模型标识和能力列表。
   */
  async models(connectionId: string) {
    const model = await this.require(connectionId)
    return [
      {
        id: model.default_model,
        capabilities: model.capabilities,
      },
    ]
  }

  /**
   * 查询模型行并连接凭据掩码。
   *
   * @param connectionId 可选外部连接 ID。
   * @returns 模型数据库行。
   */
  private async rows(connectionId?: string) {
    return this.sql<ModelRow[]>`
      select
        m.*, c.masked_hint as credential_hint, c.name as credential_name
      from model_connections m
      left join credentials c on c.id = m.credential_id
      where m.workspace_id = ${this.workspaceId}
        ${connectionId ? this.sql`and m.public_id = ${connectionId}` : this.sql``}
      order by m.is_default desc, m.created_at
    `
  }

  /**
   * 读取模型连接，跨 workspace 统一返回 404。
   *
   * @param connectionId 外部连接 ID。
   * @returns 模型数据库行。
   */
  private async require(connectionId: string) {
    const [row] = await this.rows(connectionId)
    if (!row) throw notFound('模型连接')
    return row
  }

  /**
   * 将模型数据库行投影为前端 DTO。
   *
   * @param row 模型数据库行。
   * @returns 不含明文密钥的模型连接。
   */
  private toDto(row: ModelRow) {
    return {
      id: row.public_id,
      provider: row.provider,
      name: row.name,
      model: row.default_model,
      baseUrl: row.base_url ?? 'provider default',
      status: row.enabled ? row.status : 'failed',
      isDefault: row.is_default,
      enabled: row.enabled,
      usage: 0,
      latencyMs: row.latency_ms ?? 0,
      contextWindow: row.context_window,
      capabilities: row.capabilities,
      fallbackOrder: row.fallback_order,
      credentialMask: row.credential_hint ?? '未配置',
      credentialStatus: row.credential_hint ? 'valid' : 'missing',
      secretRef: row.credential_name
        ? `secret://workspace/${row.credential_name}`
        : undefined,
      updatedAt: iso(row.updated_at)!,
    }
  }

  /**
   * 查找或创建加密 secret_ref，不保存明文密钥。
   *
   * @param transaction 当前数据库事务。
   * @param secretRef 凭据引用。
   * @param provider 供应商名称，用于掩码提示。
   * @returns 凭据内部 ID。
   */
  private async resolveCredential(
    transaction: Transaction,
    secretRef: string,
    provider: string,
  ) {
    return resolveSecretReference(
      transaction,
      this.workspaceId,
      secretRef,
      { kind: 'api_key', source: provider },
    )
  }

  /**
   * 更新连接健康状态和延迟。
   *
   * @param internalId 模型内部 UUID。
   * @param status 健康状态。
   * @param latencyMs 可选测试延迟。
   */
  private async markStatus(
    internalId: string,
    status: 'healthy' | 'degraded' | 'failed',
    latencyMs?: number,
  ) {
    await this.sql`
      update model_connections
      set status = ${status}, latency_ms = ${latencyMs ?? null}, updated_at = now()
      where workspace_id = ${this.workspaceId} and id = ${internalId}
    `
  }
}

