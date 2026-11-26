import { AppError, type FileRef } from '@ai-reflow/core'
import type { Readable } from 'node:stream'
import type { DatabaseClient } from '../client'
import type { ObjectStorage } from '../../storage'
import { validateUploadFile, type NormalizedUploadFile } from '../../files/validation'
import { iso } from './dto'
import { jsonb, notFound, publicId } from './helpers'

export interface KnowledgeListQuery {
  search?: string
  status?: string
}

export interface KnowledgeDocumentQuery {
  status?: string
  type?: string
  search?: string
}

interface KnowledgeDocumentAssetRow {
  id: string
  public_id: string
  name: string
  extension: string
  mime: string
  size_bytes: number | string
  sha256: string
  status: string
  preview_status: string
  stage_error?: Record<string, unknown> | null
  metadata: Record<string, unknown>
  updated_at: Date
  chunks?: number
  storage_key?: string
}

export interface KnowledgeFileContent {
  file: FileRef
  object: {
    body: Readable
    contentType?: string
    contentLength?: number
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
    private readonly storage?: ObjectStorage,
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
      updated_at: Date
      documents: number
      chunks: number
    }>>`
      select
        kb.id, kb.public_id, kb.name, kb.description, kb.status,
        kb.embedding_model, kb.embedding_dimension, kb.updated_at,
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
      updated_at: Date
      documents: number
      chunks: number
    }>>`
      select
        kb.id, kb.public_id, kb.name, kb.description, kb.status,
        kb.embedding_model, kb.embedding_dimension, kb.updated_at,
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
  }) {
    const [created] = await this.sql<Array<{ public_id: string }>>`
      insert into knowledge_bases (
        public_id, workspace_id, name, description, embedding_provider,
        embedding_model, embedding_dimension, status
      )
      values (
        ${publicId('kb')}, ${this.workspaceId}, ${input.name},
        ${input.description ?? ''}, ${input.embeddingProvider ?? 'openai'},
        ${input.embeddingModel ?? 'text-embedding-3-small'},
        ${input.embeddingDimension ?? 1536}, ${'ready'}
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
    },
  ) {
    const existing = await this.get(knowledgeBaseId)
    await this.sql`
      update knowledge_bases
      set
        name = ${input.name ?? existing.name},
        description = ${input.description ?? existing.description},
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
    const objectKeys = await this.sql<Array<{ storage_key: string }>>`
      select d.storage_key
      from documents d
      where d.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
      union all
      select p.storage_key
      from document_previews p
      join documents d on d.id = p.document_id
      where p.workspace_id = ${this.workspaceId}
        and d.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
    `
    if (objectKeys.length) {
      const storage = this.requireStorage()
      for (const row of objectKeys) {
        await storage.deleteObject(row.storage_key)
      }
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
      name: row.name,
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
      metadata: row.metadata,
      updatedAt: iso(row.updated_at)!,
    }))
  }

  /**
   * 上传知识库原文件并创建 queued 文档记录。
   *
   * 同一知识库内相同 SHA-256 会复用已有文档并跳过对象写入。
   */
  async upload(
    knowledgeBaseId: string,
    file: { name: string; mime: string; buffer: Buffer },
  ) {
    const storage = this.requireStorage()
    const kb = await this.requireInternal(knowledgeBaseId)
    const normalized = await validateUploadFile(file, 'knowledge-base')
    const duplicate = await this.documentBySha(kb.id, normalized.sha256)
    if (duplicate) {
      return this.toDocumentUpload(duplicate, kb.public_id, true)
    }

    const documentId = publicId('doc')
    const storageKey = `workspace/${this.workspaceId}/knowledge/${kb.id}/${documentId}.${normalized.extension}`
    let objectWritten = false
    try {
      await storage.putObject({
        key: storageKey,
        body: normalized.buffer,
        contentType: normalized.mime,
      })
      objectWritten = true
      const [created] = await this.sql<Array<{ public_id: string }>>`
        insert into documents (
          public_id, workspace_id, kb_id, name, mime, extension, size_bytes,
          sha256, storage_key, status, preview_status, metadata
        )
        values (
          ${documentId}, ${this.workspaceId}, ${kb.id}, ${normalized.name},
          ${normalized.mime}, ${normalized.extension}, ${normalized.size},
          ${normalized.sha256}, ${storageKey}, ${'queued'}, ${'none'},
          ${'{}'}::jsonb
        )
        on conflict (kb_id, sha256) do nothing
        returning public_id
      `
      if (!created) {
        await storage.deleteObject(storageKey)
        objectWritten = false
        const existing = await this.documentBySha(kb.id, normalized.sha256)
        if (!existing) {
          throw new AppError({
            code: 'OBJECT_STORAGE_ERROR',
            message: '文档写入冲突，请重试。',
            status: 409,
            retryable: true,
          })
        }
        return this.toDocumentUpload(existing, kb.public_id, true)
      }
    } catch (error) {
      if (objectWritten) {
        await storage.deleteObject(storageKey).catch(() => undefined)
      }
      throw error
    }

    return this.toNormalizedDocumentUpload(
      documentId,
      kb.public_id,
      normalized,
    )
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
      name: row.name,
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
      metadata: row.metadata,
      updatedAt: iso(row.updated_at)!,
    }
  }

  /**
   * 从对象存储读取知识库文档原文件。
   */
  async documentFile(documentId: string): Promise<KnowledgeFileContent> {
    const storage = this.requireStorage()
    const [row] = await this.sql<Array<{
      id: string
      public_id: string
      name: string
      mime: string
      size_bytes: number | string
      sha256: string
      storage_key: string
    }>>`
      select
        id, public_id, name, mime, size_bytes, sha256, storage_key
      from documents
      where workspace_id = ${this.workspaceId}
        and public_id = ${documentId}
      limit 1
    `
    if (!row) {
      throw new AppError({
        code: 'FILE_NOT_FOUND',
        message: '文档不存在或无权访问。',
        status: 404,
      })
    }
    return {
      file: {
        id: row.public_id,
        name: row.name,
        mime: row.mime,
        size: Number(row.size_bytes),
        sha256: row.sha256,
      },
      object: await storage.getObject(row.storage_key),
    }
  }

  /**
   * 删除文档、切片和预览记录。
   *
   * @param documentId 外部文档 ID。
   * @returns 删除确认。
   */
  async removeDocument(documentId: string) {
    const storage = this.requireStorage()
    const document = await this.requireDocument(documentId)
    const previews = await this.sql<Array<{ storage_key: string }>>`
      select storage_key
      from document_previews
      where workspace_id = ${this.workspaceId}
        and document_id = ${document.id}
    `
    await storage.deleteObject(document.storage_key)
    for (const preview of previews) {
      await storage.deleteObject(preview.storage_key)
    }
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
    await this.requireDocument(documentId)
    throw new AppError({
      code: 'KNOWLEDGE_INGEST_NOT_CONFIGURED',
      message: '文档 ingest 队列与解析 worker 尚未配置，不能伪造重试成功。',
      status: 503,
      retryable: true,
    })
  }

  /**
   * 重建文档索引。
   *
   * @param documentId 外部文档 ID。
   * @returns 新状态；当前部署缺少 ingest worker 时返回稳定错误。
   */
  async reindexDocument(documentId: string) {
    await this.requireDocument(documentId)
    throw new AppError({
      code: 'KNOWLEDGE_REINDEX_NOT_CONFIGURED',
      message: '文档重建索引 worker 尚未配置，不能伪造成功。',
      status: 503,
      retryable: true,
    })
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
            when exists (
              select 1
              from unnest(regexp_split_to_array(trim(${input.query}), '\\s+')) term
              where c.content ilike ${'%'} || term || ${'%'}
            )
            then 0.5::float
            else 0::float
          end
        ) as rank
      from document_chunks c
      join documents d on d.id = c.document_id
      where c.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kb.id}
        and (
          c.tsv @@ plainto_tsquery('simple', ${input.query})
          or exists (
            select 1
            from unnest(regexp_split_to_array(trim(${input.query}), '\\s+')) term
            where c.content ilike ${'%'} || term || ${'%'}
          )
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
        documentName: row.document_name,
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
    updated_at: Date
    documents: number
    chunks: number
  }) {
    return {
      id: row.public_id,
      name: row.name,
      description: row.description,
      documents: row.documents,
      chunks: row.chunks,
      status: row.status,
      embeddingModel: row.embedding_model,
      dimensions: row.embedding_dimension,
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
    }>>`
      select
        id, public_id, name, description, embedding_model, embedding_dimension
      from knowledge_bases
      where workspace_id = ${this.workspaceId}
        and public_id = ${knowledgeBaseId}
      limit 1
    `
    if (!kb) throw notFound('知识库')
    return kb
  }

  /**
   * 返回已配置的对象存储，或抛出稳定 503。
   */
  private requireStorage() {
    if (!this.storage) {
      throw new AppError({
        code: 'OBJECT_STORAGE_NOT_CONFIGURED',
        message: 'MinIO/S3 对象存储尚未配置，不能处理知识库文件。',
        status: 503,
        retryable: true,
      })
    }
    return this.storage
  }

  /**
   * 查询同一知识库内 SHA-256 相同的文档。
   */
  private async documentBySha(kbId: string, sha256: string) {
    const [document] = await this.sql<KnowledgeDocumentAssetRow[]>`
      select
        d.id, d.public_id, d.name, d.extension, d.mime, d.size_bytes, d.sha256,
        d.status, d.preview_status, d.stage_error, d.metadata, d.updated_at, 0 as chunks
      from documents d
      where d.workspace_id = ${this.workspaceId}
        and d.kb_id = ${kbId}
        and d.sha256 = ${sha256}
      limit 1
    `
    return document
  }

  /**
   * 把新写入的规范化文件映射为 upload DTO。
   */
  private toNormalizedDocumentUpload(
    id: string,
    knowledgeBaseId: string,
    file: NormalizedUploadFile,
  ) {
    return {
      id,
      kbId: knowledgeBaseId,
      name: file.name,
      extension: file.extension,
      mime: file.mime,
      size: formatBytes(file.size),
      sizeBytes: file.size,
      sha256: file.sha256,
      chunks: 0,
      chunkStrategy: 'structured · 800/120',
      status: 'queued',
      previewStatus: 'none',
      progress: 0,
      metadata: {},
      updatedAt: new Date().toISOString(),
      deduplicated: false as const,
    }
  }

  /**
   * 把已存在文档映射为 upload DTO。
   */
  private toDocumentUpload(
    row: KnowledgeDocumentAssetRow,
    knowledgeBaseId: string,
    deduplicated: boolean,
  ) {
    const sizeBytes = Number(row.size_bytes)
    const progress =
      row.status === 'ready'
        ? 100
        : row.status === 'embedding'
          ? 75
          : row.status === 'chunking'
            ? 50
            : row.status === 'parsing'
              ? 25
              : 0
    return {
      id: row.public_id,
      kbId: knowledgeBaseId,
      name: row.name,
      extension: row.extension,
      mime: row.mime,
      size: formatBytes(sizeBytes),
      sizeBytes,
      sha256: row.sha256,
      chunks: row.chunks ?? 0,
      chunkStrategy: String(row.metadata.chunkStrategy ?? 'structured · 800/120'),
      status: row.status,
      previewStatus: row.preview_status,
      progress,
      error: row.stage_error?.message,
      metadata: row.metadata,
      updatedAt: iso(row.updated_at)!,
      deduplicated,
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
      storage_key: string
    }>>`
      select id, name, extension, preview_status, storage_key
      from documents
      where workspace_id = ${this.workspaceId}
        and public_id = ${documentId}
      limit 1
    `
    if (!document) throw notFound('文档')
    return document
  }
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
