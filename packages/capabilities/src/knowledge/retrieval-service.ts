import {
  createEmbeddingProvider,
  embedTexts,
  type EmbeddingProvider,
} from './embeddings'
import {
  retrieveKnowledge,
  type KnowledgeRetrievalInput,
  type KnowledgeRetrievalResult,
  type KnowledgeReranker,
  type RetrievedKnowledgeChunk,
} from './retrieval'
import { createRerankProviderFromEnv } from './rerank'

export interface KnowledgeEmbeddingConfig {
  provider: string
  model: string
  dimension: number
}

export interface KnowledgeRetrievalRepository {
  keywordSearch(
    knowledgeBaseIds: string[],
    query: string,
    topK: number,
  ): Promise<RetrievedKnowledgeChunk[]>
  vectorSearch(
    knowledgeBaseIds: string[],
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievedKnowledgeChunk[]>
  embeddingConfig(
    knowledgeBaseIds: string[],
  ): Promise<KnowledgeEmbeddingConfig>
}

export interface KnowledgeRetrieverOptions {
  env?: NodeJS.ProcessEnv
  createEmbeddingProvider?: typeof createEmbeddingProvider
  reranker?: KnowledgeReranker
}

/**
 * 把知识库仓库、embedding 配置和检索算法组合成可复用服务。
 * @param repository 工作区内的知识库检索仓库。
 * @param options 环境变量和测试可注入的 Provider 工厂。
 * @returns 支持 vector、keyword 与 hybrid 的检索服务。
 */
export function createKnowledgeRetriever(
  repository: KnowledgeRetrievalRepository,
  options: KnowledgeRetrieverOptions = {},
) {
  const env = options.env ?? process.env
  const providerFactory =
    options.createEmbeddingProvider ?? createEmbeddingProvider
  const reranker =
    options.reranker ?? createRerankProviderFromEnv(env)

  return {
    async retrieve(
      input: KnowledgeRetrievalInput,
    ): Promise<KnowledgeRetrievalResult> {
      return retrieveKnowledge(input, {
        store: {
          keyword: (query) =>
            repository.keywordSearch(
              query.knowledgeBaseIds,
              query.query,
              query.topK,
            ),
          vector: (query) =>
            repository.vectorSearch(
              query.knowledgeBaseIds,
              query.queryEmbedding,
              query.topK,
            ),
        },
        embedder: {
          async embedQuery(text, embedOptions) {
            const config = await repository.embeddingConfig(
              input.knowledgeBaseIds,
            )
            const provider: EmbeddingProvider = providerFactory({
              provider: config.provider,
              model: config.model,
              dimensions: config.dimension,
              baseUrl:
                env.EMBEDDING_BASE_URL ??
                env.OLLAMA_BASE_URL ??
                'http://127.0.0.1:11434',
              apiKey: env.EMBEDDING_API_KEY,
            })
            const vectors = await embedTexts(provider, [text], {
              dimensions: config.dimension,
              batchSize: 1,
              signal: embedOptions?.signal,
            })
            return vectors[0]
          },
        },
        reranker,
        allowKeywordFallback: true,
      })
    },
  }
}
