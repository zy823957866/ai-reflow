import type {
  AIMessageChunk,
  BaseMessage,
} from '@langchain/core/messages'
import { ChatOllama } from '@langchain/ollama'
import { ChatOpenAI } from '@langchain/openai'
import type { AgentToolSchema } from './tools'

export interface AgentModelConnection {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
  capabilities?: string[]
}

export interface AgentChatModelOptions {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

export interface AgentChatModelLike {
  bindTools?(tools: unknown[]): AgentChatModelLike
  stream(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<AIMessageChunk>>
}

export interface AgentChatProviderInput {
  connectionId: string
  model?: string
  messages: BaseMessage[]
  tools: AgentToolSchema[]
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
}

export interface AgentChatProvider {
  stream(
    input: AgentChatProviderInput,
  ): Promise<AsyncIterable<AIMessageChunk>>
}

export interface AgentProviderFactories {
  createOllama(options: AgentChatModelOptions): AgentChatModelLike
  createOpenAI(options: AgentChatModelOptions): AgentChatModelLike
}

export interface AgentChatProviderDependencies {
  resolveConnection(connectionId: string): Promise<AgentModelConnection>
  env?: Record<string, string | undefined>
  factories?: Partial<AgentProviderFactories>
}

export class AgentModelError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status?: number

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'AgentModelError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
    if (options.cause !== undefined) this.cause = options.cause
  }
}

/**
 * 创建 Ollama / OpenAI 兼容聊天 Provider。
 * @param dependencies 模型连接解析器、环境变量与可替换工厂。
 * @returns 流式聊天 Provider。
 */
export function createAgentChatProvider(
  dependencies: AgentChatProviderDependencies,
): AgentChatProvider {
  const env =
    dependencies.env ??
    (typeof process === 'undefined' ? {} : process.env)
  const factories: AgentProviderFactories = {
    createOllama: (options) =>
      new ChatOllama({
        model: options.model,
        baseUrl: options.baseUrl,
        temperature: options.temperature,
        numPredict: options.maxTokens,
      }) as unknown as AgentChatModelLike,
    createOpenAI: (options) =>
      new ChatOpenAI({
        model: options.model,
        apiKey: options.apiKey,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        configuration: options.baseUrl
          ? { baseURL: options.baseUrl }
          : undefined,
      }) as unknown as AgentChatModelLike,
    ...dependencies.factories,
  }

  return {
    async stream(input) {
      let provider = 'unknown'
      return (async function* () {
        try {
          const connection = await dependencies.resolveConnection(
            input.connectionId,
          )
          provider = connection.provider.toLowerCase()
          const model = input.model ?? connection.model
          if (!model) {
            throw new AgentModelError(
              'MODEL_NOT_CONFIGURED',
              `模型连接 ${input.connectionId} 未配置模型。`,
            )
          }
          const options: AgentChatModelOptions = {
            provider,
            model,
            baseUrl: connection.baseUrl,
            apiKey: resolveApiKey(provider, connection, env),
            temperature: input.temperature,
            maxTokens: input.maxTokens,
          }
          let runnable =
            provider === 'ollama'
              ? factories.createOllama(options)
              : factories.createOpenAI({
                  ...options,
                  baseUrl:
                    connection.baseUrl ??
                    (provider === 'deepseek'
                      ? 'https://api.deepseek.com/v1'
                      : undefined),
                })
          if (input.tools.length && runnable.bindTools) {
            runnable = runnable.bindTools(
              input.tools.map(toOpenAITool),
            )
          }
          const stream = await runnable.stream(input.messages, {
            signal: input.signal,
          })
          for await (const chunk of stream) yield chunk
        } catch (error) {
          if (isAbortError(error)) throw error
          throw normalizeModelError(error, provider)
        }
      })()
    },
  }
}

function toOpenAITool(tool: AgentToolSchema) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

function resolveApiKey(
  provider: string,
  connection: AgentModelConnection,
  env: Record<string, string | undefined>,
) {
  if (connection.apiKey) return connection.apiKey
  if (provider === 'ollama') return undefined
  const providerKey =
    provider === 'deepseek'
      ? env.DEEPSEEK_API_KEY
      : provider === 'openai'
        ? env.OPENAI_API_KEY
        : undefined
  const apiKey = providerKey ?? env.AI_REFLOW_MODEL_API_KEY
  if (apiKey) return apiKey
  if (provider === 'custom') return 'not-required'
  throw new AgentModelError(
    'MODEL_AUTH_FAILED',
    `模型连接 ${connection.provider} 缺少 API Key。`,
  )
}

function normalizeModelError(error: unknown, provider: string) {
  if (error instanceof AgentModelError) return error
  const status = statusOf(error)
  const message =
    error instanceof Error ? error.message : '模型服务调用失败。'
  if (status === 401 || status === 403) {
    return new AgentModelError('MODEL_AUTH_FAILED', message, {
      status,
      cause: error,
    })
  }
  if (status === 429) {
    return new AgentModelError('MODEL_RATE_LIMITED', message, {
      status,
      retryable: true,
      cause: error,
    })
  }
  if (status !== undefined && status >= 500) {
    return new AgentModelError('MODEL_UNAVAILABLE', message, {
      status,
      retryable: true,
      cause: error,
    })
  }
  return new AgentModelError(
    `MODEL_REQUEST_FAILED`,
    `${provider} 模型调用失败：${message}`,
    { status, retryable: status === undefined, cause: error },
  )
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

function isAbortError(error: unknown) {
  return (
    (error instanceof Error &&
      (error.name === 'AbortError' ||
        /abort|cancel/i.test(error.message))) ||
    false
  )
}
