import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { iso } from './dto'
import { jsonb, notFound, publicId } from './helpers'

export interface KnowledgeIngestJobRow {
  id: string
  public_id: string
  workspace_id: string
  document_id: string
  kind: 'ingest' | 'retry' | 'reindex'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  stage: 'parse' | 'normalize' | 'chunk' | 'embedding' | 'index'
  attempt: number
  max_attempts: number
  next_retry_at: Date | null
  error_code: string | null
  error_message: string | null
  worker_id: string | null
  lease_expires_at: Date | null
  created_at: Date
  updated_at: Date
  document_public_id?: string
  document_name?: string
  document_status?: string
}

export interface ClaimedIngestJob {
  id: string
  publicId: string
  kind: KnowledgeIngestJobRow['kind']
  stage: KnowledgeIngestJobRow['stage']
  attempt: number
  maxAttempts: number
  documentId: string
  documentPublicId: string
  documentName: string
  documentMime: string
  documentExtension: string
  documentSizeBytes: number
  documentSha256: string
  storageKey: string
  knowledgeBaseId: string
  knowledgeBasePublicId: string
  knowledgeBaseName: string
  embeddingProvider: string
  embeddingModel: string
  embeddingDimension: number
}

/**
 * 计算 ingest 重试退避，5 秒起指数增长，封顶 5 分钟。
 * @param attempt 已失败的尝试次数，从 1 开始。
 * @returns 下一次重试延迟毫秒数。
 */
export function nextIngestRetryDelayMs(attempt: number) {
  return Math.min(300_000, 5_000 * 2 ** Math.max(0, attempt - 1))
}

/**
 * 校验 embedding 向量维度，防止不同模型向量混存。
 * @param expected 知识库声明的维度。
 * @param actual Provider 返回的维度。
 */
export function assertVectorDimension(expected: number, actual: number) {
  if (expected !== actual) {
    throw new AppError({
      code: 'EMBEDDING_DIMENSION_MISMATCH',
      message: `embedding 维度不一致：知识库为 ${expected}，Provider 返回 ${actual}。`,
      status: 422,
      details: { expected, actual },
    })
  }
}

/**
 * 把 ingest job 行投影为 API DTO。
 * @param row 作业行。
 * @returns 作业 DTO。
 */
export function toKnowledgeIngestJobDto(row: KnowledgeIngestJobRow) {
  return {
    id: row.public_id,
    documentId: row.document_public_id,
    documentName: row.document_name,
    documentStatus: row.document_status,
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextRetryAt: iso(row.next_retry_at),
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    workerId: row.worker_id ?? undefined,
    leaseExpiresAt: iso(row.lease_expires_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

/**
 * 文档 ingest 作业队列与阶段状态的数据访问层。
 */
export class KnowledgeIngestRepository {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 为文档创建 ingest、重试或重建作业。
   * @param documentId 外部文档 ID。
   * @param kind 作业类型。
   * @returns 新作业 DTO。
   */
  async createJob(
    documentId: string,
    kind: KnowledgeIngestJobRow['kind'] = 'ingest',
  ) {
    const document = await this.requireDocument(documentId)
    const jobPublicId = publicId('kij')
    await this.sql`
      insert into knowledge_ingest_jobs (
        public_id, workspace_id, document_id, kind, status, stage,
        attempt, max_attempts
      )
      values (
        ${jobPublicId}, ${this.workspaceId}, ${document.id}, ${kind},
        'queued', 'parse', 0, 3
      )
    `
    await this.sql`
      update documents
      set
        status = 'queued',
        stage_error = null,
        updated_at = now()
      where workspace_id = ${this.workspaceId} and id = ${document.id}
    `
    return this.getJob(jobPublicId)
  }

  /**
   * 读取作业详情。
   * @param jobId 外部作业 ID。
   * @returns 作业 DTO。
   */
  async getJob(jobId: string) {
    const [row] = await this.sql<KnowledgeIngestJobRow[]>`
      select
        j.*, d.public_id as document_public_id, d.name as document_name,
        d.status as document_status
      from knowledge_ingest_jobs j
      join documents d on d.id = j.document_id
      where j.workspace_id = ${this.workspaceId}
        and j.public_id = ${jobId}
      limit 1
    `
    if (!row) throw notFound('知识库入库作业')
    return toKnowledgeIngestJobDto(row)
  }

  /**
   * 查询文档最近的入库作业。
   * @param documentId 外部文档 ID。
   * @returns 作业 DTO 列表。
   */
  async jobsForDocument(documentId: string) {
    const document = await this.requireDocument(documentId)
    const rows = await this.sql<KnowledgeIngestJobRow[]>`
      select
        j.*, d.public_id as document_public_id, d.name as document_name,
        d.status as document_status
      from knowledge_ingest_jobs j
      join documents d on d.id = j.document_id
      where j.workspace_id = ${this.workspaceId}
        and j.document_id = ${document.id}
      order by j.created_at desc
      limit 20
    `
    return rows.map(toKnowledgeIngestJobDto)
  }

  /**
   * 使用 SKIP LOCKED 领取到期作业。
   * @param workerId worker ID。
   * @param leaseMs 租约毫秒数。
   * @returns 已领取作业或 null。
   */
  async claimNext(
    workerId: string,
    leaseMs = 120_000,
  ): Promise<ClaimedIngestJob | null> {
    return this.sql.begin(async (transaction) => {
      await transaction`
        update knowledge_ingest_jobs
        set
          status = 'queued',
          worker_id = null,
          lease_expires_at = null,
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and status = 'running'
          and lease_expires_at is not null
          and lease_expires_at < now()
      `
      const [candidate] = await transaction<Array<{ id: string }>>`
        select id
        from knowledge_ingest_jobs
        where workspace_id = ${this.workspaceId}
          and status = 'queued'
          and (next_retry_at is null or next_retry_at <= now())
        order by created_at
        for update skip locked
        limit 1
      `
      if (!candidate) return null
      await transaction`
        update knowledge_ingest_jobs
        set
          status = 'running',
          worker_id = ${workerId},
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          attempt = attempt + 1,
          updated_at = now()
        where id = ${candidate.id}
      `
      const [row] = await transaction<Array<KnowledgeIngestJobRow & {
        document_public_id: string
        document_name: string
        document_mime: string
        document_extension: string
        document_size_bytes: number
        document_sha256: string
        storage_key: string
        kb_internal_id: string
        kb_public_id: string
        kb_name: string
        embedding_provider: string
        embedding_model: string
        embedding_dimension: number
      }>>`
        select
          j.*, d.public_id as document_public_id, d.name as document_name,
          d.mime as document_mime, d.extension as document_extension,
          d.size_bytes as document_size_bytes, d.sha256 as document_sha256,
          d.storage_key,
          kb.id as kb_internal_id, kb.public_id as kb_public_id,
          kb.name as kb_name, kb.embedding_provider, kb.embedding_model,
          kb.embedding_dimension
        from knowledge_ingest_jobs j
        join documents d on d.id = j.document_id
        join knowledge_bases kb on kb.id = d.kb_id
        where j.id = ${candidate.id}
      `
      return {
        id: row.id,
        publicId: row.public_id,
        kind: row.kind,
        stage: row.stage,
        attempt: row.attempt,
        maxAttempts: row.max_attempts,
        documentId: row.document_id,
        documentPublicId: row.document_public_id,
        documentName: row.document_name,
        documentMime: row.document_mime,
        documentExtension: row.document_extension,
        documentSizeBytes: Number(row.document_size_bytes),
        documentSha256: row.document_sha256,
        storageKey: row.storage_key,
        knowledgeBaseId: row.kb_internal_id,
        knowledgeBasePublicId: row.kb_public_id,
        knowledgeBaseName: row.kb_name,
        embeddingProvider: row.embedding_provider,
        embeddingModel: row.embedding_model,
        embeddingDimension: row.embedding_dimension,
      }
    })
  }

  /**
   * 续约 ingest 作业。
   * @param jobInternalId 作业内部 ID。
   * @param workerId worker ID。
   * @param leaseMs 租约毫秒数。
   */
  async heartbeat(jobInternalId: string, workerId: string, leaseMs = 120_000) {
    await this.sql`
      update knowledge_ingest_jobs
      set lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
      where id = ${jobInternalId}
        and workspace_id = ${this.workspaceId}
        and worker_id = ${workerId}
        and status = 'running'
    `
  }

  /**
   * 更新当前阶段和文档展示状态。
   * @param jobInternalId 作业内部 ID。
   * @param stage 新阶段。
   */
  async updateStage(
    jobInternalId: string,
    stage: KnowledgeIngestJobRow['stage'],
  ) {
    const documentStatus =
      stage === 'parse'
        ? 'parsing'
        : stage === 'normalize' || stage === 'chunk'
          ? 'chunking'
          : 'embedding'
    await this.sql.begin(async (transaction) => {
      const [job] = await transaction<Array<{ document_id: string }>>`
        update knowledge_ingest_jobs
        set stage = ${stage}, updated_at = now()
        where id = ${jobInternalId}
          and workspace_id = ${this.workspaceId}
        returning document_id
      `
      if (!job) return
      await transaction`
        update documents
        set status = ${documentStatus}, stage_error = null, updated_at = now()
        where id = ${job.document_id}
          and workspace_id = ${this.workspaceId}
      `
    })
  }

  /**
   * 标记作业成功并更新文档状态。
   * @param jobInternalId 作业内部 ID。
   * @param metadata 切片数量、embedding 模型等摘要。
   */
  async complete(
    jobInternalId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.sql.begin(async (transaction) => {
      const [job] = await transaction<Array<{ document_id: string }>>`
        update knowledge_ingest_jobs
        set
          status = 'succeeded',
          stage = 'index',
          error_code = null,
          error_message = null,
          lease_expires_at = null,
          updated_at = now()
        where id = ${jobInternalId}
          and workspace_id = ${this.workspaceId}
        returning document_id
      `
      if (!job) return
      await transaction`
        update documents
        set
          status = 'ready',
          preview_status = 'none',
          stage_error = null,
          metadata = metadata || ${jsonb(transaction, metadata)},
          updated_at = now()
        where id = ${job.document_id}
          and workspace_id = ${this.workspaceId}
      `
    })
  }

  /**
   * 记录失败阶段；可重试错误按退避重新入队。
   * @param jobInternalId 作业内部 ID。
   * @param input 阶段、错误和是否可重试。
   * @returns 作业状态摘要。
   */
  async fail(
    jobInternalId: string,
    input: {
      stage: KnowledgeIngestJobRow['stage']
      code: string
      message: string
      retryable: boolean
    },
  ) {
    return this.sql.begin(async (transaction) => {
      const [job] = await transaction<KnowledgeIngestJobRow[]>`
        select *
        from knowledge_ingest_jobs
        where id = ${jobInternalId}
          and workspace_id = ${this.workspaceId}
        for update
      `
      if (!job) throw notFound('知识库入库作业')
      const retry =
        input.retryable &&
        job.attempt < job.max_attempts &&
        job.status !== 'cancelled'
      const status = retry ? 'queued' : 'failed'
      const delayMs = retry ? nextIngestRetryDelayMs(job.attempt) : 0
      await transaction`
        update knowledge_ingest_jobs
        set
          status = ${status},
          stage = ${input.stage},
          error_code = ${input.code},
          error_message = ${input.message},
          next_retry_at = ${retry
            ? transaction`now() + (${delayMs} * interval '1 millisecond')`
            : null},
          worker_id = null,
          lease_expires_at = null,
          updated_at = now()
        where id = ${job.id}
      `
      await transaction`
        update documents
        set
          status = ${retry ? 'queued' : 'failed'},
          stage_error = ${jsonb(transaction, {
            stage: input.stage,
            code: input.code,
            message: input.message,
            retryable: input.retryable,
          })},
          updated_at = now()
        where id = ${job.document_id}
          and workspace_id = ${this.workspaceId}
      `
      return {
        jobId: job.public_id,
        status,
        stage: input.stage,
        retryAt:
          retry && job.next_retry_at
            ? iso(job.next_retry_at)
            : retry
              ? new Date(Date.now() + delayMs).toISOString()
              : undefined,
      }
    })
  }

  /**
   * 取消排队或运行中的作业。
   * @param jobId 外部作业 ID。
   * @returns 最新状态。
   */
  async cancel(jobId: string) {
    const [row] = await this.sql<KnowledgeIngestJobRow[]>`
      update knowledge_ingest_jobs
      set
        status = 'cancelled',
        worker_id = null,
        lease_expires_at = null,
        updated_at = now()
      where workspace_id = ${this.workspaceId}
        and public_id = ${jobId}
        and status in ('queued', 'running')
      returning *
    `
    if (row) return this.getJob(row.public_id)
    const existing = await this.getJob(jobId)
    return existing
  }

  private async requireDocument(documentId: string) {
    const [document] = await this.sql<Array<{
      id: string
      name: string
      extension: string
    }>>`
      select id, name, extension
      from documents
      where workspace_id = ${this.workspaceId}
        and public_id = ${documentId}
      limit 1
    `
    if (!document) throw notFound('文档')
    return document
  }
}
