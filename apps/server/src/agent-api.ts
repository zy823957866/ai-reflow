import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import {
  AppError,
  createAgentConversationSchema,
  createAgentSchema,
  retryAgentMessageSchema,
  sendAgentMessageSchema,
  testAgentSchema,
  updateAgentConversationSchema,
  updateAgentSchema,
} from '@ai-reflow/core'
import type {
  AgentConversationRepository,
  AgentInvocationRepository,
  AgentRepository,
  KnowledgeIngestRepository,
  KnowledgeRepository,
} from '@ai-reflow/platform'
import type { ZodType } from 'zod'

export interface AgentApiRepositories {
  agents: AgentRepository
  conversations: AgentConversationRepository
  invocations: AgentInvocationRepository
  knowledge: KnowledgeRepository
  ingestJobs: KnowledgeIngestRepository
}

export interface UploadedKnowledgeFile {
  filename: string
  mime: string
  bytes: Uint8Array
  declaredSize?: number
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const SUPPORTED_UPLOADS: Record<string, Set<string>> = {
  txt: new Set(['text/plain']),
  md: new Set(['text/markdown', 'text/x-markdown', 'text/plain']),
  html: new Set(['text/html']),
  htm: new Set(['text/html']),
  csv: new Set(['text/csv', 'application/csv']),
  pdf: new Set(['application/pdf']),
  docx: new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  xlsx: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
}

/**
 * Agent、会话、调用和文档入库 API 的业务编排层。
 */
export class AgentApiOperations {
  constructor(private readonly repositories: AgentApiRepositories) {}

  listAgents() {
    return this.repositories.agents.list()
  }

  getAgent(id: string) {
    return this.repositories.agents.get(id)
  }

  async createAgent(body: unknown) {
    return this.repositories.agents.create(
      parseBody(createAgentSchema, body),
    )
  }

  updateAgent(id: string, body: unknown) {
    return this.repositories.agents.update(
      id,
      parseBody(updateAgentSchema, body),
    )
  }

  archiveAgent(id: string) {
    return this.repositories.agents.archive(id)
  }

  testAgent(id: string, body: unknown) {
    const input = parseBody(testAgentSchema, body ?? {})
    return this.repositories.invocations.createTestInvocation(id, input)
  }

  listConversations(agentId: string) {
    return this.repositories.conversations.list(agentId)
  }

  createConversation(agentId: string, body: unknown) {
    return this.repositories.conversations.create(
      agentId,
      parseBody(createAgentConversationSchema, body ?? {}),
    )
  }

  getConversation(id: string) {
    return this.repositories.conversations.get(id)
  }

  updateConversation(id: string, body: unknown) {
    return this.repositories.conversations.update(
      id,
      parseBody(updateAgentConversationSchema, body),
    )
  }

  messages(id: string, query: Record<string, string>) {
    return this.repositories.conversations.messages(
      id,
      Number(query.after ?? query.afterSeq ?? 0),
      Number(query.limit ?? 200),
    )
  }

  sendMessage(
    id: string,
    body: unknown,
    idempotencyKey?: string,
  ) {
    return this.repositories.conversations.sendMessage(
      id,
      {
        ...parseBody(sendAgentMessageSchema, body),
        idempotencyKey,
      },
    )
  }

  retryMessage(id: string, body: unknown) {
    const input = parseBody(retryAgentMessageSchema, body)
    return this.repositories.conversations.retryMessage(
      id,
      input.userMessageId,
    )
  }

  getInvocation(id: string) {
    return this.repositories.invocations.get(id)
  }

  invocationEvents(
    id: string,
    query: Record<string, string>,
  ) {
    return this.repositories.invocations.eventsPage(
      id,
      Number(query.after ?? query.afterSeq ?? 0),
      Number(query.limit ?? 200),
    )
  }

  cancelInvocation(id: string) {
    return this.repositories.invocations.cancel(id)
  }

  resumeInvocation(id: string) {
    return this.repositories.invocations.resume(id)
  }

  uploadDocument(
    knowledgeBaseId: string,
    file: UploadedKnowledgeFile,
  ) {
    return this.repositories.knowledge.upload({
      knowledgeBaseId,
      ...validateKnowledgeUpload(file),
      bytes: file.bytes,
    })
  }

  retryDocument(id: string) {
    return this.repositories.knowledge.retryDocument(id)
  }

  reindexDocument(id: string) {
    return this.repositories.knowledge.reindexDocument(id)
  }

  getIngestJob(id: string) {
    return this.repositories.ingestJobs.getJob(id)
  }

  cancelIngestJob(id: string) {
    return this.repositories.ingestJobs.cancel(id)
  }
}

/**
 * 校验上传扩展名、MIME、大小并计算 sha256。
 * @param file 上传文件元数据与字节。
 * @returns 可写 documents 表的字段。
 */
export function validateKnowledgeUpload(file: UploadedKnowledgeFile) {
  const name = basename(file.filename)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!name) {
    throw new AppError({
      code: 'KNOWLEDGE_FILE_NAME_INVALID',
      message: '文件名不能为空。',
      status: 422,
    })
  }
  const extension = name.includes('.')
    ? name.split('.').at(-1)!.toLowerCase()
    : ''
  if (extension === 'doc' || extension === 'xls') {
    throw new AppError({
      code: 'KNOWLEDGE_LEGACY_OFFICE_UNSUPPORTED',
      message: '不支持旧版 Office 文件，请转换为 DOCX 或 XLSX。',
      status: 415,
    })
  }
  const allowedMimes = SUPPORTED_UPLOADS[extension]
  if (!allowedMimes) {
    throw new AppError({
      code: 'KNOWLEDGE_FILE_TYPE_UNSUPPORTED',
      message: `不支持文件类型 .${extension || 'unknown'}。`,
      status: 415,
    })
  }
  const sizeBytes = file.declaredSize ?? file.bytes.byteLength
  if (
    sizeBytes <= 0 ||
    file.bytes.byteLength <= 0
  ) {
    throw new AppError({
      code: 'KNOWLEDGE_FILE_EMPTY',
      message: '上传文件不能为空。',
      status: 422,
    })
  }
  if (
    sizeBytes > MAX_UPLOAD_BYTES ||
    file.bytes.byteLength > MAX_UPLOAD_BYTES
  ) {
    throw new AppError({
      code: 'KNOWLEDGE_FILE_TOO_LARGE',
      message: '单个文件不能超过 50 MB。',
      status: 413,
    })
  }
  const mime = file.mime.split(';', 1)[0].trim().toLowerCase()
  if (!allowedMimes.has(mime)) {
    throw new AppError({
      code: 'KNOWLEDGE_MIME_MISMATCH',
      message: `文件 MIME ${mime || 'unknown'} 与扩展名 .${extension} 不匹配。`,
      status: 415,
    })
  }
  return {
    name,
    extension,
    mime,
    sizeBytes: file.bytes.byteLength,
    sha256: createHash('sha256').update(file.bytes).digest('hex'),
  }
}

/**
 * 读取 SSE 初始游标，Last-Event-ID 优先于 query。
 * @param headers 请求头。
 * @param query 查询参数。
 * @returns 非负事件序号。
 */
export function initialEventSeq(
  headers: Record<string, string | string[] | undefined>,
  query: Record<string, string | string[] | undefined>,
) {
  const header = firstValue(headers['last-event-id'])
  const value = header ?? firstValue(query.after) ?? firstValue(query.afterSeq)
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
}

/**
 * 过滤游标之前的事件并按 seq 排序，保证 SSE backlog 顺序。
 * @param events 事件列表。
 * @param afterSeq 初始游标。
 * @returns 有序事件。
 */
export function orderEventBacklog<T extends { seq: number }>(
  events: T[],
  afterSeq: number,
) {
  return events
    .filter((event) => event.seq > afterSeq)
    .sort((left, right) => left.seq - right.seq)
}

/**
 * 格式化单条 SSE 事件。
 * @param event 带 seq 和 type 的事件。
 * @returns SSE frame。
 */
export function sseFrame(
  event: { seq: number; type: string } & Record<string, unknown>,
) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function isTerminalInvocationStatus(status: string) {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
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

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
