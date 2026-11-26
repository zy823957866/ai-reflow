import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { resolveSecretReference } from './credential-store'
import { iso } from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'
import {
  consumeOperationPlan,
  createOperationPlan,
  type OperationPlanKind,
} from './operation-plan-repository'

type PluginKind =
  | 'tool'
  | 'toolkit'
  | 'model'
  | 'datasource'
  | 'trigger'
  | 'node-pack'

type PluginInstallStatus =
  | 'installing'
  | 'config_required'
  | 'enabled'
  | 'disabled'
  | 'degraded'
  | 'update_available'
  | 'failed'
  | 'rolling_back'

type PluginPlanAction = 'install' | 'upgrade' | 'rollback'

interface RegistryEntryRow {
  id: string
  name: string
  publisher: string
  summary: string
  visibility: string
  verified: boolean
  metadata: Record<string, unknown>
  updated_at: Date
}

interface RegistryVersionRow {
  id: string
  entry_id: string
  version: string
  manifest: Record<string, unknown>
  tarball_key: string
  checksum: string
  signature: string | null
  license: string
  compatibility: Record<string, unknown>
  deprecated: boolean
  created_at: Date
}

interface PluginInstallRow {
  id: string
  public_id: string
  entry_id: string
  version: string
  previous_version: string | null
  status: PluginInstallStatus
  enabled: boolean
  manifest_snapshot: Record<string, unknown>
  affected_workflows: unknown[]
  installed_at: Date
  updated_at: Date
  entry_name: string
}

interface PluginCredentialRow {
  id: string
  key: string
  auth_type: string
  credential_id: string | null
  expires_at: Date | null
  verified_at: Date | null
  masked_hint: string | null
}

interface PluginAuditRow {
  id: string
  install_id: string | null
  install_public_id: string | null
  entry_id: string | null
  action: string
  actor: string
  metadata: Record<string, unknown>
  created_at: Date
}

interface PermissionDto {
  group: 'network' | 'files' | 'secrets' | 'mcp' | 'code' | 'resources'
  label: string
  values: string[]
  highRisk: boolean
}

interface CredentialDto {
  key: string
  authType: 'api-key' | 'oauth' | 'bearer'
  state: 'missing' | 'configured' | 'expiring'
  masked?: string
  expiresAt?: string
  verifiedAt?: string
  required: boolean
}

interface DependencyDto {
  id: string
  name: string
  version: string
  state: 'available' | 'missing' | 'conflict'
  chain?: string
}

interface VerificationDto {
  checksum: 'ok' | 'missing' | 'mismatch'
  signature: 'verified' | 'missing' | 'invalid'
  license: string
  licenseBlocked: boolean
}

interface InstallPlanPayload extends Record<string, unknown> {
  action: PluginPlanAction
  entryId: string
  installId?: string
  fromVersion: string | null
  toVersion: string
  affectedWorkflowIds: string[]
  dependencies: DependencyDto[]
  permissions: PermissionDto[]
  credentials: CredentialDto[]
  verification: VerificationDto
  deprecated: boolean
  blockers: string[]
  warnings: string[]
  highRisk: boolean
  idempotencyKey: string
  manifest: Record<string, unknown>
  canInstall: boolean
}

interface PluginInstallPatch {
  enabled?: boolean
  credentials?: Array<{
    key: string
    secretRef: string
    authType?: 'api-key' | 'oauth' | 'bearer'
  }>
}

const LICENSE_BLOCKLIST = new Set(['AGPL-3.0', 'GPL-3.0', 'SSPL-1.0'])
const PLAN_COOLDOWN_MS = 5 * 60 * 1000

/**
 * 插件 registry、一次性安装计划、生命周期与审计仓库。
 */
export class PluginRepository {
  /**
   * 创建当前 workspace 的插件仓库。
   *
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询插件 registry 条目及版本清单。
   *
   * @param query 关键词、插件类型和分页条件。
   * @returns registry 条目 DTO 列表。
   */
  async listEntries(query: {
    search?: string
    kind?: string
    limit?: number
  } = {}) {
    const entries = await this.entryRows()
    const versions = await this.versionRows()
    const keyword = query.search?.trim().toLowerCase()
    const installs = await this.installRows()
    const installed = new Map(installs.map((row) => [row.entry_id, row]))
    return entries
      .filter((entry) => {
        const pluginKind = pluginMetadata(entry).kind
        if (query.kind && query.kind !== 'all' && pluginKind !== query.kind) return false
        if (!keyword) return true
        return [
          entry.name,
          entry.publisher,
          entry.summary,
          String(pluginMetadata(entry).description ?? ''),
          ...stringArray(pluginMetadata(entry).capabilities),
        ].some((value) => value.toLowerCase().includes(keyword))
      })
      .slice(0, Math.min(100, Math.max(1, query.limit ?? 100)))
      .map((entry) => this.toEntryDto(
        entry,
        versions.filter((version) => version.entry_id === entry.id),
        installed.get(entry.id),
      ))
  }

  /**
   * 查询单个插件 registry 条目。
   *
   * @param entryId registry entry_id。
   * @returns 插件详情 DTO。
   */
  async getEntry(entryId: string) {
    const entry = await this.requireEntry(entryId)
    const versions = await this.versionRows(entryId)
    const installs = await this.installRows(entryId)
    return this.toEntryDto(entry, versions, installs[0])
  }

  /**
   * 查询插件指定版本的不可变 manifest。
   *
   * @param entryId registry entry_id。
   * @param version 版本字符串。
   * @returns 版本详情 DTO。
   */
  async getVersion(entryId: string, version: string) {
    await this.requireEntry(entryId)
    const row = await this.requireVersion(entryId, version)
    return this.toVersionDto(row)
  }

  /**
   * 计算安装、升级或回滚计划并持久化 planId。
   *
   * @param input 插件 ID、动作和目标版本。
   * @returns 依赖、权限、凭据、影响工作流与确认信息。
   */
  async createInstallPlan(input: {
    entryId: string
    action: PluginPlanAction
    version: string
  }) {
    const entry = await this.requireEntry(input.entryId)
    const version = await this.requireVersion(input.entryId, input.version)
    const installs = await this.installRows()
    const current = installs.find((row) => row.entry_id === input.entryId)
    const payload = await this.buildInstallPlan(entry, version, current, input.action)
    const plan = await createOperationPlan(
      this.sql,
      this.workspaceId,
      planKind(input.action),
      payload,
      PLAN_COOLDOWN_MS,
    )
    return {
      ...payload,
      planId: plan.planId,
      expiresAt: plan.expiresAt,
      canInstall: payload.blockers.length === 0,
    }
  }

  /**
   * 查询当前 workspace 的活跃插件安装。
   *
   * @returns 安装记录 DTO 列表。
   */
  async listInstalls() {
    const rows = await this.installRows()
    return Promise.all(rows.map((row) => this.toInstallDto(row)))
  }

  /**
   * 查询插件安装详情、凭据和权限快照。
   *
   * @param installId 外部安装 ID。
   * @returns 安装详情 DTO。
   */
  async getInstall(installId: string) {
    return this.toInstallDto(await this.requireInstall(installId))
  }

  /**
   * 按已确认的一次性计划安装插件。
   *
   * @param input planId、幂等键与高风险确认。
   * @returns 安装记录 DTO。
   */
  async install(input: {
    planId: string
    idempotencyKey?: string
    highRiskConfirmed: boolean
  }) {
    return this.sql.begin(async (transaction) => {
      const idempotencyKey = input.idempotencyKey ?? `plan:${input.planId}`
      const previous = await this.readIdempotency(transaction, 'plugin-install', idempotencyKey)
      if (previous) return previous
      const payload = await consumeOperationPlan(
        transaction,
        this.workspaceId,
        'plugin_install',
        input.planId,
      ) as InstallPlanPayload
      this.assertPlan(payload, 'install', input.highRiskConfirmed)
      const [created] = await transaction<Array<{ id: string; public_id: string }>>`
        insert into plugin_installs (
          public_id, workspace_id, entry_id, version, previous_version, status,
          enabled, manifest_snapshot, affected_workflows
        )
        values (
          ${publicId('pi')}, ${this.workspaceId}, ${payload.entryId},
          ${payload.toVersion}, ${null}, ${statusForCredentials(payload.credentials)},
          ${payload.credentials.every((credential) => credential.state !== 'missing')},
          ${jsonb(transaction, payload.manifest)},
          ${jsonb(transaction, payload.affectedWorkflowIds)}
        )
        returning id, public_id
      `
      await this.persistInstallSnapshots(transaction, created.id, payload)
      await this.appendAudit(transaction, {
        installId: created.id,
        entryId: payload.entryId,
        action: 'install',
        metadata: auditMetadata(payload, input.planId),
      })
      await this.writeIdempotency(
        transaction,
        'plugin-install',
        idempotencyKey,
        { installId: created.public_id },
      )
      return created.public_id
    }).then((installId) => this.getInstall(installId))
  }

  /**
   * 更新插件启停状态或配置 secret:// 凭据。
   *
   * @param installId 外部安装 ID。
   * @param input 启停状态与凭据引用。
   * @returns 更新后的安装 DTO。
   */
  async updateInstall(installId: string, input: PluginInstallPatch) {
    return this.sql.begin(async (transaction) => {
      const install = await this.requireInstall(installId, transaction)
      const before = await this.credentialRows(transaction, install.id)
      if (input.credentials?.length) {
        for (const credential of input.credentials) {
          const expected = before.find((item) => item.key === credential.key)
          if (!expected) {
            throw new AppError({
              code: 'PLUGIN_CREDENTIAL_UNKNOWN',
              message: `manifest 未声明凭据 ${credential.key}。`,
              status: 422,
            })
          }
          const credentialId = await resolveSecretReference(
            transaction,
            this.workspaceId,
            credential.secretRef,
            {
              kind: credentialKind(credential.authType ?? expected.auth_type),
              source: install.entry_name,
            },
          )
          await transaction`
            update plugin_credentials
            set
              credential_id = ${credentialId},
              auth_type = ${credential.authType ?? authTypeForKind(expected.auth_type)},
              verified_at = now(),
              updated_at = now()
            where workspace_id = ${this.workspaceId}
              and install_id = ${install.id}
              and key = ${credential.key}
          `
        }
      }
      const credentials = await this.credentialRows(transaction, install.id)
      const missing = credentials.some((credential) => !credential.credential_id)
      const requestedEnabled = input.enabled ?? install.enabled
      if (requestedEnabled && missing) {
        throw new AppError({
          code: 'PLUGIN_CREDENTIAL_REQUIRED',
          message: '必需凭据尚未配置，不能启用插件。',
          status: 409,
          details: { missing: credentials.filter((item) => !item.credential_id).map((item) => item.key) },
        })
      }
      const status: PluginInstallStatus = requestedEnabled
        ? 'enabled'
        : missing
          ? 'config_required'
          : 'disabled'
      const enabled = requestedEnabled && !missing
      await transaction`
        update plugin_installs
        set
          enabled = ${enabled},
          status = ${status},
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and public_id = ${installId}
      `
      const action = input.credentials?.length
        ? 'configure'
        : enabled
          ? 'enable'
          : 'disable'
      await this.appendAudit(transaction, {
        installId: install.id,
        entryId: install.entry_id,
        action,
        metadata: input.credentials?.length
          ? {
              keys: input.credentials.map((item) => item.key),
              secretRefOnly: true,
            }
          : { enabled },
      })
      return installId
    }).then((id) => this.getInstall(id))
  }

  /**
   * 按一次性升级计划切换插件版本。
   *
   * @param installId 外部安装 ID。
   * @param input planId 与幂等键。
   * @returns 更新后的安装 DTO。
   */
  async upgrade(
    installId: string,
    input: {
      planId: string
      idempotencyKey?: string
      highRiskConfirmed?: boolean
    },
  ) {
    return this.changeVersion(installId, input, 'upgrade')
  }

  /**
   * 按一次性回滚计划恢复到 previousVersion。
   *
   * @param installId 外部安装 ID。
   * @param input planId 与幂等键。
   * @returns 更新后的安装 DTO。
   */
  async rollback(
    installId: string,
    input: {
      planId: string
      idempotencyKey?: string
      highRiskConfirmed?: boolean
    },
  ) {
    return this.changeVersion(installId, input, 'rollback')
  }

  /**
   * 软卸载插件并保留凭据、权限与审计历史。
   *
   * @param installId 外部安装 ID。
   * @returns 卸载确认。
   */
  async uninstall(installId: string) {
    return this.sql.begin(async (transaction) => {
      const install = await this.requireInstall(installId, transaction)
      await transaction`
        update plugin_installs
        set
          uninstalled_at = now(),
          enabled = false,
          status = 'disabled',
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and id = ${install.id}
      `
      await this.appendAudit(transaction, {
        installId: install.id,
        entryId: install.entry_id,
        action: 'uninstall',
        metadata: {
          historyPreserved: true,
          affectedWorkflows: install.affected_workflows,
          credentialsPreserved: true,
          permissionsPreserved: true,
        },
      })
      return { deleted: true as const }
    })
  }

  /**
   * 查询插件安装生命周期审计。
   *
   * @param installId 外部安装 ID。
   * @returns 审计事件列表。
   */
  async audits(installId: string) {
    const rows = await this.sql<PluginAuditRow[]>`
      select
        a.id, a.install_id, pi.public_id as install_public_id,
        a.entry_id, a.action, a.actor, a.metadata, a.created_at
      from plugin_audit_events a
      left join plugin_installs pi on pi.id = a.install_id
      where a.workspace_id = ${this.workspaceId}
        and pi.public_id = ${installId}
      order by a.created_at desc
    `
    if (!rows.length) throw notFound('插件安装')
    return rows.map(toAuditDto)
  }

  /**
   * 返回本地 seed registry 的同步状态。
   *
   * @returns 目录类型、条目数和最近更新时间。
   */
  async syncStatus() {
    const [row] = await this.sql<Array<{
      entries: number
      versions: number
      updated_at: Date | null
    }>>`
      select
        (select count(*) from registry_entries where kind = 'plugin')::int as entries,
        (
          select count(*)
          from registry_versions v
          join registry_entries e on e.id = v.entry_id
          where e.kind = 'plugin'
        )::int as versions,
        (
          select max(e.updated_at)
          from registry_entries e
          where e.kind = 'plugin'
        ) as updated_at
    `
    return {
      source: 'local-seed',
      state: 'ready',
      entries: row?.entries ?? 0,
      versions: row?.versions ?? 0,
      syncedAt: iso(row?.updated_at),
    }
  }

  /**
   * 执行插件版本切换并写入幂等结果。
   *
   * @param installId 外部安装 ID。
   * @param input 计划与幂等键。
   * @param action upgrade 或 rollback。
   * @returns 安装 DTO。
   */
  private async changeVersion(
    installId: string,
    input: {
      planId: string
      idempotencyKey?: string
      highRiskConfirmed?: boolean
    },
    action: 'upgrade' | 'rollback',
  ) {
    const result = await this.sql.begin(async (transaction) => {
      const install = await this.requireInstall(installId, transaction)
      const idempotencyKey = input.idempotencyKey ?? `plan:${input.planId}`
      const previous = await this.readIdempotency(
        transaction,
        `plugin-${action}`,
        idempotencyKey,
      )
      if (previous) return previous
      const payload = await consumeOperationPlan(
        transaction,
        this.workspaceId,
        planKind(action),
        input.planId,
      ) as InstallPlanPayload
      this.assertPlan(payload, action, input.highRiskConfirmed === true)
      if (payload.installId !== install.public_id) {
        throw new AppError({
          code: 'PLAN_STALE',
          message: '插件计划与当前安装记录不一致，请重新计算。',
          status: 409,
        })
      }
      if (action === 'upgrade' && compareVersions(payload.toVersion, install.version) <= 0) {
        throw new AppError({
          code: 'PLUGIN_VERSION_NOT_NEWER',
          message: '升级目标版本必须高于当前版本。',
          status: 422,
        })
      }
      if (action === 'rollback' && payload.toVersion !== install.previous_version) {
        throw new AppError({
          code: 'PLUGIN_ROLLBACK_VERSION_MISMATCH',
          message: '回滚目标必须与 previousVersion 一致。',
          status: 409,
        })
      }
      const credentials = await this.credentialRows(transaction, install.id)
      const requiredKeys = stringArray(manifestPermissions(payload.manifest).secrets)
      const missing = requiredKeys.filter(
        (key) => !credentials.some((credential) => credential.key === key && credential.credential_id),
      )
      const status: PluginInstallStatus = missing.length ? 'config_required' : 'enabled'
      await transaction`
        update plugin_installs
        set
          previous_version = ${install.version},
          version = ${payload.toVersion},
          status = ${status},
          enabled = ${missing.length === 0},
          manifest_snapshot = ${jsonb(transaction, payload.manifest)},
          affected_workflows = ${jsonb(transaction, payload.affectedWorkflowIds)},
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and id = ${install.id}
      `
      await this.replacePermissions(transaction, install.id, payload.permissions)
      await this.appendAudit(transaction, {
        installId: install.id,
        entryId: payload.entryId,
        action,
        metadata: auditMetadata(payload, input.planId),
      })
      await this.writeIdempotency(
        transaction,
        `plugin-${action}`,
        idempotencyKey,
        { installId },
      )
      return installId
    })
    return this.getInstall(result)
  }

  /**
   * 构建安装计划所需的版本、依赖、权限和影响快照。
   *
   * @param entry registry 条目行。
   * @param version registry 版本行。
   * @param current 当前活跃安装。
   * @param action 计划动作。
   * @returns 可持久化计划 payload。
   */
  private async buildInstallPlan(
    entry: RegistryEntryRow,
    version: RegistryVersionRow,
    current: PluginInstallRow | undefined,
    action: PluginPlanAction,
  ): Promise<InstallPlanPayload> {
    if (action === 'install' && current) {
      throw new AppError({
        code: 'PLUGIN_ALREADY_INSTALLED',
        message: '插件已安装，请使用升级或回滚计划。',
        status: 409,
      })
    }
    if (action !== 'install' && !current) {
      throw new AppError({
        code: 'PLUGIN_NOT_INSTALLED',
        message: '插件尚未安装。',
        status: 404,
      })
    }
    if (action === 'rollback' && current?.previous_version !== version.version) {
      throw new AppError({
        code: 'PLUGIN_ROLLBACK_UNAVAILABLE',
        message: '目标版本不是当前安装的 previousVersion，不能回滚。',
        status: 409,
      })
    }
    const dependencies = await this.inspectDependencies(version.manifest)
    const permissions = normalizePermissions(manifestPermissions(version.manifest))
    const credentials = await this.inspectCredentials(
      version.manifest,
      current?.id,
    )
    const affectedWorkflowIds = await this.affectedWorkflows(entry.id)
    const blockers: string[] = []
    const verification = verificationFor(version)
    if (verification.checksum !== 'ok') blockers.push('插件 checksum 缺失或格式无效。')
    if (verification.signature !== 'verified') blockers.push('插件包签名缺失或无效。')
    if (verification.licenseBlocked) blockers.push(`许可证 ${verification.license} 默认阻断安装。`)
    if (version.deprecated && action !== 'rollback') blockers.push('目标版本已弃用，禁止新安装或升级。')
    if (!compatibleWithCurrentApp(version.compatibility)) {
      blockers.push('插件与当前应用或引擎版本不兼容。')
    }
    dependencies
      .filter((dependency) => dependency.state === 'conflict')
      .forEach((dependency) => blockers.push(`依赖冲突：${dependency.chain ?? dependency.name}`))
    const highRisk = permissions.some((permission) => permission.highRisk)
    const warnings = [
      ...(credentials.some((credential) => credential.state === 'missing')
        ? ['安装后将进入需配置状态，补齐凭据前不能启用。']
        : []),
      ...(affectedWorkflowIds.length
        ? [`${affectedWorkflowIds.length} 个工作流引用了该插件节点。`]
        : []),
    ]
    return {
      action,
      entryId: entry.id,
      installId: current?.public_id,
      fromVersion: current?.version ?? null,
      toVersion: version.version,
      affectedWorkflowIds,
      dependencies,
      permissions,
      credentials,
      verification,
      deprecated: version.deprecated,
      blockers,
      warnings,
      highRisk,
      idempotencyKey: publicId('idem'),
      manifest: version.manifest,
      canInstall: blockers.length === 0,
    }
  }

  /**
   * 检查 manifest 声明的插件依赖及 semver 冲突。
   *
   * @param manifest 插件 manifest。
   * @returns 依赖状态。
   */
  private async inspectDependencies(manifest: Record<string, unknown>) {
    const declarations = normalizeDependencies(manifest.dependencies)
    if (!declarations.length) return [] as DependencyDto[]
    const installs = await this.installRows()
    return declarations.map((dependency): DependencyDto => {
      const installed = installs.find((row) => row.entry_id === dependency.id)
      if (!installed) {
        return {
          id: dependency.id,
          name: dependency.name,
          version: dependency.version,
          state: 'missing',
          chain: `${dependency.name} ${dependency.version} 尚未安装`,
        }
      }
      if (!semverSatisfies(installed.version, dependency.version)) {
        return {
          id: dependency.id,
          name: dependency.name,
          version: dependency.version,
          state: 'conflict',
          chain: `${dependency.name} 已安装 ${installed.version}，要求 ${dependency.version}`,
        }
      }
      return {
        id: dependency.id,
        name: dependency.name,
        version: dependency.version,
        state: 'available',
      }
    })
  }

  /**
   * 根据 manifest secret keys 和现有安装凭据生成配置状态。
   *
   * @param manifest 插件 manifest。
   * @param installInternalId 当前安装内部 ID。
   * @returns 凭据状态。
   */
  private async inspectCredentials(
    manifest: Record<string, unknown>,
    installInternalId?: string,
  ) {
    const keys = stringArray(manifestPermissions(manifest).secrets)
    const existing = installInternalId
      ? await this.credentialRows(this.sql, installInternalId)
      : []
    return keys.map((key): CredentialDto => {
      const credential = existing.find((item) => item.key === key)
      const state = credential?.credential_id
        ? expiring(credential.expires_at)
          ? 'expiring'
          : 'configured'
        : 'missing'
      return {
        key,
        authType: authTypeForKind(credential?.auth_type ?? 'api_key'),
        state,
        masked: credential?.masked_hint ?? undefined,
        expiresAt: iso(credential?.expires_at),
        verifiedAt: iso(credential?.verified_at),
        required: true,
      }
    })
  }

  /**
   * 查询引用指定插件的草稿和发布版本所属工作流。
   *
   * @param entryId registry entry_id。
   * @returns 去重后的工作流外部 ID。
   */
  private async affectedWorkflows(entryId: string) {
    const rows = await this.sql<Array<{ public_id: string }>>`
      select distinct w.public_id
      from workflows w
      where w.workspace_id = ${this.workspaceId}
        and w.archived_at is null
        and (
          exists (
            select 1
            from jsonb_array_elements(w.draft_definition->'nodes') node
            where node->>'type' like ${`plugin:${entryId}:%`}
          )
          or exists (
            select 1
            from workflow_versions v
            cross join lateral jsonb_array_elements(v.definition->'nodes') node
            where v.workflow_id = w.id
              and node->>'type' like ${`plugin:${entryId}:%`}
          )
        )
      order by w.public_id
    `
    return rows.map((row) => row.public_id)
  }

  /**
   * 读取插件 registry 条目并按 workspace 无关的全局目录统一 404。
   *
   * @param entryId registry entry_id。
   * @returns registry 条目行。
   */
  private async requireEntry(entryId: string) {
    const [row] = await this.sql<RegistryEntryRow[]>`
      select id, name, publisher, summary, visibility, verified, metadata, updated_at
      from registry_entries
      where id = ${entryId} and kind = 'plugin'
      limit 1
    `
    if (!row) throw notFound('插件')
    return row
  }

  /**
   * 读取插件指定版本并统一 404。
   *
   * @param entryId registry entry_id。
   * @param version 版本字符串。
   * @returns registry 版本行。
   */
  private async requireVersion(entryId: string, version: string) {
    const [row] = await this.sql<RegistryVersionRow[]>`
      select
        id, entry_id, version, manifest, tarball_key, checksum, signature,
        license, compatibility, deprecated, created_at
      from registry_versions
      where entry_id = ${entryId} and version = ${version}
      limit 1
    `
    if (!row) throw notFound('插件版本')
    return row
  }

  /**
   * 查询当前 workspace 活跃安装并关联 registry 展示名。
   *
   * @param entryId 可选 registry entry_id。
   * @returns 安装行。
   */
  private async installRows(entryId?: string) {
    return this.sql<PluginInstallRow[]>`
      select
        pi.id, pi.public_id, pi.entry_id, pi.version, pi.previous_version,
        pi.status, pi.enabled, pi.manifest_snapshot, pi.affected_workflows,
        pi.installed_at, pi.updated_at, e.name as entry_name
      from plugin_installs pi
      join registry_entries e on e.id = pi.entry_id
      where pi.workspace_id = ${this.workspaceId}
        and pi.uninstalled_at is null
        ${entryId ? this.sql`and pi.entry_id = ${entryId}` : this.sql``}
      order by pi.updated_at desc
    `
  }

  /**
   * 查询指定活跃安装并统一 404。
   *
   * @param installId 外部安装 ID。
   * @param sql 数据库连接或事务。
   * @returns 安装行。
   */
  private async requireInstall(
    installId: string,
    sql: DatabaseClient | Transaction = this.sql,
  ) {
    const [row] = await sql<PluginInstallRow[]>`
      select
        pi.id, pi.public_id, pi.entry_id, pi.version, pi.previous_version,
        pi.status, pi.enabled, pi.manifest_snapshot, pi.affected_workflows,
        pi.installed_at, pi.updated_at, e.name as entry_name
      from plugin_installs pi
      join registry_entries e on e.id = pi.entry_id
      where pi.workspace_id = ${this.workspaceId}
        and pi.public_id = ${installId}
        and pi.uninstalled_at is null
      limit 1
    `
    if (!row) throw notFound('插件安装')
    return row
  }

  /**
   * 查询全部插件 registry 条目。
   *
   * @returns registry 条目行。
   */
  private async entryRows() {
    return this.sql<RegistryEntryRow[]>`
      select id, name, publisher, summary, visibility, verified, metadata, updated_at
      from registry_entries
      where kind = 'plugin'
      order by name
    `
  }

  /**
   * 查询全部或单个插件的 registry 版本。
   *
   * @param entryId 可选 registry entry_id。
   * @returns registry 版本行。
   */
  private async versionRows(entryId?: string) {
    return this.sql<RegistryVersionRow[]>`
      select
        id, entry_id, version, manifest, tarball_key, checksum, signature,
        license, compatibility, deprecated, created_at
      from registry_versions
      ${entryId ? this.sql`where entry_id = ${entryId}` : this.sql``}
      order by created_at desc
    `
  }

  /**
   * 查询插件安装凭据及掩码。
   *
   * @param sql 数据库连接或事务。
   * @param installInternalId 安装内部 ID。
   * @returns 凭据行。
   */
  private async credentialRows(
    sql: DatabaseClient | Transaction,
    installInternalId: string,
  ) {
    return sql<PluginCredentialRow[]>`
      select
        pc.id, pc.key, pc.auth_type, pc.credential_id, pc.expires_at,
        pc.verified_at, c.masked_hint
      from plugin_credentials pc
      left join credentials c on c.id = pc.credential_id
      where pc.workspace_id = ${this.workspaceId}
        and pc.install_id = ${installInternalId}
      order by pc.key
    `
  }

  /**
   * 写入安装时的凭据占位和权限快照。
   *
   * @param transaction 当前事务。
   * @param installInternalId 安装内部 ID。
   * @param payload 已确认计划。
   */
  private async persistInstallSnapshots(
    transaction: Transaction,
    installInternalId: string,
    payload: InstallPlanPayload,
  ) {
    for (const credential of payload.credentials) {
      await transaction`
        insert into plugin_credentials (
          workspace_id, install_id, key, auth_type
        )
        values (
          ${this.workspaceId}, ${installInternalId}, ${credential.key},
          ${credential.authType === 'oauth' ? 'oauth2' : credential.authType.replace('-', '_')}
        )
        on conflict (install_id, key) do update
        set updated_at = now()
      `
    }
    await this.replacePermissions(transaction, installInternalId, payload.permissions)
  }

  /**
   * 用新的权限快照替换安装授权记录。
   *
   * @param transaction 当前事务。
   * @param installInternalId 安装内部 ID。
   * @param permissions 权限快照。
   */
  private async replacePermissions(
    transaction: Transaction,
    installInternalId: string,
    permissions: PermissionDto[],
  ) {
    await transaction`
      delete from plugin_permissions
      where workspace_id = ${this.workspaceId}
        and install_id = ${installInternalId}
    `
    for (const permission of permissions) {
      await transaction`
        insert into plugin_permissions (
          workspace_id, install_id, permission, value
        )
        values (
          ${this.workspaceId}, ${installInternalId},
          ${databasePermission(permission.group)},
          ${jsonb(transaction, {
            group: permission.group,
            values: permission.values,
            highRisk: permission.highRisk,
          })}
        )
        on conflict (install_id, permission) do update
        set value = excluded.value, granted_at = now()
      `
    }
  }

  /**
   * 写入不含明文密钥的插件审计事件。
   *
   * @param transaction 当前事务。
   * @param input 安装、动作与脱敏 metadata。
   */
  private async appendAudit(
    transaction: Transaction,
    input: {
      installId: string
      entryId: string
      action: string
      metadata: Record<string, unknown>
    },
  ) {
    await transaction`
      insert into plugin_audit_events (
        workspace_id, install_id, entry_id, action, actor, metadata
      )
      values (
        ${this.workspaceId}, ${input.installId}, ${input.entryId},
        ${input.action}, ${'workspace-user'}, ${jsonb(transaction, input.metadata)}
      )
    `
  }

  /**
   * 读取幂等结果，避免重复点击产生第二条安装记录。
   *
   * @param transaction 当前事务。
   * @param operation 操作类型。
   * @param idempotencyKey 客户端幂等键。
   * @returns 安装外部 ID；未命中时返回 undefined。
   */
  private async readIdempotency(
    transaction: Transaction,
    operation: string,
    idempotencyKey: string,
  ) {
    const [row] = await transaction<Array<{ result: { installId?: string } }>>`
      select result
      from operation_idempotency
      where workspace_id = ${this.workspaceId}
        and operation = ${operation}
        and idempotency_key = ${idempotencyKey}
      limit 1
    `
    return row?.result.installId
  }

  /**
   * 保存操作幂等结果。
   *
   * @param transaction 当前事务。
   * @param operation 操作类型。
   * @param idempotencyKey 客户端幂等键。
   * @param result 可重放结果。
   */
  private async writeIdempotency(
    transaction: Transaction,
    operation: string,
    idempotencyKey: string,
    result: Record<string, unknown>,
  ) {
    await transaction`
      insert into operation_idempotency (
        workspace_id, operation, idempotency_key, result
      )
      values (
        ${this.workspaceId}, ${operation}, ${idempotencyKey},
        ${jsonb(transaction, result)}
      )
      on conflict (workspace_id, operation, idempotency_key) do nothing
    `
  }

  /**
   * 校验计划动作、阻断项和高风险权限确认。
   *
   * @param payload 已持久化计划。
   * @param action 当前执行动作。
   * @param highRiskConfirmed 是否确认高风险权限。
   */
  private assertPlan(
    payload: InstallPlanPayload,
    action: PluginPlanAction,
    highRiskConfirmed: boolean,
  ) {
    if (payload.action !== action) {
      throw new AppError({
        code: 'PLAN_ACTION_MISMATCH',
        message: '计划动作与当前操作不一致，请重新计算。',
        status: 409,
      })
    }
    if (payload.blockers.length) {
      throw new AppError({
        code: 'PLUGIN_PLAN_BLOCKED',
        message: '插件计划存在阻断项。',
        status: 422,
        details: { blockers: payload.blockers },
      })
    }
    if (payload.highRisk && !highRiskConfirmed) {
      throw new AppError({
        code: 'PLUGIN_HIGH_RISK_CONFIRMATION_REQUIRED',
        message: '插件声明高风险权限，需要显式确认后才能继续。',
        status: 409,
        details: { permissions: payload.permissions.filter((item) => item.highRisk) },
      })
    }
  }

  /**
   * 将 registry 行、版本和安装状态映射为目录 DTO。
   *
   * @param entry registry 条目。
   * @param versions registry 版本。
   * @param install 当前安装。
   * @returns 插件目录 DTO。
   */
  private toEntryDto(
    entry: RegistryEntryRow,
    versions: RegistryVersionRow[],
    install?: PluginInstallRow,
  ) {
    const metadata = pluginMetadata(entry)
    const latest = versions[0]
    return {
      id: entry.id,
      name: entry.name,
      publisher: entry.publisher,
      kind: metadata.kind,
      summary: entry.summary,
      description: String(metadata.description ?? entry.summary),
      latestVersion: latest?.version ?? '0.0.0',
      icon: String(metadata.icon ?? 'plug'),
      accent: String(metadata.accent ?? 'sky'),
      verified: entry.verified,
      installs: Number(metadata.installs ?? 0),
      updatedAt: iso(entry.updated_at)!,
      capabilities: stringArray(metadata.capabilities),
      permissions: normalizePermissions(latest ? manifestPermissions(latest.manifest) : {}),
      credentials: latest
        ? stringArray(manifestPermissions(latest.manifest).secrets).map((key) => ({
            key,
            authType: 'api-key' as const,
            state: 'missing' as const,
            required: true,
          }))
        : [],
      tools: latest ? normalizeTools(latest.manifest.tools) : [],
      versions: versions.map((version) => this.toVersionDto(version)),
      install: install ? {
        installId: install.public_id,
        version: install.version,
        enabled: install.enabled,
        status: install.status,
      } : undefined,
    }
  }

  /**
   * 将 registry 版本映射为通用版本 DTO。
   *
   * @param row registry 版本行。
   * @returns 版本、校验和 manifest 信息。
   */
  private toVersionDto(row: RegistryVersionRow) {
    return {
      version: row.version,
      releasedAt: iso(row.created_at)!,
      compatibility: String(row.compatibility.app ?? '>=0.1.0'),
      engine: String(row.compatibility.engine ?? 'reflow-engine >=0.9'),
      schemaVersion: String(row.compatibility.schemaVersion ?? '1.0'),
      size: String(row.manifest.size ?? '未知'),
      deprecated: row.deprecated,
      changelog: String(row.manifest.changelog ?? ''),
      dependencies: normalizeDependencies(row.manifest.dependencies),
      verification: verificationFor(row),
      manifest: row.manifest,
      checksum: row.checksum,
      signature: row.signature ?? undefined,
      license: row.license,
    }
  }

  /**
   * 将安装行映射为包含凭据、权限与影响工作流的 DTO。
   *
   * @param row 安装行。
   * @returns 安装详情 DTO。
   */
  private async toInstallDto(row: PluginInstallRow) {
    const credentials = await this.credentialRows(this.sql, row.id)
    const permissions = await this.sql<Array<{
      permission: string
      value: Record<string, unknown>
    }>>`
      select permission, value
      from plugin_permissions
      where workspace_id = ${this.workspaceId}
        and install_id = ${row.id}
      order by permission
    `
    return {
      installId: row.public_id,
      entryId: row.entry_id,
      name: row.entry_name,
      version: row.version,
      previousVersion: row.previous_version ?? undefined,
      enabled: row.enabled,
      status: row.status,
      affectedWorkflows: row.affected_workflows,
      credentials: credentials.map((credential): CredentialDto => ({
        key: credential.key,
        authType: authTypeForKind(credential.auth_type),
        state: credential.credential_id
          ? expiring(credential.expires_at)
            ? 'expiring'
            : 'configured'
          : 'missing',
        masked: credential.masked_hint ?? undefined,
        expiresAt: iso(credential.expires_at),
        verifiedAt: iso(credential.verified_at),
        required: true,
      })),
      permissions: Object.fromEntries(
        permissions.map((permission) => [
          String(permission.value.group ?? permission.permission),
          permission.value.values ?? [],
        ]),
      ),
      installedAt: iso(row.installed_at)!,
      updatedAt: iso(row.updated_at)!,
    }
  }
}

/**
 * 读取 registry metadata 并补齐默认插件类型。
 *
 * @param entry registry 条目行。
 * @returns metadata 对象。
 */
function pluginMetadata(
  entry: RegistryEntryRow,
): Record<string, unknown> & { kind: PluginKind } {
  return {
    kind: String(entry.metadata.pluginKind ?? entry.metadata.kind ?? 'tool') as PluginKind,
    ...entry.metadata,
  } as Record<string, unknown> & { kind: PluginKind }
}

/**
 * 读取 manifest 权限对象。
 *
 * @param manifest 插件 manifest。
 * @returns 权限对象。
 */
function manifestPermissions(manifest: Record<string, unknown>) {
  const permissions = manifest.permissions
  return permissions && typeof permissions === 'object' && !Array.isArray(permissions)
    ? permissions as Record<string, unknown>
    : {}
}

/**
 * 把 manifest 权限对象归一化为页面可展示的分组。
 *
 * @param permissions manifest permissions。
 * @returns 权限分组。
 */
function normalizePermissions(permissions: Record<string, unknown>): PermissionDto[] {
  const groups: Array<PermissionDto['group']> = [
    'network',
    'files',
    'secrets',
    'mcp',
    'code',
    'resources',
  ]
  return groups.map((group) => {
    const raw = permissions[group]
    const values = raw === 'none' || raw === false || raw === undefined
      ? []
      : raw === true
        ? ['enabled']
        : stringArray(raw)
    return {
      group,
      label: PERMISSION_LABELS[group],
      values,
      highRisk:
        group === 'code' ||
        (group === 'network' && values.some((value) => value === '*' || value.includes('0.0.0.0'))) ||
        (group === 'secrets' && values.includes('*')),
    }
  }).filter((permission) => permission.values.length)
}

const PERMISSION_LABELS: Record<PermissionDto['group'], string> = {
  network: '网络',
  files: '文件',
  secrets: '密钥',
  mcp: 'MCP',
  code: '代码',
  resources: '资源限额',
}

/**
 * 校验 registry checksum、签名和许可证。
 *
 * @param version registry 版本。
 * @returns 供应链验证结果。
 */
function verificationFor(version: RegistryVersionRow): VerificationDto {
  return {
    checksum: version.checksum
      ? /^sha256:[0-9a-f]{64}$/i.test(version.checksum)
        ? 'ok'
        : 'mismatch'
      : 'missing',
    signature: version.signature
      ? version.signature === 'invalid'
        ? 'invalid'
        : 'verified'
      : 'missing',
    license: version.license,
    licenseBlocked: LICENSE_BLOCKLIST.has(version.license),
  }
}

/**
 * 解析 manifest 中的依赖数组。
 *
 * @param value dependencies JSON。
 * @returns 统一依赖。
 */
function normalizeDependencies(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{
    id: string
    name: string
    version: string
  }>
  return value.map((item) => {
    if (typeof item === 'string') {
      return { id: item, name: item, version: '*' }
    }
    const record = asRecord(item)
    const id = String(record.id ?? record.entryId ?? '')
    return {
      id,
      name: String(record.name ?? id),
      version: String(record.version ?? '*'),
    }
  }).filter((item) => item.id)
}

/**
 * 解析 manifest 工具清单。
 *
 * @param value tools JSON。
 * @returns 工具名称与说明。
 */
function normalizeTools(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{
    name: string
    description: string
    nodeType?: string
  }>
  return value.map((item) => {
    const record = asRecord(item)
    return {
      name: String(record.name ?? ''),
      description: String(record.description ?? ''),
      nodeType: record.nodeType ? String(record.nodeType) : undefined,
    }
  }).filter((item) => item.name)
}

/**
 * 把权限组映射为数据库允许的枚举。
 *
 * @param group 页面权限组。
 * @returns 数据库权限枚举。
 */
function databasePermission(group: PermissionDto['group']) {
  return group === 'resources' ? 'code' as const : group
}

/**
 * 将安装计划动作映射为 operation_plans 类型。
 *
 * @param action 计划动作。
 * @returns 操作计划类型。
 */
function planKind(action: PluginPlanAction): OperationPlanKind {
  if (action === 'upgrade') return 'plugin_upgrade'
  if (action === 'rollback') return 'plugin_rollback'
  return 'plugin_install'
}

/**
 * 根据凭据完整性推导初始安装状态。
 *
 * @param credentials 计划凭据。
 * @returns 安装状态。
 */
function statusForCredentials(credentials: CredentialDto[]): PluginInstallStatus {
  return credentials.some((credential) => credential.state === 'missing')
    ? 'config_required'
    : 'enabled'
}

/**
 * 生成不含密钥与完整权限值的审计 metadata。
 *
 * @param payload 安装计划。
 * @param planId 计划 ID。
 * @returns 脱敏审计 metadata。
 */
function auditMetadata(payload: InstallPlanPayload, planId: string) {
  return {
    planId,
    fromVersion: payload.fromVersion,
    toVersion: payload.toVersion,
    permissions: payload.permissions.map((permission) => permission.group),
    affectedWorkflows: payload.affectedWorkflowIds,
  }
}

/**
 * 将审计行映射为页面 DTO。
 *
 * @param row 审计行。
 * @returns 审计 DTO。
 */
function toAuditDto(row: PluginAuditRow) {
  return {
    id: row.id,
    installId: row.install_public_id ?? undefined,
    entryId: row.entry_id ?? '',
    action: row.action,
    actor: row.actor,
    at: iso(row.created_at)!,
    metadata: row.metadata,
  }
}

/**
 * 把任意 JSON 值安全读取为字符串数组。
 *
 * @param value 任意值。
 * @returns 字符串数组。
 */
function stringArray(value: unknown) {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return [] as string[]
  return value.map(String)
}

/**
 * 读取 JSON 对象。
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
 * 把凭据类型映射为页面认证方式。
 *
 * @param kind 数据库凭据类型。
 * @returns 页面认证方式。
 */
function authTypeForKind(kind: string): 'api-key' | 'oauth' | 'bearer' {
  if (kind === 'oauth' || kind === 'oauth2') return 'oauth'
  if (kind === 'bearer') return 'bearer'
  return 'api-key'
}

/**
 * 把页面认证方式映射为 credentials.kind。
 *
 * @param authType 页面认证方式。
 * @returns 数据库凭据类型。
 */
function credentialKind(authType: string) {
  if (authType === 'oauth') return 'oauth2' as const
  if (authType === 'bearer') return 'bearer' as const
  return 'api_key' as const
}

/**
 * 判断凭据是否即将过期。
 *
 * @param expiresAt 过期时间。
 * @returns 是否在七天内到期或已过期。
 */
function expiring(expiresAt: Date | null) {
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000)
}

/**
 * 校验当前应用版本是否满足 registry compatibility。
 *
 * @param compatibility registry 版本兼容性。
 * @returns 是否兼容。
 */
function compatibleWithCurrentApp(compatibility: Record<string, unknown>) {
  const appRange = compatibility.app
  return typeof appRange !== 'string' || semverSatisfies('0.1.0', appRange)
}

/**
 * 判断版本是否满足精确、caret、tilde 和比较范围。
 *
 * @param installed 已安装版本。
 * @param required 要求范围。
 * @returns 是否满足。
 */
function semverSatisfies(installed: string, required: string) {
  if (!required || required === '*') return true
  const parsed = parseVersion(installed)
  if (!parsed) return installed === required
  return required.split('||').map((item) => item.trim()).some((candidate) => {
    if (candidate.startsWith('^')) {
      const target = parseVersion(candidate.slice(1))
      return Boolean(target && parsed.major === target.major && compareVersions(installed, candidate.slice(1)) >= 0)
    }
    if (candidate.startsWith('~')) {
      const target = parseVersion(candidate.slice(1))
      return Boolean(
        target &&
        parsed.major === target.major &&
        parsed.minor === target.minor &&
        compareVersions(installed, candidate.slice(1)) >= 0
      )
    }
    const operator = candidate.match(/^(>=|<=|>|<|=)\s*/)?.[1]
    if (!operator) return installed === candidate
    const comparison = compareVersions(
      installed,
      candidate.replace(/^(>=|<=|>|<|=)\s*/, ''),
    )
    return matchesOperator(comparison, operator)
  })
}

/**
 * 比较两个 semver 主次修订号。
 *
 * @param left 左版本。
 * @param right 右版本。
 * @returns 正数、零或负数。
 */
function compareVersions(left: string, right: string) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return left.localeCompare(right, undefined, { numeric: true })
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/**
 * 解析基础 semver。
 *
 * @param value 版本字符串。
 * @returns 主次修订号，非法时返回 null。
 */
function parseVersion(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/)
  return match
    ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
    : null
}

/**
 * 判断版本比较结果是否满足运算符。
 *
 * @param comparison 比较值。
 * @param operator 运算符。
 * @returns 是否满足。
 */
function matchesOperator(comparison: number, operator: string) {
  if (operator === '>=') return comparison >= 0
  if (operator === '<=') return comparison <= 0
  if (operator === '>') return comparison > 0
  if (operator === '<') return comparison < 0
  return comparison === 0
}
