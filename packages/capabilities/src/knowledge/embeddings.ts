import { OllamaEmbeddings } from '@langchain/ollama'
import { OpenAIEmbeddings } from '@langchain/openai'

export interface EmbeddingProvider {
  embedDocuments(
    texts: string[],
    options?: { signal?: AbortSignal },
  ): Promise<number[][]>
}

export interface EmbeddingBatchOptions {
  batchSize?: number
  dimensions: number
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}

export class EmbeddingError extends Error {
  readonly code: string
  readonly stage = 'embedding' as const
  readonly retryable: boolean
  readonly status?: number

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean
      status?: number
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'EmbeddingError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
    if (options.cause !== undefined) this.cause = options.cause
  }
}

/**
 * 分批生成 embedding，并对限流、5xx 和连接错误进行指数退避。
 * @param provider embedding Provider。
 * @param texts 待向量化文本。
 * @param options 批次、维度和重试配置。
 * @returns 与输入顺序一致的向量列表。
 */
export async function embedTexts(
  provider: EmbeddingProvider,
  texts: string[],
  options: EmbeddingBatchOptions,
): Promise<number[][]> {
  if (!texts.length) return []
  const batchSize = Math.max(1, options.batchSize ?? 32)
  const maxRetries = Math.max(0, options.maxRetries ?? 2)
  const initialDelay = Math.max(1, options.initialDelayMs ?? 500)
  const maxDelay = Math.max(initialDelay, options.maxDelayMs ?? 8000)
  const vectors: number[][] = []

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    options.signal?.throwIfAborted()
    const batch = texts.slice(offset, offset + batchSize)
    let attempt = 0
    while (true) {
      try {
        const result = await provider.embedDocuments(batch, {
          signal: options.signal,
        })
        if (result.length !== batch.length) {
          throw new EmbeddingError(
            'EMBEDDING_COUNT_MISMATCH',
            `embedding 返回 ${result.length} 条，预期 ${batch.length} 条。`,
          )
        }
        result.forEach((vector) => {
          if (vector.length !== options.dimensions) {
            throw new EmbeddingError(
              'EMBEDDING_DIMENSION_MISMATCH',
              `embedding 维度不一致：知识库为 ${options.dimensions}，Provider 返回 ${vector.length}。`,
            )
          }
        })
        vectors.push(...result)
        break
      } catch (error) {
        const normalized = normalizeEmbeddingError(error)
        if (!normalized.retryable || attempt >= maxRetries) throw normalized
        const delay = Math.min(
          maxDelay,
          initialDelay * 2 ** attempt,
        )
        await (options.sleep ?? sleep)(delay)
        attempt += 1
      }
    }
  }
  return vectors
}

/**
 * 根据知识库记录创建 Ollama 或 OpenAI 兼容 embedding Provider。
 * @param input Provider、模型、地址与凭据。
 * @returns LangChain embedding 适配器。
 */
export function createEmbeddingProvider(input: {
  provider: string
  model: string
  dimensions: number
  baseUrl?: string
  apiKey?: string
}): EmbeddingProvider {
  const provider = input.provider.toLowerCase()
  if (provider === 'ollama') {
    return new OllamaEmbeddings({
      model: input.model,
      baseUrl: input.baseUrl,
      dimensions: input.dimensions,
      truncate: false,
    }) as EmbeddingProvider
  }
  if (
    provider === 'openai' ||
    provider === 'custom' ||
    provider === 'compatible'
  ) {
    const apiKey =
      input.apiKey ??
      process.env.EMBEDDING_API_KEY ??
      process.env.AI_REFLOW_MODEL_API_KEY ??
      process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new EmbeddingError(
        'EMBEDDING_CREDENTIAL_MISSING',
        'embedding Provider 缺少 API Key。',
      )
    }
    return new OpenAIEmbeddings({
      model: input.model,
      dimensions: input.dimensions,
      apiKey,
      batchSize: 32,
      configuration: input.baseUrl
        ? { baseURL: input.baseUrl }
        : undefined,
    }) as EmbeddingProvider
  }
  throw new EmbeddingError(
    'EMBEDDING_PROVIDER_UNSUPPORTED',
    `暂不支持 embedding Provider ${input.provider}。`,
  )
}

/**
 * 使用部署环境默认值创建 embedding Provider。
 * @param env 环境变量。
 * @returns embedding Provider。
 */
export function createEmbeddingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
) {
  return createEmbeddingProvider({
    provider: env.EMBEDDING_PROVIDER ?? 'ollama',
    model: env.EMBEDDING_MODEL ?? 'nomic-embed-text',
    dimensions: Number(env.EMBEDDING_DIMENSION ?? 768),
    baseUrl:
      env.EMBEDDING_BASE_URL ??
      env.OLLAMA_BASE_URL ??
      'http://127.0.0.1:11434',
    apiKey: env.EMBEDDING_API_KEY,
  })
}

function normalizeEmbeddingError(error: unknown) {
  if (error instanceof EmbeddingError) return error
  const status = statusOf(error)
  const message =
    error instanceof Error ? error.message : 'embedding 调用失败。'
  if (status === 429) {
    return new EmbeddingError('EMBEDDING_RATE_LIMITED', message, {
      status,
      retryable: true,
      cause: error,
    })
  }
  if (status !== undefined && status >= 500) {
    return new EmbeddingError('EMBEDDING_UNAVAILABLE', message, {
      status,
      retryable: true,
      cause: error,
    })
  }
  if (status !== undefined && status >= 400) {
    return new EmbeddingError('EMBEDDING_REQUEST_INVALID', message, {
      status,
      retryable: false,
      cause: error,
    })
  }
  return new EmbeddingError('EMBEDDING_UNAVAILABLE', message, {
    retryable: true,
    cause: error,
  })
}

function statusOf(error: unknown) {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  const direct = Number(record.status)
  if (Number.isFinite(direct)) return direct
  const response = record.response
  if (response && typeof response === 'object') {
    const nested = Number((response as Record<string, unknown>).status)
    if (Number.isFinite(nested)) return nested
  }
  return undefined
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
