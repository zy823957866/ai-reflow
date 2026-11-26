import {
  AppError,
  validateWorkflowDefinition,
  WORKFLOW_NODE_TYPES,
  type WorkflowDefinition,
} from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { iso, toWorkflowDraft, type WorkflowRow } from './dto'
import {
  jsonb,
  notFound,
  publicId,
  slugify,
  type Transaction,
} from './helpers'
import {
  consumeOperationPlan,
  createOperationPlan,
} from './operation-plan-repository'

interface TemplateRow {
  id: string
  name: string
  author: string
  summary: string
  category: string
  tags: string[]
  license: string
  preview: Record<string, unknown>
  visibility: string
  usage_count: number
  created_at: Date
  updated_at: Date
}

interface TemplateVersionRow {
  id: string
  template_id: string
  version: string
  manifest: Record<string, unknown>
  workflow_definition: WorkflowDefinition
  preview_graph: Record<string, unknown>
  bundle_key: string
  schema_version: string
  required_plugins: unknown[]
  required_models: unknown[]
  required_secrets: unknown[]
  required_knowledge: unknown[]
  created_at: Date
}

interface TemplateDependency {
  type: 'plugin' | 'model' | 'secret' | 'knowledge' | 'node'
  id: string
  label: string
  required: string
  state: 'available' | 'missing' | 'incompatible' | 'unconfigured'
  detail: string
}

/**
 * 模板目录、版本、依赖检查与新草稿克隆仓库。
 */
export class TemplateRepository {
  /**
   * 创建当前 workspace 的模板仓库。
   *
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询模板目录，包含全部版本和依赖清单。
   *
   * @param query 搜索、分类和排序条件。
   * @returns 模板 DTO 列表。
   */
  async list(query: { search?: string; category?: string; sort?: string } = {}) {
    const templates = await this.sql<TemplateRow[]>`
      select
        id, name, author, summary, category, tags, license, preview,
        visibility, usage_count, created_at, updated_at
      from template_catalog
      order by created_at
    `
    const versions = await this.versionsFor()
    const keyword = query.search?.trim().toLowerCase()
    const versionMap = groupVersions(versions)
    const result = templates
      .filter((template) => query.category
        ? template.category === query.category
        : true)
      .filter((template) => {
        if (!keyword) return true
        return [
          template.name,
          template.summary,
          template.author,
          template.category,
          ...template.tags,
        ].some((value) => value.toLowerCase().includes(keyword))
      })
      .map((template) => this.toDto(
        template,
        versionMap.get(template.id) ?? [],
      ))
    if (query.sort === 'name') {
      result.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    } else if (query.sort === 'updated') {
      result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    } else {
      result.sort((left, right) => right.installs - left.installs)
    }
    return result
  }

  /**
   * 查询单个模板详情。
   *
   * @param templateId 模板 ID。
   * @returns 模板 DTO。
   */
  async get(templateId: string) {
    const template = await this.requireTemplate(templateId)
    return this.toDto(template, groupVersions(await this.versionsFor(templateId)).get(templateId) ?? [])
  }

  /**
   * 查询模板指定版本。
   *
   * @param templateId 模板 ID。
   * @param version 模板版本。
   * @returns 版本 DTO。
   */
  async version(templateId: string, version: string) {
    await this.requireTemplate(templateId)
    const row = await this.requireVersion(templateId, version)
    return this.toVersionDto(row)
  }

  /**
   * 计算克隆计划并持久化一次性 planId。
   *
   * @param templateId 模板 ID。
   * @param input 目标名称和可选版本。
   * @returns 依赖、阻断项与计划有效期。
   */
  async clonePlan(
    templateId: string,
    input: { targetName: string; version?: string },
  ) {
    const template = await this.requireTemplate(templateId)
    const version = input.version
      ? await this.requireVersion(templateId, input.version)
      : (await this.latestVersion(templateId))
    const targetName = await this.availableTargetName(input.targetName)
    const dependencies = await this.inspectDependencies(version)
    const missingDependencies = dependencies.filter(
      (dependency) => dependency.state !== 'available',
    )
    const blockingReasons: string[] = []
    if (version.schema_version !== '1.0') {
      blockingReasons.push(`模板 schemaVersion ${version.schema_version} 与当前设计器不兼容。`)
    }
    dependencies
      .filter((dependency) => dependency.type === 'node' && dependency.state !== 'available')
      .forEach((dependency) => blockingReasons.push(dependency.detail))
    const warnings = missingDependencies.length
      ? ['克隆后需配置缺失依赖，不会自动安装插件或写入真实密钥。']
      : []
    if (targetName !== input.targetName.trim()) {
      warnings.push(`目标名称已自动调整为「${targetName}」，避免覆盖现有工作流。`)
    }
    const plan = await createOperationPlan(
      this.sql,
      this.workspaceId,
      'template_clone',
      {
        templateId,
        version: version.version,
        templateName: template.name,
        summary: template.summary,
        category: template.category,
        tags: template.tags,
        targetName,
        missingDependencies,
        blockingReasons,
        warnings,
      },
    )
    return {
      planId: plan.planId,
      templateId,
      version: version.version,
      targetName,
      dependencies,
      missingDependencies,
      blockingReasons,
      warnings,
      willAutoInstall: false as const,
      willWriteSecrets: false as const,
      canClone: blockingReasons.length === 0,
      expiresAt: plan.expiresAt,
    }
  }

  /**
   * 消费克隆计划并生成全新草稿。
   *
   * nodeId 与 edgeId 全部重映射；不覆盖现有工作流，不写真实密钥。
   *
   * @param templateId 模板 ID。
   * @param input planId、目标名称和版本。
   * @returns 导入记录与工作流草稿。
   */
  async clone(
    templateId: string,
    input: { planId: string; targetName: string; version: string },
  ) {
    return this.sql.begin(async (transaction) => {
      const payload = await consumeOperationPlan(
        transaction,
        this.workspaceId,
        'template_clone',
        input.planId,
      )
      if (
        payload.templateId !== templateId ||
        payload.version !== input.version
      ) {
        throw new AppError({
          code: 'PLAN_STALE',
          message: '克隆计划与模板版本不一致，请重新计算。',
          status: 409,
        })
      }
      const blockingReasons = Array.isArray(payload.blockingReasons)
        ? payload.blockingReasons.map(String)
        : []
      if (blockingReasons.length) {
        throw new AppError({
          code: 'TEMPLATE_DEPENDENCIES_BLOCKED',
          message: '模板存在阻断依赖，不能克隆。',
          status: 422,
          details: { blockingReasons },
        })
      }
      const version = await this.requireVersion(templateId, input.version)
      const template = await this.requireTemplate(templateId)
      const targetName = String(payload.targetName ?? input.targetName)
      const definition = remapDefinition(version.workflow_definition, targetName)
      const validation = validateWorkflowDefinition(definition)
      if (!validation.valid) {
        throw new AppError({
          code: 'TEMPLATE_WORKFLOW_INVALID',
          message: '模板工作流定义未通过校验，不能克隆。',
          status: 422,
          issues: validation.errors,
        })
      }
      const slug = `${slugify(targetName)}-${publicId('x').slice(-6)}`
      const [workflow] = await transaction<WorkflowRow[]>`
        insert into workflows (
          public_id, workspace_id, name, slug, description, tags,
          owner, draft_definition, revision
        )
        values (
          ${publicId('wf')}, ${this.workspaceId}, ${targetName}, ${slug},
          ${template.summary}, ${jsonb(transaction, template.tags.slice(0, 5))},
          ${jsonb(transaction, { id: 'demo', name: 'Demo', initials: 'D' })},
          ${jsonb(transaction, definition)}, ${1}
        )
        returning
          id, public_id, workspace_id, name, slug, description, status, tags,
          owner, draft_definition, revision, published_version_id,
          published_version, created_at, updated_at
      `
      const [importRow] = await transaction<Array<{ id: string }>>`
        insert into template_imports (
          workspace_id, template_id, template_version_id, workflow_id,
          target_name, missing_dependencies, warnings
        )
        values (
          ${this.workspaceId}, ${templateId}, ${version.id}, ${workflow.id},
          ${targetName},
          ${jsonb(transaction, payload.missingDependencies ?? [])},
          ${jsonb(transaction, payload.warnings ?? [])}
        )
        returning id
      `
      await transaction`
        update template_catalog
        set usage_count = usage_count + 1, updated_at = now()
        where id = ${templateId}
      `
      return {
        importId: importRow.id,
        workflow: {
          ...toWorkflowDraft(workflow),
          forkOf: { templateId, version: version.version },
        },
        missingDependencies: payload.missingDependencies ?? [],
        warnings: payload.warnings ?? [],
        canPreview: blockingReasons.length === 0,
      }
    })
  }

  /**
   * 查询模板导入结果。
   *
   * @param importId 导入记录 ID。
   * @returns 导入记录、工作流与缺失依赖。
   */
  async importResult(importId: string) {
    const [row] = await this.sql<Array<{
      id: string
      template_id: string
      version: string
      workflow_public_id: string
      target_name: string
      missing_dependencies: unknown[]
      warnings: string[]
      created_at: Date
    }>>`
      select
        i.id, i.template_id, v.version, w.public_id as workflow_public_id,
        i.target_name, i.missing_dependencies, i.warnings, i.created_at
      from template_imports i
      join template_versions v on v.id = i.template_version_id
      join workflows w on w.id = i.workflow_id
      where i.workspace_id = ${this.workspaceId} and i.id = ${importId}
      limit 1
    `
    if (!row) throw notFound('模板导入记录')
    return {
      importId: row.id,
      templateId: row.template_id,
      version: row.version,
      workflowId: row.workflow_public_id,
      targetName: row.target_name,
      missingDependencies: row.missing_dependencies,
      warnings: row.warnings,
      createdAt: iso(row.created_at)!,
    }
  }

  /**
   * 检查插件、模型、密钥、知识库和节点类型依赖。
   *
   * @param version 模板版本行。
   * @returns 全部依赖状态。
   */
  private async inspectDependencies(version: TemplateVersionRow) {
    const dependencies: TemplateDependency[] = []
    const plugins = await this.sql<Array<{ entry_id: string; version: string; enabled: boolean }>>`
      select pi.entry_id, pi.version, pi.enabled
      from plugin_installs pi
      where pi.workspace_id = ${this.workspaceId}
        and pi.uninstalled_at is null
    `
    const models = await this.sql<Array<{ public_id: string; enabled: boolean }>>`
      select public_id, enabled
      from model_connections
      where workspace_id = ${this.workspaceId}
    `
    const knowledge = await this.sql<Array<{ public_id: string; status: string }>>`
      select public_id, status
      from knowledge_bases
      where workspace_id = ${this.workspaceId}
    `
    const credentials = await this.sql<Array<{ name: string }>>`
      select name
      from credentials
      where workspace_id = ${this.workspaceId}
    `
    for (const item of version.required_plugins) {
      const dependency = normalizeDependency(item)
      const installed = plugins.find((plugin) => plugin.entry_id === dependency.id)
      const available = Boolean(installed?.enabled && semverSatisfies(installed.version, dependency.version))
      dependencies.push({
        type: 'plugin',
        id: dependency.id,
        label: dependency.label,
        required: dependency.version,
        state: available
          ? 'available'
          : installed
            ? 'incompatible'
            : 'missing',
        detail: available
          ? `插件 v${installed?.version} 已启用。`
          : installed
            ? `已安装 v${installed.version}，但未启用或版本不满足 ${dependency.version}。`
            : `需安装插件 ${dependency.label} ${dependency.version}，不会自动安装。`,
      })
    }
    for (const item of version.required_models) {
      const dependency = normalizeDependency(item)
      const model = models.find((candidate) => candidate.public_id === dependency.id)
      dependencies.push({
        type: 'model',
        id: dependency.id,
        label: dependency.label,
        required: dependency.version || dependency.id,
        state: model?.enabled ? 'available' : model ? 'incompatible' : 'missing',
        detail: model?.enabled
          ? '模型连接已启用。'
          : model
            ? '模型连接已停用。'
            : '需配置模型连接后才能预览运行。',
      })
    }
    for (const item of version.required_secrets) {
      const dependency = normalizeSecret(item)
      const configured = credentials.some((credential) => credential.name === dependency.key)
      dependencies.push({
        type: 'secret',
        id: dependency.key,
        label: dependency.label,
        required: dependency.description,
        state: configured ? 'available' : 'unconfigured',
        detail: configured
          ? '已存在 secret_ref，占位值不会写入模板。'
          : `需配置 ${dependency.key}（secret:// 引用），克隆不会写入真实密钥。`,
      })
    }
    version.required_knowledge.forEach((item) => {
      const dependency = normalizeKnowledge(item)
      const kb = knowledge.find((candidate) => candidate.public_id === dependency.id)
      dependencies.push({
        type: 'knowledge',
        id: dependency.id,
        label: dependency.label,
        required: dependency.embeddingDimension
          ? `dimension ${dependency.embeddingDimension}`
          : dependency.id,
        state: kb?.status === 'ready' ? 'available' : kb ? 'incompatible' : 'missing',
        detail: kb?.status === 'ready'
          ? '知识库已就绪。'
          : kb
            ? `知识库当前状态为 ${kb.status}。`
            : '需先创建同名知识库，克隆时不会自动导入文档。',
      })
    })
    const nodeDependencies = uniqueNodeDependencies(version.workflow_definition)
    for (const node of nodeDependencies) {
      if (node.pluginId) {
        const plugin = plugins.find((candidate) => candidate.entry_id === node.pluginId)
        const available = Boolean(plugin?.enabled)
        dependencies.push({
          type: 'node',
          id: node.type,
          label: node.type,
          required: node.version,
          state: available ? 'available' : 'missing',
          detail: available
            ? `插件节点由 ${node.pluginId} 提供。`
            : `缺少插件节点 ${node.pluginId} v${node.version}，会阻止克隆。`,
        })
        continue
      }
      const supported = WORKFLOW_NODE_TYPES.has(node.type) && node.version === '1.0.0'
      dependencies.push({
        type: 'node',
        id: node.type,
        label: node.type,
        required: node.version,
        state: supported ? 'available' : 'incompatible',
        detail: supported
          ? '内置节点版本可用。'
          : `节点 ${node.type} v${node.version} 与当前设计器不兼容。`,
      })
    }
    return dependencies
  }

  /**
   * 读取模板行，跨 workspace 统一 404。
   *
   * @param templateId 模板 ID。
   * @returns 模板行。
   */
  private async requireTemplate(templateId: string) {
    const [row] = await this.sql<TemplateRow[]>`
      select
        id, name, author, summary, category, tags, license, preview,
        visibility, usage_count, created_at, updated_at
      from template_catalog
      where id = ${templateId}
      limit 1
    `
    if (!row) throw notFound('模板')
    return row
  }

  /**
   * 读取指定模板版本。
   *
   * @param templateId 模板 ID。
   * @param version 模板版本。
   * @returns 版本行。
   */
  private async requireVersion(templateId: string, version: string) {
    const [row] = await this.sql<TemplateVersionRow[]>`
      select
        id, template_id, version, manifest, workflow_definition, preview_graph,
        bundle_key, schema_version, required_plugins, required_models,
        required_secrets, required_knowledge, created_at
      from template_versions
      where template_id = ${templateId} and version = ${version}
      limit 1
    `
    if (!row) throw notFound('模板版本')
    return row
  }

  /**
   * 读取模板最新版本。
   *
   * @param templateId 模板 ID。
   * @returns 版本行。
   */
  private async latestVersion(templateId: string) {
    const [row] = await this.sql<TemplateVersionRow[]>`
      select
        id, template_id, version, manifest, workflow_definition, preview_graph,
        bundle_key, schema_version, required_plugins, required_models,
        required_secrets, required_knowledge, created_at
      from template_versions
      where template_id = ${templateId}
      order by created_at desc
      limit 1
    `
    if (!row) throw notFound('模板版本')
    return row
  }

  /**
   * 查询全部或单个模板版本。
   *
   * @param templateId 可选模板 ID。
   * @returns 版本行。
   */
  private async versionsFor(templateId?: string) {
    return this.sql<TemplateVersionRow[]>`
      select
        id, template_id, version, manifest, workflow_definition, preview_graph,
        bundle_key, schema_version, required_plugins, required_models,
        required_secrets, required_knowledge, created_at
      from template_versions
      ${templateId ? this.sql`where template_id = ${templateId}` : this.sql``}
      order by created_at desc
    `
  }

  /**
   * 在现有工作流名称冲突时追加副本序号。
   *
   * @param requestedName 用户输入名称。
   * @returns 可用名称。
   */
  private async availableTargetName(requestedName: string) {
    const base = requestedName.trim()
    const rows = await this.sql<Array<{ name: string }>>`
      select name
      from workflows
      where workspace_id = ${this.workspaceId} and archived_at is null
    `
    const names = new Set(rows.map((row) => row.name))
    if (!names.has(base)) return base
    let index = 1
    while (names.has(`${base}（副本${index === 1 ? '' : ` ${index}`}）`)) index++
    return `${base}（副本${index === 1 ? '' : ` ${index}`}）`
  }

  /**
   * 将模板目录行和版本映射为 DTO。
   *
   * @param row 模板目录行。
   * @param versions 模板版本行。
   * @returns 模板 DTO。
   */
  private toDto(row: TemplateRow, versions: TemplateVersionRow[]) {
    const latest = versions[0]
    return {
      id: row.id,
      name: row.name,
      author: row.author,
      description: row.summary,
      category: row.category,
      tags: row.tags,
      license: row.license,
      visibility: row.visibility,
      installs: row.usage_count,
      featured: row.preview.featured === true,
      icon: String(row.preview.icon ?? 'workflow'),
      accent: String(row.preview.accent ?? 'primary'),
      updatedAt: iso(row.updated_at)!,
      latestVersion: latest?.version ?? '0.0.0',
      versions: versions.map((version) => this.toVersionDto(version)),
      definition: latest?.workflow_definition,
      previewGraph: latest?.preview_graph ?? {},
      examples: latest?.manifest.examples ?? {},
    }
  }

  /**
   * 将模板版本映射为 DTO。
   *
   * @param row 版本行。
   * @returns 版本 DTO。
   */
  private toVersionDto(row: TemplateVersionRow) {
    return {
      id: row.id,
      version: row.version,
      createdAt: iso(row.created_at)!,
      schemaVersion: row.schema_version,
      changelog: String(row.manifest.changelog ?? ''),
      requiredPlugins: row.required_plugins,
      requiredModels: row.required_models,
      requiredSecrets: row.required_secrets,
      requiredKnowledge: row.required_knowledge,
      nodeDependencies: uniqueNodeDependencies(row.workflow_definition),
      definition: row.workflow_definition,
      previewGraph: row.preview_graph,
      manifest: row.manifest,
    }
  }
}

/**
 * 按模板 ID 分组版本。
 *
 * @param rows 版本行。
 * @returns 模板 ID 到版本列表。
 */
function groupVersions(rows: TemplateVersionRow[]) {
  const groups = new Map<string, TemplateVersionRow[]>()
  for (const row of rows) {
    const group = groups.get(row.template_id) ?? []
    group.push(row)
    groups.set(row.template_id, group)
  }
  return groups
}

/**
 * 深度重映射模板节点和边 ID。
 *
 * @param definition 模板工作流定义。
 * @param targetName 新草稿名称。
 * @returns 可独立编辑的新定义。
 */
function remapDefinition(
  definition: WorkflowDefinition,
  targetName: string,
): WorkflowDefinition {
  const cloned = structuredClone(definition)
  cloned.name = targetName
  const nodeIds = new Map<string, string>()
  cloned.nodes = cloned.nodes.map((node) => {
    const nextId = `node_${publicId('x').slice(-10)}`
    nodeIds.set(node.id, nextId)
    return { ...node, id: nextId }
  })
  cloned.edges = cloned.edges.map((edge) => ({
    ...edge,
    id: `edge_${publicId('x').slice(-10)}`,
    source: nodeIds.get(edge.source) ?? edge.source,
    target: nodeIds.get(edge.target) ?? edge.target,
  }))
  return cloned
}

/**
 * 提取定义中的节点 type/version 依赖。
 *
 * @param definition 工作流定义。
 * @returns 去重后的节点依赖。
 */
function uniqueNodeDependencies(definition: WorkflowDefinition) {
  const map = new Map<string, {
    type: string
    version: string
    displayName: string
    pluginId?: string
  }>()
  for (const node of definition.nodes) {
    const version = node.manifestVersion ?? '1.0.0'
    const key = `${node.type}:${version}`
    const pluginId = node.type.startsWith('plugin:')
      ? node.type.split(':')[1]
      : undefined
    map.set(key, {
      type: node.type,
      version,
      displayName: node.title,
      pluginId,
    })
  }
  return [...map.values()]
}

/**
 * 归一化插件或模型依赖。
 *
 * @param item 数据库 JSON 依赖项。
 * @returns 统一依赖字段。
 */
function normalizeDependency(item: unknown) {
  if (typeof item === 'string') {
    return { id: item, label: item, version: '' }
  }
  const record = asRecord(item)
  const id = String(record.id ?? record.suggested ?? record.capability ?? '')
  return {
    id,
    label: String(record.name ?? record.suggested ?? id),
    version: String(record.version ?? record.required ?? ''),
  }
}

/**
 * 归一化密钥依赖。
 *
 * @param item 数据库 JSON 依赖项。
 * @returns 密钥 key 与说明。
 */
function normalizeSecret(item: unknown) {
  if (typeof item === 'string') {
    return { key: item, label: item, description: '要求 secret:// 引用' }
  }
  const record = asRecord(item)
  return {
    key: String(record.key ?? record.id ?? ''),
    label: String(record.name ?? record.key ?? record.id ?? ''),
    description: String(record.description ?? record.required ?? '要求 secret:// 引用'),
  }
}

/**
 * 归一化知识库依赖。
 *
 * @param item 数据库 JSON 依赖项。
 * @returns 知识库 ID、展示名和维度。
 */
function normalizeKnowledge(item: unknown) {
  if (typeof item === 'string') {
    return { id: item, label: item, embeddingDimension: 0 }
  }
  const record = asRecord(item)
  return {
    id: String(record.id ?? record.name ?? ''),
    label: String(record.name ?? record.id ?? ''),
    embeddingDimension: Number(record.embeddingDimension ?? 0),
  }
}

/**
 * 安全读取 JSON 对象。
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
 * 校验常见的精确、caret、tilde 和比较版本范围。
 *
 * @param installed 已安装版本。
 * @param required 要求范围。
 * @returns 是否满足。
 */
function semverSatisfies(installed: string, required: string) {
  if (!required || required === '*') return true
  const parsed = parseSemver(installed)
  if (!parsed) return installed === required
  const candidates = required.split('||').map((part) => part.trim())
  return candidates.some((candidate) => {
    if (candidate.startsWith('^')) {
      const target = parseSemver(candidate.slice(1))
      return Boolean(target && parsed.major === target.major && compareSemver(installed, candidate.slice(1)) >= 0)
    }
    if (candidate.startsWith('~')) {
      const target = parseSemver(candidate.slice(1))
      return Boolean(
        target &&
        parsed.major === target.major &&
        parsed.minor === target.minor &&
        compareSemver(installed, candidate.slice(1)) >= 0
      )
    }
    const operator = candidate.match(/^(>=|<=|>|<|=)\s*/)?.[1]
    return operator
      ? matchesSemverOperator(
          compareSemver(installed, candidate.replace(/^(>=|<=|>|<|=)\s*/, '')),
          operator,
        )
      : installed === candidate
  })
}

/**
 * 解析基础 semver。
 *
 * @param value 版本文本。
 * @returns 主次修订号。
 */
function parseSemver(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/)
  return match
    ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
    : null
}

/**
 * 比较两个版本。
 *
 * @param left 左版本。
 * @param right 右版本。
 * @param operator 比较运算符。
 * @returns 比较结果或布尔判断。
 */
function compareSemver(left: string, right: string) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return left === right ? 0 : left.localeCompare(right, undefined, { numeric: true })
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch
  )
}

/**
 * 判断版本比较结果是否满足范围运算符。
 *
 * @param comparison 左版本减右版本的结果。
 * @param operator semver 比较运算符。
 * @returns 是否满足。
 */
function matchesSemverOperator(comparison: number, operator: string) {
  if (operator === '>=') return comparison >= 0
  if (operator === '<=') return comparison <= 0
  if (operator === '>') return comparison > 0
  if (operator === '<') return comparison < 0
  return comparison === 0
}
