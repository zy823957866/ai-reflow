import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  AppError,
  createMcpServerSchema,
  createKnowledgeBaseSchema,
  createWorkflowSchema,
  createModelConnectionSchema,
  knowledgeSearchSchema,
  mcpAccessTokenCreateSchema,
  mcpToolCallSchema,
  previewRunSchema,
  pluginInstallPlanSchema,
  pluginInstallSchema,
  pluginInstallUpdateSchema,
  pluginLifecycleSchema,
  productionRunSchema,
  publishWorkflowSchema,
  templateClonePlanSchema,
  templateCloneSchema,
  updateKnowledgeBaseSchema,
  updateMcpServerSchema,
  updateModelConnectionSchema,
  updateWorkflowSchema,
  workflowMcpExposureSchema,
  workflowMcpTokenRotationSchema,
  type WorkflowDefinition,
} from '@ai-reflow/core'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ZodType } from 'zod'
import {
  CatalogRepository,
  KnowledgeRepository,
  McpExposureRepository,
  McpRepository,
  ModelRepository,
  PluginRepository,
  RunRepository,
  TemplateRepository,
  WorkflowRepository,
  createDatabase,
  loadEnvironment,
  type AuthenticatedMcpExposure,
  type DatabaseClient,
} from '@ai-reflow/platform'

interface ApiResponse {
  writableEnded: boolean
  setHeader(name: string, value: string): void
  flushHeaders(): void
  write(chunk: string): void
  end(): void
  on(event: 'close', listener: () => void): void
}

interface ApiRequest {
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  on?(event: 'close', listener: () => void): void
}

/**
 * 管理单进程数据库连接和默认 workspace。
 */
@Injectable()
class DatabaseService {
  private readonly database = createDatabase(loadEnvironment().DATABASE_URL)
  readonly sql: DatabaseClient = this.database.sql
  readonly workspaceId = loadEnvironment().DEFAULT_WORKSPACE_ID

  /**
   * 关闭 PostgreSQL 连接池。
   */
  async close() {
    await this.sql.end()
  }
}

/**
 * 把 AppError 与 Zod 错误转换为稳定的 JSON 响应。
 */
@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  /**
   * 处理控制器抛出的任意异常。
   * @param exception 原始异常。
   * @param host NestJS 参数宿主。
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{
      status(code: number): unknown
      json(body: unknown): void
      setHeader(name: string, value: string): void
    }>()
    if (exception instanceof AppError) {
      response.status(exception.status)
      response.json({
        error: {
          code: exception.code,
          message: exception.message,
          retryable: exception.retryable,
          details: exception.details,
          issues: exception.issues,
        },
      })
      return
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus())
      response.json({
        error: { code: 'HTTP_ERROR', message: exception.message },
      })
      return
    }
    console.error(exception)
    response.status(500)
    response.json({
      error: {
        code: 'INTERNAL_ERROR',
        message: exception instanceof Error ? exception.message : '服务内部错误。',
      },
    })
  }
}

/**
 * Reflow P0 REST 与 SSE 控制面。
 */
@Controller('api')
class ApiController {
  /**
   * 注入数据库和仓库工厂依赖。
   * @param database 数据库服务。
   */
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * 创建当前 workspace 的工作流仓库。
   * @returns 工作流仓库。
   */
  private workflows() {
    return new WorkflowRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建当前 workspace 的运行仓库。
   * @returns 运行仓库。
   */
  private runs() {
    return new RunRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建当前 workspace 的目录仓库。
   * @returns 目录仓库。
   */
  private catalog() {
    return new CatalogRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建当前 workspace 的模型连接仓库。
   *
   * @returns 模型连接仓库。
   */
  private modelsRepository() {
    return new ModelRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建当前 workspace 的知识库仓库。
   *
   * @returns 知识库仓库。
   */
  private knowledge() {
    return new KnowledgeRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建当前 workspace 的出站 MCP 仓库。
   *
   * @returns MCP 仓库。
   */
  private mcp() {
    return new McpRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建模板市场仓库。
   *
   * @returns 模板仓库。
   */
  private templates() {
    return new TemplateRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建插件市场与生命周期仓库。
   *
   * @returns 插件仓库。
   */
  private plugins() {
    return new PluginRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 创建入站 MCP 暴露与访问令牌仓库。
   *
   * @returns 入站暴露仓库。
   */
  private mcpExposures() {
    return new McpExposureRepository(this.database.sql, this.database.workspaceId)
  }

  /**
   * 健康检查。
   * @returns 服务与数据库状态。
   */
  @Get('health')
  async health() {
    await this.database.sql`select 1`
    return { ok: true, service: 'ai-reflow-server', database: 'up' }
  }

  /**
   * 查询工作流卡片列表。
   * @param query 搜索、状态、标签和排序条件。
   * @returns 卡片列表。
   */
  @Get('workflows')
  listWorkflows(@Query() query: Record<string, string>) {
    return this.workflows().list({
      search: query.search,
      status: query.status,
      tag: query.tag,
      sort: query.sort as 'updated' | 'runs' | 'count' | 'success' | undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    })
  }

  /**
   * 创建空白工作流或从模板创建草稿。
   * @param body 创建参数。
   * @returns 新草稿。
   */
  @Post('workflows')
  @HttpCode(201)
  async createWorkflow(@Body() body: unknown) {
    const input = parseBody(createWorkflowSchema, body)
    if (!input.templateId) return this.workflows().create(input)
    const template = await this.catalog().templateDefinition(input.templateId)
    return this.workflows().create({
      ...input,
      definition: template.definition as unknown as WorkflowDefinition,
    })
  }

  /**
   * 读取工作流草稿。
   * @param id 外部工作流 ID。
   * @returns 草稿 DTO。
   */
  @Get('workflows/:id')
  getWorkflow(@Param('id') id: string) {
    return this.workflows().get(id)
  }

  /**
   * 更新工作流元数据或草稿。
   * @param id 外部工作流 ID。
   * @param body 修改字段和 revision。
   * @returns 更新后的草稿。
   */
  @Patch('workflows/:id')
  async updateWorkflow(@Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(updateWorkflowSchema, body)
    if (input.definition && !input.revision) {
      throw new AppError({
        code: 'REVISION_REQUIRED',
        message: '保存草稿定义时必须提供 revision。',
        status: 400,
      })
    }
    const revision = input.revision ?? (await this.workflows().get(id)).revision
    return this.workflows().update(id, { ...input, revision })
  }

  /**
   * 归档工作流。
   * @param id 外部工作流 ID。
   * @returns 归档结果。
   */
  @Delete('workflows/:id')
  archiveWorkflow(@Param('id') id: string) {
    return this.workflows().archive(id)
  }

  /**
   * 复制工作流草稿。
   * @param id 源工作流 ID。
   * @returns 新草稿。
   */
  @Post('workflows/:id/duplicate')
  duplicateWorkflow(@Param('id') id: string) {
    return this.workflows().duplicate(id)
  }

  /**
   * 编译校验客户端提交的定义。
   * @param id 工作流 ID。
   * @param body 定义或直接定义对象。
   * @returns 校验结果。
   */
  @Post('workflows/:id/validate')
  validateWorkflow(
    @Param('id') _id: string,
    @Body() body: { definition?: WorkflowDefinition } | WorkflowDefinition,
  ) {
    const definition = 'definition' in body && body.definition ? body.definition : body
    return this.workflows().validate(definition as WorkflowDefinition)
  }

  /**
   * 发布不可变工作流版本。
   * @param id 工作流 ID。
   * @param body revision 与版本说明。
   * @returns 新版本摘要。
   */
  @Post('workflows/:id/publish')
  async publish(@Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(publishWorkflowSchema, body)
    return this.workflows().publish(id, input.revision, input.changelog)
  }

  /**
   * 查询发布版本列表。
   * @param id 工作流 ID。
   * @returns 版本列表。
   */
  @Get('workflows/:id/versions')
  versions(@Param('id') id: string) {
    return this.workflows().versions(id)
  }

  /**
   * 查询单个固定发布版本。
   * @param id 工作流 ID。
   * @param versionId 外部版本 ID。
   * @returns 版本 DTO。
   */
  @Get('workflows/:id/versions/:versionId')
  version(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.workflows().version(id, versionId)
  }

  /**
   * 检查固定发布版本的真实执行就绪状态。
   * @param id 工作流 ID。
   * @param versionId 外部版本 ID。
   * @returns 阻断项与警告。
   */
  @Get('workflows/:id/versions/:versionId/readiness')
  readiness(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.workflows().readiness(id, versionId)
  }

  /**
   * 创建草稿预览运行。
   * @param id 工作流 ID。
   * @param body 预览定义、输入和超时。
   * @param idempotencyKey 幂等键。
   * @returns 入队运行摘要。
   */
  @Post('workflows/:id/preview')
  async preview(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const input = parseBody(previewRunSchema, body)
    return this.workflows().createPreviewRun(id, {
      definition: input.definition,
      input: input.input,
      timeoutMs: input.options?.timeoutMs,
      idempotencyKey,
    })
  }

  /**
   * 创建固定发布版本运行。
   * @param id 工作流 ID。
   * @param body 固定版本、触发方式、输入和超时。
   * @param idempotencyKey 幂等键。
   * @returns 入队运行摘要。
   */
  @Post('workflows/:id/runs')
  async runWorkflow(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const input = parseBody(productionRunSchema, body)
    return this.workflows().createProductionRun(id, {
      workflowVersionId: input.workflowVersionId,
      trigger: input.trigger,
      input: input.input,
      timeoutMs: input.options?.timeoutMs,
      idempotencyKey,
    })
  }

  /**
   * 查询运行列表。
   * @param query 运行筛选条件。
   * @returns 运行 DTO 列表。
   */
  @Get('runs')
  listRuns(@Query() query: Record<string, string>) {
    return this.runs().list({
      workflowId: query.workflowId,
      versionId: query.versionId,
      status: query.status,
      kind: query.kind,
      trigger: query.trigger,
      search: query.search,
      limit: query.limit ? Number(query.limit) : undefined,
    })
  }

  /**
   * 查询单次运行详情。
   * @param id 外部运行 ID。
   * @returns 运行 DTO。
   */
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.runs().get(id)
  }

  /**
   * 查询运行的节点执行明细。
   * @param id 外部运行 ID。
   * @returns 节点 DTO 列表。
   */
  @Get('runs/:id/node-runs')
  nodeRuns(@Param('id') id: string) {
    return this.runs().nodeRuns(id)
  }

  /**
   * 分页查询历史运行事件。
   * @param id 外部运行 ID。
   * @param query after 与 limit。
   * @returns 事件列表。
   */
  @Get('runs/:id/events/page')
  eventsPage(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.runs().eventsPage(
      id,
      Number(query.after ?? query.afterSeq ?? 0),
      Number(query.limit ?? 200),
    )
  }

  /**
   * 以 SSE 推送数据库 backlog 与后续事件。
   * @param id 外部运行 ID。
   * @param request HTTP 请求。
   * @param response SSE 响应。
   * @param query after 序号。
   */
  @Get('runs/:id/events')
  async events(
    @Param('id') id: string,
    @Req() request: ApiRequest,
    @Res() response: ApiResponse,
    @Query() query: Record<string, string>,
  ) {
    const lastHeader = request.headers['last-event-id']
    const initialSeq = Number(
      Array.isArray(lastHeader) ? lastHeader[0] : lastHeader ?? query.after ?? query.afterSeq ?? 0,
    )
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()
    let lastSeq = Number.isFinite(initialSeq) ? initialSeq : 0
    let closed = false
    request.on?.('close', () => {
      closed = true
    })
    response.on('close', () => {
      closed = true
    })
    const send = (event: { seq: number; type: string }) => {
      response.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      lastSeq = event.seq
    }
    try {
      const backlog = await this.runs().eventsPage(id, lastSeq, 1000)
      backlog.forEach(send)
      while (!closed && !response.writableEnded) {
        const events = await this.runs().eventsPage(id, lastSeq, 100)
        events.forEach(send)
        const run = await this.runs().get(id)
        if (
          ['succeeded', 'failed', 'cancelled'].includes(run.status) &&
          !events.some((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type))
        ) {
          const event = events.at(-1) ?? {
            seq: lastSeq,
            type: run.status === 'succeeded' ? 'run.completed' : run.status === 'failed' ? 'run.failed' : 'run.cancelled',
          }
          if (event.seq > lastSeq) send(event as { seq: number; type: string })
          break
        }
        if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break
        await new Promise((resolve) => setTimeout(resolve, 450))
      }
      response.end()
    } catch {
      if (!response.writableEnded) response.end()
    }
  }

  /**
   * 请求取消运行。
   * @param id 外部运行 ID。
   * @returns 最新运行状态。
   */
  @Post('runs/:id/cancel')
  cancelRun(@Param('id') id: string) {
    return this.runs().cancel(id)
  }

  /**
   * 使用原定义快照重放运行。
   * @param id 原运行 ID。
   * @returns 新运行摘要。
   */
  @Post('runs/:id/replay')
  replayRun(@Param('id') id: string) {
    return this.runs().replay(id)
  }

  /**
   * 查询知识库列表。
   *
   * @param query 名称搜索与状态筛选。
   * @returns 知识库 DTO 列表。
   */
  @Get('knowledge-bases')
  knowledgeBases(@Query() query: Record<string, string>) {
    return this.knowledge().list({
      search: query.search,
      status: query.status,
    })
  }

  /**
   * 创建知识库。
   *
   * @param body 名称、描述和 embedding 配置。
   * @returns 新知识库 DTO。
   */
  @Post('knowledge-bases')
  @HttpCode(201)
  async createKnowledgeBase(@Body() body: unknown) {
    return this.knowledge().create(parseBody(createKnowledgeBaseSchema, body))
  }

  /**
   * 查询单个知识库。
   *
   * @param id 外部知识库 ID。
   * @returns 知识库 DTO。
   */
  @Get('knowledge-bases/:id')
  getKnowledgeBase(@Param('id') id: string) {
    return this.knowledge().get(id)
  }

  /**
   * 更新知识库名称或描述。
   *
   * @param id 外部知识库 ID。
   * @param body 修改字段。
   * @returns 更新后的知识库 DTO。
   */
  @Patch('knowledge-bases/:id')
  async updateKnowledgeBase(@Param('id') id: string, @Body() body: unknown) {
    return this.knowledge().update(id, parseBody(updateKnowledgeBaseSchema, body))
  }

  /**
   * 删除未被工作流引用的知识库。
   *
   * @param id 外部知识库 ID。
   * @returns 删除确认。
   */
  @Delete('knowledge-bases/:id')
  removeKnowledgeBase(@Param('id') id: string) {
    return this.knowledge().remove(id)
  }

  /**
   * 查询知识库文档。
   *
   * @param id 外部知识库 ID。
   * @param query 文档状态、类型和名称搜索。
   * @returns 文档 DTO 列表。
   */
  @Get('knowledge-bases/:id/documents')
  knowledgeDocuments(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.knowledge().documents(id, {
      status: query.status,
      type: query.type,
      search: query.search,
    })
  }

  /**
   * 接收文档上传。对象存储未配置时返回稳定 503。
   *
   * @returns 当前部署的上传能力状态。
   */
  @Post('knowledge-bases/:id/documents')
  @HttpCode(201)
  uploadKnowledgeDocument() {
    return this.knowledge().upload()
  }

  /**
   * 执行知识库检索测试。
   *
   * @param id 外部知识库 ID。
   * @param body 查询、TopK、阈值和检索模式。
   * @returns 切片、引用和上下文。
   */
  @Post('knowledge-bases/:id/search')
  @HttpCode(200)
  async searchKnowledge(@Param('id') id: string, @Body() body: unknown) {
    return this.knowledge().search(id, parseBody(knowledgeSearchSchema, body))
  }

  /**
   * 查询知识库文档、切片和处理状态统计。
   *
   * @param id 外部知识库 ID。
   * @returns 聚合统计。
   */
  @Get('knowledge-bases/:id/stats')
  knowledgeStats(@Param('id') id: string) {
    return this.knowledge().stats(id)
  }

  /**
   * 兼容旧的全文检索验证路径。
   *
   * @param id 外部知识库 ID。
   * @param body query 与 topK。
   * @returns 切片、引用和上下文。
   */
  @Post('knowledge-bases/:id/retrieve')
  @HttpCode(200)
  retrieve(@Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(knowledgeSearchSchema, body)
    return this.knowledge().search(id, { ...input, retrievalMode: 'keyword' })
  }

  /**
   * 查询文档详情。
   *
   * @param id 外部文档 ID。
   * @returns 文档 DTO。
   */
  @Get('documents/:id')
  document(@Param('id') id: string) {
    return this.knowledge().document(id)
  }

  /**
   * 删除文档、切片与预览记录。
   *
   * @param id 外部文档 ID。
   * @returns 删除确认。
   */
  @Delete('documents/:id')
  removeDocument(@Param('id') id: string) {
    return this.knowledge().removeDocument(id)
  }

  /**
   * 从失败阶段重试文档 ingest。
   *
   * @param id 外部文档 ID。
   * @returns 当前部署的重试能力状态。
   */
  @Post('documents/:id/retry')
  retryDocument(@Param('id') id: string) {
    return this.knowledge().retryDocument(id)
  }

  /**
   * 重建文档索引。
   *
   * @param id 外部文档 ID。
   * @returns 当前部署的重建能力状态。
   */
  @Post('documents/:id/reindex')
  reindexDocument(@Param('id') id: string) {
    return this.knowledge().reindexDocument(id)
  }

  /**
   * 分页查询文档切片。
   *
   * @param id 外部文档 ID。
   * @param query offset 与 limit。
   * @returns 切片列表。
   */
  @Get('documents/:id/chunks')
  documentChunks(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.knowledge().chunks(
      id,
      Number(query.offset ?? 0),
      Number(query.limit ?? 100),
    )
  }

  /**
   * 查询文档预览描述。
   *
   * @param id 外部文档 ID。
   * @returns 预览状态和页/工作表元数据。
   */
  @Get('documents/:id/preview')
  documentPreview(@Param('id') id: string) {
    return this.knowledge().preview(id)
  }

  /**
   * 查询模型连接列表。
   *
   * @returns 模型连接 DTO 列表。
   */
  @Get('model-connections')
  modelConnections() {
    return this.modelsRepository().list()
  }

  /**
   * 创建模型连接。
   *
   * @param body 连接配置与 secret_ref。
   * @returns 新建模型连接 DTO。
   */
  @Post('model-connections')
  @HttpCode(201)
  async createModelConnection(@Body() body: unknown) {
    return this.modelsRepository().create(parseBody(createModelConnectionSchema, body))
  }

  /**
   * 查询单个模型连接。
   *
   * @param id 外部模型连接 ID。
   * @returns 模型连接 DTO。
   */
  @Get('model-connections/:id')
  modelConnection(@Param('id') id: string) {
    return this.modelsRepository().get(id)
  }

  /**
   * 更新模型连接。
   *
   * @param id 外部模型连接 ID。
   * @param body 部分更新字段。
   * @returns 更新后的模型连接 DTO。
   */
  @Patch('model-connections/:id')
  async updateModelConnection(@Param('id') id: string, @Body() body: unknown) {
    return this.modelsRepository().update(id, parseBody(updateModelConnectionSchema, body))
  }

  /**
   * 删除未被工作流引用的模型连接。
   *
   * @param id 外部模型连接 ID。
   * @returns 删除确认。
   */
  @Delete('model-connections/:id')
  removeModelConnection(@Param('id') id: string) {
    return this.modelsRepository().remove(id)
  }

  /**
   * 使用真实供应商 endpoint 测试模型连接。
   *
   * @param id 外部模型连接 ID。
   * @returns 延迟、模型列表和错误。
   */
  @Post('model-connections/:id/test')
  testModelConnection(@Param('id') id: string) {
    return this.modelsRepository().test(id)
  }

  /**
   * 查询模型连接可用模型。
   *
   * @param id 外部模型连接 ID。
   * @returns 默认模型与能力。
   */
  @Get('model-connections/:id/models')
  connectionModels(@Param('id') id: string) {
    return this.modelsRepository().models(id)
  }

  /**
   * 兼容旧模型目录路径。
   *
   * @returns 模型连接 DTO 列表。
   */
  @Get('models')
  legacyModels() {
    return this.modelsRepository().list()
  }

  /**
   * 查询出站 MCP Server 列表。
   *
   * @param query 搜索、健康状态和 transport。
   * @returns MCP Server DTO 列表。
   */
  @Get('mcp/servers')
  mcpServers(@Query() query: Record<string, string>) {
    return this.mcp().list({
      search: query.search,
      status: query.status,
      transport: query.transport,
    })
  }

  /**
   * 创建出站 MCP Server。
   *
   * @param body transport、endpoint/command、allowlist 和 secret_ref。
   * @returns 新 Server DTO。
   */
  @Post('mcp/servers')
  @HttpCode(201)
  createMcpServer(@Body() body: unknown) {
    return this.mcp().create(parseBody(createMcpServerSchema, body))
  }

  /**
   * 查询单个出站 MCP Server。
   *
   * @param id 外部 Server ID。
   * @returns Server DTO。
   */
  @Get('mcp/servers/:id')
  mcpServer(@Param('id') id: string) {
    return this.mcp().get(id)
  }

  /**
   * 更新出站 MCP Server。
   *
   * @param id 外部 Server ID。
   * @param body 部分连接配置。
   * @returns 更新后的 Server DTO。
   */
  @Patch('mcp/servers/:id')
  updateMcpServer(@Param('id') id: string, @Body() body: unknown) {
    return this.mcp().update(id, parseBody(updateMcpServerSchema, body))
  }

  /**
   * 删除未被工作流引用的 MCP Server。
   *
   * @param id 外部 Server ID。
   * @returns 删除确认。
   */
  @Delete('mcp/servers/:id')
  removeMcpServer(@Param('id') id: string) {
    return this.mcp().remove(id)
  }

  /**
   * 测试外部 MCP 连接并刷新 tools/list 缓存。
   *
   * @param id 外部 Server ID。
   * @returns 延迟、协议版本与 schema 变化。
   */
  @Post('mcp/servers/:id/test')
  testMcpServer(@Param('id') id: string) {
    return this.mcp().test(id)
  }

  /**
   * 查询已缓存 MCP 工具。
   *
   * @param id 外部 Server ID。
   * @returns 工具 schema 与注解。
   */
  @Get('mcp/servers/:id/tools')
  mcpTools(@Param('id') id: string) {
    return this.mcp().tools(id)
  }

  /**
   * 执行一次不创建工作流运行的 MCP 工具测试。
   *
   * @param id 外部 Server ID。
   * @param tool 工具原始名称。
   * @param body 工具参数。
   * @returns 标准化调用 envelope。
   */
  @Post('mcp/servers/:id/tools/:tool/test')
  testMcpTool(
    @Param('id') id: string,
    @Param('tool') tool: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(mcpToolCallSchema, body)
    return this.mcp().callTool(id, tool, input.arguments)
  }

  /**
   * 停用 MCP Server，保留工具缓存与历史审计。
   *
   * @param id 外部 Server ID。
   * @returns 更新后的 Server DTO。
   */
  @Post('mcp/servers/:id/disable')
  disableMcpServer(@Param('id') id: string) {
    return this.mcp().disable(id)
  }

  /**
   * 查询 MCP 出站与入站调用审计。
   *
   * @param query 方向、状态、工具、客户端与 limit。
   * @returns 已脱敏调用记录。
   */
  @Get('mcp/calls')
  mcpCalls(@Query() query: Record<string, string>) {
    return this.mcp().calls({
      direction: query.direction,
      status: query.status,
      tool: query.tool,
      client: query.client,
      limit: query.limit ? Number(query.limit) : undefined,
    })
  }

  /**
   * 查询工作流已绑定发布版本的 MCP 暴露状态。
   *
   * @param id 外部工作流 ID。
   * @returns 工作流摘要与可选暴露配置。
   */
  @Get('workflows/:id/mcp-exposure')
  workflowMcpExposure(@Param('id') id: string) {
    return this.mcpExposures().getForWorkflow(id)
  }

  /**
   * 创建或更新工作流的入站 MCP 暴露。
   *
   * 暴露始终绑定不可变发布版本，不会读取或运行草稿。
   *
   * @param id 外部工作流 ID。
   * @param body 发布版本、工具定义、认证与并发限制。
   * @returns 更新后的暴露 DTO。
   */
  @Post('workflows/:id/mcp-exposure')
  @HttpCode(200)
  upsertWorkflowMcpExposure(@Param('id') id: string, @Body() body: unknown) {
    return this.mcpExposures().upsert(
      id,
      parseBody(workflowMcpExposureSchema, body),
    )
  }

  /**
   * 轮换工作流入站令牌并立即使旧令牌失效。
   *
   * @param id 外部工作流 ID。
   * @param body 新令牌、作用域和可选过期时间。
   * @returns 不含明文的令牌元数据。
   */
  @Post('workflows/:id/mcp-exposure/rotate-token')
  @HttpCode(200)
  rotateWorkflowMcpToken(@Param('id') id: string, @Body() body: unknown) {
    return this.mcpExposures().rotateToken(
      id,
      parseBody(workflowMcpTokenRotationSchema, body),
    )
  }

  /**
   * 查询入站访问凭据元数据，不返回明文、密文或完整摘要。
   *
   * @returns 凭据掩码、作用域、关联暴露和状态。
   */
  @Get('mcp/access-tokens')
  mcpAccessTokens() {
    return this.mcpExposures().accessTokens()
  }

  /**
   * 为指定入站暴露创建访问令牌。
   *
   * @param body 暴露 ID、新令牌、作用域和可选过期时间。
   * @returns 不含明文的令牌元数据。
   */
  @Post('mcp/access-tokens')
  @HttpCode(201)
  createMcpAccessToken(@Body() body: unknown) {
    const input = parseBody(mcpAccessTokenCreateSchema, body)
    return this.mcpExposures().rotateTokenByExposure(input.exposureId, {
      token: input.token,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    })
  }

  /**
   * 查询模板市场目录。
   *
   * @param query 搜索、分类和排序条件。
   * @returns 模板 DTO 列表。
   */
  @Get('templates')
  templateMarket(@Query() query: Record<string, string>) {
    return this.templates().list({
      search: query.search,
      category: query.category,
      sort: query.sort,
    })
  }

  /**
   * 查询模板详情与全部版本。
   *
   * @param id 模板 ID。
   * @returns 模板 DTO。
   */
  @Get('templates/:id')
  templateDetail(@Param('id') id: string) {
    return this.templates().get(id)
  }

  /**
   * 查询指定模板版本与依赖清单。
   *
   * @param id 模板 ID。
   * @param version 模板版本。
   * @returns 版本 DTO。
   */
  @Get('templates/:id/versions/:version')
  templateVersion(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.templates().version(id, version)
  }

  /**
   * 计算并持久化模板克隆计划。
   *
   * @param id 模板 ID。
   * @param body 目标名称与可选版本。
   * @returns 缺失依赖、阻断项和 planId。
   */
  @Post('templates/:id/clone-plan')
  @HttpCode(200)
  templateClonePlan(@Param('id') id: string, @Body() body: unknown) {
    return this.templates().clonePlan(id, parseBody(templateClonePlanSchema, body))
  }

  /**
   * 消费模板克隆计划并创建新草稿。
   *
   * @param id 模板 ID。
   * @param body planId、目标名称与版本。
   * @returns 导入记录与新草稿。
   */
  @Post('templates/:id/clone')
  @HttpCode(201)
  cloneTemplate(@Param('id') id: string, @Body() body: unknown) {
    return this.templates().clone(id, parseBody(templateCloneSchema, body))
  }

  /**
   * 查询模板导入结果。
   *
   * @param id 导入记录 ID。
   * @returns 工作流、依赖与警告快照。
   */
  @Get('template-imports/:id')
  templateImport(@Param('id') id: string) {
    return this.templates().importResult(id)
  }

  /**
   * 查询插件 registry 条目。
   *
   * @param query 关键词、插件类型与 limit。
   * @returns registry 条目 DTO。
   */
  @Get('registry/entries')
  registryEntries(@Query() query: Record<string, string>) {
    return this.plugins().listEntries({
      search: query.search,
      kind: query.kind,
      limit: query.limit ? Number(query.limit) : undefined,
    })
  }

  /**
   * 查询插件 registry 详情和全部版本。
   *
   * @param id registry entry_id。
   * @returns 插件详情 DTO。
   */
  @Get('registry/entries/:id')
  registryEntry(@Param('id') id: string) {
    return this.plugins().getEntry(id)
  }

  /**
   * 查询指定 registry 版本的不可变 manifest。
   *
   * @param id registry entry_id。
   * @param version 插件版本。
   * @returns 版本 DTO。
   */
  @Get('registry/entries/:id/versions/:version')
  registryVersion(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.plugins().getVersion(id, version)
  }

  /**
   * 计算安装、升级或回滚计划。
   *
   * @param body entryId、action 与 version。
   * @returns 带 planId 的权限和依赖审查结果。
   */
  @Post('registry/install-plan')
  @HttpCode(200)
  registryInstallPlan(@Body() body: unknown) {
    return this.plugins().createInstallPlan(parseBody(pluginInstallPlanSchema, body))
  }

  /**
   * 查询 registry 本地同步状态。
   *
   * @returns 条目、版本和最近同步时间。
   */
  @Get('registry/sync-status')
  registrySyncStatus() {
    return this.plugins().syncStatus()
  }

  /**
   * P1 远程 catalog 同步尚未接入，返回稳定能力错误。
   */
  @Post('registry/sync')
  registrySync() {
    throw new AppError({
      code: 'REGISTRY_REMOTE_SYNC_NOT_IMPLEMENTED',
      message: '远程 registry 同步属于 P1，当前仅提供本地 seed catalog。',
      status: 501,
    })
  }

  /**
   * 查询当前 workspace 的活跃插件安装。
   *
   * @returns 安装生命周期 DTO。
   */
  @Get('plugin-installs')
  pluginInstalls() {
    return this.plugins().listInstalls()
  }

  /**
   * 查询插件安装详情。
   *
   * @param id 外部安装 ID。
   * @returns 凭据、权限和影响工作流。
   */
  @Get('plugin-installs/:id')
  pluginInstall(@Param('id') id: string) {
    return this.plugins().getInstall(id)
  }

  /**
   * 查询插件安装审计。
   *
   * @param id 外部安装 ID。
   * @returns 审计事件列表。
   */
  @Get('plugin-installs/:id/audit')
  pluginInstallAudit(@Param('id') id: string) {
    return this.plugins().audits(id)
  }

  /**
   * 按 planId 安装插件。
   *
   * @param body planId、幂等键和高风险确认。
   * @param idempotencyHeader 可选 Idempotency-Key。
   * @returns 安装记录 DTO。
   */
  @Post('plugin-installs')
  @HttpCode(201)
  installPlugin(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyHeader?: string,
  ) {
    const input = parseBody(pluginInstallSchema, body)
    return this.plugins().install({
      ...input,
      idempotencyKey: idempotencyHeader ?? input.idempotencyKey,
    })
  }

  /**
   * 启用、禁用或配置插件凭据。
   *
   * @param id 外部安装 ID。
   * @param body 启停或 secret:// 凭据。
   * @returns 更新后的安装 DTO。
   */
  @Patch('plugin-installs/:id')
  updatePluginInstall(@Param('id') id: string, @Body() body: unknown) {
    return this.plugins().updateInstall(id, parseBody(pluginInstallUpdateSchema, body))
  }

  /**
   * 按升级计划切换插件版本。
   *
   * @param id 外部安装 ID。
   * @param body planId 与幂等键。
   * @returns 更新后的安装 DTO。
   */
  @Post('plugin-installs/:id/upgrade')
  @HttpCode(200)
  upgradePlugin(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyHeader?: string,
  ) {
    const input = parseBody(pluginLifecycleSchema, body)
    return this.plugins().upgrade(id, {
      ...input,
      idempotencyKey: idempotencyHeader ?? input.idempotencyKey,
    })
  }

  /**
   * 按回滚计划恢复到 previousVersion。
   *
   * @param id 外部安装 ID。
   * @param body planId 与幂等键。
   * @returns 更新后的安装 DTO。
   */
  @Post('plugin-installs/:id/rollback')
  @HttpCode(200)
  rollbackPlugin(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyHeader?: string,
  ) {
    const input = parseBody(pluginLifecycleSchema, body)
    return this.plugins().rollback(id, {
      ...input,
      idempotencyKey: idempotencyHeader ?? input.idempotencyKey,
    })
  }

  /**
   * 软卸载插件并保留凭据、权限、运行与审计历史。
   *
   * @param id 外部安装 ID。
   * @returns 卸载确认。
   */
  @Delete('plugin-installs/:id')
  uninstallPlugin(@Param('id') id: string) {
    return this.plugins().uninstall(id)
  }

  /**
   * 兼容旧插件目录路径。
   *
   * @returns registry 条目 DTO。
   */
  @Get('plugins')
  legacyPlugins() {
    return this.plugins().listEntries()
  }

  /**
   * 查询 Skills 目录。
   * @returns Skills DTO。
   */
  @Get('skills')
  skills() {
    return this.catalog().skills()
  }
}

/**
 * 原生 Node 请求扩展，用于读取 Nest 已解析的 JSON 请求体。
 */
interface McpHttpRequest extends IncomingMessage {
  body?: unknown
}

/**
 * 对外提供 Workflow as MCP Tool 的 Streamable HTTP 端点。
 *
 * 该控制器只负责 MCP 协议适配；认证、版本绑定、运行创建和审计全部委托
 * 给独立入站仓库，避免与出站 Server 生命周期耦合。
 */
@Controller()
class McpGatewayController {
  /**
   * 注入数据库服务。
   *
   * @param database 数据库与默认 workspace。
   */
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * 接收 MCP Streamable HTTP JSON-RPC 请求。
   *
   * @param request 原生 HTTP 请求。
   * @param response 原生 HTTP 响应。
   * @param body Nest 已解析的 JSON 请求体。
   */
  @Post('mcp')
  async handleMcp(
    @Req() request: McpHttpRequest,
    @Res() response: ServerResponse,
    @Body() body: unknown,
  ) {
    const repository = new McpExposureRepository(
      this.database.sql,
      this.database.workspaceId,
    )
    const host = loadEnvironment().API_HOST
    const clientId = requestHeader(request, 'x-ai-reflow-client')
      ?? requestHeader(request, 'user-agent')
      ?? 'mcp-client'
    let exposures: AuthenticatedMcpExposure[]
    try {
      exposures = await repository.authenticate(
        requestHeader(request, 'authorization'),
        requestHeader(request, 'x-api-key'),
        isLoopbackHost(host),
      )
    } catch (error) {
      sendMcpHttpError(response, error)
      return
    }

    const server = createMcpServer(repository, exposures, clientId)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    const closeSession = () => {
      void transport.close()
      void server.close()
    }
    response.once('close', closeSession)
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch (error) {
      if (!response.headersSent) sendMcpHttpError(response, error)
      else response.end()
    } finally {
      if (response.writableEnded) {
        response.off('close', closeSession)
        closeSession()
      }
    }
  }

  /**
   * 明确拒绝无状态的 GET SSE 请求。
   *
   * @param _request 原生 HTTP 请求。
   * @param response 原生 HTTP 响应。
   */
  @Get('mcp')
  mcpGet(_request: IncomingMessage, @Res() response: ServerResponse) {
    sendMethodNotAllowed(response, 'GET')
  }

  /**
   * 明确拒绝删除会话请求。
   *
   * @param _request 原生 HTTP 请求。
   * @param response 原生 HTTP 响应。
   */
  @Delete('mcp')
  mcpDelete(_request: IncomingMessage, @Res() response: ServerResponse) {
    sendMethodNotAllowed(response, 'DELETE')
  }
}

/**
 * 创建单次 MCP 请求使用的协议 Server。
 *
 * @param repository 入站暴露与运行仓库。
 * @param exposures 当前令牌授权的暴露。
 * @param clientId 外部客户端标识。
 * @returns 已注册 `tools/list` 与 `tools/call` 的 MCP Server。
 */
function createMcpServer(
  repository: McpExposureRepository,
  exposures: AuthenticatedMcpExposure[],
  clientId: string,
) {
  const server = new Server(
    { name: 'ai-reflow', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        '调用 run_ 前缀工具会创建固定发布版本的生产运行；使用 get_run 与 cancel_run 查询或取消。',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listMcpTools(exposures),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name
    const args = asMcpRecord(request.params.arguments)
    try {
      if (name === 'get_run') {
        const runId = requireRunId(args)
        const run = await repository.getRunScoped(runId, exposures, clientId)
        return mcpToolResult(run, false, true)
      }
      if (name === 'cancel_run') {
        const runId = requireRunId(args)
        const run = await repository.cancelRunScoped(runId, exposures, clientId)
        return mcpToolResult(run, false, true)
      }
      const exposure = exposures.find((item) => item.toolName === name)
      if (!exposure) {
        return mcpToolFailure({
          code: 'MCP_TOOL_NOT_FOUND',
          message: `工具 ${name} 不存在或不在当前令牌作用域内。`,
        })
      }
      const run = await repository.runExposure(
        exposure,
        args,
        clientId,
        String(extra.requestId),
      )
      return mcpToolResult(
        run,
        false,
        exposure.outputMode === 'structured',
      )
    } catch (error) {
      return mcpToolFailure(toMcpError(error))
    }
  })

  return server
}

/**
 * 根据当前令牌作用域构造 `tools/list` 结果。
 *
 * @param exposures 当前令牌授权的暴露。
 * @returns 只包含当前令牌可调用工具的 MCP 工具描述。
 */
function listMcpTools(exposures: AuthenticatedMcpExposure[]) {
  const tools: Array<Record<string, unknown>> = exposures
    .filter((exposure) => exposure.scopes.includes('workflow:run'))
    .map((exposure) => ({
      name: exposure.toolName,
      title: exposure.title,
      description: exposure.description,
      inputSchema: normalizeMcpInputSchema(exposure.inputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        exposureId: exposure.publicId,
        workflowId: exposure.workflowPublicId,
        workflowVersionId: exposure.workflowVersionPublicId,
        workflowVersion: exposure.workflowVersion,
        schemaHash: exposure.versionSchemaHash,
      },
    }))
  if (exposures.some((exposure) => exposure.scopes.includes('run:read'))) {
    tools.push({
      name: 'get_run',
      title: '查询 MCP 运行',
      description: '查询当前访问令牌作用域内的 AI Reflow 运行详情。',
      inputSchema: runIdInputSchema(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })
  }
  if (exposures.some((exposure) => exposure.scopes.includes('run:cancel'))) {
    tools.push({
      name: 'cancel_run',
      title: '取消 MCP 运行',
      description: '请求取消当前访问令牌作用域内的 AI Reflow 运行。',
      inputSchema: runIdInputSchema(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })
  }
  return tools
}

/**
 * 统一 MCP 输入 schema，保证 `tools/list` 的结构符合协议要求。
 *
 * @param schema 发布版本锁定的 start.inputSchema。
 * @returns 至少包含 object properties 的 JSON Schema。
 */
function normalizeMcpInputSchema(schema: Record<string, unknown>) {
  return {
    ...schema,
    type: 'object',
    properties: asMcpRecord(schema.properties),
  }
}

/**
 * 构造 runId 参数 schema。
 *
 * @returns `get_run` 与 `cancel_run` 共用的 JSON Schema。
 */
function runIdInputSchema() {
  return {
    type: 'object',
    properties: {
      runId: {
        type: 'string',
        description: 'AI Reflow 外部运行 ID，例如 run_xxx。',
      },
    },
    required: ['runId'],
    additionalProperties: false,
  }
}

/**
 * 构造标准化 MCP 工具成功结果。
 *
 * @param value 运行 DTO。
 * @param isError 是否为错误结果。
 * @param structured 是否同时返回 structuredContent。
 * @returns MCP `tools/call` 结果。
 */
function mcpToolResult(
  value: unknown,
  isError: boolean,
  structured: boolean,
) {
  const structuredValue = asMcpRecord(value)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(structured ? { structuredContent: structuredValue } : {}),
    isError,
  }
}

/**
 * 构造标准化 MCP 工具错误结果。
 *
 * @param error 已脱敏错误。
 * @returns 带稳定错误码的 MCP `tools/call` 结果。
 */
function mcpToolFailure(error: {
  code: string
  message: string
  details?: unknown
}) {
  const payload = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  }
}

/**
 * 将未知异常映射为可返回给 MCP 客户端的稳定错误。
 *
 * @param error 控制器捕获的异常。
 * @returns 错误码、消息和可选详情。
 */
function toMcpError(error: unknown) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    }
  }
  console.error('MCP 工具调用失败', error)
  return {
    code: 'MCP_INTERNAL_ERROR',
    message: 'MCP 工具调用失败，请稍后重试。',
  }
}

/**
 * 从工具参数读取必填 runId。
 *
 * @param args MCP 工具参数。
 * @returns 外部运行 ID。
 */
function requireRunId(args: Record<string, unknown>) {
  const runId = args.runId
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new AppError({
      code: 'MCP_INPUT_INVALID',
      message: '缺少必填参数：runId。',
      status: 422,
    })
  }
  return runId.trim()
}

/**
 * 读取单个请求头值。
 *
 * @param request 原生 HTTP 请求。
 * @param name 小写请求头名。
 * @returns 请求头字符串或 undefined。
 */
function requestHeader(request: IncomingMessage, name: string) {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * 判断监听地址是否为回环地址。
 *
 * @param host 服务监听地址。
 * @returns 是否允许匿名本地 MCP 工具。
 */
function isLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase()
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1'
}

/**
 * 将仓库异常写为 MCP HTTP 错误响应。
 *
 * @param response 原生 HTTP 响应。
 * @param error 捕获的异常。
 */
function sendMcpHttpError(response: ServerResponse, error: unknown) {
  const status = error instanceof AppError ? error.status : 500
  const code = error instanceof AppError ? error.code : 'MCP_INTERNAL_ERROR'
  const message = error instanceof AppError
    ? error.message
    : 'MCP 网关处理请求失败。'
  if (!(error instanceof AppError)) console.error('MCP HTTP 请求失败', error)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: status === 401 ? -32001 : -32603, message, data: { code } },
    id: null,
  }))
}

/**
 * 写明确的 405 响应。
 *
 * @param response 原生 HTTP 响应。
 * @param method 被拒绝的方法。
 */
function sendMethodNotAllowed(response: ServerResponse, method: string) {
  response.writeHead(405, {
    'Content-Type': 'application/json; charset=utf-8',
    Allow: 'POST',
  })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: `${method} 不受支持；当前入站 MCP 使用无状态 POST 请求。`,
    },
    id: null,
  }))
}

/**
 * 将任意 JSON 值读取为对象。
 *
 * @param value 任意值。
 * @returns 对象或空对象。
 */
function asMcpRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * 解析请求体并抛出可定位字段的 Zod 错误。
 * @param schema 请求体 schema。
 * @param value 原始请求体。
 * @returns 已校验数据。
 */
function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new AppError({
    code: 'REQUEST_INVALID',
    message: '请求参数未通过校验。',
    status: 400,
    issues: parsed.error.issues.map((issue) => ({
      code: 'REQUEST_INVALID',
      message: issue.message,
      field: issue.path.join('.'),
    })),
  })
}

/**
 * server NestJS 模块。
 */
@Module({
  controllers: [ApiController, McpGatewayController],
  providers: [DatabaseService],
})
class ServerModule {}

/**
 * 启动控制面服务并优雅关闭数据库连接。
 */
async function bootstrap() {
  const config = loadEnvironment()
  const app = await NestFactory.create(ServerModule, { logger: ['error', 'warn', 'log'] })
  app.enableShutdownHooks()
  app.enableCors({
    origin: [config.WEB_ORIGIN, 'http://127.0.0.1:5174', 'http://localhost:5174'],
    credentials: false,
    allowedHeaders: [
      'Content-Type',
      'Idempotency-Key',
      'Last-Event-ID',
      'Authorization',
      'X-API-Key',
      'Mcp-Session-Id',
      'Mcp-Protocol-Version',
      'X-AI-Reflow-Client',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
  app.useGlobalFilters(new ApiExceptionFilter())
  await app.listen(config.API_PORT, config.API_HOST)
  console.log(`AI Reflow API 已启动：http://${config.API_HOST}:${config.API_PORT}/api/health`)
}

bootstrap().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
