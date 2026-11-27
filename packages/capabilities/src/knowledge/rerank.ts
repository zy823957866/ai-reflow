export interface RerankCandidate {
  id: string
  text: string
  documentName?: string
  metadata?: Record<string, unknown>
}

export interface RerankScore {
  id: string
  score: number
}

export interface RerankInput {
  query: string
  candidates: RerankCandidate[]
  signal?: AbortSignal
}

export interface RerankProvider {
  readonly model: string
  rerank(input: RerankInput): Promise<RerankScore[]>
}

export class RerankError extends Error {
  readonly code: string
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
    this.name = 'RerankError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
    if (options.cause !== undefined) this.cause = options.cause
  }
}

interface OllamaRerankOptions {
  model: string
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  maxTextChars?: number
  batchSize?: number
  fetch?: typeof fetch
}

interface HttpRerankOptions {
  model: string
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

/**
 * 使用 Ollama 对话模型做 LLM 精排。
 *
 * 通过一次批量请求给全部候选打分，避免逐条调用带来的额外延迟。
 *
 * @param input 模型、服务地址、超时与可注入的 fetch。
 * @returns 面向检索链路的重排 Provider。
 */
export function createOllamaRerankProvider(
  input: OllamaRerankOptions,
): RerankProvider {
  const request = input.fetch ?? fetch
  const timeoutMs = Math.max(1000, input.timeoutMs ?? 60_000)
  const maxTextChars = Math.max(100, input.maxTextChars ?? 400)
  const batchSize = Math.max(1, input.batchSize ?? 8)
  const endpoint = joinEndpoint(input.baseUrl, 'api/chat')

  return {
    model: input.model,
    async rerank({ query, candidates, signal }) {
      if (!candidates.length) return []
      const scores: RerankScore[] = []
      for (let start = 0; start < candidates.length; start += batchSize) {
        const batch = candidates.slice(start, start + batchSize)
        const messages = buildRerankMessages(query, batch, maxTextChars)
        const payload = await requestJson(request, endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(input.apiKey
              ? { authorization: `Bearer ${input.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: input.model,
            stream: false,
            think: false,
            format: 'json',
            keep_alive: '30m',
            options: {
              temperature: 0,
              num_predict: Math.min(
                1024,
                Math.max(128, batch.length * 24 + 64),
              ),
              num_ctx: 8192,
            },
            messages,
          }),
          signal: requestSignal(signal, timeoutMs),
        })
        const content = ollamaMessageContent(payload)
        if (typeof content !== 'string' || !content.trim()) {
          throw new RerankError(
            'RERANK_INVALID_RESPONSE',
            'Rerank 模型没有返回评分内容。',
            { retryable: true },
          )
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(content)
        } catch (error) {
          throw new RerankError(
            'RERANK_INVALID_RESPONSE',
            'Rerank 模型返回的评分不是合法 JSON。',
            { retryable: true, cause: error },
          )
        }
        scores.push(...parseScores(parsed, batch))
      }
      return scores
    },
  }
}

/**
 * 调用 Cohere 兼容的 HTTP Rerank 接口，例如 bge-reranker 服务。
 *
 * @param input 模型、服务地址、凭据、超时与可注入的 fetch。
 * @returns 面向检索链路的重排 Provider。
 */
export function createHttpRerankProvider(
  input: HttpRerankOptions,
): RerankProvider {
  const request = input.fetch ?? fetch
  const timeoutMs = Math.max(1000, input.timeoutMs ?? 10_000)
  const endpoint = joinEndpoint(input.baseUrl, 'rerank')

  return {
    model: input.model,
    async rerank({ query, candidates, signal }) {
      if (!candidates.length) return []
      const payload = await requestJson(request, endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(input.apiKey
            ? { authorization: `Bearer ${input.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: input.model,
          query,
          documents: candidates.map((candidate) => candidate.text),
          top_n: candidates.length,
          return_documents: false,
        }),
        signal: requestSignal(signal, timeoutMs),
      })
      return parseHttpScores(payload, candidates)
    },
  }
}

/**
 * 从环境变量创建 Rerank Provider。
 *
 * 未配置 RERANK_PROVIDER 时返回 undefined，让检索侧显式降级，
 * 而不是把错误配置伪装成可用能力。
 *
 * @param env 环境变量。
 * @returns Rerank Provider 或 undefined。
 */
export function createRerankProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RerankProvider | undefined {
  const provider = (env.RERANK_PROVIDER ?? '').trim().toLowerCase()
  if (!provider || provider === 'none' || provider === 'disabled') {
    return undefined
  }

  const timeoutMs = positiveNumber(env.RERANK_TIMEOUT_MS)
  const model = env.RERANK_MODEL?.trim()
  if (!model) return undefined

  if (provider === 'ollama') {
    return createOllamaRerankProvider({
      model,
      baseUrl:
        env.RERANK_BASE_URL?.trim() ||
        env.OLLAMA_BASE_URL?.trim() ||
        'http://127.0.0.1:11434',
      apiKey: env.RERANK_API_KEY?.trim() || undefined,
      timeoutMs,
      maxTextChars: positiveInteger(env.RERANK_MAX_TEXT_CHARS),
      batchSize: positiveInteger(env.RERANK_BATCH_SIZE),
    })
  }

  if (
    provider === 'http' ||
    provider === 'cohere' ||
    provider === 'compatible'
  ) {
    const baseUrl = env.RERANK_BASE_URL?.trim()
    if (!baseUrl) return undefined
    return createHttpRerankProvider({
      model,
      baseUrl,
      apiKey: env.RERANK_API_KEY?.trim() || undefined,
      timeoutMs,
    })
  }

  return undefined
}

function buildRerankMessages(
  query: string,
  candidates: RerankCandidate[],
  maxTextChars: number,
) {
  const candidatePayload = candidates.map((candidate, index) => ({
    index: index + 1,
    document: candidate.documentName ?? '',
    text: candidate.text.slice(0, maxTextChars),
  }))
  return [
    {
      role: 'system',
      content:
        '你是知识库检索重排器。根据用户问题判断每个候选切片的直接相关性。只输出 JSON，不要解释。',
    },
    {
      role: 'user',
      content: [
        `问题：${query}`,
        '',
        '候选切片：',
        JSON.stringify(candidatePayload, null, 2),
        '',
        `请为候选 1 到 ${candidates.length} 分别打 0-100 分。`,
        '严格返回 {"scores":[{"index":1,"score":0}]}，必须覆盖全部候选。',
      ].join('\n'),
    },
  ]
}

function ollamaMessageContent(payload: unknown) {
  if (!payload || typeof payload !== 'object') return undefined
  const message = (payload as Record<string, unknown>).message
  if (!message || typeof message !== 'object') return undefined
  return (message as Record<string, unknown>).content
}

function parseScores(
  payload: unknown,
  candidates: RerankCandidate[],
): RerankScore[] {
  const raw =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).scores
      : undefined

  if (Array.isArray(raw) && raw.every((item) => typeof item === 'number')) {
    if (raw.length !== candidates.length) {
      throw new RerankError(
        'RERANK_INVALID_RESPONSE',
        `Rerank 返回 ${raw.length} 条评分，预期 ${candidates.length} 条。`,
        { retryable: true },
      )
    }
    return candidates.map((candidate, index) => ({
      id: candidate.id,
      score: normalizeScore(raw[index]),
    }))
  }

  const byIndex = indexedScores(raw, 1)
  return candidates.map((candidate, index) => {
    const score = byIndex.get(index + 1)
    if (score === undefined) {
      throw new RerankError(
        'RERANK_INVALID_RESPONSE',
        `Rerank 缺少候选 ${index + 1} 的评分。`,
        { retryable: true },
      )
    }
    return { id: candidate.id, score }
  })
}

function parseHttpScores(
  payload: unknown,
  candidates: RerankCandidate[],
): RerankScore[] {
  const raw =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).results ??
        (payload as Record<string, unknown>).scores
      : payload
  const zeroBased =
    Array.isArray(raw) &&
    raw.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        Number((item as Record<string, unknown>).index) === 0,
    )
  const byIndex = indexedScores(raw, zeroBased ? 0 : 1)
  return candidates.map((candidate, index) => {
    const score = byIndex.get(zeroBased ? index : index + 1)
    if (score === undefined) {
      throw new RerankError(
        'RERANK_INVALID_RESPONSE',
        `Rerank 服务缺少候选 ${index + 1} 的评分。`,
        { retryable: true },
      )
    }
    return { id: candidate.id, score }
  })
}

function indexedScores(raw: unknown, minIndex: number) {
  const scores = new Map<number, number>()
  if (!Array.isArray(raw)) return scores
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const index = Number(record.index)
    const score = Number(
      record.score ??
        record.relevance_score ??
        record.relevanceScore,
    )
    if (!Number.isInteger(index) || index < minIndex || !Number.isFinite(score)) {
      continue
    }
    scores.set(index, normalizeScore(score))
  }
  return scores
}

function normalizeScore(value: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new RerankError(
      'RERANK_INVALID_RESPONSE',
      'Rerank 返回了非法评分。',
      { retryable: true },
    )
  }
  const normalized = numeric > 1 ? numeric / 100 : numeric
  return Math.min(1, Math.max(0, normalized))
}

async function requestJson(
  request: typeof fetch,
  url: string,
  init: RequestInit,
) {
  let response: Response
  try {
    response = await request(url, init)
  } catch (error) {
    throw normalizeRerankError(error)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new RerankError(
      'RERANK_REQUEST_FAILED',
      `Rerank 服务返回 ${response.status}${
        detail ? `：${detail.slice(0, 200)}` : ''
      }`,
      {
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      },
    )
  }
  try {
    return (await response.json()) as unknown
  } catch (error) {
    throw new RerankError(
      'RERANK_INVALID_RESPONSE',
      'Rerank 服务返回的内容不是合法 JSON。',
      { retryable: true, cause: error },
    )
  }
}

function normalizeRerankError(error: unknown) {
  if (error instanceof RerankError) return error
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new RerankError(
      'RERANK_TIMEOUT',
      'Rerank 调用超时。',
      { retryable: true, cause: error },
    )
  }
  return new RerankError(
    'RERANK_UNAVAILABLE',
    error instanceof Error ? error.message : 'Rerank 调用失败。',
    { retryable: true, cause: error },
  )
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function joinEndpoint(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/+$/, '')
  return normalized.endsWith(`/${path}`)
    ? normalized
    : `${normalized}/${path}`
}

function positiveNumber(value: string | undefined) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
}

function positiveInteger(value: string | undefined) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined
}
