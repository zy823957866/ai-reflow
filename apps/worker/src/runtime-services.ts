import {
  createKnowledgeRetriever,
} from '@ai-reflow/capabilities'
import {
  AppError,
  NodeExecutionError,
  type AgentRuntimePort,
  type NodeRuntimeServices,
} from '@ai-reflow/core'
import {
  KnowledgeRepository,
  type DatabaseClient,
} from '@ai-reflow/platform'

/**
 * 创建 worker 真实运行时服务。
 * @param sql PostgreSQL 连接。
 * @param workspaceId 当前 workspace 内部 ID。
 * @returns 模型、MCP 和知识库端口。
 */
export function createRuntimeServices(
  sql: DatabaseClient,
  workspaceId: string,
  agent?: AgentRuntimePort,
): NodeRuntimeServices {
  const knowledgeRepository = new KnowledgeRepository(sql, workspaceId)
  const knowledgeRetriever = createKnowledgeRetriever(knowledgeRepository)
  return {
    llm: {
    /**
     * 调用 OpenAI 兼容 Chat Completions 接口。
     * @param input 模型连接、Prompt 与超时上下文。
     * @returns 文本、结构化结果和 usage。
     */
    async generate(input) {
      const [connection] = await sql<Array<{
        base_url: string | null
        default_model: string
        provider: string
        enabled: boolean
      }>>`
        select base_url, default_model, provider, enabled
        from model_connections
        where workspace_id = ${workspaceId}
          and public_id = ${input.connectionId}
        limit 1
      `
      if (!connection?.enabled) {
        throw new NodeExecutionError({
          code: 'MODEL_NOT_READY',
          message: `模型连接 ${input.connectionId} 不可用。`,
          nodeType: 'llm',
        })
      }
      if (connection.provider !== 'openai' && connection.provider !== 'custom') {
        throw new NodeExecutionError({
          code: 'MODEL_PROVIDER_NOT_IMPLEMENTED',
          message: `模型供应商 ${connection.provider} 的 worker 适配器尚未配置。`,
          nodeType: 'llm',
        })
      }
      const apiKey =
        process.env.AI_REFLOW_MODEL_API_KEY ??
        process.env.OPENAI_API_KEY
      if (!apiKey) {
        throw new NodeExecutionError({
          code: 'MODEL_CREDENTIAL_MISSING',
          message: '模型连接缺少可用的服务端凭据。',
          nodeType: 'llm',
        })
      }
      const baseUrl = (connection.base_url ?? 'https://api.openai.com/v1').replace(/\/$/, '')
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.model ?? connection.default_model,
          messages: [
            ...(input.systemPrompt
              ? [{ role: 'system', content: input.systemPrompt }]
              : []),
            { role: 'user', content: input.prompt },
          ],
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          response_format:
            input.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
        }),
        signal: input.signal,
      })
      const body = await response.json() as Record<string, unknown>
      if (!response.ok) {
        throw new NodeExecutionError({
          code: `MODEL_HTTP_${response.status}`,
          message: `模型请求失败（${response.status}）。`,
          nodeType: 'llm',
          retryable: response.status === 429 || response.status >= 500,
          details: { status: response.status },
        })
      }
      const firstChoice =
        Array.isArray(body.choices) && body.choices[0] && typeof body.choices[0] === 'object'
          ? body.choices[0] as Record<string, unknown>
          : {}
      const message =
        firstChoice.message && typeof firstChoice.message === 'object'
          ? firstChoice.message as Record<string, unknown>
          : {}
      return {
        text: typeof message.content === 'string' ? message.content : '',
        structured: undefined,
        usage:
          body.usage && typeof body.usage === 'object'
            ? body.usage as Record<string, unknown>
            : {},
        model: String(body.model ?? input.model ?? connection.default_model),
      }
    },
    },

    mcp: {
    /**
     * 通过 Streamable HTTP MCP JSON-RPC 端口调用工具。
     * @param input MCP server、工具名、参数和超时。
     * @returns MCP 工具结果。
     */
    async call(input) {
      const [server] = await sql<Array<{
        endpoint: string | null
        transport: string
        enabled: boolean
        allowed_hosts: string[]
        tool_allowlist: string[]
        timeouts: { requestMs?: number }
      }>>`
        select endpoint, transport, enabled, allowed_hosts, tool_allowlist, timeouts
        from mcp_connections
        where workspace_id = ${workspaceId}
          and public_id = ${input.serverId}
        limit 1
      `
      if (!server?.enabled) {
        throw new NodeExecutionError({
          code: 'MCP_NOT_READY',
          message: `MCP Server ${input.serverId} 不可用。`,
          nodeType: 'tool',
        })
      }
      if (server.transport !== 'streamable-http' && server.transport !== 'sse') {
        throw new NodeExecutionError({
          code: 'MCP_TRANSPORT_NOT_CONFIGURED',
          message: `MCP ${server.transport} transport 需要独立进程适配器。`,
          nodeType: 'tool',
        })
      }
      if (!server.endpoint) {
        throw new NodeExecutionError({
          code: 'MCP_ENDPOINT_MISSING',
          message: 'MCP HTTP endpoint 未配置。',
          nodeType: 'tool',
        })
      }
      const url = new URL(server.endpoint)
      if (!server.allowed_hosts.includes(url.hostname)) {
        throw new NodeExecutionError({
          code: 'MCP_HOST_NOT_ALLOWED',
          message: `MCP host ${url.hostname} 不在 allowlist 中。`,
          nodeType: 'tool',
        })
      }
      if (server.tool_allowlist.length && !server.tool_allowlist.includes(input.toolName)) {
        throw new NodeExecutionError({
          code: 'MCP_TOOL_NOT_ALLOWED',
          message: `MCP 工具 ${input.toolName} 不在 allowlist 中。`,
          nodeType: 'tool',
        })
      }
      const timeoutMs = input.timeoutMs ?? server.timeouts.requestMs ?? 30_000
      const signal = input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'tools/call',
          params: { name: input.toolName, arguments: input.arguments },
        }),
        signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new NodeExecutionError({
          code: `MCP_HTTP_${response.status}`,
          message: `MCP 调用失败（${response.status}）。`,
          nodeType: 'tool',
          retryable: response.status === 429 || response.status >= 500,
        })
      }
      const payload = parseMcpPayload(text, response.headers.get('content-type') ?? '')
      if (payload.error && typeof payload.error === 'object') {
        const error = payload.error as Record<string, unknown>
        throw new NodeExecutionError({
          code: 'MCP_TOOL_ERROR',
          message: String(error.message ?? 'MCP 工具返回错误。'),
          nodeType: 'tool',
          details: { code: error.code },
        })
      }
      return payload.result && typeof payload.result === 'object'
        ? payload.result as Record<string, unknown>
        : { result: payload.result }
    },
    },

    knowledge: {
    /**
     * 使用 vector、keyword 或 hybrid 检索知识库。
     * @param input 知识库 ID、query、TopK、阈值与模式。
     * @returns 有序切片、引用、上下文与降级 warning。
     */
    async retrieve(input) {
      return knowledgeRetriever.retrieve({
        knowledgeBaseIds: input.knowledgeBaseIds,
        query: input.query,
        topK: input.topK,
        scoreThreshold: input.scoreThreshold,
        retrievalMode: input.retrievalMode ?? 'vector',
        signal: input.signal,
      })
    },
    },
    agent,
  }
}

/**
 * 解析 MCP JSON 或 SSE data 帧。
 * @param text HTTP 响应文本。
 * @param contentType 响应 Content-Type。
 * @returns JSON-RPC 响应对象。
 */
function parseMcpPayload(text: string, contentType: string) {
  const candidate = contentType.includes('text/event-stream')
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .at(-1)
    : text
  if (!candidate) {
    throw new NodeExecutionError({
      code: 'MCP_RESPONSE_EMPTY',
      message: 'MCP 返回空响应。',
      nodeType: 'tool',
    })
  }
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch {
    throw new NodeExecutionError({
      code: 'MCP_RESPONSE_INVALID',
      message: 'MCP 返回内容不是合法 JSON-RPC。',
      nodeType: 'tool',
    })
  }
}
