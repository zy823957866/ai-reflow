import { createHash } from 'node:crypto'
import type {
  AgentDefinition,
  AgentMcpToolConfig,
} from '@ai-reflow/core'

export interface AgentToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AgentRunnableTool extends AgentToolSchema {
  source: AgentMcpToolConfig
  execute(
    argumentsValue: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>
}

export interface AgentMcpPort {
  call(input: {
    serverId: string
    toolName: string
    arguments: Record<string, unknown>
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<unknown>
}

export interface AgentToolHistoryRecord {
  idempotencyKey: string
  toolCallId: string
  toolName: string
  result: unknown
  finishedAt: string
}

export interface AgentToolHistoryStartRecord {
  idempotencyKey: string
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  startedAt: string
}

export interface AgentToolHistoryPort {
  get(idempotencyKey: string): Promise<AgentToolHistoryRecord | undefined>
  start?(record: AgentToolHistoryStartRecord): Promise<void>
  save(record: AgentToolHistoryRecord): Promise<void>
}

export interface AgentToolCallIdentity {
  id?: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * 将 Agent 配置转换为可绑定到模型且可在服务端执行的工具。
 * @param definition Agent 定义。
 * @param mcp MCP 调用端口。
 * @returns 不包含凭据的工具描述。
 */
export function createAgentTools(
  definition: AgentDefinition,
  mcp?: AgentMcpPort,
): AgentRunnableTool[] {
  const names = new Set<string>()
  return definition.mcpTools.map((source) => {
    if (names.has(source.toolName)) {
      throw new Error(`AGENT_TOOL_DUPLICATE: 工具 ${source.toolName} 重复。`)
    }
    names.add(source.toolName)
    return {
      name: source.toolName,
      description: source.description ?? `调用 ${source.toolName}`,
      parameters: source.parameters ?? {
        type: 'object',
        properties: {},
      },
      source,
      async execute(argumentsValue, signal) {
        if (!mcp) {
          throw new Error('MCP_SERVICE_NOT_CONFIGURED: MCP 客户端未配置。')
        }
        return mcp.call({
          serverId: source.serverId,
          toolName: source.toolName,
          arguments: argumentsValue,
          timeoutMs: definition.timeoutMs,
          signal,
        })
      },
    }
  })
}

/**
 * 生成稳定工具幂等键，恢复时参数变化不会错误复用旧结果。
 * @param input invocation 与工具调用标识。
 * @returns 可写入数据库的幂等键。
 */
export function toolIdempotencyKey(input: {
  invocationId: string
  call: AgentToolCallIdentity
}) {
  const digest = createHash('sha256')
    .update(
      stableStringify({
        id: input.call.id ?? '',
        name: input.call.name,
        arguments: input.call.arguments,
      }),
    )
    .digest('hex')
    .slice(0, 24)
  return `${input.invocationId}:${input.call.id ?? digest}:${digest}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  )
  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`,
    )
    .join(',')}}`
}
