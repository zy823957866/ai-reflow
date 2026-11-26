import {
  AgentModelError,
  createAgentChatProvider,
  createAgentRuntime,
  type AgentRuntimeDependencies,
  type AgentToolHistoryPort,
  type AgentToolHistoryRecord,
} from '@ai-reflow/capabilities'
import type {
  AgentInvokeInput,
  NodeRuntimeServices,
} from '@ai-reflow/core'
import {
  AgentInvocationRepository,
  type DatabaseClient,
} from '@ai-reflow/platform'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

type Checkpointer = NonNullable<
  AgentRuntimeDependencies['checkpointer']
>

/**
 * 使用 worker 的 PostgreSQL 连接创建 LangGraph checkpoint。
 * @param connectionString 数据库连接串。
 * @returns 已完成 schema 初始化的 PostgresSaver。
 */
export async function createPostgresAgentCheckpointer(
  connectionString: string,
): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(connectionString)
  await checkpointer.setup()
  return checkpointer
}

/**
 * 将 invocation 工具历史端口接到 agent_tool_calls 表。
 * @param invocationId 外部 invocation ID。
 * @param repository Agent invocation 仓库。
 * @returns 运行时工具幂等端口。
 */
export function createPostgresToolHistoryPort(
  invocationId: string,
  repository: AgentInvocationRepository,
): AgentToolHistoryPort {
  return {
    async get(idempotencyKey) {
      const cached = await repository.completedToolCall(
        invocationId,
        idempotencyKey,
      )
      if (!cached || cached.error || !cached.finishedAt) {
        return undefined
      }
      return {
        idempotencyKey,
        toolCallId: cached.toolCallId,
        toolName: cached.toolName,
        result: cached.result,
        finishedAt: cached.finishedAt,
      } satisfies AgentToolHistoryRecord
    },
    async start(record) {
      await repository.startToolCall(invocationId, {
        id: record.toolCallId,
        name: record.toolName,
        arguments: record.arguments,
        status: 'started',
        idempotencyKey: record.idempotencyKey,
        startedAt: record.startedAt,
      })
    },
    async save(record) {
      await repository.finishToolCall(invocationId, {
        id: record.toolCallId,
        name: record.toolName,
        arguments: {},
        status: 'succeeded',
        idempotencyKey: record.idempotencyKey,
        result: record.result,
        finishedAt: record.finishedAt,
      })
    },
  }
}

export interface AgentRuntimeFactoryInput {
  sql: DatabaseClient
  workspaceId: string
  services: NodeRuntimeServices
  checkpointer?: Checkpointer
  env?: NodeJS.ProcessEnv
}

/**
 * 创建共享 Agent runtime 和队列仓库。
 * @param input 数据库、运行服务和 checkpoint。
 * @returns workflow node 与 chat consumer 共用运行时。
 */
export function createAgentRuntimeFactory(
  input: AgentRuntimeFactoryInput,
) {
  const invocations = new AgentInvocationRepository(
    input.sql,
    input.workspaceId,
  )
  const chat = createAgentChatProvider({
    env: input.env,
    async resolveConnection(connectionId) {
      const [connection] = await input.sql<Array<{
        provider: string
        default_model: string
        base_url: string | null
        enabled: boolean
      }>>`
        select provider, default_model, base_url, enabled
        from model_connections
        where workspace_id = ${input.workspaceId}
          and public_id = ${connectionId}
        limit 1
      `
      if (!connection?.enabled) {
        throw new AgentModelError(
          'MODEL_NOT_READY',
          `模型连接 ${connectionId} 不可用。`,
        )
      }
      return {
        provider: connection.provider,
        model: connection.default_model,
        baseUrl: connection.base_url ?? undefined,
      }
    },
  })
  const runtime = createAgentRuntime({
    chat,
    knowledge: input.services.knowledge,
    mcp: input.services.mcp,
    checkpointer: input.checkpointer,
    toolHistory: (invocation: AgentInvokeInput) =>
      createPostgresToolHistoryPort(
        invocation.invocationId,
        invocations,
      ),
  })
  return { runtime, invocations }
}
