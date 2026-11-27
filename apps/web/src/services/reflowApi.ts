import {
  ApiError,
  apiDelete,
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  apiUpload,
} from '@/api/client'
import type {
  RunEvent,
  RunRecord,
  WorkflowCard,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowVersion,
} from '@/shared/types'

export interface ApiIssue {
  /** 错误码，用于程序化识别问题类别 */
  code: string
  /** 人类可读的错误描述 */
  message: string
  /** 关联的工作流节点 ID（仅节点相关问题时存在） */
  nodeId?: string
  /** 关联的表单字段名（仅字段相关问题时存在） */
  field?: string
}

export interface ReadinessResponse {
  /** 是否就绪（无阻断项时为 true） */
  ready: boolean
  /** 阻断项列表，需全部解决后版本才可运行 */
  blockers: ApiIssue[]
  /** 非阻断的警告列表 */
  warnings: ApiIssue[]
  /** 本次就绪检查覆盖的各类依赖数量统计 */
  checked: {
    /** 检查的模型连接数量 */
    models: number
    /** 检查的知识库数量 */
    knowledgeBases: number
    /** 检查的 MCP 服务数量 */
    mcpServers: number
    /** 检查的工作流节点数量 */
    nodes: number
  }
}

export interface RunCreatedResponse {
  /** 新建运行的 ID */
  runId: string
  /** 运行使用的固定发布版本 ID（非版本运行时可能为空） */
  workflowVersionId?: string
  /** 运行类型（如试运行 / 生产运行） */
  runKind: RunRecord['runKind']
  /** 触发来源（手动 / API / MCP / 定时等） */
  trigger: RunRecord['trigger']
  /** 运行的初始状态 */
  status: RunRecord['status']
  /** 相关资源链接 */
  links: {
    /** 运行详情接口地址 */
    detail: string
    /** 运行事件流接口地址 */
    events: string
  }
}

export interface ModelConnectionDto {
  /** 连接 ID */
  id: string
  /** 供应商标识（如 openai / anthropic） */
  provider: string
  /** 连接显示名称 */
  name: string
  /** 默认模型标识 */
  model: string
  /** API 基础地址 */
  baseUrl: string
  /** 连接健康状态 */
  status: 'healthy' | 'degraded' | 'failed'
  /** 是否为 workspace 默认连接 */
  isDefault: boolean
  /** 是否启用 */
  enabled: boolean
  /** 使用量统计 */
  usage: number
  /** 最近一次探测的延迟（毫秒） */
  latencyMs: number
  /** 模型上下文窗口大小（token 数） */
  contextWindow: number
  /** 模型能力标签列表（如 vision、function-calling） */
  capabilities: string[]
  /** 故障回退顺序（依次回退的连接或模型 ID） */
  fallbackOrder: string[]
  /** 凭据脱敏展示值 */
  credentialMask: string
  /** 凭据状态（有效 / 即将过期 / 缺失） */
  credentialStatus: 'valid' | 'expiring' | 'missing'
  /** 密钥引用（secret:// 路径） */
  secretRef?: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface ModelTestResponse {
  /** 测试是否成功 */
  ok: boolean
  /** 测试请求的往返延迟（毫秒） */
  latencyMs: number
  /** 该连接可用的模型标识列表 */
  models: string[]
  /** 失败时返回的错误详情 */
  error?: ApiIssue
}

export interface KnowledgeBaseDto {
  /** 知识库 ID */
  id: string
  /** 知识库显示名称 */
  name: string
  /** 知识库描述 */
  description: string
  /** 知识库中的文档数量 */
  documents: number
  /** 已生成的切片总数量 */
  chunks: number
  /** 知识库索引状态（就绪 / 索引中 / 失败） */
  status: 'ready' | 'indexing' | 'failed'
  /** 向量化模型标识 */
  embeddingModel: string
  /** 向量维度 */
  dimensions: number
  /** 单个切片的目标长度 */
  chunkSize: number
  /** 相邻切片之间的重叠长度 */
  overlapSize: number
  /** 切片时使用的分隔符 */
  separator: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface KnowledgeDocumentDto {
  /** 文档 ID */
  id: string
  /** 所属知识库 ID（跨库列表场景可能为空） */
  kbId?: string
  /** 原始文件名 */
  name: string
  /** MIME 类型 */
  mime: string
  /** 文件扩展名 */
  extension: string
  /** 人类可读的文件大小 */
  size: string
  /** 文件大小（字节） */
  sizeBytes: number
  /** 已生成的切片数量 */
  chunks: number
  /** 切片策略名称 */
  chunkStrategy: string
  /** 文档处理状态（排队 / 解析 / 切片 / 向量化 / 就绪 / 失败） */
  status: 'queued' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed'
  /** 预览转换状态（未转换 / 转换中 / 就绪 / 失败 / 不支持） */
  previewStatus: 'none' | 'converting' | 'ready' | 'failed' | 'unsupported'
  /** 处理进度（0-100 百分比） */
  progress: number
  /** 失败原因的人类可读描述 */
  error?: string
  /** 失败发生的处理阶段 */
  errorStage?: 'parse' | 'normalize' | 'chunk' | 'embedding' | 'index'
  /** 稳定错误码 */
  errorCode?: string
  /** 该错误是否可通过重试恢复 */
  errorRetryable?: boolean
  /** 附加元数据 */
  metadata?: Record<string, unknown>
  /** 最后更新时间 */
  updatedAt: string
}

export interface KnowledgeIngestJobDto {
  /** 作业 ID */
  id: string
  /** 关联的文档 ID */
  documentId?: string
  /** 关联的文档名称 */
  documentName?: string
  /** 关联文档的当前状态 */
  documentStatus?: string
  /** 作业类型（首次入库 / 重试 / 重建索引） */
  kind: 'ingest' | 'retry' | 'reindex'
  /** 作业状态（排队 / 执行中 / 成功 / 失败 / 已取消） */
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  /** 当前处理阶段（解析 / 归一化 / 切片 / 向量化 / 入索引） */
  stage: 'parse' | 'normalize' | 'chunk' | 'embedding' | 'index'
  /** 已尝试次数 */
  attempt: number
  /** 最大尝试次数 */
  maxAttempts: number
  /** 下次自动重试的时间 */
  nextRetryAt?: string
  /** 稳定错误码 */
  errorCode?: string
  /** 错误描述 */
  errorMessage?: string
  /** 正在执行该作业的 worker 标识 */
  workerId?: string
  /** 作业执行租约到期时间（用于超时回收） */
  leaseExpiresAt?: string
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface KnowledgeUploadResponse {
  /** 上传后的文档记录 */
  document: KnowledgeDocumentDto
  /** 关联的入库处理作业 */
  job: KnowledgeIngestJobDto
}

export interface KnowledgeSearchChunk {
  /** 切片 ID */
  id: string
  /** 所属文档 ID */
  documentId: string
  /** 所属文档名称 */
  documentName: string
  /** 切片在文档中的序号 */
  chunkIndex: number
  /** 命中的文本片段 */
  snippet: string
  /** 切片在原文中的位置描述 */
  location: string
  /** 综合相关性得分 */
  score: number
  /** 向量检索得分 */
  vectorScore?: number
  /** 全文检索得分 */
  fulltextScore?: number
  /** 重排序阶段得分 */
  rerankScore?: number
  /** 切片元数据 */
  metadata: Record<string, unknown>
}

export interface KnowledgeSearchResponse {
  /** 命中的切片列表（按相关性排序） */
  chunks: KnowledgeSearchChunk[]
  /** 引用列表（用于结果溯源） */
  citations: Array<Record<string, unknown>>
  /** 由命中切片拼接成的上下文文本，可直接注入提示词 */
  context: string
  /** 命中总数 */
  total: number
  /** 本次检索是否应用了重排序 */
  rerankApplied: boolean
  /** 实际使用的重排序模型 */
  rerankModel?: string
  /** 检索过程中的警告信息 */
  warnings?: string[]
}

export interface KnowledgeStatsDto {
  /** 文档总数 */
  documents: number
  /** 已就绪的文档数量 */
  ready: number
  /** 处理失败的文档数量 */
  failed: number
  /** 处理中的文档数量 */
  processing: number
  /** 切片总数 */
  chunks: number
  /** 已完成向量化的切片数量 */
  embeddedChunks: number
  /** 向量化模型标识 */
  embeddingModel: string
  /** 向量维度 */
  embeddingDimension: number
}

export interface DocumentChunkDto {
  /** 切片 ID */
  id: string
  /** 所属文档 ID */
  documentId: string
  /** 所属文档名称 */
  documentName: string
  /** 切片在文档中的序号 */
  chunkIndex: number
  /** 切片文本片段 */
  snippet: string
  /** 切片 token 数量 */
  tokenCount?: number
  /** 向量化状态（待处理 / 就绪 / 失败） */
  embeddingStatus: 'pending' | 'ready' | 'failed'
  /** 切片元数据 */
  metadata: Record<string, unknown>
  /** 切片在原文中的位置描述 */
  location: string
}

export interface KnowledgePreviewDto {
  /** 文档 ID */
  documentId: string
  /** 预览类型（如分页文档、表格等） */
  previewKind: string
  /** 预览转换状态 */
  previewStatus: string
  /** 分页预览数据（文档类预览） */
  pages: unknown
  /** 工作表预览数据（表格类预览） */
  sheets: unknown
  /** 预览生成失败的原因 */
  error?: string
}

export type AgentMemoryMode = 'none' | 'conversation' | 'run'

export interface AgentKnowledgeConfig {
  /** 启用检索的知识库 ID 列表 */
  knowledgeBaseIds: string[]
  /** 单次检索返回的最大切片数 */
  topK: number
  /** 相关性得分阈值，低于该值的切片会被过滤 */
  scoreThreshold: number
  /** 检索模式（向量 / 关键词 / 混合） */
  retrievalMode: 'vector' | 'keyword' | 'hybrid'
}

export interface AgentMcpToolConfig {
  /** MCP Server ID */
  serverId: string
  /** 工具原始名称 */
  toolName: string
  /** 覆盖工具原生描述的自定义说明 */
  description?: string
  /** 调用工具时固定的参数模板 */
  parameters?: Record<string, unknown>
}

export interface AgentDefinitionDto {
  /** 系统提示词（Agent 的核心指令） */
  instructions: string
  /** 输入表达式，用于从上游上下文提取输入 */
  inputExpression?: string
  /** 使用的模型连接 ID */
  modelConnectionId: string
  /** 指定模型标识（覆盖连接的默认模型） */
  model?: string
  /** 采样温度 */
  temperature?: number
  /** 单次生成的最大 token 数 */
  maxTokens?: number
  /** 知识库检索配置 */
  knowledge?: AgentKnowledgeConfig
  /** 允许调用的 MCP 工具列表 */
  mcpTools: AgentMcpToolConfig[]
  /** 单次执行的最大步数 */
  maxSteps: number
  /** 执行超时时间（毫秒） */
  timeoutMs: number
  /** 输出结构校验 schema */
  outputSchema?: Record<string, unknown>
  /** 记忆配置 */
  memory: {
    /** 记忆模式（不记忆 / 按会话 / 按运行） */
    mode: AgentMemoryMode
  }
}

export interface AgentDto {
  /** Agent ID */
  id: string
  /** Agent 名称 */
  name: string
  /** Agent 描述 */
  description: string
  /** Agent 定义配置 */
  config: AgentDefinitionDto
  /** 配置修订版本号（配置变更时递增） */
  revision: number
  /** Agent 状态 */
  status: string
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface AgentConversationDto {
  /** 会话 ID */
  id: string
  /** 所属 Agent ID */
  agentId: string
  /** Agent 名称快照（冗余展示用） */
  agentName?: string
  /** 会话创建时固定的 Agent 修订版本号 */
  revision: number
  /** 会话标题 */
  title: string
  /** 会话状态（active / archived 等） */
  status: string
  /** 会话中的消息数量 */
  messageCount: number
  /** 最近一条消息的摘要 */
  preview: string
  /** 最近一条消息的时间 */
  lastMessageAt?: string
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface AgentCitationDto {
  /** 引用记录 ID */
  id?: string
  /** 命中的知识库切片 ID */
  chunkId?: string
  /** 来源文档 ID */
  documentId: string
  /** 来源文档名称 */
  documentName: string
  /** 命中切片的序号 */
  chunkIndex?: number
  /** 命中内容在原文中的位置描述 */
  location?: string
  /** 相关性得分 */
  score?: number
  /** 允许携带的扩展字段 */
  [key: string]: unknown
}

export interface AgentMessageDto {
  /** 消息 ID */
  id: string
  /** 所属会话 ID */
  conversationId: string
  /** 关联的 invocation ID（助手消息的生成调用） */
  invocationId?: string | null
  /** 消息在会话中的序号 */
  seq: number
  /** 消息角色（用户 / 助手 / 系统） */
  role: 'user' | 'assistant' | 'system'
  /** 消息正文 */
  content: string
  /** 消息状态 */
  status: string
  /** 该消息引用的知识库来源 */
  citations: AgentCitationDto[]
  /** token 用量信息 */
  usage: Record<string, unknown>
  /** 生成失败时的错误对象 */
  error?: Record<string, unknown> | null
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface AgentInvocationDto {
  /** invocation ID */
  id: string
  /** 被调用的 Agent ID */
  agentId?: string | null
  /** 所属会话 ID */
  conversationId?: string | null
  /** 关联的工作流运行 ID（作为节点执行时） */
  runId?: string | null
  /** 关联的工作流节点 ID（作为节点执行时） */
  nodeId?: string | null
  /** 调用来源（对话 / 工作流节点 / 外部） */
  kind: 'chat' | 'workflow_node' | 'external'
  /** 调用状态 */
  status: string
  /** 调用时固定的 Agent 定义快照 */
  definitionSnapshot: AgentDefinitionDto
  /** 请求参数 */
  request: Record<string, unknown>
  /** 成功时的结果 */
  result?: Record<string, unknown> | null
  /** 失败时的错误对象 */
  error?: Record<string, unknown> | null
  /** 执行线程 ID（用于跨调用续接上下文） */
  threadId: string
  /** 中断后恢复所用的检查点 ID */
  resumeCheckpointId?: string | null
  /** 已尝试次数 */
  attempts: number
  /** 请求取消的时间 */
  cancelRequestedAt?: string
  /** 正在执行该调用的 worker 标识 */
  workerId?: string | null
  /** 执行租约到期时间（用于超时回收） */
  leaseExpiresAt?: string
  /** 开始执行时间 */
  startedAt?: string
  /** 结束时间 */
  finishedAt?: string
  /** 总耗时（毫秒） */
  durationMs?: number
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface AgentInvocationEventDto {
  /** 事件序号（用于排序与断点续传） */
  seq: number
  /** 事件类型 */
  type: string
  /** 所属 invocation ID */
  invocationId: string
  /** 事件发生时间 */
  at: string
  /** 事件负载内容 */
  payload: Record<string, unknown>
}

export interface AgentMessageAcceptedResponse {
  /** 会话 ID */
  conversationId: string
  /** 已落库的用户消息 ID */
  userMessageId: string
  /** 助手占位消息 ID（等待生成完成） */
  assistantMessageId: string
  /** 新建的 invocation ID */
  invocationId: string
  /** 受理状态 */
  status: string
  /** 事件流订阅地址 */
  events: string
  /** 会话当前的消息列表 */
  messages: AgentMessageDto[]
}

export interface SkillDto {
  /** Skill ID */
  id: string
  /** Skill 名称 */
  name: string
  /** 发布者 */
  publisher: string
  /** 简要说明 */
  summary: string
  /** Skill 类型 */
  type: string
  /** 可见性范围 */
  visibility: string
  /** 当前版本号 */
  version: string
  /** Skill 状态 */
  status: string
}

export interface McpServerDto {
  /** MCP Server ID */
  id: string
  /** Server 显示名称 */
  name: string
  /** URL 友好的唯一标识 */
  slug: string
  /** 服务端点地址 */
  endpoint: string
  /** 传输协议（流式 HTTP / SSE / 标准输入输出） */
  transport: 'streamable-http' | 'sse' | 'stdio'
  /** 健康状态（健康 / 降级 / 离线 / 错误） */
  status: 'healthy' | 'degraded' | 'offline' | 'error'
  /** 是否启用 */
  enabled: boolean
  /** 缓存的工具数量 */
  tools: number
  /** 累计调用次数 */
  calls: number
  /** 最近探测延迟（毫秒） */
  latencyMs: number
  /** 凭据引用（secret:// 路径） */
  secretRef?: string
  /** 允许调用的工具白名单 */
  allowlist: string[]
  /** 最近一次健康检查时间 */
  lastCheckedAt?: string
}

export interface McpToolDto {
  /** 工具 ID */
  id: string
  /** 工具原始名称 */
  name: string
  /** 工具展示名称 */
  title: string
  /** 工具用途描述 */
  description: string
  /** 是否只读（无副作用） */
  readOnly: boolean
  /** 是否具有破坏性 */
  destructive: boolean
  /** 累计调用次数 */
  calls: number
  /** 平均调用延迟（毫秒） */
  latencyMs: number
  /** 工具参数 schema */
  schema: Record<string, unknown>
  /** schema 内容哈希（用于检测工具定义变更） */
  schemaHash: string
  /** 是否启用 */
  enabled: boolean
}

export interface McpCallResponse {
  /** 工具返回的原始结果 */
  result: unknown
  /** 工具返回的结构化内容 */
  structuredContent?: unknown
  /** 工具是否报告了错误 */
  isError: boolean
  /** 调用的用量信息 */
  usage: Record<string, unknown>
  /** 调用耗时（毫秒） */
  durationMs: number
}

export interface McpCallDto {
  /** 调用记录 ID */
  id: string
  /** 调用方向（出站调用外部 Server / 入站被外部客户端调用） */
  direction: 'outbound' | 'inbound'
  /** 出站方向关联的 MCP Server ID */
  serverId?: string
  /** 被调用的工具名称 */
  toolName: string
  /** 关联的工作流运行 ID */
  runId?: string
  /** 入站方向的调用客户端标识 */
  clientId?: string
  /** 调用状态 */
  status: string
  /** 稳定错误码 */
  errorCode?: string
  /** 调用耗时（毫秒） */
  durationMs?: number
  /** 附加元数据（已脱敏） */
  metadata: Record<string, unknown>
  /** 调用发生时间 */
  at: string
}

export interface WorkflowMcpExposureDto {
  /** 暴露配置 ID */
  id: string
  /** 工作流 ID */
  workflowId: string
  /** 工作流名称 */
  workflowName: string
  /** 工作流 slug */
  workflowSlug: string
  /** 暴露所绑定的工作流版本 ID */
  workflowVersionId: string
  /** 暴露所绑定的工作流版本号 */
  workflowVersion: number
  /** 版本定义的 schema 哈希（用于检测版本内容变化） */
  versionSchemaHash: string
  /** 对外暴露的 MCP 工具名称 */
  toolName: string
  /** 工具展示标题 */
  title: string
  /** 工具描述 */
  description: string
  /** 提供给调用方的使用说明 */
  instructions?: string
  /** 输入参数 schema */
  inputSchema: Record<string, unknown>
  /** 输出模式（纯文本 / 结构化） */
  outputMode: 'text' | 'structured'
  /** 可见性（私有 / 公开） */
  visibility: 'private' | 'public'
  /** 认证方式（无 / Bearer / API Key / OAuth2） */
  authMode: 'none' | 'bearer' | 'api-key' | 'oauth2'
  /** 访问令牌状态（无需令牌 / 有效 / 缺失） */
  tokenStatus: 'not_required' | 'active' | 'missing'
  /** 脱敏后的令牌预览 */
  tokenMasked?: string
  /** 令牌作用域列表 */
  scopes: string[]
  /** 凭证过期时间 */
  expiresAt?: string
  /** 单次调用超时时间（毫秒） */
  timeoutMs: number
  /** 最大并发调用数 */
  maxConcurrency: number
  /** 限流配置 */
  rateLimit: Record<string, unknown>
  /** 是否启用 */
  enabled: boolean
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface WorkflowMcpExposureResponse {
  /** 工作流 ID */
  workflowId: string
  /** 工作流名称 */
  workflowName: string
  /** 是否已配置 MCP 暴露 */
  configured: boolean
  /** 暴露配置详情（未配置时为 null） */
  exposure: WorkflowMcpExposureDto | null
}

export interface McpAccessTokenDto {
  /** 令牌记录 ID */
  id: string
  /** 令牌名称 */
  name: string
  /** 脱敏提示（仅展示部分明文） */
  maskedHint: string
  /** 关联的入站暴露配置 ID */
  exposureId: string
  /** 关联的工作流 ID */
  workflowId?: string
  /** 关联的工具名称 */
  toolName: string
  /** 令牌作用域列表 */
  scopes: string[]
  /** 令牌状态（有效 / 过期 / 已撤销 / 已禁用） */
  state: 'active' | 'expired' | 'revoked' | 'disabled'
  /** 令牌过期时间 */
  expiresAt?: string
  /** 令牌撤销时间 */
  revokedAt?: string
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface TemplateVersionDto {
  /** 模板版本 ID */
  id: string
  /** 版本号 */
  version: string
  /** 版本发布时间 */
  createdAt: string
  /** 工作流定义的 schema 版本 */
  schemaVersion: string
  /** 版本变更说明 */
  changelog: string
  /** 该版本依赖的插件列表 */
  requiredPlugins: unknown[]
  /** 该版本依赖的模型列表 */
  requiredModels: unknown[]
  /** 该版本依赖的密钥列表 */
  requiredSecrets: unknown[]
  /** 该版本依赖的知识库列表 */
  requiredKnowledge: unknown[]
  /** 该版本依赖的节点类型列表 */
  nodeDependencies: Array<{
    /** 节点类型标识 */
    type: string
    /** 节点版本 */
    version: string
    /** 节点显示名称 */
    displayName: string
    /** 节点来源的插件 ID */
    pluginId?: string
  }>
  /** 该版本的工作流定义快照 */
  definition: WorkflowDefinition
  /** 画布预览图数据 */
  previewGraph: Record<string, unknown>
  /** 版本清单 */
  manifest: Record<string, unknown>
}

export interface TemplateDto {
  /** 模板 ID */
  id: string
  /** 模板名称 */
  name: string
  /** 作者 */
  author: string
  /** 模板描述 */
  description: string
  /** 模板分类 */
  category: string
  /** 标签列表 */
  tags: string[]
  /** 许可证类型 */
  license: string
  /** 可见性范围 */
  visibility: string
  /** 累计安装次数 */
  installs: number
  /** 是否精选推荐 */
  featured: boolean
  /** 图标标识 */
  icon: string
  /** 主题强调色 */
  accent: string
  /** 最后更新时间 */
  updatedAt: string
  /** 最新版本号 */
  latestVersion: string
  /** 历史版本列表 */
  versions: TemplateVersionDto[]
  /** 最新版本的工作流定义 */
  definition: WorkflowDefinition
  /** 画布预览图数据 */
  previewGraph: Record<string, unknown>
  /** 使用示例 */
  examples: Record<string, unknown>
}

export interface TemplateClonePlanDto {
  /** 克隆计划 ID（执行克隆时需携带） */
  planId: string
  /** 来源模板 ID */
  templateId: string
  /** 目标模板版本号 */
  version: string
  /** 克隆生成的新工作流名称 */
  targetName: string
  /** 克隆将引入的依赖列表 */
  dependencies: Array<Record<string, unknown>>
  /** 当前 workspace 缺失的依赖列表 */
  missingDependencies: Array<Record<string, unknown>>
  /** 非阻断的警告信息 */
  warnings: string[]
  /** 无法执行克隆的阻断原因 */
  blockingReasons: string[]
  /** 是否会自动安装依赖（固定为 false，需人工确认） */
  willAutoInstall: false
  /** 是否会写入密钥（固定为 false，需人工配置） */
  willWriteSecrets: false
  /** 是否可以执行克隆 */
  canClone: boolean
  /** 计划过期时间 */
  expiresAt: string
}

export interface RegistryVersionDto {
  /** 版本号 */
  version: string
  /** 版本发布时间 */
  releasedAt: string
  /** 兼容性说明 */
  compatibility: string
  /** 所需引擎版本 */
  engine: string
  /** 定义 schema 版本 */
  schemaVersion: string
  /** 包大小（人类可读） */
  size: string
  /** 是否已废弃 */
  deprecated: boolean
  /** 版本变更日志 */
  changelog: string
  /** 依赖的其他插件列表 */
  dependencies: Array<{
    /** 依赖插件 ID */
    id: string
    /** 依赖插件名称 */
    name: string
    /** 依赖插件版本 */
    version: string
  }>
  /** 包完整性校验信息 */
  verification: {
    /** 校验和状态（一致 / 缺失 / 不匹配） */
    checksum: 'ok' | 'missing' | 'mismatch'
    /** 签名状态（已验证 / 缺失 / 无效） */
    signature: 'verified' | 'missing' | 'invalid'
    /** 许可证类型 */
    license: string
    /** 许可证是否被策略阻止 */
    licenseBlocked: boolean
  }
  /** 版本清单 */
  manifest: Record<string, unknown>
  /** 包校验和 */
  checksum: string
  /** 包签名值 */
  signature?: string
  /** 许可证类型 */
  license: string
}

export interface RegistryEntryDto {
  /** registry 条目 ID */
  id: string
  /** 插件名称 */
  name: string
  /** 发布者 */
  publisher: string
  /** 简要说明 */
  summary: string
  /** 详细描述 */
  description: string
  /** 插件类别（工具 / 工具包 / 模型 / 数据源 / 触发器 / 节点包） */
  kind: PluginKindDto
  /** 最新版本号 */
  latestVersion: string
  /** 图标标识 */
  icon: string
  /** 主题强调色 */
  accent: string
  /** 可见性范围 */
  visibility?: string
  /** 是否通过官方认证 */
  verified: boolean
  /** 累计安装次数 */
  installs: number
  /** 最后更新时间 */
  updatedAt: string
  /** 插件能力标签列表 */
  capabilities: string[]
  /** 插件所需的权限列表 */
  permissions: PluginPermissionDto[]
  /** 插件所需的凭据列表 */
  credentials: PluginCredentialDto[]
  /** 插件提供的工具列表 */
  tools: Array<{
    /** 工具名称 */
    name: string
    /** 工具描述 */
    description: string
    /** 工具对应的节点类型 */
    nodeType?: string
  }>
  /** 附加元数据 */
  metadata?: Record<string, unknown>
  /** 全部可用版本列表 */
  versions: RegistryVersionDto[]
  /** 当前 workspace 的安装信息（未安装时不存在） */
  install?: {
    /** 安装 ID */
    installId: string
    /** 已安装的版本号 */
    version: string
    /** 是否启用 */
    enabled: boolean
    /** 安装状态 */
    status: string
  }
}

export type PluginKindDto =
  | 'tool'
  | 'toolkit'
  | 'model'
  | 'datasource'
  | 'trigger'
  | 'node-pack'

export type PluginCredentialDto = {
  /** 凭据键名 */
  key: string
  /** 认证类型（API Key / OAuth / Bearer） */
  authType: 'api-key' | 'oauth' | 'bearer'
  /** 凭据状态（缺失 / 已配置 / 即将过期） */
  state: 'missing' | 'configured' | 'expiring'
  /** 脱敏后的凭据预览 */
  masked?: string
  /** 凭据过期时间 */
  expiresAt?: string
  /** 上次验证通过时间 */
  verifiedAt?: string
  /** 是否必需 */
  required: boolean
}

export type PluginPermissionDto = {
  /** 权限分组（网络 / 文件 / 密钥 / MCP / 代码 / 资源） */
  group: 'network' | 'files' | 'secrets' | 'mcp' | 'code' | 'resources'
  /** 权限显示名称 */
  label: string
  /** 权限值列表（如具体域名或路径） */
  values: string[]
  /** 是否高风险权限 */
  highRisk: boolean
}

export interface PluginInstallDto {
  /** 安装 ID */
  installId: string
  /** registry 条目 ID */
  entryId: string
  /** 插件名称 */
  name: string
  /** 已安装版本号 */
  version: string
  /** 升级 / 回滚前的版本号 */
  previousVersion?: string
  /** 安装状态 */
  status: string
  /** 是否启用 */
  enabled: boolean
  /** 凭据配置列表 */
  credentials: PluginCredentialDto[]
  /** 已授权的权限快照 */
  permissions: Record<string, unknown>
  /** 受该安装影响的工作流列表 */
  affectedWorkflows: unknown[]
  /** 安装时间 */
  installedAt: string
  /** 最后更新时间 */
  updatedAt: string
}

export interface PluginInstallPlanDto extends Record<string, unknown> {
  /** 计划 ID（执行安装时需携带） */
  planId: string
  /** 计划动作（安装 / 升级 / 回滚） */
  action: 'install' | 'upgrade' | 'rollback'
  /** registry 条目 ID */
  entryId: string
  /** 已有安装的 ID（升级 / 回滚时存在） */
  installId?: string
  /** 当前版本（尚未安装时为 null） */
  fromVersion: string | null
  /** 目标版本号 */
  toVersion: string
  /** 受影响的工作流 ID 列表 */
  affectedWorkflowIds: string[]
  /** 依赖解析结果列表 */
  dependencies: Array<{
    /** 依赖条目 ID */
    id: string
    /** 依赖名称 */
    name: string
    /** 依赖版本 */
    version: string
    /** 解析状态（可用 / 缺失 / 冲突） */
    state: 'available' | 'missing' | 'conflict'
    /** 完整依赖链描述 */
    chain?: string
  }>
  /** 所需权限列表 */
  permissions: PluginPermissionDto[]
  /** 所需凭据列表 */
  credentials: PluginCredentialDto[]
  /** 包完整性校验信息 */
  verification: {
    /** 校验和状态（一致 / 缺失 / 不匹配） */
    checksum: 'ok' | 'missing' | 'mismatch'
    /** 签名状态（已验证 / 缺失 / 无效） */
    signature: 'verified' | 'missing' | 'invalid'
    /** 许可证类型 */
    license: string
    /** 许可证是否被策略阻止 */
    licenseBlocked: boolean
  }
  /** 目标版本是否已废弃 */
  deprecated: boolean
  /** 无法执行安装的阻断原因 */
  blockers: string[]
  /** 非阻断的警告信息 */
  warnings: string[]
  /** 是否高风险操作（需二次确认） */
  highRisk: boolean
  /** 执行安装时必须携带的幂等键 */
  idempotencyKey: string
  /** 计划过期时间 */
  expiresAt: string
  /** 是否可以执行安装 */
  canInstall: boolean
}

export interface PluginAuditDto {
  /** 审计事件 ID */
  id: string
  /** 关联的安装 ID */
  installId?: string
  /** 关联的 registry 条目 ID */
  entryId: string
  /** 审计动作类型（安装 / 升级 / 启停等） */
  action: string
  /** 操作者标识 */
  actor: string
  /** 事件发生时间 */
  at: string
  /** 附加信息 */
  metadata: Record<string, unknown>
}

/**
 * 查询当前 workspace 的工作流卡片。
 *
 * @returns 真实工作流列表。
 */
export function listWorkflows() {
  return apiGet<WorkflowCard[]>('/api/workflows')
}

/**
 * 查询单个工作流草稿。
 *
 * @param workflowId 外部工作流 ID。
 * @returns 工作流草稿。
 */
export function getWorkflow(workflowId: string) {
  return apiGet<WorkflowDraft>(`/api/workflows/${workflowId}`)
}

/**
 * 创建空白工作流。
 *
 * @param input 名称与描述。
 * @returns 新草稿。
 */
export function createWorkflow(input: { name: string; description?: string }) {
  return apiPost<WorkflowDraft>('/api/workflows', input)
}

/**
 * 更新工作流元数据。
 *
 * @param workflowId 外部工作流 ID。
 * @param input 名称、描述、标签或定义。
 * @returns 更新后的草稿。
 */
export function updateWorkflow(
  workflowId: string,
  input: {
    name?: string
    description?: string
    tags?: string[]
    definition?: WorkflowDefinition
    revision?: number
  },
) {
  return apiPatch<WorkflowDraft>(`/api/workflows/${workflowId}`, input)
}

/**
 * 归档工作流。
 *
 * @param workflowId 外部工作流 ID。
 * @returns 归档确认。
 */
export function archiveWorkflow(workflowId: string) {
  return apiDelete<{ archived: true }>(`/api/workflows/${workflowId}`)
}

/**
 * 复制工作流为新的草稿。
 *
 * @param workflowId 源工作流 ID。
 * @returns 新草稿。
 */
export function duplicateWorkflow(workflowId: string) {
  return apiPost<WorkflowDraft>(`/api/workflows/${workflowId}/duplicate`)
}

/**
 * 查询固定发布版本。
 *
 * @param workflowId 外部工作流 ID。
 * @returns 版本列表。
 */
export function listWorkflowVersions(workflowId: string) {
  return apiGet<WorkflowVersion[]>(`/api/workflows/${workflowId}/versions`)
}

/**
 * 查询指定发布版本。
 *
 * @param workflowId 外部工作流 ID。
 * @param versionId 外部版本 ID。
 * @returns 固定版本快照。
 */
export function getWorkflowVersion(workflowId: string, versionId: string) {
  return apiGet<WorkflowVersion>(
    `/api/workflows/${workflowId}/versions/${versionId}`,
  )
}

/**
 * 查询固定版本的依赖就绪状态。
 *
 * @param workflowId 外部工作流 ID。
 * @param versionId 外部版本 ID。
 * @returns 阻断项、警告和检查计数。
 */
export function getWorkflowReadiness(workflowId: string, versionId: string) {
  return apiGet<ReadinessResponse>(
    `/api/workflows/${workflowId}/versions/${versionId}/readiness`,
  )
}

/**
 * 创建固定发布版本的真实试运行。
 *
 * @param workflowId 外部工作流 ID。
 * @param input 版本、触发与输入。
 * @returns 入队运行摘要。
 */
export function createProductionRun(
  workflowId: string,
  input: {
    workflowVersionId: string
    trigger: 'manual_trial' | 'api' | 'mcp' | 'webhook' | 'schedule' | 'event'
    input: Record<string, unknown>
    options?: { timeoutMs?: number }
  },
  idempotencyKey?: string,
) {
  return apiPost<RunCreatedResponse>(
    `/api/workflows/${workflowId}/runs`,
    input,
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  )
}

/**
 * 查询运行列表。
 *
 * @param query 工作流、版本、状态、类型、触发和关键词。
 * @returns 运行记录。
 */
export function listRuns(query?: {
  workflowId?: string
  versionId?: string
  status?: string
  kind?: string
  trigger?: string
  search?: string
  limit?: number
}) {
  return apiGet<RunRecord[]>('/api/runs', query)
}

/**
 * 查询单次运行详情。
 *
 * @param runId 外部运行 ID。
 * @returns 运行记录。
 */
export function getRun(runId: string) {
  return apiGet<RunRecord>(`/api/runs/${runId}`)
}

/**
 * 分页查询运行事件。
 *
 * @param runId 外部运行 ID。
 * @param afterSeq 起始序号。
 * @param limit 最大条数。
 * @returns 已落库事件。
 */
export function listRunEvents(runId: string, afterSeq = 0, limit = 1000) {
  return apiGet<RunEvent[]>(`/api/runs/${runId}/events/page`, {
    after: afterSeq,
    limit,
  })
}

/**
 * 请求取消运行。
 *
 * @param runId 外部运行 ID。
 * @returns 最新运行状态。
 */
export function cancelRun(runId: string) {
  return apiPost<{ runId: string; status: RunRecord['status'] }>(
    `/api/runs/${runId}/cancel`,
  )
}

/**
 * 使用原定义快照和输入创建重放运行。
 *
 * @param runId 原运行 ID。
 * @returns 新运行摘要。
 */
export function replayRun(runId: string) {
  return apiPost<RunCreatedResponse>(`/api/runs/${runId}/replay`)
}

/**
 * 查询模型连接目录。
 *
 * @returns 模型连接列表。
 */
export function listModelConnections() {
  return apiGet<ModelConnectionDto[]>('/api/model-connections')
}

/**
 * 创建模型连接。
 *
 * @param input 连接配置与 secret_ref。
 * @returns 新连接。
 */
export function createModelConnection(input: {
  name: string
  provider: string
  baseUrl?: string | null
  defaultModel: string
  contextWindow: number
  capabilities: string[]
  secretRef: string
  fallbackOrder?: string[]
}) {
  return apiPost<ModelConnectionDto>('/api/model-connections', input)
}

/**
 * 更新模型连接。
 *
 * @param connectionId 模型连接 ID。
 * @param input 修改字段。
 * @returns 更新后的连接。
 */
export function updateModelConnection(
  connectionId: string,
  input: Partial<{
    name: string
    provider: string
    baseUrl: string | null
    defaultModel: string
    contextWindow: number
    capabilities: string[]
    fallbackOrder: string[]
    isDefault: boolean
    enabled: boolean
    secretRef: string
  }>,
) {
  return apiPatch<ModelConnectionDto>(
    `/api/model-connections/${connectionId}`,
    input,
  )
}

/**
 * 删除模型连接。
 *
 * @param connectionId 模型连接 ID。
 * @returns 删除确认。
 */
export function deleteModelConnection(connectionId: string) {
  return apiDelete<{ deleted: true }>(`/api/model-connections/${connectionId}`)
}

/**
 * 测试模型连接。
 *
 * @param connectionId 模型连接 ID。
 * @returns 延迟、模型和错误。
 */
export function testModelConnection(connectionId: string) {
  return apiPost<ModelTestResponse>(`/api/model-connections/${connectionId}/test`)
}

/**
 * 查询模型连接可用模型。
 *
 * @param connectionId 模型连接 ID。
 * @returns 模型标识列表。
 */
export function listConnectionModels(connectionId: string) {
  return apiGet<Array<{ id: string; capabilities: string[] }>>(
    `/api/model-connections/${connectionId}/models`,
  )
}

/**
 * 查询知识库列表。
 *
 * @returns 知识库统计。
 */
export function listKnowledgeBases(query?: {
  search?: string
  status?: string
}) {
  return apiGet<KnowledgeBaseDto[]>('/api/knowledge-bases', query)
}

/**
 * 创建知识库。
 *
 * @param input 名称、描述和 embedding 配置。
 * @returns 新知识库。
 */
export function createKnowledgeBase(input: {
  name: string
  description?: string
  embeddingProvider?: string
  embeddingModel?: string
  embeddingDimension?: number
}) {
  return apiPost<KnowledgeBaseDto>('/api/knowledge-bases', input)
}

/**
 * 查询单个知识库。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @returns 知识库统计。
 */
export function getKnowledgeBase(knowledgeBaseId: string) {
  return apiGet<KnowledgeBaseDto>(`/api/knowledge-bases/${knowledgeBaseId}`)
}

/**
 * 更新知识库名称或描述。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @param input 修改字段。
 * @returns 更新后的知识库。
 */
export function updateKnowledgeBase(
  knowledgeBaseId: string,
  input: {
    name?: string
    description?: string
    chunkSize?: number
    overlapSize?: number
    separator?: string
  },
) {
  return apiPatch<KnowledgeBaseDto>(`/api/knowledge-bases/${knowledgeBaseId}`, input)
}

/**
 * 删除知识库。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @returns 删除确认。
 */
export function deleteKnowledgeBase(knowledgeBaseId: string) {
  return apiDelete<{ deleted: true }>(`/api/knowledge-bases/${knowledgeBaseId}`)
}

/**
 * 查询知识库文档。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @returns 文档列表。
 */
export function listKnowledgeDocuments(knowledgeBaseId: string) {
  return apiGet<KnowledgeDocumentDto[]>(
    `/api/knowledge-bases/${knowledgeBaseId}/documents`,
  )
}

/**
 * 上传文档到知识库。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @param file 待上传文件。
 * @returns 上传后文档记录。
 */
export function uploadKnowledgeDocument(knowledgeBaseId: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return apiUpload<KnowledgeUploadResponse>(
    `/api/knowledge-bases/${knowledgeBaseId}/documents`,
    formData,
  )
}

/**
 * 查询单个文档详情。
 *
 * @param documentId 文档 ID。
 * @returns 文档详情。
 */
export function getKnowledgeDocument(documentId: string) {
  return apiGet<KnowledgeDocumentDto>(`/api/documents/${documentId}`)
}

/**
 * 删除文档及其切片。
 *
 * @param documentId 文档 ID。
 * @returns 删除确认。
 */
export function deleteKnowledgeDocument(documentId: string) {
  return apiDelete<{ deleted: true }>(`/api/documents/${documentId}`)
}

/**
 * 重试失败阶段的文档 ingest。
 *
 * @param documentId 文档 ID。
 * @returns ingest 状态。
 */
export function retryKnowledgeDocument(documentId: string) {
  return apiPost<KnowledgeIngestJobDto>(`/api/documents/${documentId}/retry`)
}

/**
 * 重建文档索引。
 *
 * @param documentId 文档 ID。
 * @returns 重建任务状态。
 */
export function reindexKnowledgeDocument(documentId: string) {
  return apiPost<KnowledgeIngestJobDto>(`/api/documents/${documentId}/reindex`)
}

/**
 * 查询知识库入库作业详情。
 *
 * @param jobId 外部作业 ID。
 * @returns 作业状态、阶段和稳定错误。
 */
export function getKnowledgeIngestJob(jobId: string) {
  return apiGet<KnowledgeIngestJobDto>(`/api/knowledge-ingest-jobs/${jobId}`)
}

/**
 * 取消尚未完成的知识库入库作业。
 *
 * @param jobId 外部作业 ID。
 * @returns 最新作业状态。
 */
export function cancelKnowledgeIngestJob(jobId: string) {
  return apiPost<KnowledgeIngestJobDto>(
    `/api/knowledge-ingest-jobs/${jobId}/cancel`,
  )
}

/**
 * 执行知识库混合检索。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @param input 查询和检索参数。
 * @returns 切片、引用和上下文。
 */
export function searchKnowledge(
  knowledgeBaseId: string,
  input: {
    query: string
    topK?: number
    scoreThreshold?: number
    retrievalMode?: 'vector' | 'keyword' | 'hybrid'
    rerank?: { enabled: boolean }
  },
) {
  return apiPost<KnowledgeSearchResponse>(
    `/api/knowledge-bases/${knowledgeBaseId}/search`,
    input,
  )
}

/**
 * 查询文档切片。
 *
 * @param documentId 文档 ID。
 * @returns chunk 列表。
 */
export function listDocumentChunks(documentId: string) {
  return apiGet<DocumentChunkDto[]>(`/api/documents/${documentId}/chunks`)
}

/**
 * 查询知识库聚合统计。
 *
 * @param knowledgeBaseId 知识库 ID。
 * @returns 文档、切片和失败状态统计。
 */
export function getKnowledgeStats(knowledgeBaseId: string) {
  return apiGet<KnowledgeStatsDto>(`/api/knowledge-bases/${knowledgeBaseId}/stats`)
}

/**
 * 查询文档预览描述。
 *
 * @param documentId 文档 ID。
 * @returns 预览状态、页和工作表元数据。
 */
export function getKnowledgePreview(documentId: string) {
  return apiGet<KnowledgePreviewDto>(`/api/documents/${documentId}/preview`)
}

/**
 * 获取文档原始附件，用于原件预览。
 *
 * @param documentId 文档 ID。
 * @returns 原始文件 Blob。
 */
export function getKnowledgeSource(documentId: string) {
  return apiGetBlob(`/api/documents/${documentId}/source`)
}

/**
 * 查询 P1 Skills 目录。
 *
 * @returns Skills 目录条目。
 */
export function listSkills() {
  return apiGet<SkillDto[]>('/api/skills')
}

/**
 * 查询 MCP 出站连接。
 *
 * @returns MCP Server 列表。
 */
export function listMcpServers() {
  return apiGet<McpServerDto[]>('/api/mcp/servers')
}

/**
 * 创建 MCP Server。
 *
 * @param input 连接与安全配置。
 * @returns 新 Server。
 */
export function createMcpServer(input: {
  name: string
  slug: string
  transport: 'streamable-http' | 'sse' | 'stdio'
  endpoint?: string
  command?: string
  secretRef?: string
  allowlist?: string[]
}) {
  return apiPost<McpServerDto>('/api/mcp/servers', input)
}

/**
 * 更新 MCP Server 配置。
 *
 * @param serverId MCP Server ID。
 * @param input 修改字段。
 * @returns 更新后的 Server。
 */
export function updateMcpServer(
  serverId: string,
  input: Partial<{
    name: string
    slug: string
    transport: McpServerDto['transport']
    endpoint: string
    secretRef: string
    allowlist: string[]
    enabled: boolean
  }>,
) {
  return apiPatch<McpServerDto>(`/api/mcp/servers/${serverId}`, input)
}

/**
 * 删除 MCP Server。
 *
 * @param serverId MCP Server ID。
 * @returns 删除确认。
 */
export function deleteMcpServer(serverId: string) {
  return apiDelete<{ deleted: true }>(`/api/mcp/servers/${serverId}`)
}

/**
 * 测试 MCP 连接并刷新工具缓存。
 *
 * @param serverId MCP Server ID。
 * @returns 健康状态和工具数。
 */
export function testMcpServer(serverId: string) {
  return apiPost<{
    ok: boolean
    latencyMs: number
    protocolVersion?: string
    toolCount: number
    error?: ApiIssue
  }>(`/api/mcp/servers/${serverId}/test`)
}

/**
 * 查询 MCP 工具缓存。
 *
 * @param serverId MCP Server ID。
 * @returns 工具 schema 与 annotation。
 */
export function listMcpTools(serverId: string) {
  return apiGet<McpToolDto[]>(`/api/mcp/servers/${serverId}/tools`)
}

/**
 * 执行一次不写工作流的 MCP 测试调用。
 *
 * @param serverId MCP Server ID。
 * @param toolName 工具原始名称。
 * @param args 工具参数。
 * @returns 标准化调用结果。
 */
export function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  return apiPost<McpCallResponse>(
    `/api/mcp/servers/${serverId}/tools/${toolName}/test`,
    { arguments: args },
  )
}

/**
 * 查询 MCP 出站与入站调用审计。
 *
 * @param query 方向、状态、工具、客户端和条数。
 * @returns 已脱敏调用记录。
 */
export function listMcpCalls(query?: {
  direction?: 'outbound' | 'inbound'
  status?: string
  tool?: string
  client?: string
  limit?: number
}) {
  return apiGet<McpCallDto[]>('/api/mcp/calls', query)
}

/**
 * 查询工作流入站 MCP 暴露配置。
 *
 * @param workflowId 外部工作流 ID。
 * @returns 工作流摘要与可选暴露。
 */
export function getWorkflowMcpExposure(workflowId: string) {
  return apiGet<WorkflowMcpExposureResponse>(
    `/api/workflows/${workflowId}/mcp-exposure`,
  )
}

/**
 * 创建或更新工作流入站 MCP 暴露。
 *
 * @param workflowId 外部工作流 ID。
 * @param input 固定版本、工具、认证与限制。
 * @returns 更新后的暴露。
 */
export function upsertWorkflowMcpExposure(
  workflowId: string,
  input: {
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
  },
) {
  return apiPost<WorkflowMcpExposureDto>(
    `/api/workflows/${workflowId}/mcp-exposure`,
    input,
  )
}

/**
 * 轮换工作流入站 MCP 访问令牌。
 *
 * @param workflowId 外部工作流 ID。
 * @param input 新令牌、作用域和过期时间。
 * @returns 不含明文的轮换结果。
 */
export function rotateWorkflowMcpToken(
  workflowId: string,
  input: {
    token: string
    scopes?: Array<'workflow:run' | 'run:read' | 'run:cancel'>
    expiresAt?: string | null
  },
) {
  return apiPost<Record<string, unknown>>(
    `/api/workflows/${workflowId}/mcp-exposure/rotate-token`,
    input,
  )
}

/**
 * 查询入站 MCP 访问令牌元数据。
 *
 * @returns 不含明文的凭据列表。
 */
export function listMcpAccessTokens() {
  return apiGet<McpAccessTokenDto[]>('/api/mcp/access-tokens')
}

/**
 * 为指定入站暴露创建访问令牌。
 *
 * @param input 暴露 ID、令牌、作用域和过期时间。
 * @returns 不含明文的令牌元数据。
 */
export function createMcpAccessToken(input: {
  exposureId: string
  token: string
  scopes?: Array<'workflow:run' | 'run:read' | 'run:cancel'>
  expiresAt?: string | null
}) {
  return apiPost<Record<string, unknown>>('/api/mcp/access-tokens', input)
}

/**
 * 查询模板市场目录。
 *
 * @returns 模板详情列表。
 */
export function listTemplates() {
  return apiGet<TemplateDto[]>('/api/templates')
}

/**
 * 查询模板详情。
 *
 * @param templateId 模板 ID。
 * @returns 模板版本与依赖。
 */
export function getTemplate(templateId: string) {
  return apiGet<TemplateDto>(`/api/templates/${templateId}`)
}

/**
 * 计算模板克隆计划。
 *
 * @param templateId 模板 ID。
 * @param input 目标名称与版本。
 * @returns 依赖、冲突和确认信息。
 */
export function createTemplateClonePlan(
  templateId: string,
  input: { targetName: string; version?: string },
) {
  return apiPost<TemplateClonePlanDto>(
    `/api/templates/${templateId}/clone-plan`,
    input,
  )
}

/**
 * 按 clone plan 创建新草稿。
 *
 * @param templateId 模板 ID。
 * @param input planId 与目标名称。
 * @returns 导入结果。
 */
export function cloneTemplate(
  templateId: string,
  input: { planId: string; targetName: string; version: string },
  idempotencyKey?: string,
) {
  return apiPost<{
    importId: string
    workflow: WorkflowDraft
    missingDependencies: unknown[]
    warnings: string[]
    canPreview: boolean
  }>(
    `/api/templates/${templateId}/clone`,
    input,
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  )
}

/**
 * 使用工作流校验接口验证任意定义，不读取草稿也不写入数据库。
 *
 * @param workflowId 任意可见工作流 ID。
 * @param definition 待校验定义。
 * @returns 结构化校验结果。
 */
export function validateWorkflowDefinition(
  workflowId: string,
  definition: WorkflowDefinition,
) {
  return apiPost<Record<string, unknown>>(
    `/api/workflows/${workflowId}/validate`,
    { definition },
  )
}

/**
 * 查询插件 registry 条目。
 *
 * @param query kind、关键词和分页条件。
 * @returns 插件条目与版本。
 */
export function listRegistryEntries(query?: {
  kind?: string
  search?: string
  limit?: number
}) {
  return apiGet<RegistryEntryDto[]>('/api/registry/entries', query)
}

/**
 * 查询插件 registry 条目详情。
 *
 * @param entryId registry entry ID。
 * @returns 插件条目与全部版本。
 */
export function getRegistryEntry(entryId: string) {
  return apiGet<RegistryEntryDto>(`/api/registry/entries/${entryId}`)
}

/**
 * 查询当前 workspace 的插件安装。
 *
 * @returns 安装记录、凭据和权限快照。
 */
export function listPluginInstalls() {
  return apiGet<PluginInstallDto[]>('/api/plugin-installs')
}

/**
 * 计算插件安装、升级或回滚计划。
 *
 * @param input entryId、动作和目标版本。
 * @returns planId、依赖、权限和阻断项。
 */
export function createPluginInstallPlan(input: {
  entryId: string
  action: 'install' | 'upgrade' | 'rollback'
  version: string
}) {
  return apiPost<PluginInstallPlanDto>('/api/registry/install-plan', input)
}

/**
 * 按已确认计划安装插件。
 *
 * @param input planId、幂等键和高风险确认。
 * @returns 安装记录。
 */
export function installPlugin(
  input: { planId: string; idempotencyKey: string; highRiskConfirmed: boolean },
) {
  return apiPost<PluginInstallDto>('/api/plugin-installs', input, {
    'Idempotency-Key': input.idempotencyKey,
  })
}

/**
 * 启用或禁用插件安装。
 *
 * @param installId 安装 ID。
 * @param enabled 目标状态。
 * @returns 更新后的安装记录。
 */
export function setPluginInstallEnabled(installId: string, enabled: boolean) {
  return apiPatch<PluginInstallDto>(`/api/plugin-installs/${installId}`, {
    enabled,
  })
}

/**
 * 配置插件必需凭据，只提交 secret:// 引用。
 *
 * @param installId 安装 ID。
 * @param credentials 凭据 key 与 secret_ref。
 * @returns 更新后的安装。
 */
export function configurePluginCredentials(
  installId: string,
  credentials: Array<{
    key: string
    secretRef: string
    authType?: 'api-key' | 'oauth' | 'bearer'
  }>,
) {
  return apiPatch<PluginInstallDto>(`/api/plugin-installs/${installId}`, {
    credentials,
  })
}

/**
 * 按一次性升级计划切换插件版本。
 *
 * @param installId 安装 ID。
 * @param input 计划与幂等键。
 * @returns 更新后的安装。
 */
export function upgradePlugin(
  installId: string,
  input: {
    planId: string
    idempotencyKey: string
    highRiskConfirmed?: boolean
  },
) {
  return apiPost<PluginInstallDto>(
    `/api/plugin-installs/${installId}/upgrade`,
    input,
    { 'Idempotency-Key': input.idempotencyKey },
  )
}

/**
 * 按一次性回滚计划切换到 previousVersion。
 *
 * @param installId 安装 ID。
 * @param input 计划与幂等键。
 * @returns 更新后的安装。
 */
export function rollbackPlugin(
  installId: string,
  input: {
    planId: string
    idempotencyKey: string
    highRiskConfirmed?: boolean
  },
) {
  return apiPost<PluginInstallDto>(
    `/api/plugin-installs/${installId}/rollback`,
    input,
    { 'Idempotency-Key': input.idempotencyKey },
  )
}

/**
 * 查询插件安装审计。
 *
 * @param installId 安装 ID。
 * @returns 审计事件。
 */
export function listPluginAudit(installId: string) {
  return apiGet<PluginAuditDto[]>(
    `/api/plugin-installs/${installId}/audit`,
  )
}

/**
 * 查询本地 registry 同步状态。
 *
 * @returns 来源、条目数、版本数和同步时间。
 */
export function getRegistrySyncStatus() {
  return apiGet<{
    source: string
    state: string
    entries: number
    versions: number
    syncedAt?: string
  }>('/api/registry/sync-status')
}

/**
 * 请求同步远程 registry。
 *
 * P1 尚未接入时服务端会返回明确的 501 能力错误，页面不得伪造成功状态。
 *
 * @returns 服务端同步结果。
 */
export function syncRegistry() {
  return apiPost<Record<string, unknown>>('/api/registry/sync', {})
}

/**
 * 卸载插件安装。
 *
 * @param installId 安装 ID。
 * @returns 删除确认。
 */
export function uninstallPlugin(installId: string) {
  return apiDelete<{ deleted: true }>(`/api/plugin-installs/${installId}`)
}

/**
 * 查询当前 workspace 的 Agent。
 *
 * @returns Agent Profile 列表。
 */
export function listAgents() {
  return apiGet<AgentDto[]>('/api/agents')
}

/**
 * 查询单个 Agent Profile。
 *
 * @param agentId 外部 Agent ID。
 * @returns Agent 配置与 revision。
 */
export function getAgent(agentId: string) {
  return apiGet<AgentDto>(`/api/agents/${agentId}`)
}

/**
 * 创建 Agent Profile。
 *
 * @param input 名称、描述和可序列化定义。
 * @returns 新建 Agent。
 */
export function createAgent(input: {
  name: string
  description?: string
  config: AgentDefinitionDto
}) {
  return apiPost<AgentDto>('/api/agents', input)
}

/**
 * 更新 Agent Profile；配置变化会递增 revision。
 *
 * @param agentId 外部 Agent ID。
 * @param input 可修改字段。
 * @returns 更新后的 Agent。
 */
export function updateAgent(
  agentId: string,
  input: {
    name?: string
    description?: string
    config?: AgentDefinitionDto
  },
) {
  return apiPatch<AgentDto>(`/api/agents/${agentId}`, input)
}

/**
 * 归档 Agent，保留历史会话。
 *
 * @param agentId 外部 Agent ID。
 * @returns 归档确认。
 */
export function archiveAgent(agentId: string) {
  return apiDelete<{ archived: true }>(`/api/agents/${agentId}`)
}

/**
 * 使用 Agent 当前配置创建一次性测试调用。
 *
 * @param agentId 外部 Agent ID。
 * @param input 测试内容与元数据。
 * @returns 已排队的 invocation。
 */
export function testAgent(
  agentId: string,
  input: { content?: string; metadata?: Record<string, unknown> } = {},
) {
  return apiPost<AgentInvocationDto>(`/api/agents/${agentId}/test`, input)
}

/**
 * 查询 Agent 会话列表。
 *
 * @param agentId 外部 Agent ID。
 * @returns 会话摘要。
 */
export function listAgentConversations(agentId: string) {
  return apiGet<AgentConversationDto[]>(
    `/api/agents/${agentId}/conversations`,
  )
}

/**
 * 创建会话并固定当前 Agent 快照。
 *
 * @param agentId 外部 Agent ID。
 * @param input 可选标题。
 * @returns 新会话。
 */
export function createAgentConversation(
  agentId: string,
  input: { title?: string } = {},
) {
  return apiPost<AgentConversationDto>(
    `/api/agents/${agentId}/conversations`,
    input,
  )
}

/**
 * 查询会话详情。
 *
 * @param conversationId 外部会话 ID。
 * @returns 会话摘要。
 */
export function getAgentConversation(conversationId: string) {
  return apiGet<AgentConversationDto>(
    `/api/agent-conversations/${conversationId}`,
  )
}

/**
 * 重命名或归档 Agent 会话。
 *
 * @param conversationId 外部会话 ID。
 * @param input 标题与状态。
 * @returns 更新后的会话。
 */
export function updateAgentConversation(
  conversationId: string,
  input: { title?: string; status?: 'active' | 'archived' },
) {
  return apiPatch<AgentConversationDto>(
    `/api/agent-conversations/${conversationId}`,
    input,
  )
}

/**
 * 分页读取会话消息。
 *
 * @param conversationId 外部会话 ID。
 * @param query 起始序号与条数。
 * @returns 用户和助手消息。
 */
export function listAgentMessages(
  conversationId: string,
  query: { after?: number; limit?: number } = {},
) {
  return apiGet<AgentMessageDto[]>(
    `/api/agent-conversations/${conversationId}/messages`,
    query,
  )
}

/**
 * 发送消息并创建 Agent invocation。
 *
 * @param conversationId 外部会话 ID。
 * @param input 消息正文、附件和元数据。
 * @param idempotencyKey 客户端幂等键。
 * @returns 用户消息、助手占位和 invocation 链接。
 */
export function sendAgentMessage(
  conversationId: string,
  input: {
    content: string
    attachments?: Array<Record<string, unknown>>
    metadata?: Record<string, unknown>
  },
  idempotencyKey?: string,
) {
  return apiPost<AgentMessageAcceptedResponse>(
    `/api/agent-conversations/${conversationId}/messages`,
    input,
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  )
}

/**
 * 从指定用户消息重新生成助手回答。
 *
 * @param conversationId 外部会话 ID。
 * @param userMessageId 用户消息 ID。
 * @returns 新 invocation 与助手占位。
 */
export function retryAgentMessage(
  conversationId: string,
  userMessageId: string,
) {
  return apiPost<AgentMessageAcceptedResponse>(
    `/api/agent-conversations/${conversationId}/messages/retry`,
    { userMessageId },
  )
}

/**
 * 查询 invocation 详情。
 *
 * @param invocationId 外部 invocation ID。
 * @returns 状态、结果和 checkpoint。
 */
export function getAgentInvocation(invocationId: string) {
  return apiGet<AgentInvocationDto>(
    `/api/agent-invocations/${invocationId}`,
  )
}

/**
 * 分页读取已落库的 invocation 事件。
 *
 * @param invocationId 外部 invocation ID。
 * @param afterSeq 起始事件序号。
 * @param limit 最大条数。
 * @returns 有序事件。
 */
export function listAgentInvocationEvents(
  invocationId: string,
  afterSeq = 0,
  limit = 1000,
) {
  return apiGet<AgentInvocationEventDto[]>(
    `/api/agent-invocations/${invocationId}/events/page`,
    { after: afterSeq, limit },
  )
}

/**
 * 请求取消 Agent invocation。
 *
 * @param invocationId 外部 invocation ID。
 * @returns 最新状态。
 */
export function cancelAgentInvocation(invocationId: string) {
  return apiPost<{ invocationId: string; status: string }>(
    `/api/agent-invocations/${invocationId}/cancel`,
  )
}

/**
 * 从失败或中断状态恢复 invocation。
 *
 * @param invocationId 外部 invocation ID。
 * @returns 更新后的 invocation。
 */
export function resumeAgentInvocation(invocationId: string) {
  return apiPost<AgentInvocationDto>(
    `/api/agent-invocations/${invocationId}/resume`,
  )
}

/**
 * 通过 fetch SSE 订阅 Agent invocation，支持 after 和 Last-Event-ID。
 *
 * @param input invocation ID、起始序号和生命周期回调。
 * @returns 取消订阅函数。
 */
export function subscribeAgentInvocationEvents(input: {
  invocationId: string
  afterSeq?: number
  onEvent: (event: AgentInvocationEventDto) => void
  onError: (error: Error) => void
  onEnd: () => void
}) {
  const controller = new AbortController()
  let ended = false
  let cursor = input.afterSeq ?? 0
  let retries = 0
  let terminalSeen = false

  function finish() {
    if (ended) return
    ended = true
    input.onEnd()
  }

  async function consume() {
    const query = cursor ? `?after=${encodeURIComponent(String(cursor))}` : ''
    const response = await fetch(
      `/api/agent-invocations/${encodeURIComponent(input.invocationId)}/events${query}`,
      {
        headers: {
          Accept: 'text/event-stream',
          ...(cursor ? { 'Last-Event-ID': String(cursor) } : {}),
        },
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      let message = response.statusText || 'Agent 事件流请求失败。'
      try {
        const body = (await response.json()) as {
          error?: { message?: string }
        }
        message = body.error?.message ?? message
      } catch {
        // Keep the HTTP status text when the server did not return JSON.
      }
      throw new ApiError({
        status: response.status,
        code: `HTTP_${response.status}`,
        message,
        retryable: response.status >= 500 || response.status === 429,
      })
    }
    if (!response.body) {
      throw new ApiError({
        status: 0,
        code: 'SSE_BODY_MISSING',
        message: 'Agent 事件流没有响应正文。',
        retryable: true,
      })
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const parsed = parseAgentSseBlock(block)
        if (!parsed) continue
        let event: AgentInvocationEventDto
        try {
          event = JSON.parse(parsed.data) as AgentInvocationEventDto
        } catch {
          throw new Error('收到无法解析的 Agent 事件。')
        }
        if (parsed.event) event.type = parsed.event
        if (Number.isFinite(parsed.id) && parsed.id > 0) event.seq = parsed.id
        if (Number.isFinite(event.seq)) {
          cursor = Math.max(cursor, event.seq)
        }
        if (isTerminalAgentEvent(event.type)) terminalSeen = true
        input.onEvent(event)
      }
    }
  }

  async function connect() {
    while (!ended && !controller.signal.aborted) {
      try {
        await consume()
        if (terminalSeen) {
          finish()
          return
        }
        throw new ApiError({
          status: 0,
          code: 'SSE_DISCONNECTED',
          message: 'Agent 事件流连接中断。',
          retryable: true,
        })
      } catch (error) {
        if (ended || controller.signal.aborted) return
        const normalized =
          error instanceof Error ? error : new Error(String(error))
        if (
          (error instanceof ApiError && !error.retryable) ||
          retries >= 8
        ) {
          input.onError(normalized)
          finish()
          return
        }
        retries += 1
        await waitForRetry(
          Math.min(5_000, 500 * 2 ** (retries - 1)),
          controller.signal,
        )
      }
    }
  }

  void connect()

  return () => {
    if (ended) return
    ended = true
    controller.abort()
  }
}

function isTerminalAgentEvent(type: string) {
  return (
    type === 'invocation.completed' ||
    type === 'invocation.failed' ||
    type === 'invocation.cancelled'
  )
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * 解析单个 SSE block。
 *
 * @param block SSE 原始文本块。
 * @returns 事件序号、类型和 JSON 数据。
 */
function parseAgentSseBlock(block: string) {
  let id = 0
  let event = ''
  const data: string[] = []
  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('id:')) id = Number(line.slice(3).trim())
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  })
  if (!data.length) return null
  return { id, event, data: data.join('\n') }
}

/**
 * 已从服务端删除的 legacy 路径也集中在这里，避免页面重复拼接。
 *
 * @param runId 外部运行 ID。
 * @returns 原始事件分页。
 */
export function listLegacyRunEvents(runId: string) {
  return listRunEvents(runId)
}
