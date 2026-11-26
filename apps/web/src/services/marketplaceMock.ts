import { getNodeRegistration } from '@/shared/registry'
import type { EdgeRegistration, WorkflowDefinition, WorkflowDraft } from '@/shared/types'
import {
  getWorkflowDraft,
  getWorkflowList,
  importWorkflowDraft,
  knowledgeBases,
  modelConnections,
} from './mockData'

export type TemplateCategory = 'Workflow' | 'Agent' | 'Chat' | 'Prompt' | 'Knowledge' | '节点组合包'
export type DependencyState = 'available' | 'missing' | 'incompatible' | 'unconfigured'

export interface TemplateDependency {
  type: 'plugin' | 'model' | 'secret' | 'knowledge' | 'node'
  id: string
  label: string
  required: string
  state: DependencyState
  detail: string
}

export interface TemplateNodeDependency {
  type: string
  version: string
  displayName: string
  pluginId?: string
}

export interface TemplateVersion {
  version: string
  releasedAt: string
  schemaVersion: string
  changelog: string
  nodeDependencies: TemplateNodeDependency[]
}

export interface TemplateEntry {
  id: string
  name: string
  version: string
  type: TemplateCategory
  category: string
  tags: string[]
  author: string
  license: string
  description: string
  schemaVersion: string
  featured: boolean
  accent: string
  icon: string
  usageCount: number
  rating: number
  updatedAt: string
  requiredPlugins: Array<{ id: string; name: string; version: string }>
  requiredModels: Array<{ capability: string; suggested: string }>
  requiredSecrets: Array<{ key: string; description: string }>
  requiredKnowledge: Array<{ name: string; embeddingDimension: number }>
  nodeDependencies: TemplateNodeDependency[]
  versions: TemplateVersion[]
  definition: WorkflowDefinition
  examples: {
    input: Record<string, unknown>
    output: Record<string, unknown>
  }
  originForkOf: { templateId: string; version: string } | null
}

export interface TemplateClonePlan {
  planId: string
  templateId: string
  version: string
  targetName: string
  missingDependencies: TemplateDependency[]
  blockingReasons: string[]
  warnings: string[]
  willAutoInstall: boolean
  willWriteSecrets: boolean
  expiresAt: string
  canClone: boolean
}

export interface TemplateCloneResult {
  importId: string
  workflow: WorkflowDraft
  missingDependencies: TemplateDependency[]
  canPreview: boolean
}

export type PluginKind = 'tool' | 'toolkit' | 'model' | 'datasource' | 'trigger' | 'node-pack'
export type PluginInstallStatus =
  | 'config_required'
  | 'enabled'
  | 'disabled'
  | 'update_available'
  | 'degraded'
  | 'failed'

export interface PluginPermission {
  group: 'network' | 'files' | 'secrets' | 'mcp' | 'code' | 'resources'
  label: string
  values: string[]
  highRisk?: boolean
}

export interface PluginDependency {
  id: string
  name: string
  version: string
  state: 'available' | 'missing' | 'conflict'
  chain?: string
}

export interface PluginCredential {
  key: string
  authType: 'api-key' | 'oauth' | 'bearer'
  state: 'missing' | 'configured' | 'expiring'
  masked?: string
  expiresAt?: string
  verifiedAt?: string
}

export interface PluginVerification {
  checksum: 'ok' | 'missing' | 'mismatch'
  signature: 'verified' | 'missing' | 'invalid'
  license: string
  licenseBlocked: boolean
}

export interface PluginVersion {
  version: string
  releasedAt: string
  compatibility: string
  engine: string
  schemaVersion: string
  size: string
  deprecated: boolean
  changelog: string
  dependencies: PluginDependency[]
  verification: PluginVerification
}

export interface PluginEntry {
  id: string
  name: string
  publisher: string
  kind: PluginKind
  summary: string
  description: string
  latestVersion: string
  icon: string
  accent: string
  verified: boolean
  installs: number
  updatedAt: string
  capabilities: string[]
  permissions: PluginPermission[]
  credentials: PluginCredential[]
  tools: Array<{ name: string; description: string; nodeType?: string }>
  versions: PluginVersion[]
}

export interface PluginInstall {
  installId: string
  entryId: string
  version: string
  previousVersion?: string
  enabled: boolean
  status: PluginInstallStatus
  affectedWorkflows: string[]
  credentials: PluginCredential[]
  installedAt: string
  updatedAt: string
}

export type PluginPlanAction = 'install' | 'upgrade' | 'configure' | 'rollback'

export interface PluginInstallPlan {
  planId: string
  action: PluginPlanAction
  entryId: string
  fromVersion: string | null
  toVersion: string
  affectedWorkflowIds: string[]
  dependencies: PluginDependency[]
  permissions: PluginPermission[]
  credentials: PluginCredential[]
  verification: PluginVerification
  deprecated: boolean
  blockers: string[]
  warnings: string[]
  highRisk: boolean
  idempotencyKey: string
  expiresAt: string
  canInstall: boolean
}

export interface PluginAuditEvent {
  id: string
  entryId: string
  action: string
  actor: string
  at: string
  metadata: Record<string, unknown>
}

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
const iso = (offset = 0) => new Date(now - offset).toISOString()
const futureIso = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString()
const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`
const PLUGIN_STORAGE_KEY = 'reflow_plugin_state_v1'

/**
 * 从 Vue 响应式代理中提取可持久化的纯 JSON 数据。
 *
 * @param value 任意可序列化对象。
 */
function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 截取工作流定义并在模板中复用相同节点与边的语义。
 *
 * @param workflowId 作为模板来源的工作流 ID。
 * @param name 模板展示名称。
 */
function templateDefinition(workflowId: string, name: string): WorkflowDefinition {
  const draft = getWorkflowDraft(workflowId)
  if (!draft) {
    return {
      schemaVersion: '1.0',
      name,
      nodes: [],
      edges: [],
    }
  }
  return {
    ...structuredClone(draft.definition),
    name,
  }
}

/**
 * 生成模板节点版本清单，来源始终是注册表，而不是页面内第二份节点目录。
 */
function nodeDependencies(definition: WorkflowDefinition): TemplateNodeDependency[] {
  return [...new Set(definition.nodes.map((node) => node.type))].map((type) => {
    const registration = getNodeRegistration(type)
    return {
      type,
      version: registration?.manifest.version ?? '0.0.0',
      displayName: registration?.manifest.displayName ?? type,
      pluginId: type.startsWith('plugin:') ? type.split(':')[1] : undefined,
    }
  })
}

const supportTemplateDefinition = templateDefinition('wf_support', '企业级客服知识问答')
const leadTemplateDefinition = templateDefinition('wf_lead_scoring', '线索评分与自动分配')
const reportTemplateDefinition = templateDefinition('wf_weekly_report', '团队周报生成')

/**
 * 官方 seed 模板目录。模板包只声明依赖，不内嵌插件代码或真实密钥。
 */
export const templateEntries: TemplateEntry[] = [
  {
    id: 'tpl_support',
    name: '企业级客服知识问答',
    version: '1.3.0',
    type: 'Workflow',
    category: '客服',
    tags: ['知识库', 'MCP', '人工审批'],
    author: 'Reflow 官方',
    license: 'MIT',
    description:
      '检索增强的客服工作流：文档解析、混合检索、引用回答、低置信度转人工，附 12 条评测用例。',
    schemaVersion: '1.0',
    featured: true,
    accent: 'violet',
    icon: 'headset',
    usageCount: 1284,
    rating: 4.8,
    updatedAt: iso(2 * DAY),
    requiredPlugins: [],
    requiredModels: [{ capability: 'text', suggested: 'openai:gpt-4.1-mini' }],
    requiredSecrets: [],
    requiredKnowledge: [{ name: '产品文档', embeddingDimension: 1024 }],
    nodeDependencies: nodeDependencies(supportTemplateDefinition),
    versions: [
      {
        version: '1.3.0',
        releasedAt: iso(2 * DAY),
        schemaVersion: '1.0',
        changelog: '加入引用来源与低置信度人工审批分支。',
        nodeDependencies: nodeDependencies(supportTemplateDefinition),
      },
      {
        version: '1.2.0',
        releasedAt: iso(18 * DAY),
        schemaVersion: '1.0',
        changelog: '优化知识检索召回阈值。',
        nodeDependencies: nodeDependencies(supportTemplateDefinition),
      },
    ],
    definition: supportTemplateDefinition,
    examples: {
      input: { question: '如何申请企业版试用？', locale: 'zh-CN' },
      output: { answer: '可在控制台提交企业认证并申请 14 天试用。', citations: 3 },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_lead',
    name: '线索评分与自动分配',
    version: '1.4.0',
    type: 'Agent',
    category: '销售',
    tags: ['HTTP', 'LLM', '条件'],
    author: '周予安',
    license: 'MIT',
    description: '拉取线索、按 BANT 维度评分，并按区域分配给销售后在飞书通知。',
    schemaVersion: '1.0',
    featured: false,
    accent: 'sky',
    icon: 'route',
    usageCount: 866,
    rating: 4.6,
    updatedAt: iso(5 * DAY),
    requiredPlugins: [{ id: 'plugin_crm_toolkit', name: 'CRM 工具包', version: '^1.0.0' }],
    requiredModels: [{ capability: 'text', suggested: 'openai:gpt-4.1-mini' }],
    requiredSecrets: [{ key: 'CRM_API_KEY', description: '只写入 secret_ref 占位，不导入真实值。' }],
    requiredKnowledge: [],
    nodeDependencies: nodeDependencies(leadTemplateDefinition),
    versions: [
      {
        version: '1.4.0',
        releasedAt: iso(5 * DAY),
        schemaVersion: '1.0',
        changelog: '新增区域路由与飞书通知。',
        nodeDependencies: nodeDependencies(leadTemplateDefinition),
      },
    ],
    definition: leadTemplateDefinition,
    examples: {
      input: { leadId: 'lead_1024', source: 'webinar' },
      output: { score: 86, owner: '华东销售组' },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_report',
    name: '团队周报生成',
    version: '1.2.0',
    type: 'Workflow',
    category: '运营',
    tags: ['并行', '模板', '飞书'],
    author: 'Reflow 官方',
    license: 'Apache-2.0',
    description: '并行拉取 Jira 与 Git 数据，汇总后生成结构化团队周报。',
    schemaVersion: '1.0',
    featured: false,
    accent: 'mint',
    icon: 'calendar',
    usageCount: 742,
    rating: 4.5,
    updatedAt: iso(7 * DAY),
    requiredPlugins: [
      { id: 'plugin_jira_connector', name: 'Jira Connector', version: '^1.0.0' },
      { id: 'plugin_slack_notifier', name: '飞书消息', version: '^1.1.0' },
    ],
    requiredModels: [{ capability: 'text', suggested: 'openai:gpt-4.1-mini' }],
    requiredSecrets: [],
    requiredKnowledge: [],
    nodeDependencies: nodeDependencies(reportTemplateDefinition),
    versions: [
      {
        version: '1.2.0',
        releasedAt: iso(7 * DAY),
        schemaVersion: '1.0',
        changelog: '支持并行数据源与失败分支。',
        nodeDependencies: nodeDependencies(reportTemplateDefinition),
      },
    ],
    definition: reportTemplateDefinition,
    examples: {
      input: { week: '2026-W48', team: 'platform' },
      output: { markdown: '# 平台组周报', highlights: 5 },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_ticket',
    name: '工单分类与自动派发',
    version: '2.1.0',
    type: 'Workflow',
    category: '客服',
    tags: ['LLM 分类', '条件', 'MCP'],
    author: 'Reflow 官方',
    license: 'MIT',
    description: '按意图分级并路由到客服、技术或风控队列。',
    schemaVersion: '1.0',
    featured: true,
    accent: 'violet',
    icon: 'wand',
    usageCount: 704,
    rating: 4.7,
    updatedAt: iso(9 * DAY),
    requiredPlugins: [],
    requiredModels: [{ capability: 'classification', suggested: 'openai:gpt-4.1-mini' }],
    requiredSecrets: [],
    requiredKnowledge: [],
    nodeDependencies: nodeDependencies(supportTemplateDefinition),
    versions: [
      {
        version: '2.1.0',
        releasedAt: iso(9 * DAY),
        schemaVersion: '1.0',
        changelog: '新增风控队列与 fallback 分类。',
        nodeDependencies: nodeDependencies(supportTemplateDefinition),
      },
    ],
    definition: { ...structuredClone(supportTemplateDefinition), name: '工单分类与自动派发' },
    examples: {
      input: { ticket: '支付后无法下载发票' },
      output: { queue: 'finance', priority: 'normal' },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_contract',
    name: 'PDF 合同信息抽取',
    version: '1.0.4',
    type: 'Knowledge',
    category: '财务',
    tags: ['文档', 'LLM', '变量'],
    author: '李知夏',
    license: 'MIT',
    description: '解析合同 PDF，抽取甲乙方、金额和期限并写入结构化表格。',
    schemaVersion: '1.0',
    featured: false,
    accent: 'mint',
    icon: 'file',
    usageCount: 463,
    rating: 4.4,
    updatedAt: iso(12 * DAY),
    requiredPlugins: [],
    requiredModels: [{ capability: 'extraction', suggested: 'openai:gpt-4.1' }],
    requiredSecrets: [],
    requiredKnowledge: [{ name: '合同条款库', embeddingDimension: 1536 }],
    nodeDependencies: nodeDependencies(leadTemplateDefinition),
    versions: [
      {
        version: '1.0.4',
        releasedAt: iso(12 * DAY),
        schemaVersion: '1.0',
        changelog: '提高跨页表格识别率。',
        nodeDependencies: nodeDependencies(leadTemplateDefinition),
      },
    ],
    definition: { ...structuredClone(leadTemplateDefinition), name: 'PDF 合同信息抽取' },
    examples: {
      input: { file: 'service-agreement.pdf' },
      output: { buyer: 'Acme', amount: 650000, effectiveAt: '2027-01-01' },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_chat',
    name: '品牌语气 Chat 助手',
    version: '1.1.2',
    type: 'Chat',
    category: '营销',
    tags: ['Prompt', '知识库', 'Chat'],
    author: 'Reflow 官方',
    license: 'MIT',
    description: '带品牌语气约束与会话记忆的客服聊天模板。',
    schemaVersion: '1.0',
    featured: false,
    accent: 'amber',
    icon: 'message',
    usageCount: 391,
    rating: 4.3,
    updatedAt: iso(15 * DAY),
    requiredPlugins: [],
    requiredModels: [{ capability: 'chat', suggested: 'anthropic:claude-sonnet-4' }],
    requiredSecrets: [{ key: 'CHAT_MODEL_SECRET', description: '克隆后需配置模型连接凭证。' }],
    requiredKnowledge: [{ name: '品牌语气指南', embeddingDimension: 768 }],
    nodeDependencies: nodeDependencies(supportTemplateDefinition),
    versions: [
      {
        version: '1.1.2',
        releasedAt: iso(15 * DAY),
        schemaVersion: '1.0',
        changelog: '增强品牌禁用词检查。',
        nodeDependencies: nodeDependencies(supportTemplateDefinition),
      },
    ],
    definition: { ...structuredClone(supportTemplateDefinition), name: '品牌语气 Chat 助手' },
    examples: {
      input: { message: '你们支持私有化部署吗？' },
      output: { answer: '企业版支持私有化选项，可由商务团队评估。' },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_legacy',
    name: '旧版审批模板',
    version: '0.8.0',
    type: 'Workflow',
    category: '行政',
    tags: ['审批', '人工'],
    author: 'Community',
    license: 'MIT',
    description: '用于验证旧 schemaVersion 与节点版本不兼容的阻断路径。',
    schemaVersion: '0.8',
    featured: false,
    accent: 'rose',
    icon: 'shield',
    usageCount: 82,
    rating: 3.8,
    updatedAt: iso(90 * DAY),
    requiredPlugins: [],
    requiredModels: [],
    requiredSecrets: [],
    requiredKnowledge: [],
    nodeDependencies: [
      ...nodeDependencies(supportTemplateDefinition),
      { type: 'human', version: '0.7.0', displayName: '人工任务（旧版）' },
    ],
    versions: [
      {
        version: '0.8.0',
        releasedAt: iso(90 * DAY),
        schemaVersion: '0.8',
        changelog: '旧版审批模板，不再推荐新克隆。',
        nodeDependencies: [
          ...nodeDependencies(supportTemplateDefinition),
          { type: 'human', version: '0.7.0', displayName: '人工任务（旧版）' },
        ],
      },
    ],
    definition: { ...structuredClone(supportTemplateDefinition), schemaVersion: '0.8', name: '旧版审批模板' },
    examples: {
      input: { requestId: 'req_1024' },
      output: { approved: true },
    },
    originForkOf: null,
  },
  {
    id: 'tpl_plugin_missing',
    name: 'CRM 客户资料补全',
    version: '1.0.0',
    type: '节点组合包',
    category: '销售',
    tags: ['插件节点', 'CRM'],
    author: 'Community',
    license: 'MPL-2.0',
    description: '依赖 CRM 插件节点的客户资料补全组合，用于验证缺失插件节点阻断。',
    schemaVersion: '1.0',
    featured: false,
    accent: 'rose',
    icon: 'package',
    usageCount: 118,
    rating: 4.1,
    updatedAt: iso(32 * DAY),
    requiredPlugins: [{ id: 'plugin_crm_toolkit', name: 'CRM 工具包', version: '^1.4.0' }],
    requiredModels: [],
    requiredSecrets: [{ key: 'CRM_API_KEY', description: '插件节点依赖 CRM 凭据。' }],
    requiredKnowledge: [],
    nodeDependencies: [
      ...nodeDependencies(supportTemplateDefinition),
      {
        type: 'plugin:plugin_crm_toolkit:crm_lookup',
        version: '1.4.0',
        displayName: 'CRM 客户查询',
        pluginId: 'plugin_crm_toolkit',
      },
    ],
    versions: [
      {
        version: '1.0.0',
        releasedAt: iso(32 * DAY),
        schemaVersion: '1.0',
        changelog: '首个插件节点组合模板。',
        nodeDependencies: [
          ...nodeDependencies(supportTemplateDefinition),
          {
            type: 'plugin:plugin_crm_toolkit:crm_lookup',
            version: '1.4.0',
            displayName: 'CRM 客户查询',
            pluginId: 'plugin_crm_toolkit',
          },
        ],
      },
    ],
    definition: {
      ...structuredClone(leadTemplateDefinition),
      name: 'CRM 客户资料补全',
      nodes: [
        ...leadTemplateDefinition.nodes,
        {
          id: 'plugin_crm_lookup',
          type: 'plugin:plugin_crm_toolkit:crm_lookup',
          title: 'CRM 客户查询',
          x: 1080,
          y: 420,
          config: { query: '{{ $input.leadId }}' },
          manifestVersion: '1.4.0',
        },
      ],
    },
    examples: {
      input: { leadId: 'lead_2048' },
      output: { company: 'Northstar Labs', employees: 180 },
    },
    originForkOf: null,
  },
]

const permission = (
  group: PluginPermission['group'],
  label: string,
  values: string[],
  highRisk = false,
): PluginPermission => ({ group, label, values, highRisk })

const verification = (
  input: Partial<PluginVerification> = {},
): PluginVerification => ({
  checksum: 'ok',
  signature: 'verified',
  license: 'MIT',
  licenseBlocked: false,
  ...input,
})

const pluginVersion = (
  version: string,
  releasedOffset: number,
  changelog: string,
  input: Partial<PluginVersion> = {},
): PluginVersion => ({
  version,
  releasedAt: iso(releasedOffset),
  compatibility: '>=0.1.0 <1.0.0',
  engine: 'reflow-engine >=0.9',
  schemaVersion: '1.0',
  size: '8.4 MB',
  deprecated: false,
  changelog,
  dependencies: [],
  verification: verification(),
  ...input,
})

/**
 * 官方 seed catalog，共 12 个条目，覆盖工具、工具包、模型、数据源、触发器与节点包。
 */
export const pluginEntries: PluginEntry[] = [
  {
    id: 'plugin_crm_toolkit',
    name: 'CRM 工具包',
    publisher: 'Reflow 官方',
    kind: 'toolkit',
    summary: 'Salesforce / HubSpot 读写、字段映射与 Webhook 触发。',
    description: '将 CRM 查询、写入和字段映射能力包装为受权限代理约束的工具节点。',
    latestVersion: '2.2.0',
    icon: 'contact',
    accent: 'violet',
    verified: true,
    installs: 2860,
    updatedAt: iso(4 * DAY),
    capabilities: ['查询客户', '创建线索', '字段映射'],
    permissions: [
      permission('network', '网络', ['api.salesforce.com', 'api.hubspot.com'], true),
      permission('secrets', '密钥', ['CRM_API_KEY']),
      permission('resources', '资源限额', ['4 核 / 512 MB / 30s']),
    ],
    credentials: [
      {
        key: 'CRM_API_KEY',
        authType: 'api-key',
        state: 'missing',
      },
    ],
    tools: [
      { name: 'crm.query_contact', description: '按邮箱或域名查询客户。' },
      { name: 'crm.upsert_lead', description: '写入或更新销售线索。' },
    ],
    versions: [
      pluginVersion('2.2.0', 4 * DAY, '新增 HubSpot 字段映射与幂等写入。'),
      pluginVersion('2.1.0', 35 * DAY, '支持 Salesforce 沙箱环境。'),
    ],
  },
  {
    id: 'plugin_postgres',
    name: 'Postgres 连接器',
    publisher: 'Acme 内部',
    kind: 'datasource',
    summary: '参数化查询、只读默认、写操作显式授权。',
    description: '为数据库节点提供白名单连接、SQL 风险检查和结果结构投影。',
    latestVersion: '1.6.0',
    icon: 'database',
    accent: 'sky',
    verified: true,
    installs: 1740,
    updatedAt: iso(8 * DAY),
    capabilities: ['参数化查询', '事务写入', '查询计划'],
    permissions: [
      permission('network', '网络', ['db.internal']),
      permission('secrets', '密钥', ['POSTGRES_CONNECTION']),
      permission('code', '代码', ['SQL 模板'], true),
    ],
    credentials: [
      {
        key: 'POSTGRES_CONNECTION',
        authType: 'bearer',
        state: 'configured',
        masked: 'secret_ref://••••••••7f2a',
        verifiedAt: iso(3 * DAY),
      },
    ],
    tools: [{ name: 'postgres.query', description: '执行参数化只读查询。' }],
    versions: [
      pluginVersion('1.6.0', 8 * DAY, '支持查询计划与结果集上限。', {
        verification: verification({ license: 'Apache-2.0' }),
      }),
      pluginVersion('1.4.0', 40 * DAY, '增加事务策略。', {
        verification: verification({ license: 'Apache-2.0' }),
      }),
    ],
  },
  {
    id: 'plugin_crawler',
    name: '网页抓取工具',
    publisher: 'Reflow 官方',
    kind: 'tool',
    summary: 'HTML / PDF 抓取与正文提取，默认 SSRF 防护。',
    description: '仅允许 manifest 声明的 host，内网与回环地址默认拒绝。',
    latestVersion: '1.2.0',
    icon: 'globe',
    accent: 'violet',
    verified: false,
    installs: 980,
    updatedAt: iso(17 * DAY),
    capabilities: ['正文抽取', 'PDF 下载', '超时控制'],
    permissions: [
      permission('network', '网络', ['docs.example.com', '*'], true),
      permission('files', '文件', ['临时下载目录'], true),
    ],
    credentials: [],
    tools: [{ name: 'web.fetch', description: '抓取 URL 并返回正文。' }],
    versions: [
      pluginVersion('1.2.0', 17 * DAY, '增加 SSRF allowlist。', {
        verification: verification({
          signature: 'missing',
          license: 'BSD-3-Clause',
        }),
      }),
    ],
  },
  {
    id: 'plugin_gpt_adapter',
    name: 'GPT 模型适配器',
    publisher: 'Reflow 官方',
    kind: 'model',
    summary: '统一 OpenAI 与 Anthropic 接入、token 估算和成本上限。',
    description: '模型连接由 workspace 凭证引用，插件本身不保存明文密钥。',
    latestVersion: '3.0.1',
    icon: 'sparkles',
    accent: 'violet',
    verified: true,
    installs: 3210,
    updatedAt: iso(21 * DAY),
    capabilities: ['文本生成', '结构化输出', '成本上限'],
    permissions: [
      permission('network', '网络', ['api.openai.com', 'api.anthropic.com'], true),
      permission('secrets', '密钥', ['MODEL_PROVIDER_KEY']),
    ],
    credentials: [
      {
        key: 'MODEL_PROVIDER_KEY',
        authType: 'api-key',
        state: 'configured',
        masked: 'secret_ref://••••••••c10d',
      },
    ],
    tools: [],
    versions: [
      pluginVersion('3.0.1', 21 * DAY, '支持模型 fallback 顺序。'),
    ],
  },
  {
    id: 'plugin_schedule',
    name: '定时触发器',
    publisher: 'Reflow 社区',
    kind: 'trigger',
    summary: 'cron 表达式调度，支持时区与补跑。',
    description: '触发器与 start 解耦，通过独立插件触发器运行时执行。',
    latestVersion: '0.9.3',
    icon: 'clock',
    accent: 'violet',
    verified: false,
    installs: 642,
    updatedAt: iso(120 * DAY),
    capabilities: ['cron', '时区', '补跑'],
    permissions: [
      permission('resources', '资源限额', ['计划任务 / 30s']),
      permission('mcp', 'MCP', ['调度控制平面'], true),
    ],
    credentials: [],
    tools: [],
    versions: [
      pluginVersion('0.9.3', 120 * DAY, '旧版本触发器，已弃用。', {
        deprecated: true,
        verification: verification({ signature: 'missing' }),
      }),
    ],
  },
  {
    id: 'plugin_doc_parser',
    name: '文档解析节点包',
    publisher: 'Reflow 官方',
    kind: 'node-pack',
    summary: 'PDF / DOCX / HTML 解析与分块，支持 5 种格式。',
    description: '提供文档解析节点与 artifact 引用，不在宿主执行解析进程。',
    latestVersion: '1.0.0',
    icon: 'file',
    accent: 'rose',
    verified: false,
    installs: 1580,
    updatedAt: iso(27 * DAY),
    capabilities: ['PDF 解析', 'DOCX 解析', '分块'],
    permissions: [
      permission('files', '文件', ['artifact 临时目录'], true),
      permission('resources', '资源限额', ['2 核 / 1 GB / 120s']),
    ],
    credentials: [],
    tools: [{ name: 'document.parse', description: '解析文档并返回 chunks。', nodeType: 'plugin:plugin_doc_parser:parse' }],
    versions: [
      pluginVersion('1.0.0', 27 * DAY, '首个稳定版本。', {
        verification: verification({ checksum: 'mismatch', license: 'MIT' }),
      }),
    ],
  },
  {
    id: 'plugin_slack',
    name: '飞书消息',
    publisher: 'Reflow 官方',
    kind: 'tool',
    summary: '发送卡片、文档与多维表消息。',
    description: '凭证只保存 secret_ref，失败调用保留审计与运行记录。',
    latestVersion: '1.2.0',
    icon: 'message',
    accent: 'mint',
    verified: true,
    installs: 1120,
    updatedAt: iso(34 * DAY),
    capabilities: ['卡片消息', '文档消息', '失败重试'],
    permissions: [
      permission('network', '网络', ['open.feishu.cn'], true),
      permission('secrets', '密钥', ['FEISHU_WEBHOOK']),
    ],
    credentials: [{ key: 'FEISHU_WEBHOOK', authType: 'bearer', state: 'missing' }],
    tools: [{ name: 'feishu.send_card', description: '发送富文本卡片。' }],
    versions: [pluginVersion('1.2.0', 34 * DAY, '增加多维表消息。')],
  },
  {
    id: 'plugin_jira',
    name: 'Jira Connector',
    publisher: 'Reflow Labs',
    kind: 'tool',
    summary: '查询、创建与更新 Jira Issue。',
    description: 'Jira 写入具备幂等键，网络访问限制在配置的 site host。',
    latestVersion: '2.0.0',
    icon: 'ticket',
    accent: 'sky',
    verified: true,
    installs: 2184,
    updatedAt: iso(43 * DAY),
    capabilities: ['Issue 查询', '创建 Issue', '状态流转'],
    permissions: [
      permission('network', '网络', ['api.atlassian.com'], true),
      permission('secrets', '密钥', ['JIRA_TOKEN']),
    ],
    credentials: [{ key: 'JIRA_TOKEN', authType: 'api-key', state: 'missing' }],
    tools: [{ name: 'jira.search_issues', description: 'JQL 查询 Issue。' }],
    versions: [
      pluginVersion('2.0.0', 43 * DAY, '升级 JQL 查询和幂等写入。'),
      pluginVersion('1.4.2', 150 * DAY, '旧版稳定版本。'),
    ],
  },
  {
    id: 'plugin_pii',
    name: 'PII Guard',
    publisher: 'Community',
    kind: 'node-pack',
    summary: '识别并脱敏常见个人信息。',
    description: '通过质量门禁节点调用本地模式与模型双检。',
    latestVersion: '0.9.8',
    icon: 'shield',
    accent: 'mint',
    verified: true,
    installs: 890,
    updatedAt: iso(52 * DAY),
    capabilities: ['邮箱识别', '手机号识别', '脱敏'],
    permissions: [permission('code', '代码', ['正则规则'], true)],
    credentials: [],
    tools: [{ name: 'pii.mask', description: '对文本执行脱敏。', nodeType: 'plugin:plugin_pii:mask' }],
    versions: [
      pluginVersion('0.9.8', 52 * DAY, '增加自定义正则规则。', {
        verification: verification({ license: 'ISC' }),
      }),
    ],
  },
  {
    id: 'plugin_sql_inspector',
    name: 'SQL Inspector',
    publisher: 'Reflow Labs',
    kind: 'toolkit',
    summary: '只读 SQL 预览、风险与查询计划。',
    description: '在写入数据库节点前提供风险说明与审计注释。',
    latestVersion: '1.1.5',
    icon: 'database',
    accent: 'sky',
    verified: true,
    installs: 615,
    updatedAt: iso(61 * DAY),
    capabilities: ['SQL 风险', '查询计划', '只读预览'],
    permissions: [
      permission('network', '网络', ['db.internal']),
      permission('secrets', '密钥', ['SQL_INSPECTOR_TOKEN']),
    ],
    credentials: [{ key: 'SQL_INSPECTOR_TOKEN', authType: 'api-key', state: 'missing' }],
    tools: [{ name: 'sql.inspect', description: '分析 SQL 风险。' }],
    versions: [pluginVersion('1.1.5', 61 * DAY, '增加跨 schema 风险提示。')],
  },
  {
    id: 'plugin_s3_files',
    name: 'S3 文件连接器',
    publisher: 'Acme 内部',
    kind: 'datasource',
    summary: '对象存储读写、签名 URL 与 artifact 生命周期。',
    description: '仅允许 workspace 配置的 bucket 前缀和操作。',
    latestVersion: '1.3.2',
    icon: 'cloud',
    accent: 'mint',
    verified: true,
    installs: 540,
    updatedAt: iso(73 * DAY),
    capabilities: ['对象读取', '对象写入', '签名 URL'],
    permissions: [
      permission('network', '网络', ['s3.internal']),
      permission('files', '文件', ['workspace/artifacts'], true),
      permission('secrets', '密钥', ['S3_ACCESS_KEY']),
    ],
    credentials: [{ key: 'S3_ACCESS_KEY', authType: 'api-key', state: 'missing' }],
    tools: [{ name: 's3.put_object', description: '写入 artifact。' }],
    versions: [pluginVersion('1.3.2', 73 * DAY, '增加对象前缀限制。')],
  },
  {
    id: 'plugin_redis_cache',
    name: 'Redis 缓存连接器',
    publisher: 'Community',
    kind: 'datasource',
    summary: '运行级缓存、TTL 与幂等键辅助。',
    description: '默认内网连接拒绝，需管理员显式放行 host。',
    latestVersion: '1.0.1',
    icon: 'database',
    accent: 'rose',
    verified: false,
    installs: 320,
    updatedAt: iso(98 * DAY),
    capabilities: ['缓存读写', 'TTL', '幂等键'],
    permissions: [
      permission('network', '网络', ['redis.internal'], true),
      permission('secrets', '密钥', ['REDIS_PASSWORD']),
    ],
    credentials: [{ key: 'REDIS_PASSWORD', authType: 'bearer', state: 'missing' }],
    tools: [],
    versions: [
      pluginVersion('1.0.1', 98 * DAY, 'AGPL 许可证，默认阻断安装。', {
        verification: verification({
          signature: 'verified',
          license: 'AGPL-3.0',
          licenseBlocked: true,
        }),
      }),
    ],
  },
]

interface PersistedPluginState {
  installs: PluginInstall[]
  audits: PluginAuditEvent[]
  plans: Record<string, PluginInstallPlan>
  idempotency: Record<string, string>
}

/**
 * 读取插件生命周期状态。种子状态覆盖已启用、需配置、可更新和异常四种场景。
 */
function readPluginState(): PersistedPluginState {
  const seed: PersistedPluginState = {
    installs: [
      {
        installId: 'pi_crm',
        entryId: 'plugin_crm_toolkit',
        version: '2.1.0',
        enabled: false,
        status: 'update_available',
        affectedWorkflows: ['wf_support', 'wf_lead_scoring'],
        credentials: pluginEntries[0].credentials.map((item) => ({ ...item, state: 'missing' })),
        installedAt: iso(35 * DAY),
        updatedAt: iso(4 * DAY),
      },
      {
        installId: 'pi_postgres',
        entryId: 'plugin_postgres',
        version: '1.4.0',
        enabled: true,
        status: 'update_available',
        affectedWorkflows: ['wf_crm_sync'],
        credentials: pluginEntries[1].credentials.map((item) => ({ ...item })),
        installedAt: iso(45 * DAY),
        updatedAt: iso(8 * DAY),
      },
      {
        installId: 'pi_gpt',
        entryId: 'plugin_gpt_adapter',
        version: '3.0.1',
        enabled: true,
        status: 'enabled',
        affectedWorkflows: ['wf_support', 'wf_lead_scoring', 'wf_weekly_report'],
        credentials: pluginEntries[3].credentials.map((item) => ({ ...item })),
        installedAt: iso(60 * DAY),
        updatedAt: iso(21 * DAY),
      },
      {
        installId: 'pi_doc_parser',
        entryId: 'plugin_doc_parser',
        version: '1.0.0',
        enabled: false,
        status: 'failed',
        affectedWorkflows: ['wf_support'],
        credentials: [],
        installedAt: iso(27 * DAY),
        updatedAt: iso(2 * DAY),
      },
    ],
    audits: [
      {
        id: 'audit_seed_install',
        entryId: 'plugin_crm_toolkit',
        action: 'install',
        actor: '林一舟',
        at: iso(35 * DAY),
        metadata: { version: '2.1.0', planId: 'plan_seed_01' },
      },
    ],
    plans: {},
    idempotency: {},
  }
  if (typeof localStorage === 'undefined') return seed
  const raw = localStorage.getItem(PLUGIN_STORAGE_KEY)
  if (!raw) {
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
  try {
    return JSON.parse(raw) as PersistedPluginState
  } catch {
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(seed))
    return seed
  }
}

/**
 * 持久化插件状态并广播数据变化事件，供工作流页与侧栏刷新状态。
 */
function writePluginState(state: PersistedPluginState) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(state))
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reflow:data-changed'))
  }
}

/**
 * 返回目录中的指定插件。
 *
 * @param entryId registry entry_id。
 */
export function getPluginEntry(entryId: string): PluginEntry | undefined {
  return pluginEntries.find((entry) => entry.id === entryId)
}

/**
 * 返回 workspace 当前安装记录。
 *
 * @param entryId 可选的 registry entry_id 过滤。
 */
export function getPluginInstalls(entryId?: string): PluginInstall[] {
  const state = readPluginState()
  return entryId
    ? state.installs.filter((install) => install.entryId === entryId)
    : structuredClone(state.installs)
}

/**
 * 获取指定插件的审计事件，按时间倒序返回。
 */
export function getPluginAudit(entryId: string): PluginAuditEvent[] {
  return readPluginState()
    .audits.filter((event) => event.entryId === entryId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/**
 * 计算安装、升级、配置或回滚计划。
 *
 * 所有写操作必须先拿到带过期时间的 planId；计划包含版本影响、依赖、
 * 权限、凭据与阻断原因，避免 UI 直接绕过供应链检查。
 */
export function createPluginPlan(input: {
  entryId: string
  version?: string
  action?: PluginPlanAction
}): PluginInstallPlan {
  const entry = getPluginEntry(input.entryId)
  if (!entry) throw new Error('插件不存在。')
  const state = readPluginState()
  const install = state.installs.find((item) => item.entryId === entry.id)
  const action =
    input.action ??
    (!install ? 'install' : install.credentials.some((item) => item.state === 'missing') ? 'configure' : 'upgrade')
  const targetVersion = input.version ?? entry.latestVersion
  const version = entry.versions.find((item) => item.version === targetVersion)
  if (!version) throw new Error(`找不到插件版本 ${targetVersion}。`)
  const affectedWorkflowIds =
    install?.affectedWorkflows ??
    getWorkflowList()
      .filter((workflow) => workflow.status === 'published')
      .slice(0, entry.kind === 'node-pack' ? 2 : 1)
      .map((workflow) => workflow.id)
  const dependencies = version.dependencies.map((item) => ({ ...item }))
  const credentials = entry.credentials.map((credential) => {
    const installed = install?.credentials.find((item) => item.key === credential.key)
    return { ...(installed ?? credential) }
  })
  const blockers: string[] = []
  if (version.verification.checksum === 'missing') blockers.push('缺少 SHA-256 checksum。')
  if (version.verification.checksum === 'mismatch') blockers.push('SHA-256 checksum 与 tarball 不匹配。')
  if (version.verification.signature === 'missing') blockers.push('插件包未签名。')
  if (version.verification.signature === 'invalid') blockers.push('插件包签名校验失败。')
  if (version.verification.licenseBlocked) blockers.push(`许可证 ${version.verification.license} 默认阻断安装。`)
  if (version.deprecated && action !== 'rollback') blockers.push('目标版本已弃用，禁止新安装或升级。')
  dependencies
    .filter((dependency) => dependency.state === 'conflict')
    .forEach((dependency) => blockers.push(`依赖冲突：${dependency.chain ?? dependency.name}`))
  const highRisk = entry.permissions.some((item) => item.highRisk)
  const warnings = [
    ...(credentials.some((item) => item.state === 'missing')
      ? ['安装后将进入需配置状态，补齐凭据前不能启用。']
      : []),
    ...(affectedWorkflowIds.length ? [`${affectedWorkflowIds.length} 个已发布工作流会引用该插件。`] : []),
    ...(version.verification.license === 'MPL-2.0' ? ['MPL-2.0 许可证需管理员确认。'] : []),
  ]
  const plan: PluginInstallPlan = {
    planId: uid('plan'),
    action,
    entryId: entry.id,
    fromVersion: install?.version ?? null,
    toVersion: targetVersion,
    affectedWorkflowIds,
    dependencies,
    permissions: structuredClone(entry.permissions),
    credentials: structuredClone(credentials),
    verification: structuredClone(version.verification),
    deprecated: version.deprecated,
    blockers,
    warnings,
    highRisk,
    idempotencyKey: uid('idem'),
    expiresAt: futureIso(5),
    canInstall: blockers.length === 0,
  }
  state.plans[plan.planId] = plan
  writePluginState(state)
  return structuredClone(plan)
}

/**
 * 重新解析一个已过期或版本变化的安装计划，旧 planId 永不复用。
 */
export function refreshPluginPlan(planId: string): PluginInstallPlan {
  const state = readPluginState()
  const previous = state.plans[planId]
  if (!previous) throw new Error('安装计划不存在，请重新计算。')
  delete state.plans[planId]
  writePluginState(state)
  return createPluginPlan({
    entryId: previous.entryId,
    version: previous.toVersion,
    action: previous.action,
  })
}

/**
 * 按 planId 执行安装或升级。重复幂等键只返回首次结果，不重复写状态。
 */
export function confirmPluginPlan(input: {
  planId: string
  idempotencyKey: string
  highRiskConfirmed: boolean
}): PluginInstall {
  const state = readPluginState()
  const plan = state.plans[input.planId]
  if (!plan) throw new Error('没有有效 planId，禁止安装。')
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('安装计划已过期，请重新计算。')
  if (!plan.canInstall) throw new Error(`安装被阻断：${plan.blockers.join('；')}`)
  if (plan.highRisk && !input.highRiskConfirmed) throw new Error('高风险权限需要显式确认。')
  if (state.idempotency[input.idempotencyKey]) {
    const existing = state.installs.find((item) => item.entryId === plan.entryId)
    if (existing) return structuredClone(existing)
  }
  const entry = getPluginEntry(plan.entryId)
  if (!entry) throw new Error('插件不存在。')
  const current = state.installs.find((item) => item.entryId === plan.entryId)
  const credentials = plan.credentials.map((item) => ({ ...item }))
  const status: PluginInstallStatus = credentials.some((item) => item.state === 'missing')
    ? 'config_required'
    : 'enabled'
  const install: PluginInstall = {
    installId: current?.installId ?? uid('pi'),
    entryId: plan.entryId,
    version: plan.toVersion,
    previousVersion: current?.version,
    enabled: status === 'enabled',
    status,
    affectedWorkflows: plan.affectedWorkflowIds,
    credentials,
    installedAt: current?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (current) {
    Object.assign(current, install)
  } else {
    state.installs.unshift(install)
  }
  state.idempotency[input.idempotencyKey] = plan.planId
  state.audits.unshift({
    id: uid('audit'),
    entryId: plan.entryId,
    action: plan.action === 'install' ? 'install' : plan.action,
    actor: '林一舟',
    at: new Date().toISOString(),
    metadata: {
      planId: plan.planId,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      permissions: plan.permissions.map((item) => item.group),
    },
  })
  delete state.plans[plan.planId]
  writePluginState(state)
  return structuredClone(install)
}

/**
 * 启用或禁用插件。禁用不会删除凭据、权限快照或历史审计。
 */
export function setPluginEnabled(entryId: string, enabled: boolean): PluginInstall {
  const state = readPluginState()
  const install = state.installs.find((item) => item.entryId === entryId)
  if (!install) throw new Error('插件尚未安装。')
  if (enabled && install.credentials.some((item) => item.state === 'missing')) {
    throw new Error('凭据尚未配置，不能启用插件。')
  }
  install.enabled = enabled
  install.status = enabled ? 'enabled' : 'disabled'
  install.updatedAt = new Date().toISOString()
  state.audits.unshift({
    id: uid('audit'),
    entryId,
    action: enabled ? 'enable' : 'disable',
    actor: '林一舟',
    at: install.updatedAt,
    metadata: { credentialsPreserved: install.credentials.length, permissionsPreserved: true },
  })
  writePluginState(state)
  return structuredClone(install)
}

/**
 * 为插件写入新的 secret_ref 掩码，不保存任何明文值。
 */
export function configurePluginCredential(input: {
  entryId: string
  key: string
  secretRef: string
}): PluginInstall {
  const state = readPluginState()
  const install = state.installs.find((item) => item.entryId === input.entryId)
  if (!install) throw new Error('插件尚未安装。')
  const credential = install.credentials.find((item) => item.key === input.key)
  if (!credential) throw new Error('凭据项不存在。')
  if (!input.secretRef.startsWith('secret_ref://')) throw new Error('只能保存 secret_ref，不接受明文密钥。')
  credential.state = 'configured'
  credential.masked = `${input.secretRef.slice(0, 13)}••••••••${input.secretRef.slice(-4)}`
  credential.verifiedAt = new Date().toISOString()
  delete credential.expiresAt
  install.status = 'enabled'
  install.enabled = true
  install.updatedAt = new Date().toISOString()
  state.audits.unshift({
    id: uid('audit'),
    entryId: input.entryId,
    action: 'configure',
    actor: '林一舟',
    at: install.updatedAt,
    metadata: { key: input.key, secretRefOnly: true },
  })
  writePluginState(state)
  return structuredClone(install)
}

/**
 * 回滚到已安装记录中的 previousVersion，并写入独立审计事件。
 */
export function rollbackPlugin(entryId: string): PluginInstall {
  const state = readPluginState()
  const install = state.installs.find((item) => item.entryId === entryId)
  if (!install?.previousVersion) throw new Error('没有可回滚的已验证版本。')
  const fromVersion = install.version
  install.version = install.previousVersion
  install.previousVersion = fromVersion
  install.status = install.credentials.some((item) => item.state === 'missing')
    ? 'config_required'
    : install.enabled
      ? 'enabled'
      : 'disabled'
  install.updatedAt = new Date().toISOString()
  state.audits.unshift({
    id: uid('audit'),
    entryId,
    action: 'rollback',
    actor: '林一舟',
    at: install.updatedAt,
    metadata: { fromVersion, toVersion: install.version },
  })
  writePluginState(state)
  return structuredClone(install)
}

/**
 * 卸载插件。运行历史与审计保留，安装记录从 workspace 活跃列表移除。
 */
export function uninstallPlugin(entryId: string): void {
  const state = readPluginState()
  const install = state.installs.find((item) => item.entryId === entryId)
  if (!install) throw new Error('插件尚未安装。')
  state.installs = state.installs.filter((item) => item.entryId !== entryId)
  state.audits.unshift({
    id: uid('audit'),
    entryId,
    action: 'uninstall',
    actor: '林一舟',
    at: new Date().toISOString(),
    metadata: { historyPreserved: true, affectedWorkflows: install.affectedWorkflows },
  })
  writePluginState(state)
}

/**
 * 校验插件版本是否满足模板声明的最小 semver。
 */
function pluginVersionAvailable(pluginId: string, requiredVersion: string): boolean {
  const install = getPluginInstalls(pluginId).find((item) => item.enabled)
  if (!install) return false
  const required = requiredVersion.replace(/[^0-9.]/g, '')
  return install.version.localeCompare(required, undefined, { numeric: true }) >= 0
}

/**
 * 计算模板依赖清单。缺失密钥和知识库只标记需配置，未知或旧版节点会阻断克隆。
 */
export function inspectTemplateDependencies(template: TemplateEntry): TemplateDependency[] {
  const dependencies: TemplateDependency[] = []
  template.requiredPlugins.forEach((plugin) => {
    const available = pluginVersionAvailable(plugin.id, plugin.version)
    dependencies.push({
      type: 'plugin',
      id: plugin.id,
      label: plugin.name,
      required: plugin.version,
      state: available ? 'available' : 'missing',
      detail: available ? '已启用兼容版本' : '需在插件市场安装或升级后再启用',
    })
  })
  template.requiredModels.forEach((model) => {
    const available = modelConnections.some((connection) => connection.status === 'ready')
    dependencies.push({
      type: 'model',
      id: model.suggested,
      label: model.suggested,
      required: model.capability,
      state: available ? 'available' : 'unconfigured',
      detail: available ? '存在健康模型连接' : '需配置模型连接',
    })
  })
  template.requiredSecrets.forEach((secret) => {
    dependencies.push({
      type: 'secret',
      id: secret.key,
      label: secret.key,
      required: 'secret_ref',
      state: 'unconfigured',
      detail: secret.description,
    })
  })
  template.requiredKnowledge.forEach((knowledge) => {
    const available = knowledgeBases.some(
      (item) => item.name === knowledge.name && item.status === 'ready',
    )
    dependencies.push({
      type: 'knowledge',
      id: knowledge.name,
      label: knowledge.name,
      required: `${knowledge.embeddingDimension} 维`,
      state: available ? 'available' : 'unconfigured',
      detail: available ? '知识库可用' : '需选择同维度知识库或稍后配置',
    })
  })
  template.nodeDependencies.forEach((dependency) => {
    const registration = getNodeRegistration(dependency.type)
    if (!registration) {
      dependencies.push({
        type: 'node',
        id: dependency.type,
        label: dependency.displayName,
        required: dependency.version,
        state: 'missing',
        detail: dependency.pluginId
          ? `需安装插件 ${dependency.pluginId} 并提供节点 ${dependency.type}`
          : `节点 ${dependency.type} 未注册`,
      })
      return
    }
    const compatible = registration.manifest.version.localeCompare(dependency.version, undefined, {
      numeric: true,
    }) >= 0
    if (!compatible) {
      dependencies.push({
        type: 'node',
        id: dependency.type,
        label: dependency.displayName,
        required: dependency.version,
        state: 'incompatible',
        detail: `当前注册版本 ${registration.manifest.version}，模板要求 ${dependency.version}`,
      })
    }
  })
  return dependencies
}

/**
 * 生成 clone plan。没有 planId、存在未知节点、插件节点缺失或版本不兼容时禁止克隆。
 */
export function createTemplateClonePlan(input: {
  template: TemplateEntry
  targetName: string
}): TemplateClonePlan {
  const dependencies = inspectTemplateDependencies(input.template)
  const blockingReasons: string[] = []
  if (input.template.schemaVersion !== '1.0') {
    blockingReasons.push(`模板 schemaVersion ${input.template.schemaVersion} 与当前设计器不兼容。`)
  }
  dependencies
    .filter((dependency) => dependency.type === 'node' && dependency.state !== 'available')
    .forEach((dependency) => blockingReasons.push(dependency.detail))
  if (!input.targetName.trim()) blockingReasons.push('目标工作流名称不能为空。')
  const missingDependencies = dependencies.filter((dependency) => dependency.state !== 'available')
  return {
    planId: uid('clone_plan'),
    templateId: input.template.id,
    version: input.template.version,
    targetName: input.targetName.trim(),
    missingDependencies,
    blockingReasons,
    warnings: [
      ...(missingDependencies.length ? ['克隆后需配置缺失依赖，不会自动安装插件或写入真实密钥。'] : []),
      '每次克隆都会生成新草稿并重映射 nodeId，不覆盖现有工作流。',
    ],
    willAutoInstall: false,
    willWriteSecrets: false,
    expiresAt: futureIso(30),
    canClone: blockingReasons.length === 0,
  }
}

/**
 * 确认模板克隆计划并生成新工作流草稿。
 */
export function cloneTemplate(input: {
  plan: TemplateClonePlan
  template: TemplateEntry
}): TemplateCloneResult {
  if (Date.parse(input.plan.expiresAt) <= Date.now()) throw new Error('克隆计划已过期，请重新生成。')
  if (input.plan.templateId !== input.template.id || input.plan.version !== input.template.version) {
    throw new Error('克隆计划与模板版本不一致，请重新计算。')
  }
  if (!input.plan.canClone) throw new Error(input.plan.blockingReasons.join('；'))
  const workflow = importWorkflowDraft({
    name: input.plan.targetName,
    description: input.template.description,
    tags: [input.template.category, ...input.template.tags].slice(0, 5),
    definition: clonePlain(input.template.definition),
    forkOf: { templateId: input.template.id, version: input.template.version },
  })
  return {
    importId: uid('tpl_import'),
    workflow,
    missingDependencies: input.plan.missingDependencies,
    canPreview: input.plan.blockingReasons.length === 0,
  }
}

/**
 * 为模板详情提供只读画布所需的占位端口，不写入运行历史或真实数据。
 */
export function createTemplatePreviewDraft(template: TemplateEntry): WorkflowDraft {
  return {
    workflowId: `template_${template.id}`,
    name: `${template.name} · 只读预览`,
    description: template.description,
    status: 'published',
    tags: [template.category, ...template.tags],
    revision: 0,
    savedAt: template.updatedAt,
    publishedVersion: Number(template.version.split('.')[0]) || 1,
    publishedVersionId: `template_version_${template.version}`,
    definition: clonePlain(template.definition),
    forkOf: { templateId: template.id, version: template.version },
  }
}

/**
 * 空实现用于只读设计器，显式拒绝任何写操作。
 */
export const readonlyTemplateEdge: EdgeRegistration = {
  type: 'template-readonly',
  label: '只读预览',
  style: { stroke: '#B8BFCD', strokeWidth: 1.5 },
}
