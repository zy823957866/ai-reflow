import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import {
  createObjectStorage,
  type ObjectStorage,
} from '../../storage/object-storage'
import { normalizeFilenameEncoding } from '../../storage/filename'
import { iso } from './dto'
import { jsonb, notFound, publicId } from './helpers'
import { KnowledgeIngestRepository } from './knowledge-ingest-repository'
import {
  knowledgeChunkStrategyLabel,
  normalizeKnowledgeChunkSettings,
  type KnowledgeChunkSettings,
} from './knowledge-chunk-settings'

export interface KnowledgeListQuery {
  search?: string
  status?: string
}

export interface KnowledgeDocumentQuery {
  status?: string
  type?: string
  search?: string
}

export interface KnowledgeSearchChunk {
  id: string
  documentId: string
  documentName: string
  chunkIndex: number
  text: string
  metadata: Record<string, unknown>
  score: number
  knowledgeBaseId: string
  fulltextScore?: number
  vectorScore?: number
}

export interface KnowledgeChunkInput {
  content: string
  tokenCount: number
  metadata: Record<string, unknown>
}

export interface PendingKnowledgeChunk {
  chunkIndex: number
  content: string
}

export interface KnowledgeEmbeddingConfig {
  provider: string
  model: string
  dimension: number
}

/**
 * 当前部署只允许本地 768 维 embedding 模型，忽略客户端自报配置。
 * @returns 固定 provider、模型和维度。
 */
export function normalizeKnowledgeEmbeddingConfig(
  _input: {
    embeddingProvider?: string
    embeddingModel?: string
    embeddingDimension?: number
  } = {},
) {
  return {
    embeddingProvider: 'ollama',
    embeddingModel: 'nomic-embed-text',
    embeddingDimension: 768,
  }
}

/**
 * 知识库、文档、切片、检索和预览管理的数据访问层。
 */
export class KnowledgeRepository {
  /**
   * 创建当前 workspace 的知识库仓库。
   *
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
    private readonly storage: ObjectStorage = createObjectStorage(),
  ) {}

  /**
   * 查询知识库聚合统计。
   *
   * @param query 名称搜索与状态筛选。
   * @returns 知识库 DTO 列表。
   */
  async list(query: KnowledgeListQuery = {}) {
    const rows = await this.sql<Array<{
      id: string
      public_id: string
      name: string
      description: string
      status: string
      embedding_model: string
      embedding_dimension: number
      metadata: Record<string, unknown>
      updated_at: Date
      documents: number
      chunks: number
    }>>`
      select
        kb.id, kb.public_id, kb.name, kb.description, kb.status,
        kb.embedding_model, kb.embedding_dimension, kb.metadata, kb.updated_at,
        count(distinct d.id)::int as documents,
        count(c.id)::int as chunks
      from knowledge_bases kb
      left join documents d
        on d.kb_id = kb.id and d.workspace_id = kb.workspace_id
      left join document_chunks c
        on c.document_id = d.id and c.workspace_id = kb.workspace_id
      where kb.workspace_id = ${this.workspaceId}
        ${query.status ? this.sql`and kb.status = ${query.status}` : this.sql``}
        ${query.search
          ? this.sql`and (kb.name ilike ${`%${query.search}%`} or kb.description ilike ${`%${query.search}%`})`
          : this.sql``}
      group by kb.id
      order by kb.updated_at desc
    `
    return rows.map((row) => this.toDto(row))
  }

  /**
   * 查询单个知识库及其统计。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @returns 知识库 DTO。
   */
  async get(knowledgeBaseId: string) {
    const [row] = await this.sql<Array<{
      id: string
      public_id: string
      name: string
      description: string
      status: string
      embedding_model: string
      embedding_dimension: number
      metadata: Record<string, unknown>
      updated_at: Date
      documents: number
      chunks: number
    }>>`
      select
        kb.id, kb.public_id, kb.name, kb.description, kb.status,
        kb.embedding_model, kb.embedding_dimension, kb.metadata, kb.updated_at,
        count(distinct d.id)::int as documents,
        count(c.id)::int as chunks
      from knowledge_bases kb
      left join documents d
        on d.kb_id = kb.id and d.workspace_id = kb.workspace_id
      left join document_chunks c
        on c.document_id = d.id and c.workspace_id = kb.workspace_id
      where kb.workspace_id = ${this.workspaceId}
        and kb.public_id = ${knowledgeBaseId}
      group by kb.id
      limit 1
    `
    if (!row) throw notFound('知识库')
    return this.toDto(row)
  }

  /**
   * 创建空知识库。P0 的 embedding 模型由部署配置提供。
   *
   * @param input 名称、描述和 embedding 配置。
   * @returns 新知识库 DTO。
   */
  async create(input: {
    name: string
    description?: string
    embeddingProvider?: string
    embeddingModel?: string
    embeddingDimension?: number
    chunkSize?: number
    overlapSize?: number
    separator?: string
  }) {
    const embedding = normalizeKnowledgeEmbeddingConfig(input)
    const chunkSettings = normalizeKnowledgeChunkSettings(input)
    const [created] = await this.sql<Array<{ public_id: string }>>`
      insert into knowledge_bases (
        public_id, workspace_id, name, description, embedding_provider,
        embedding_model, embedding_dimension, status, metadata
      )
      values (
        ${publicId('kb')}, ${this.workspaceId}, ${input.name},
        ${input.description ?? ''}, ${embedding.embeddingProvider},
        ${embedding.embeddingModel}, ${embedding.embeddingDimension}, ${'ready'},
        ${jsonb(this.sql, { chunkSettings })}
      )
      returning public_id
    `
    return this.get(created.public_id)
  }

  /**
   * 更新知识库名称或描述。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @param input 修改字段。
   * @returns 更新后的知识库 DTO。
   */
  async update(
    knowledgeBaseId: string,
    input: {
      name?: string
      description?: string
      chunkSize?: number
      overlapSize?: number
      separator?: string
    },
  ) {
    const existing = await this.get(knowledgeBaseId)
    const chunkSettings = normalizeKnowledgeChunkSettings({
      chunkSize: input.chunkSize ?? existing.chunkSize,
      overlapSize: input.overlapSize ?? existing.overlapSize,
      separator: input.separator ?? existing.separator,
    })
    await this.sql`
      update knowledge_bases
      set
        name = ${input.name ?? existing.name},
        description = ${input.description ?? existing.description},
        metadata = metadata || ${jsonb(this.sql, { chunkSettings })},
        updated_at = now()
      where workspace_id = ${this.workspaceId}
        and public_id = ${knowledgeBaseId}
    `
    return this.get(knowledgeBaseId)
  }

  /**
   * 删除未被工作流引用的知识库及其文档和切片。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @returns 删除确认。
   */
  async remove(knowledgeBaseId: string) {
    const kb = await this.requireInternal(knowledgeBaseId)
    const [usage] = await this.sql<Array<{ versions: number; drafts: number }>>`
      select
        (
          select count(*)
          from workflow_versions v
          where v.workspace_id = ${this.workspaceId}
            and exists (
              select 1
              from jsonb_array_elements(v.definition->'nodes') node
              where node->'config'->>'knowledgeBaseId' = ${kb.public_id}
                or node->'config'->'knowledgeBaseIds' ? ${kb.public_id}
            )
        )::int as versions,
        (
          select count(*)
          from workflows w
          where w.workspace_id = ${this.workspaceId}
            and exists (
              select 1
              from jsonb_array_elements(w.draft_definition->'nodes') node
              where node->'config'->>'knowledgeBaseId' = ${kb.public_id}
                or node->'config'->'knowledgeBaseIds' ? ${kb.public_id}
            )
        )::int as drafts
    `
    if ((usage?.versions ?? 0) + (usage?.drafts ?? 0) > 0) {
      throw new AppError({
        code: 'KNOWLEDGE_BASE_IN_USE',
        message: '知识库仍被工作流或发布版本引用，不能删除。',
        status: 409,
        details: usage,
      })
    }
    await this.sql.begin(async (transaction) => {
      await transaction`
        delete from document_chunks
        where workspace_id = ${this.workspaceId}
          and document_id in (
            select id from documents
            where workspace_id = ${this.workspaceId} and kb_id = ${kb.id}
          )
      `
      await transaction`
        delete from documents
        where workspace_id = ${this.workspaceId} and kb_id = ${kb.id}
      `
      await transaction`
        delete from knowledge_bases
        where workspace_id = ${this.workspaceId} and id = ${kb.id}
      `
    })
    return { deleted: true as const }
  }

  /**
   * 查询文档并提供状态、类型和名称筛选。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @param query 文档筛选条件。
   * @returns 文档 DTO 列表。
   */
  async documents(
    knowledgeBaseId: string,
    query: KnowledgeDocumentQuery = {},
  ) {
    const kb = await this.requireInternal(knowledgeBaseId)
    const rows = await this.sql<Array<{
      public_id: string
      name: string
      extension: string
      mime: string
      size_bytes: number
      sha256: string
      status: string
      preview_status: string
      stage_error: Record<string, unknown> | null
      metadata: Record<string, unknown>
      updated_at: Date
      chunks: number
    }>>`
      select
        d.public_id, d.name, d.extension, d.mime, d.size_bytes, d.sha256,
        d.status, d.preview_status, d.stage_error, d.metadata, d.updated_at,
        count(c.id)::int as chunks
      from documents d
      left join document_chunks c on c.document_id = d.id
      where d.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
        ${query.status ? this.sql`and d.status = ${query.status}` : this.sql``}
        ${query.type ? this.sql`and d.extension = ${query.type}` : this.sql``}
        ${query.search
          ? this.sql`and d.name ilike ${`%${query.search}%`}`
          : this.sql``}
      group by d.id
      order by d.updated_at desc
    `
    return rows.map((row) => ({
      id: row.public_id,
      kbId: kb.public_id,
      name: normalizeFilenameEncoding(row.name),
      extension: row.extension,
      mime: row.mime,
      size: formatBytes(row.size_bytes),
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      chunks: row.chunks,
      chunkStrategy: String(row.metadata.chunkStrategy ?? 'structured · 800/120'),
      status: row.status,
      previewStatus: row.preview_status,
      progress:
        row.status === 'ready'
          ? 100
          : row.status === 'embedding'
            ? 75
            : row.status === 'chunking'
              ? 50
              : row.status === 'parsing'
                ? 25
                : 0,
      error: row.stage_error?.message,
      errorStage:
        typeof row.stage_error?.stage === 'string'
          ? row.stage_error.stage
          : undefined,
      errorCode:
        typeof row.stage_error?.code === 'string'
          ? row.stage_error.code
          : undefined,
      errorRetryable:
        typeof row.stage_error?.retryable === 'boolean'
          ? row.stage_error.retryable
          : undefined,
      metadata: row.metadata,
      updatedAt: iso(row.updated_at)!,
    }))
  }

  /**
   * 上传文件并在对象存储可用时创建 ingest 任务。
   *
   * @returns 当前部署未配置对象存储时抛出稳定错误。
   */
  async upload(input: {
    knowledgeBaseId: string
    name: string
    mime: string
    extension: string
    sizeBytes: number
    sha256: string
    bytes: Uint8Array
  }) {
    const kb = await this.requireInternal(input.knowledgeBaseId)
    const [existing] = await this.sql<Array<{ public_id: string }>>`
      select public_id
      from documents
      where workspace_id = ${this.workspaceId}
        and kb_id = ${kb.id}
        and sha256 = ${input.sha256}
      limit 1
    `
    if (existing) return this.uploadResult(existing.public_id)

    const storageKey = [
      'kb',
      kb.public_id,
      input.sha256,
      input.name,
    ].join('/')
    await this.storage.put({
      key: storageKey,
      bytes: input.bytes,
      contentType: input.mime,
    })
    const documentPublicId = publicId('doc')
    try {
      await this.sql`
        insert into documents (
          public_id, workspace_id, kb_id, name, mime, extension,
          size_bytes, sha256, storage_key, status, metadata
        )
        values (
          ${documentPublicId}, ${this.workspaceId}, ${kb.id},
          ${input.name}, ${input.mime}, ${input.extension},
          ${input.sizeBytes}, ${input.sha256}, ${storageKey}, ${'queued'},
          ${jsonb(this.sql, {
            chunkStrategy: knowledgeChunkStrategyLabel(kb.chunkSettings),
            chunkSize: kb.chunkSettings.chunkSize,
            overlapSize: kb.chunkSettings.overlapSize,
            separator: kb.chunkSettings.separator,
          })}
        )
      `
    } catch (error) {
      const [raced] = await this.sql<Array<{ public_id: string }>>`
        select public_id
        from documents
        where workspace_id = ${this.workspaceId}
          and kb_id = ${kb.id}
          and sha256 = ${input.sha256}
        limit 1
      `
      if (raced) return this.uploadResult(raced.public_id)
      throw error
    }
    const job = await new KnowledgeIngestRepository(
      this.sql,
      this.workspaceId,
    ).createJob(documentPublicId, 'ingest')
    return {
      document: await this.document(documentPublicId),
      job,
    }
  }

  /**
   * 查询单个文档详情。
   *
   * @param documentId 外部文档 ID。
   * @returns 文档详情。
   */
  async document(documentId: string) {
    const [row] = await this.sql<Array<{
      public_id: string
      kb_public_id: string
      name: string
      extension: string
      mime: string
      size_bytes: number
      sha256: string
      status: string
      preview_status: string
      stage_error: Record<string, unknown> | null
      metadata: Record<string, unknown>
      updated_at: Date
      chunks: number
    }>>`
      select
        d.public_id, kb.public_id as kb_public_id, d.name, d.extension,
        d.mime, d.size_bytes, d.sha256, d.status, d.preview_status,
        d.stage_error, d.metadata, d.updated_at,
        count(c.id)::int as chunks
      from documents d
      join knowledge_bases kb on kb.id = d.kb_id
      left join document_chunks c on c.document_id = d.id
      where d.workspace_id = ${this.workspaceId}
        and d.public_id = ${documentId}
      group by d.id, kb.public_id
      limit 1
    `
    if (!row) throw notFound('文档')
    return {
      id: row.public_id,
      kbId: row.kb_public_id,
      name: normalizeFilenameEncoding(row.name),
      extension: row.extension,
      mime: row.mime,
      size: formatBytes(row.size_bytes),
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      chunks: row.chunks,
      status: row.status,
      previewStatus: row.preview_status,
      progress: row.status === 'ready' ? 100 : 0,
      error: row.stage_error?.message,
      errorStage:
        typeof row.stage_error?.stage === 'string'
          ? row.stage_error.stage
          : undefined,
      errorCode:
        typeof row.stage_error?.code === 'string'
          ? row.stage_error.code
          : undefined,
      errorRetryable:
        typeof row.stage_error?.retryable === 'boolean'
          ? row.stage_error.retryable
          : undefined,
      metadata: row.metadata,
      updatedAt: iso(row.updated_at)!,
    }
  }

  /**
   * 读取知识库原始附件，严格限定当前 workspace。
   *
   * @param documentId 外部文档 ID。
   * @returns 文件字节、名称和 MIME。
   */
  async source(documentId: string) {
    const [row] = await this.sql<Array<{
      public_id: string
      name: string
      extension: string
      mime: string
      size_bytes: number
      storage_key: string
    }>>`
      select public_id, name, extension, mime, size_bytes, storage_key
      from documents
      where workspace_id = ${this.workspaceId}
        and public_id = ${documentId}
      limit 1
    `
    if (!row) throw notFound('文档')
    let bytes: Buffer
    try {
      bytes = await this.storage.get(row.storage_key)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError({
        code: 'KNOWLEDGE_SOURCE_UNAVAILABLE',
        message: '原始附件暂时无法读取。',
        status: 404,
        retryable: true,
      })
    }
    return {
      id: row.public_id,
      name: normalizeFilenameEncoding(row.name),
      extension: row.extension,
      mime: row.mime,
      sizeBytes: row.size_bytes,
      bytes,
    }
  }

  /**
   * 删除文档、切片和预览记录。
   *
   * @param documentId 外部文档 ID。
   * @returns 删除确认。
   */
  async removeDocument(documentId: string) {
    const document = await this.requireDocument(documentId)
    await this.sql`
      delete from documents
      where workspace_id = ${this.workspaceId} and id = ${document.id}
    `
    return { deleted: true as const }
  }

  /**
   * 从失败阶段重试文档 ingest。
   *
   * @param documentId 外部文档 ID。
   * @returns 新状态；当前部署缺少 ingest worker 时返回稳定错误。
   */
  async retryDocument(documentId: string) {
    const document = await this.requireDocument(documentId)
    if (document.status !== 'failed') {
      throw new AppError({
        code: 'DOCUMENT_NOT_RETRYABLE',
        message: '只有失败状态的文档可以重试。',
        status: 409,
      })
    }
    const jobs = new KnowledgeIngestRepository(
      this.sql,
      this.workspaceId,
    )
    const [latest] = await jobs.jobsForDocument(documentId)
    return jobs.createJob(
      documentId,
      'retry',
      latest?.status === 'failed' ? latest.stage : 'parse',
    )
  }

  /**
   * 重建文档索引。
   *
   * @param documentId 外部文档 ID。
   * @returns 新状态；当前部署缺少 ingest worker 时返回稳定错误。
   */
  async reindexDocument(documentId: string) {
    // 旧切片保留到处理器成功解析后由 replaceDocumentChunks 原子替换。
    // 创建作业本身会在文档锁内拒绝并发的活动任务。
    await this.requireDocument(documentId)
    return new KnowledgeIngestRepository(
      this.sql,
      this.workspaceId,
    ).createJob(documentId, 'reindex', 'parse')
  }

  /**
   * 按 workspace 和知识库范围执行全文检索。
   *
   * @param knowledgeBaseIds 外部知识库 ID。
   * @param query 用户查询。
   * @param topK 返回上限。
   * @returns 按全文得分排序的 chunk。
   */
  async keywordSearch(
    knowledgeBaseIds: string[],
    query: string,
    topK: number,
  ): Promise<KnowledgeSearchChunk[]> {
    const kbs = await this.searchableKnowledgeBases(knowledgeBaseIds)
    const terms = buildKeywordSearchTerms(query)
    const rows = await this.sql<Array<{
      id: string
      content: string
      chunk_index: number
      metadata: Record<string, unknown>
      document_public_id: string
      document_name: string
      knowledge_base_public_id: string
      rank: number
    }>>`
      select
        c.id, c.content, c.chunk_index, c.metadata,
        d.public_id as document_public_id, d.name as document_name,
        kb.public_id as knowledge_base_public_id,
        greatest(
          ts_rank(c.tsv, plainto_tsquery('simple', ${query}))::float,
          case
            when term_matches.matched_terms > 0
            then (
              0.5 + 0.5 * term_matches.matched_terms::float /
              greatest(cardinality(${terms}::text[]), 1)
            )::float
            else 0::float
          end
        ) as rank
      from document_chunks c
      join documents d on d.id = c.document_id
      join knowledge_bases kb on kb.id = d.kb_id
      cross join lateral (
        select count(*)::int as matched_terms
        from unnest(${terms}::text[]) term
        where c.content ilike ${'%'} || term || ${'%'}
      ) term_matches
      where c.workspace_id = ${this.workspaceId}
        and d.workspace_id = ${this.workspaceId}
        and kb.workspace_id = ${this.workspaceId}
        and d.kb_id = any(${kbs.internalIds}::uuid[])
        and (
          c.tsv @@ plainto_tsquery('simple', ${query})
          or term_matches.matched_terms > 0
        )
      order by rank desc, c.chunk_index
      limit ${Math.min(100, Math.max(topK, topK * 3))}
    `
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_public_id,
      documentName: normalizeFilenameEncoding(row.document_name),
      chunkIndex: row.chunk_index,
      text: row.content,
      metadata: row.metadata,
      score: Number(row.rank),
      knowledgeBaseId: row.knowledge_base_public_id,
      fulltextScore: Number(row.rank),
    }))
  }

  /**
   * 按 workspace 和知识库范围执行 pgvector cosine 检索。
   *
   * @param knowledgeBaseIds 外部知识库 ID。
   * @param queryEmbedding 查询向量。
   * @param topK 返回上限。
   * @returns 按相似度排序的 chunk。
   */
  async vectorSearch(
    knowledgeBaseIds: string[],
    queryEmbedding: number[],
    topK: number,
  ): Promise<KnowledgeSearchChunk[]> {
    if (!queryEmbedding.length) {
      throw new AppError({
        code: 'EMBEDDING_QUERY_EMPTY',
        message: '查询向量不能为空。',
        status: 422,
      })
    }
    const kbs = await this.searchableKnowledgeBases(knowledgeBaseIds)
    const rows = await this.sql<Array<{
      id: string
      content: string
      chunk_index: number
      metadata: Record<string, unknown>
      document_public_id: string
      document_name: string
      knowledge_base_public_id: string
      score: number
    }>>`
      select
        c.id, c.content, c.chunk_index, c.metadata,
        d.public_id as document_public_id, d.name as document_name,
        kb.public_id as knowledge_base_public_id,
        (1 - (c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector))::float as score
      from document_chunks c
      join documents d on d.id = c.document_id
      join knowledge_bases kb on kb.id = d.kb_id
      where c.workspace_id = ${this.workspaceId}
        and d.workspace_id = ${this.workspaceId}
        and kb.workspace_id = ${this.workspaceId}
        and d.kb_id = any(${kbs.internalIds}::uuid[])
        and c.embedding is not null
        and c.embedding_status = 'ready'
      order by c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector, c.chunk_index
      limit ${Math.min(100, Math.max(topK, topK * 3))}
    `
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_public_id,
      documentName: normalizeFilenameEncoding(row.document_name),
      chunkIndex: row.chunk_index,
      text: row.content,
      metadata: row.metadata,
      score: Number(row.score),
      knowledgeBaseId: row.knowledge_base_public_id,
      vectorScore: Number(row.score),
    }))
  }

  /**
   * 读取一组知识库共用的 embedding 配置。
   *
   * @param knowledgeBaseIds 外部知识库 ID。
   * @returns Provider、模型和维度。
   */
  async embeddingConfig(
    knowledgeBaseIds: string[],
  ): Promise<KnowledgeEmbeddingConfig> {
    const rows = await this.sql<Array<{
      embedding_provider: string
      embedding_model: string
      embedding_dimension: number
    }>>`
      select distinct
        embedding_provider, embedding_model, embedding_dimension
      from knowledge_bases
      where workspace_id = ${this.workspaceId}
        and public_id = any(${knowledgeBaseIds}::text[])
        and status = 'ready'
    `
    if (!rows.length) {
      throw new AppError({
        code: 'KNOWLEDGE_NOT_READY',
        message: '没有可检索的已就绪知识库。',
        status: 409,
      })
    }
    if (rows.length > 1) {
      throw new AppError({
        code: 'KNOWLEDGE_EMBEDDING_CONFIG_MISMATCH',
        message: '所选知识库使用了不同的 embedding Provider、模型或维度。',
        status: 409,
      })
    }
    return {
      provider: rows[0].embedding_provider,
      model: rows[0].embedding_model,
      dimension: rows[0].embedding_dimension,
    }
  }

  /**
   * 事务性替换文档切片；embedding 在后续阶段单独写入。
   *
   * @param documentId 外部文档 ID。
   * @param chunks 已分块内容。
   * @param embeddingModel 知识库固定模型。
   * @returns 写入的切片数量。
   */
  async replaceDocumentChunks(
    documentId: string,
    chunks: KnowledgeChunkInput[],
    embeddingModel: string,
  ) {
    if (chunks.length > 5000) {
      throw new AppError({
        code: 'KNOWLEDGE_CHUNK_LIMIT_EXCEEDED',
        message: `切片数量 ${chunks.length} 超过单文档上限 5000。`,
        status: 422,
      })
    }
    await this.sql.begin(async (transaction) => {
      const [document] = await transaction<Array<{ id: string }>>`
        select id
        from documents
        where workspace_id = ${this.workspaceId}
          and public_id = ${documentId}
        limit 1
      `
      if (!document) throw notFound('文档')
      await transaction`
        delete from document_chunks
        where workspace_id = ${this.workspaceId}
          and document_id = ${document.id}
      `
      for (const [index, chunk] of chunks.entries()) {
        await transaction`
          insert into document_chunks (
            workspace_id, document_id, chunk_index, content, token_count,
            metadata, embedding_model, embedding_status, tsv
          )
          values (
            ${this.workspaceId}, ${document.id}, ${index},
            ${chunk.content}, ${chunk.tokenCount},
            ${jsonb(transaction, chunk.metadata)}, ${embeddingModel},
            'pending', to_tsvector('simple', ${chunk.content})
          )
        `
      }
      await transaction`
        update documents
        set
          status = 'embedding',
          metadata = metadata || ${jsonb(transaction, {
            chunks: chunks.length,
            embeddingModel,
          })},
          updated_at = now()
        where workspace_id = ${this.workspaceId}
          and id = ${document.id}
      `
    })
    return chunks.length
  }

  /**
   * 读取尚未完成 embedding 的切片，用于阶段重试。
   *
   * @param documentId 外部文档 ID。
   * @returns 待向量化切片。
   */
  async pendingDocumentChunks(
    documentId: string,
  ): Promise<PendingKnowledgeChunk[]> {
    const rows = await this.sql<Array<{
      chunk_index: number
      content: string
    }>>`
      select c.chunk_index, c.content
      from document_chunks c
      join documents d on d.id = c.document_id
      where c.workspace_id = ${this.workspaceId}
        and d.workspace_id = ${this.workspaceId}
        and d.public_id = ${documentId}
        and c.embedding_status = 'pending'
      order by c.chunk_index
    `
    return rows.map((row) => ({
      chunkIndex: row.chunk_index,
      content: row.content,
    }))
  }

  /**
   * 写入单个切片的向量并标记 ready。
   *
   * @param documentId 外部文档 ID。
   * @param chunkIndex 切片序号。
   * @param embedding 固定维度向量。
   * @param embeddingModel embedding 模型。
   */
  async updateChunkEmbedding(
    documentId: string,
    chunkIndex: number,
    embedding: number[],
    embeddingModel: string,
  ) {
    await this.sql`
      update document_chunks c
      set
        embedding = ${JSON.stringify(embedding)}::vector,
        embedding_model = ${embeddingModel},
        embedding_status = 'ready',
        updated_at = now()
      from documents d
      where c.document_id = d.id
        and c.workspace_id = ${this.workspaceId}
        and d.workspace_id = ${this.workspaceId}
        and d.public_id = ${documentId}
        and c.chunk_index = ${chunkIndex}
    `
  }

  /**
   * 分页查询文档切片。
   *
   * @param documentId 外部文档 ID。
   * @param offset 起始偏移。
   * @param limit 最大条数。
   * @returns 切片与可定位元数据。
   */
  async chunks(documentId: string, offset = 0, limit = 100) {
    const document = await this.requireDocument(documentId)
    const rows = await this.sql<Array<{
      id: string
      chunk_index: number
      content: string
      token_count: number | null
      metadata: Record<string, unknown>
      embedding_status: string
    }>>`
      select id, chunk_index, content, token_count, metadata, embedding_status
      from document_chunks
      where workspace_id = ${this.workspaceId}
        and document_id = ${document.id}
      order by chunk_index
      offset ${Math.max(0, offset)}
      limit ${Math.min(500, Math.max(1, limit))}
    `
    return rows.map((row) => ({
      id: row.id,
      documentId,
      documentName: document.name,
      chunkIndex: row.chunk_index,
      snippet: row.content,
      tokenCount: row.token_count ?? undefined,
      embeddingStatus: row.embedding_status,
      metadata: row.metadata,
      location: describeLocation(row.metadata),
    }))
  }

  /**
   * 查询文档预览描述。转换产物缺失时不伪造 URL。
   *
   * @param documentId 外部文档 ID。
   * @returns 预览状态和页/工作表元数据。
   */
  async preview(documentId: string) {
    const document = await this.requireDocument(documentId)
    const [preview] = await this.sql<Array<{
      kind: string
      pages: unknown
      sheets: unknown
      status: string
      error_code: string | null
      expires_at: Date | null
      storage_key: string
    }>>`
      select kind, pages, sheets, status, error_code, expires_at, storage_key
      from document_previews
      where workspace_id = ${this.workspaceId}
        and document_id = ${document.id}
      order by created_at desc
      limit 1
    `
    if (!preview) {
      return {
        documentId,
        previewKind: document.extension,
        previewStatus: document.preview_status,
        pages: [],
        sheets: [],
      }
    }
    if (preview.status !== 'ready') {
      return {
        documentId,
        previewKind: preview.kind,
        previewStatus: preview.status,
        pages: preview.pages ?? [],
        sheets: preview.sheets ?? [],
        error: preview.error_code ?? undefined,
      }
    }
    throw new AppError({
      code: 'PREVIEW_SIGNING_NOT_CONFIGURED',
      message: '预览产物已存在，但对象存储签名服务尚未配置。',
      status: 503,
      retryable: true,
    })
  }

  /**
   * 查询知识库文档、切片和失败状态统计。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @returns 聚合统计。
   */
  async stats(knowledgeBaseId: string) {
    const kb = await this.requireInternal(knowledgeBaseId)
    const [row] = await this.sql<Array<{
      documents: number
      ready: number
      failed: number
      processing: number
      chunks: number
      embedded_chunks: number
    }>>`
      select
        count(distinct d.id)::int as documents,
        count(distinct d.id) filter (where d.status = 'ready')::int as ready,
        count(distinct d.id) filter (where d.status = 'failed')::int as failed,
        count(distinct d.id) filter (
          where d.status in ('queued', 'parsing', 'chunking', 'embedding')
        )::int as processing,
        count(c.id)::int as chunks,
        count(c.id) filter (where c.embedding_status = 'ready')::int as embedded_chunks
      from documents d
      left join document_chunks c on c.document_id = d.id
      where d.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
    `
    return {
      documents: row?.documents ?? 0,
      ready: row?.ready ?? 0,
      failed: row?.failed ?? 0,
      processing: row?.processing ?? 0,
      chunks: row?.chunks ?? 0,
      embeddedChunks: row?.embedded_chunks ?? 0,
      embeddingModel: kb.embedding_model,
      embeddingDimension: kb.embedding_dimension,
    }
  }

  /**
   * 执行真实 PostgreSQL 全文检索。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @param input 查询、TopK、阈值和检索模式。
   * @returns 切片、引用、上下文与降级说明。
   */
  async search(
    knowledgeBaseId: string,
    input: {
      query: string
      topK?: number
      scoreThreshold?: number
      retrievalMode?: 'vector' | 'keyword' | 'hybrid'
      rerank?: { enabled: boolean }
    },
  ) {
    if (input.retrievalMode === 'vector' || input.retrievalMode === 'hybrid') {
      throw new AppError({
        code: 'VECTOR_RETRIEVAL_NOT_CONFIGURED',
        message:
          '向量/混合检索需要已配置的 embedding provider，当前仅支持真实全文检索。',
        status: 501,
      })
    }
    const kb = await this.requireInternal(knowledgeBaseId)
    const topK = Math.min(20, Math.max(1, input.topK ?? 5))
    const threshold = input.scoreThreshold ?? 0
    const terms = buildKeywordSearchTerms(input.query)
    const rows = await this.sql<Array<{
      id: string
      content: string
      chunk_index: number
      metadata: Record<string, unknown>
      document_public_id: string
      document_name: string
      rank: number
    }>>`
      select
        c.id, c.content, c.chunk_index, c.metadata,
        d.public_id as document_public_id, d.name as document_name,
        greatest(
          ts_rank(c.tsv, plainto_tsquery('simple', ${input.query}))::float,
          case
            when term_matches.matched_terms > 0
            then (
              0.5 + 0.5 * term_matches.matched_terms::float /
              greatest(cardinality(${terms}::text[]), 1)
            )::float
            else 0::float
          end
        ) as rank
      from document_chunks c
      join documents d on d.id = c.document_id
      cross join lateral (
        select count(*)::int as matched_terms
        from unnest(${terms}::text[]) term
        where c.content ilike ${'%'} || term || ${'%'}
      ) term_matches
      where c.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
        and (
          c.tsv @@ plainto_tsquery('simple', ${input.query})
          or term_matches.matched_terms > 0
        )
      order by rank desc, c.chunk_index
      limit ${topK}
    `
    const chunks = rows
      .filter((row) => Number(row.rank) >= threshold)
      .map((row, index) => ({
        id: row.id,
        citationId: `c${index + 1}`,
        documentId: row.document_public_id,
        documentName: normalizeFilenameEncoding(row.document_name),
        chunkIndex: row.chunk_index,
        snippet: row.content,
        location: describeLocation(row.metadata),
        score: Number(row.rank),
        fulltextScore: Number(row.rank),
        metadata: row.metadata,
      }))
    return {
      chunks,
      citations: chunks.map((chunk) => ({
        id: chunk.citationId,
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        chunkIndex: chunk.chunkIndex,
        location: chunk.location,
        score: chunk.score,
      })),
      context: chunks.map((chunk) => chunk.snippet).join('\n\n'),
      total: chunks.length,
      rerankApplied: false,
      warnings: input.rerank?.enabled
        ? ['RERANK_NOT_CONFIGURED: 已降级为原始全文排序。']
        : [],
    }
  }

  /**
   * 将知识库聚合数据库行投影为 DTO。
   *
   * @param row 聚合行。
   * @returns 知识库 DTO。
   */
  private toDto(row: {
    public_id: string
    name: string
    description: string
    status: string
    embedding_model: string
    embedding_dimension: number
    metadata: Record<string, unknown>
    updated_at: Date
    documents: number
    chunks: number
  }) {
    const chunkSettings = normalizeKnowledgeChunkSettings(
      row.metadata?.chunkSettings,
    )
    return {
      id: row.public_id,
      name: row.name,
      description: row.description,
      documents: row.documents,
      chunks: row.chunks,
      status: row.status,
      embeddingModel: row.embedding_model,
      dimensions: row.embedding_dimension,
      chunkSize: chunkSettings.chunkSize,
      overlapSize: chunkSettings.overlapSize,
      separator: chunkSettings.separator,
      updatedAt: iso(row.updated_at)!,
    }
  }

  /**
   * 读取知识库内部行。
   *
   * @param knowledgeBaseId 外部知识库 ID。
   * @returns 知识库内部记录。
   */
  private async requireInternal(knowledgeBaseId: string) {
    const [kb] = await this.sql<Array<{
      id: string
      public_id: string
      name: string
      description: string
      embedding_model: string
      embedding_dimension: number
      metadata: Record<string, unknown>
    }>>`
      select
        id, public_id, name, description, embedding_model, embedding_dimension,
        metadata
      from knowledge_bases
      where workspace_id = ${this.workspaceId}
        and public_id = ${knowledgeBaseId}
      limit 1
    `
    if (!kb) throw notFound('知识库')
    return {
      ...kb,
      chunkSettings: normalizeKnowledgeChunkSettings(
        kb.metadata?.chunkSettings,
      ),
    }
  }

  /**
   * 读取文档内部记录。
   *
   * @param documentId 外部文档 ID。
   * @returns 文档内部记录。
   */
  private async requireDocument(documentId: string) {
    const [document] = await this.sql<Array<{
      id: string
      name: string
      extension: string
      preview_status: string
      status: string
    }>>`
      select id, name, extension, preview_status, status
      from documents
      where workspace_id = ${this.workspaceId}
        and public_id = ${documentId}
      limit 1
    `
    if (!document) throw notFound('文档')
    return {
      ...document,
      name: normalizeFilenameEncoding(document.name),
    }
  }

  private async searchableKnowledgeBases(knowledgeBaseIds: string[]) {
    const rows = await this.sql<Array<{
      id: string
      public_id: string
    }>>`
      select id, public_id
      from knowledge_bases
      where workspace_id = ${this.workspaceId}
        and public_id = any(${knowledgeBaseIds}::text[])
        and status = 'ready'
    `
    if (!rows.length) {
      throw new AppError({
        code: 'KNOWLEDGE_NOT_READY',
        message: '没有可检索的已就绪知识库。',
        status: 409,
      })
    }
    return {
      internalIds: rows.map((row) => row.id),
      publicIds: rows.map((row) => row.public_id),
    }
  }

  private async uploadResult(documentId: string) {
    const jobs = new KnowledgeIngestRepository(
      this.sql,
      this.workspaceId,
    )
    const existingJobs = await jobs.jobsForDocument(documentId)
    return {
      document: await this.document(documentId),
      job: existingJobs[0] ?? (await jobs.createJob(documentId, 'ingest')),
    }
  }
}

const CJK_STOP_TERMS = new Set([
  '多少',
  '什么',
  '怎么',
  '如何',
  '请问',
  '是否',
  '哪些',
  '哪个',
  '哪里',
  '为什么',
  '一下',
  '可以',
  '的是',
  '这个',
  '那个',
])

/**
 * 为中文问题生成可命中 PostgreSQL 全文检索的二元词。
 *
 * PostgreSQL simple parser 不会切分中文，因此“小红多少分”会被当成
 * 一个 token；这里生成“小红 / 红多 / 多少 / 少分”等候选词，再由
 * 数据库按命中数量排序。
 *
 * @param query 用户原始查询。
 * @returns 去重后的候选检索词。
 */
export function buildKeywordSearchTerms(query: string) {
  const normalized = query.normalize('NFKC').toLowerCase().trim()
  if (!normalized) return []
  const tokens =
    normalized.match(/[\p{Script=Han}]+|[a-z0-9]+(?:[._-][a-z0-9]+)*/gu) ??
    []
  const terms = new Set<string>()

  for (const token of tokens) {
    if (/^\p{Script=Han}+$/u.test(token)) {
      if (token.length <= 2) {
        if (!CJK_STOP_TERMS.has(token)) terms.add(token)
        continue
      }
      for (let index = 0; index < token.length - 1; index += 1) {
        const term = token.slice(index, index + 2)
        if (!CJK_STOP_TERMS.has(term)) terms.add(term)
      }
      continue
    }
    if (token.length >= 2) terms.add(token)
  }

  if (!terms.size) terms.add(normalized.slice(0, 64))
  return [...terms].slice(0, 32)
}

/**
 * 把字节数格式化为紧凑文件大小。
 *
 * @param value 字节数。
 * @returns 可读文件大小。
 */
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 从切片 metadata 生成可追溯位置。
 *
 * @param metadata 页码、sheet、行区间或标题路径。
 * @returns 适合列表展示的位置文本。
 */
function describeLocation(metadata: Record<string, unknown>) {
  if (typeof metadata.page === 'number') return `第 ${metadata.page} 页`
  if (typeof metadata.sheet === 'string') {
    const start = metadata.rowStart ?? metadata.startRow
    const end = metadata.rowEnd ?? metadata.endRow
    return start !== undefined
      ? `${metadata.sheet} · 行 ${String(start)}-${String(end ?? start)}`
      : String(metadata.sheet)
  }
  if (Array.isArray(metadata.headingPath)) {
    return metadata.headingPath.join(' / ')
  }
  if (typeof metadata.charStart === 'number') {
    return `字符 ${metadata.charStart}-${String(metadata.charEnd ?? metadata.charStart)}`
  }
  return '未提供原文定位'
}
