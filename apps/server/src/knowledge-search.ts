import {
  createKnowledgeRetriever,
  type KnowledgeRetrievalResult,
  type KnowledgeRetrieverOptions,
  type KnowledgeRetrievalRepository,
} from '@ai-reflow/capabilities'

export interface KnowledgeSearchInput {
  query: string
  topK?: number
  scoreThreshold?: number
  retrievalMode?: 'vector' | 'keyword' | 'hybrid'
  rerank?: { enabled: boolean }
}

/**
 * 创建知识库 HTTP 检索服务，保持现有片段与引用响应结构。
 * @param repository 当前工作区的知识库仓库。
 * @param options 部署环境与测试 Provider。
 * @returns 可被控制器调用的检索服务。
 */
export function createKnowledgeSearchService(
  repository: KnowledgeRetrievalRepository,
  options: KnowledgeRetrieverOptions = {},
) {
  const retriever = createKnowledgeRetriever(repository, options)

  return {
    async search(knowledgeBaseId: string, input: KnowledgeSearchInput) {
      const retrieved = await retriever.retrieve({
        knowledgeBaseIds: [knowledgeBaseId],
        query: input.query,
        topK: input.topK ?? 5,
        scoreThreshold: input.scoreThreshold ?? 0,
        retrievalMode: input.retrievalMode ?? 'keyword',
      })
      return toKnowledgeSearchResponse(retrieved, input.rerank?.enabled ?? false)
    },
  }
}

function toKnowledgeSearchResponse(
  result: KnowledgeRetrievalResult,
  rerankEnabled: boolean,
) {
  const warnings = [...result.warnings]
  if (
    rerankEnabled &&
    !warnings.some((warning) => warning.startsWith('RERANK_NOT_CONFIGURED'))
  ) {
    warnings.push('RERANK_NOT_CONFIGURED: 已降级为原始检索排序。')
  }
  const chunks = result.chunks.map((chunk) => ({
    id: chunk.id,
    citationId: chunk.citationId,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    chunkIndex: chunk.chunkIndex,
    snippet: chunk.text,
    location: chunk.location,
    score: chunk.score,
    fulltextScore: chunk.fulltextScore,
    vectorScore: chunk.vectorScore,
    metadata: chunk.metadata,
  }))
  return {
    chunks,
    citations: result.citations,
    context: result.context,
    total: result.total,
    rerankApplied: false,
    warnings,
  }
}
