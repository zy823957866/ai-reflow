export interface RetrievedKnowledgeChunk {
  id: string
  documentId: string
  documentName: string
  chunkIndex: number
  text: string
  metadata: Record<string, unknown>
  score: number
  knowledgeBaseId?: string
  fulltextScore?: number
  vectorScore?: number
}

export interface KnowledgeRetrievalInput {
  knowledgeBaseIds: string[]
  query: string
  topK: number
  scoreThreshold: number
  retrievalMode: 'vector' | 'keyword' | 'hybrid'
  signal?: AbortSignal
}

export interface KnowledgeRetrievalStore {
  keyword(input: {
    knowledgeBaseIds: string[]
    query: string
    topK: number
    signal?: AbortSignal
  }): Promise<RetrievedKnowledgeChunk[]>
  vector(input: {
    knowledgeBaseIds: string[]
    queryEmbedding: number[]
    topK: number
    signal?: AbortSignal
  }): Promise<RetrievedKnowledgeChunk[]>
}

export interface KnowledgeEmbedder {
  embedQuery(
    text: string,
    options?: { signal?: AbortSignal },
  ): Promise<number[]>
}

export interface KnowledgeRetrieverDependencies {
  store: KnowledgeRetrievalStore
  embedder?: KnowledgeEmbedder
  allowKeywordFallback?: boolean
  maxContextChars?: number
}

export interface KnowledgeRetrievalCitation {
  id: string
  chunkId: string
  documentId: string
  documentName: string
  chunkIndex: number
  location: string
  score: number
}

export interface KnowledgeRetrievalResult {
  chunks: Array<RetrievedKnowledgeChunk & { citationId: string; location: string }>
  citations: KnowledgeRetrievalCitation[]
  context: string
  total: number
  warnings: string[]
}

/**
 * 执行 vector、keyword 或 hybrid 检索，并在向量不可用时显式降级。
 * @param input 查询与检索模式。
 * @param dependencies 检索 store、embedder 和降级策略。
 * @returns 有序 chunk、citation、上下文和 warning。
 */
export async function retrieveKnowledge(
  input: KnowledgeRetrievalInput,
  dependencies: KnowledgeRetrieverDependencies,
): Promise<KnowledgeRetrievalResult> {
  const query = input.query.trim()
  if (!query) {
    throw new Error('知识库检索 query 不能为空。')
  }
  const knowledgeBaseIds = [...new Set(input.knowledgeBaseIds.filter(Boolean))]
  if (!knowledgeBaseIds.length) {
    throw new Error('知识库检索至少需要一个 knowledgeBaseId。')
  }
  const topK = Math.min(20, Math.max(1, input.topK))
  const threshold = Math.max(0, input.scoreThreshold)
  const warnings: string[] = []
  const mode = input.retrievalMode

  let keywordRows: RetrievedKnowledgeChunk[] = []
  let vectorRows: RetrievedKnowledgeChunk[] = []

  if (mode === 'keyword') {
    keywordRows = await dependencies.store.keyword({
      knowledgeBaseIds,
      query,
      topK: topK * 3,
      signal: input.signal,
    })
  } else {
    let queryEmbedding: number[] | undefined
    try {
      if (!dependencies.embedder) {
        throw new Error('embedding Provider 未配置。')
      }
      queryEmbedding = await dependencies.embedder.embedQuery(query, {
        signal: input.signal,
      })
    } catch (error) {
      if (dependencies.allowKeywordFallback === false) throw error
      warnings.push(
        'EMBEDDING_UNAVAILABLE: 向量检索不可用，已显式降级为关键字检索。',
      )
    }

    if (queryEmbedding) {
      vectorRows = await dependencies.store.vector({
        knowledgeBaseIds,
        queryEmbedding,
        topK: topK * 3,
        signal: input.signal,
      })
    }
    if (mode === 'hybrid' || !queryEmbedding) {
      keywordRows = await dependencies.store.keyword({
        knowledgeBaseIds,
        query,
        topK: topK * 3,
        signal: input.signal,
      })
    }
  }

  const allowed = new Set(knowledgeBaseIds)
  const scoped = (rows: RetrievedKnowledgeChunk[]) =>
    rows.filter(
      (row) =>
        !row.knowledgeBaseId || allowed.has(row.knowledgeBaseId),
    )
  keywordRows = scoped(keywordRows)
  vectorRows = scoped(vectorRows)

  const merged = mergeRetrievalRows(keywordRows, vectorRows, mode)
    .filter((row) => row.score >= threshold)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.chunkIndex - right.chunkIndex,
    )
    .slice(0, topK)

  const maxContextChars = dependencies.maxContextChars ?? 12_000
  const selected: typeof merged = []
  let contextLength = 0
  for (const chunk of merged) {
    const addition = chunk.text.length + (selected.length ? 2 : 0)
    if (selected.length && contextLength + addition > maxContextChars) break
    if (!selected.length && addition > maxContextChars) {
      selected.push({
        ...chunk,
        text: chunk.text.slice(0, maxContextChars),
      })
      warnings.push('CONTEXT_TRUNCATED: 检索上下文已按预算截断。')
      break
    }
    selected.push(chunk)
    contextLength += addition
  }

  const chunks = selected.map((chunk, index) => ({
    ...chunk,
    citationId: `c${index + 1}`,
    location: describeLocation(chunk.metadata),
  }))
  const citations = chunks.map((chunk) => ({
    id: chunk.citationId,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    chunkIndex: chunk.chunkIndex,
    location: chunk.location,
    score: chunk.score,
  }))

  return {
    chunks,
    citations,
    context: chunks.map((chunk) => chunk.text).join('\n\n'),
    total: chunks.length,
    warnings,
  }
}

function mergeRetrievalRows(
  keywordRows: RetrievedKnowledgeChunk[],
  vectorRows: RetrievedKnowledgeChunk[],
  mode: KnowledgeRetrievalInput['retrievalMode'],
) {
  if (mode === 'keyword') {
    return keywordRows.map((row) => ({
      ...row,
      fulltextScore: row.fulltextScore ?? row.score,
    }))
  }
  if (mode === 'vector' && !keywordRows.length) {
    return vectorRows.map((row) => ({
      ...row,
      vectorScore: row.vectorScore ?? row.score,
    }))
  }

  const keywordMax = maxScore(keywordRows)
  const vectorMax = maxScore(vectorRows)
  const byId = new Map<string, RetrievedKnowledgeChunk & {
    fulltextScore?: number
    vectorScore?: number
  }>()

  keywordRows.forEach((row) => {
    const normalized = keywordMax ? row.score / keywordMax : 0
    byId.set(row.id, {
      ...row,
      fulltextScore: row.score,
      score: normalized * 0.3,
    })
  })
  vectorRows.forEach((row) => {
    const normalized = vectorMax ? row.score / vectorMax : 0
    const existing = byId.get(row.id)
    byId.set(row.id, {
      ...(existing ?? row),
      vectorScore: row.score,
      score:
        (existing?.score ?? 0) +
        normalized * 0.7,
    })
  })
  return [...byId.values()]
}

function maxScore(rows: RetrievedKnowledgeChunk[]) {
  return rows.reduce((maximum, row) => Math.max(maximum, row.score), 0)
}

function describeLocation(metadata: Record<string, unknown>) {
  if (typeof metadata.page === 'number') return `第 ${metadata.page} 页`
  if (typeof metadata.sheet === 'string') {
    const start = metadata.rowStart ?? metadata.startRow
    const end = metadata.rowEnd ?? metadata.endRow
    return start !== undefined
      ? `${metadata.sheet} · 行 ${String(start)}-${String(end ?? start)}`
      : metadata.sheet
  }
  if (Array.isArray(metadata.headingPath)) {
    return metadata.headingPath.join(' / ')
  }
  if (typeof metadata.charStart === 'number') {
    return `字符 ${metadata.charStart}-${String(metadata.charEnd ?? metadata.charStart)}`
  }
  return '未提供原文定位'
}
