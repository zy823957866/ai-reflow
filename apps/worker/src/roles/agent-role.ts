import type {
  AgentConversationMessage,
  AgentInvokeResult,
  AgentRuntimeEvent,
  AgentRuntimePort,
} from '@ai-reflow/core'
import type {
  AgentConversationRepository,
  AgentInvocationRepository,
  ClaimedAgentInvocation,
} from '@ai-reflow/platform'
import { runRolePool } from './role-pool'

type AgentInvocationPort = Pick<
  AgentInvocationRepository,
  'heartbeat' | 'appendEvent' | 'complete' | 'fail'
>
type AgentConversationPort = Pick<
  AgentConversationRepository,
  'updateAssistantDraft' | 'completeAssistantMessage'
>

export interface PreparedAgentInvocation {
  input: Record<string, unknown>
  history: AgentConversationMessage[]
  assistantMessageId?: string
}

/**
 * 将数据库中的 invocation request 转换为运行时输入与可信历史。
 * @param request sendMessage/retryMessage 写入的请求快照。
 * @returns 运行时 input、历史消息和助手占位 ID。
 */
export function agentInvocationInput(
  request: Record<string, unknown>,
): PreparedAgentInvocation {
  const content =
    typeof request.content === 'string' ? request.content : ''
  const attachments = Array.isArray(request.attachments)
    ? request.attachments.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : []
  const metadata = asRecord(request.metadata)
  const userMessageId = stringValue(request.userMessageId)
  const assistantMessageId = stringValue(request.assistantMessageId)
  return {
    input: {
      text: content,
      attachments,
      metadata,
      ...(userMessageId ? { userMessageId } : {}),
      ...(assistantMessageId ? { assistantMessageId } : {}),
    },
    history: normalizeHistory(request.history),
    assistantMessageId,
  }
}

/**
 * 执行一个已领取的 Agent 调用，并同步 SSE 事件与助手消息草稿。
 * @param input 调用、运行时和仓库端口。
 * @returns Agent 运行时结果。
 */
export async function executeAgentInvocation(input: {
  workspaceId: string
  invocation: ClaimedAgentInvocation
  runtime: AgentRuntimePort
  invocations: AgentInvocationPort
  conversations: AgentConversationPort
  workerId: string
  signal: AbortSignal
  heartbeatIntervalMs?: number
  draftFlushIntervalMs?: number
  leaseMs?: number
}): Promise<AgentInvokeResult> {
  const prepared = agentInvocationInput(input.invocation.request)
  const internal = new AbortController()
  const signal = AbortSignal.any([input.signal, internal.signal])
  let draftText = ''
  let persistedDraft = ''
  let lastDraftFlushAt = 0
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? 1000
  const draftFlushIntervalMs = input.draftFlushIntervalMs ?? 120
  const leaseMs = input.leaseMs ?? 60_000
  const heartbeat = setInterval(() => {
    void input.invocations
      .heartbeat(input.invocation.id, input.workerId, leaseMs)
      .then((cancelled) => {
        if (!cancelled) return
        internal.abort(new Error('Agent 调用已取消'))
        void input.runtime.cancel?.(input.invocation.publicId)
      })
      .catch((error) => {
        console.error('Agent invocation heartbeat failed', error)
      })
  }, heartbeatIntervalMs)

  const flushDraft = async (force: boolean) => {
    if (!prepared.assistantMessageId) return
    const now = Date.now()
    if (
      !force &&
      now - lastDraftFlushAt < draftFlushIntervalMs
    ) {
      return
    }
    if (draftText === persistedDraft) return
    lastDraftFlushAt = now
    persistedDraft = draftText
    await input.conversations.updateAssistantDraft(
      prepared.assistantMessageId,
      draftText,
    )
  }

  try {
    const result = await input.runtime.invoke({
      invocationId: input.invocation.publicId,
      workspaceId: input.workspaceId,
      conversationId: input.invocation.conversationId ?? undefined,
      kind: input.invocation.kind,
      threadId: input.invocation.threadId,
      definition: input.invocation.definition,
      input: prepared.input,
      history: prepared.history,
      resumeCheckpointId:
        input.invocation.resumeCheckpointId ?? undefined,
      signal,
      async emit(event: AgentRuntimeEvent) {
        if (event.type === 'message.delta') {
          const text = event.payload.text
          if (typeof text === 'string') draftText += text
          await flushDraft(false)
        }
        if (
          event.type === 'message.completed' &&
          typeof event.payload.text === 'string'
        ) {
          draftText = event.payload.text
        }
        if (!isClaimLifecycleEvent(event.type)) {
          await input.invocations.appendEvent(
            input.invocation.publicId,
            event.type,
            event.payload,
          )
        }
      },
    })
    await flushDraft(true)
    if (prepared.assistantMessageId) {
      await input.conversations.completeAssistantMessage(
        prepared.assistantMessageId,
        {
          text: result.text,
          status:
            result.finishReason === 'cancelled'
              ? 'cancelled'
              : 'completed',
          citations: result.citations,
          usage: result.usage,
        },
      )
    }
    await input.invocations.complete(
      input.invocation.publicId,
      result,
    )
    return result
  } catch (error) {
    await flushDraft(true)
    const normalized = normalizeInvocationError(error)
    if (prepared.assistantMessageId) {
      await input.conversations.completeAssistantMessage(
        prepared.assistantMessageId,
        {
          text: draftText,
          status: 'failed',
          error: normalized,
        },
      )
    }
    await input.invocations.fail(
      input.invocation.publicId,
      normalized,
    )
    throw error
  } finally {
    clearInterval(heartbeat)
  }
}

/**
 * 启动 Agent invocation 消费角色。
 * @param input 队列、运行时和执行配置。
 */
export async function runAgentRole(input: {
  invocations: AgentInvocationRepository
  conversations: AgentConversationRepository
  runtime: AgentRuntimePort
  workspaceId: string
  workerId: string
  concurrency: number
  pollIntervalMs: number
  signal: AbortSignal
}) {
  console.log(
    `Agent role 已启动：concurrency=${input.concurrency}`,
  )
  await runRolePool({
    concurrency: input.concurrency,
    pollIntervalMs: input.pollIntervalMs,
    signal: input.signal,
    async claim() {
      return input.invocations.claimNext(input.workerId)
    },
    async execute(invocation) {
      await executeAgentInvocation({
        workspaceId: input.workspaceId,
        invocation,
        runtime: input.runtime,
        invocations: input.invocations,
        conversations: input.conversations,
        workerId: input.workerId,
        signal: input.signal,
      })
    },
    onError(error, phase) {
      console.error(`Agent role ${phase} failed`, error)
    },
  })
  console.log('Agent role 已停止')
}

function normalizeHistory(value: unknown): AgentConversationMessage[] {
  if (!Array.isArray(value)) return []
  const result: AgentConversationMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (
      row.role !== 'user' &&
      row.role !== 'assistant' &&
      row.role !== 'system'
    ) {
      continue
    }
    if (typeof row.content !== 'string') continue
    const message: AgentConversationMessage = {
      role: row.role,
      content: row.content,
    }
    if (Array.isArray(row.citations)) {
      message.citations =
        row.citations as AgentConversationMessage['citations']
    }
    if (typeof row.createdAt === 'string') {
      message.createdAt = row.createdAt
    }
    result.push(message)
  }
  return result
}

function isClaimLifecycleEvent(type: AgentRuntimeEvent['type']) {
  return (
    type === 'invocation.interrupted' ||
    type === 'invocation.resumed' ||
    type === 'invocation.completed' ||
    type === 'invocation.failed' ||
    type === 'invocation.cancelled'
  )
}

function normalizeInvocationError(error: unknown) {
  if (error instanceof Error) {
    const record = error as Error & {
      code?: unknown
      retryable?: unknown
    }
    return {
      code:
        typeof record.code === 'string'
          ? record.code
          : 'AGENT_INVOCATION_FAILED',
      message: error.message,
      retryable:
        typeof record.retryable === 'boolean'
          ? record.retryable
          : true,
    }
  }
  return {
    code: 'AGENT_INVOCATION_FAILED',
    message: String(error),
    retryable: true,
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
