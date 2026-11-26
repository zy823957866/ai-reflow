import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/api/client'
import type {
  FileRef,
  RunEvent,
  RunRecord,
  WorkflowCard,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowVersion,
} from '@/shared/types'
import type { UploadProgressHandler } from '@/api/client'

export interface ApiIssue {
  code: string
  message: string
  nodeId?: string
  field?: string
}

export interface ReadinessResponse {
  ready: boolean
  blockers: ApiIssue[]
  warnings: ApiIssue[]
  checked: {
    models: number
    knowledgeBases: number
    mcpServers: number
    nodes: number
  }
}

export interface RunCreatedResponse {
  runId: string
  workflowVersionId?: string
  runKind: RunRecord['runKind']
  trigger: RunRecord['trigger']
  status: RunRecord['status']
  links: {
    detail: string
    events: string
  }
}

export interface ModelConnectionDto {
  id: string
  provider: string
  name: string
  model: string
  baseUrl: string
  status: 'healthy' | 'degraded' | 'failed'
  isDefault: boolean
  enabled: boolean
  usage: number
  latencyMs: number
  contextWindow: number
  capabilities: string[]
  fallbackOrder: string[]
  credentialMask: string
  credentialStatus: 'valid' | 'expiring' | 'missing'
  secretRef?: string
  updatedAt: string
}

export interface ModelTestResponse {
  ok: boolean
  latencyMs: number
  models: string[]
  error?: ApiIssue
}

export interface KnowledgeBaseDto {
  id: string
  name: string
  description: string
  documents: number
  chunks: number
  status: 'ready' | 'indexing' | 'failed'
  embeddingModel: string
  dimensions: number
  updatedAt: string
}

export interface KnowledgeDocumentDto {
  id: string
  kbId?: string
  name: string
  mime: string
  extension: string
  size: string
  sizeBytes: number
  chunks: number
  chunkStrategy: string
  status: 'queued' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed'
  previewStatus: 'none' | 'converting' | 'ready' | 'failed' | 'unsupported'
  progress: number
  error?: string
  metadata?: Record<string, unknown>
  updatedAt: string
}

export interface KnowledgeSearchChunk {
  id: string
  documentId: string
  documentName: string
  chunkIndex: number
  snippet: string
  location: string
  score: number
  vectorScore?: number
  fulltextScore?: number
  metadata: Record<string, unknown>
}

export interface KnowledgeSearchResponse {
  chunks: KnowledgeSearchChunk[]
  citations: Array<Record<string, unknown>>
  context: string
  total: number
  rerankApplied: boolean
  warnings?: string[]
}

export interface KnowledgeStatsDto {
  documents: number
  ready: number
  failed: number
  processing: number
  chunks: number
  embeddedChunks: number
  embeddingModel: string
  embeddingDimension: number
}

export interface DocumentChunkDto {
  id: string
  documentId: string
  documentName: string
  chunkIndex: number
  snippet: string
  tokenCount?: number
  embeddingStatus: 'pending' | 'ready' | 'failed'
  metadata: Record<string, unknown>
  location: string
}

export interface KnowledgePreviewDto {
  documentId: string
  previewKind: string
  previewStatus: string
  pages: unknown
  sheets: unknown
  error?: string
}

export interface SkillDto {
  id: string
  name: string
  publisher: string
  summary: string
  type: string
  visibility: string
  version: string
  status: string
}

export interface McpServerDto {
  id: string
  name: string
  slug: string
  endpoint: string
  transport: 'streamable-http' | 'sse' | 'stdio'
  status: 'healthy' | 'degraded' | 'offline' | 'error'
  enabled: boolean
  tools: number
  calls: number
  latencyMs: number
  secretRef?: string
  allowlist: string[]
  lastCheckedAt?: string
}

export interface McpToolDto {
  id: string
  name: string
  title: string
  description: string
  readOnly: boolean
  destructive: boolean
  calls: number
  latencyMs: number
  schema: Record<string, unknown>
  schemaHash: string
  enabled: boolean
}

export interface McpCallResponse {
  result: unknown
  structuredContent?: unknown
  isError: boolean
  usage: Record<string, unknown>
  durationMs: number
}

export interface McpCallDto {
  id: string
  direction: 'outbound' | 'inbound'
  serverId?: string
  toolName: string
  runId?: string
  clientId?: string
  status: string
  errorCode?: string
  durationMs?: number
  metadata: Record<string, unknown>
  at: string
}

export interface WorkflowMcpExposureDto {
  id: string
  workflowId: string
  workflowName: string
  workflowSlug: string
  workflowVersionId: string
  workflowVersion: number
  versionSchemaHash: string
  toolName: string
  title: string
  description: string
  instructions?: string
  inputSchema: Record<string, unknown>
  outputMode: 'text' | 'structured'
  visibility: 'private' | 'public'
  authMode: 'none' | 'bearer' | 'api-key' | 'oauth2'
  tokenStatus: 'not_required' | 'active' | 'missing'
  tokenMasked?: string
  scopes: string[]
  expiresAt?: string
  timeoutMs: number
  maxConcurrency: number
  rateLimit: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkflowMcpExposureResponse {
  workflowId: string
  workflowName: string
  configured: boolean
  exposure: WorkflowMcpExposureDto | null
}

export interface McpAccessTokenDto {
  id: string
  name: string
  maskedHint: string
  exposureId: string
  workflowId?: string
  toolName: string
  scopes: string[]
  state: 'active' | 'expired' | 'revoked' | 'disabled'
  expiresAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export interface TemplateVersionDto {
  id: string
  version: string
  createdAt: string
  schemaVersion: string
  changelog: string
  requiredPlugins: unknown[]
  requiredModels: unknown[]
  requiredSecrets: unknown[]
  requiredKnowledge: unknown[]
  nodeDependencies: Array<{
    type: string
    version: string
    displayName: string
    pluginId?: string
  }>
  definition: WorkflowDefinition
  previewGraph: Record<string, unknown>
  manifest: Record<string, unknown>
}

export interface TemplateDto {
  id: string
  name: string
  author: string
  description: string
  category: string
  tags: string[]
  license: string
  visibility: string
  installs: number
  featured: boolean
  icon: string
  accent: string
  updatedAt: string
  latestVersion: string
  versions: TemplateVersionDto[]
  definition: WorkflowDefinition
  previewGraph: Record<string, unknown>
  examples: Record<string, unknown>
}

export interface TemplateClonePlanDto {
  planId: string
  templateId: string
  version: string
  targetName: string
  dependencies: Array<Record<string, unknown>>
  missingDependencies: Array<Record<string, unknown>>
  warnings: string[]
  blockingReasons: string[]
  willAutoInstall: false
  willWriteSecrets: false
  canClone: boolean
  expiresAt: string
}

export interface RegistryVersionDto {
  version: string
  releasedAt: string
  compatibility: string
  engine: string
  schemaVersion: string
  size: string
  deprecated: boolean
  changelog: string
  dependencies: Array<{ id: string; name: string; version: string }>
  verification: {
    checksum: 'ok' | 'missing' | 'mismatch'
    signature: 'verified' | 'missing' | 'invalid'
    license: string
    licenseBlocked: boolean
  }
  manifest: Record<string, unknown>
  checksum: string
  signature?: string
  license: string
}

export interface RegistryEntryDto {
  id: string
  name: string
  publisher: string
  summary: string
  description: string
  kind: PluginKindDto
  latestVersion: string
  icon: string
  accent: string
  visibility?: string
  verified: boolean
  installs: number
  updatedAt: string
  capabilities: string[]
  permissions: PluginPermissionDto[]
  credentials: PluginCredentialDto[]
  tools: Array<{ name: string; description: string; nodeType?: string }>
  metadata?: Record<string, unknown>
  versions: RegistryVersionDto[]
  install?: {
    installId: string
    version: string
    enabled: boolean
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
  key: string
  authType: 'api-key' | 'oauth' | 'bearer'
  state: 'missing' | 'configured' | 'expiring'
  masked?: string
  expiresAt?: string
  verifiedAt?: string
  required: boolean
}

export type PluginPermissionDto = {
  group: 'network' | 'files' | 'secrets' | 'mcp' | 'code' | 'resources'
  label: string
  values: string[]
  highRisk: boolean
}

export interface PluginInstallDto {
  installId: string
  entryId: string
  name: string
  version: string
  previousVersion?: string
  status: string
  enabled: boolean
  credentials: PluginCredentialDto[]
  permissions: Record<string, unknown>
  affectedWorkflows: unknown[]
  installedAt: string
  updatedAt: string
}

export interface PluginInstallPlanDto extends Record<string, unknown> {
  planId: string
  action: 'install' | 'upgrade' | 'rollback'
  entryId: string
  installId?: string
  fromVersion: string | null
  toVersion: string
  affectedWorkflowIds: string[]
  dependencies: Array<{
    id: string
    name: string
    version: string
    state: 'available' | 'missing' | 'conflict'
    chain?: string
  }>
  permissions: PluginPermissionDto[]
  credentials: PluginCredentialDto[]
  verification: {
    checksum: 'ok' | 'missing' | 'mismatch'
    signature: 'verified' | 'missing' | 'invalid'
    license: string
    licenseBlocked: boolean
  }
  deprecated: boolean
  blockers: string[]
  warnings: string[]
  highRisk: boolean
  idempotencyKey: string
  expiresAt: string
  canInstall: boolean
}

export interface PluginAuditDto {
  id: string
  installId?: string
  entryId: string
  action: string
  actor: string
  at: string
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
  input: { name?: string; description?: string },
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
 * @param onProgress 上传百分比回调。
 * @returns 上传后文档记录。
 */
export function uploadKnowledgeDocument(
  knowledgeBaseId: string,
  file: File,
  onProgress?: UploadProgressHandler,
) {
  const formData = new FormData()
  formData.append('file', file)
  return apiUpload<KnowledgeDocumentDto>(
    `/api/knowledge-bases/${knowledgeBaseId}/documents`,
    formData,
    onProgress,
  )
}

/**
 * 上传工作流通用附件。
 *
 * @param file 待上传文件。
 * @param onProgress 上传百分比回调。
 * @returns 公开 FileRef。
 */
export function uploadAttachment(file: File, onProgress?: UploadProgressHandler) {
  const formData = new FormData()
  formData.append('file', file)
  return apiUpload<FileRef>('/api/files', formData, onProgress)
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
  return apiPost<Record<string, unknown>>(`/api/documents/${documentId}/retry`)
}

/**
 * 重建文档索引。
 *
 * @param documentId 文档 ID。
 * @returns 重建任务状态。
 */
export function reindexKnowledgeDocument(documentId: string) {
  return apiPost<Record<string, unknown>>(`/api/documents/${documentId}/reindex`)
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
 * 已从服务端删除的 legacy 路径也集中在这里，避免页面重复拼接。
 *
 * @param runId 外部运行 ID。
 * @returns 原始事件分页。
 */
export function listLegacyRunEvents(runId: string) {
  return listRunEvents(runId)
}
