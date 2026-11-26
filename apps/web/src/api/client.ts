import type { RunEvent, ValidationIssue } from '@/shared/types'

type QueryValue = string | number | boolean | null | undefined
type Query = Record<string, QueryValue | QueryValue[]>

export interface ApiErrorBody {
  code: string
  message: string
  retryable?: boolean
  details?: unknown
  issues?: ValidationIssue[]
}

interface ErrorEnvelope {
  error?: Partial<ApiErrorBody>
}

/**
 * 统一 API 异常，保留 HTTP 状态、稳定错误码和字段级问题。
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  readonly details?: unknown
  readonly issues?: ValidationIssue[]

  /**
   * 创建可被页面统一处理的 API 异常。
   *
   * @param input 服务端错误和 HTTP 状态。
   */
  constructor(input: {
    status: number
    code: string
    message: string
    retryable?: boolean
    details?: unknown
    issues?: ValidationIssue[]
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.code
    this.retryable = input.retryable ?? false
    this.details = input.details
    this.issues = input.issues
  }
}

/**
 * 将查询参数编码为 URLSearchParams，自动忽略空值和重复数组项。
 *
 * @param query 查询字段。
 * @returns 已编码查询参数。
 */
function buildQuery(query?: Query) {
  const params = new URLSearchParams()
  Object.entries(query ?? {}).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value]
    values.forEach((item) => {
      if (item !== undefined && item !== null && item !== '') {
        params.append(key, String(item))
      }
    })
  })
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

/**
 * 把网络响应体中的错误 envelope 转换为 ApiError。
 *
 * @param response 非成功 HTTP 响应。
 * @returns 始终抛出的 ApiError。
 */
async function throwResponseError(response: Response): Promise<never> {
  let body: ErrorEnvelope | undefined
  try {
    body = (await response.json()) as ErrorEnvelope
  } catch {
    body = undefined
  }
  throw new ApiError({
    status: response.status,
    code: body?.error?.code ?? `HTTP_${response.status}`,
    message: body?.error?.message ?? (response.statusText || '请求失败。'),
    retryable: body?.error?.retryable,
    details: body?.error?.details,
    issues: body?.error?.issues,
  })
}

/**
 * 发起 REST 请求并统一 JSON、错误体和 204 响应处理。
 *
 * @param path API 相对路径。
 * @param init fetch 选项。
 * @returns 解析后的响应数据。
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  })
  if (!response.ok) return throwResponseError(response)
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return (await response.text()) as T
  return (await response.json()) as T
}

/**
 * 查询 GET API。
 *
 * @param path API 路径。
 * @param query 查询字段。
 * @returns 响应数据。
 */
export function apiGet<T>(path: string, query?: Query) {
  return apiRequest<T>(`${path}${buildQuery(query)}`)
}

/**
 * 提交 POST JSON API。
 *
 * @param path API 路径。
 * @param body JSON 请求体。
 * @param headers 额外请求头。
 * @returns 响应数据。
 */
export function apiPost<T>(path: string, body?: unknown, headers?: HeadersInit) {
  return apiRequest<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  })
}

/**
 * 提交 PATCH JSON API。
 *
 * @param path API 路径。
 * @param body JSON 请求体。
 * @returns 响应数据。
 */
export function apiPatch<T>(path: string, body?: unknown) {
  return apiRequest<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/**
 * 提交 DELETE API。
 *
 * @param path API 路径。
 * @returns 响应数据。
 */
export function apiDelete<T>(path: string) {
  return apiRequest<T>(path, { method: 'DELETE' })
}

/**
 * 上传 multipart 表单并统一错误处理。
 *
 * @param path API 路径。
 * @param formData 待上传表单。
 * @returns 响应数据。
 */
export function apiUpload<T>(path: string, formData: FormData) {
  return apiRequest<T>(path, { method: 'POST', body: formData })
}

/**
 * 逐行解析 fetch SSE 流，并保留服务端事件序号。
 *
 * @param block SSE 原始文本块。
 * @returns 解析后的事件对象；非事件块返回 null。
 */
function parseSseBlock(block: string) {
  let id = 0
  let event = ''
  const data: string[] = []
  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('id:')) id = Number(line.slice(3).trim())
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  })
  if (!data.length) return null
  return { id, event, data: data.join('\n') }
}

/**
 * 通过 fetch 流订阅运行 SSE，支持 `after` 断点续传和主动取消。
 *
 * @param input 运行 ID、起始序号和生命周期回调。
 * @returns 取消订阅函数。
 */
export function subscribeRunEvents(input: {
  runId: string
  afterSeq?: number
  onEvent: (event: RunEvent) => void
  onError: (error: Error) => void
  onEnd: () => void
}) {
  const controller = new AbortController()
  let ended = false

  /**
   * 结束订阅并避免重复触发回调。
   */
  function finish() {
    if (ended) return
    ended = true
    input.onEnd()
  }

  void (async () => {
    try {
      const query = input.afterSeq ? `?after=${input.afterSeq}` : ''
      const response = await fetch(`/api/runs/${input.runId}/events${query}`, {
        headers: {
          Accept: 'text/event-stream',
          ...(input.afterSeq ? { 'Last-Event-ID': String(input.afterSeq) } : {}),
        },
        signal: controller.signal,
      })
      if (!response.ok) await throwResponseError(response)
      if (!response.body) throw new ApiError({
        status: 0,
        code: 'SSE_BODY_MISSING',
        message: '运行事件流没有响应正文。',
        retryable: true,
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        blocks.forEach((block) => {
          const parsed = parseSseBlock(block)
          if (!parsed) return
          try {
            const event = JSON.parse(parsed.data) as RunEvent
            if (parsed.event) event.type = parsed.event
            if (parsed.id) event.seq = parsed.id
            input.onEvent(event)
          } catch {
            input.onError(new Error('收到无法解析的运行事件。'))
          }
        })
      }
      finish()
    } catch (error) {
      if (controller.signal.aborted) return
      const normalized = error instanceof Error ? error : new Error(String(error))
      input.onError(normalized)
      finish()
    }
  })()

  return () => {
    if (ended) return
    ended = true
    controller.abort()
  }
}
