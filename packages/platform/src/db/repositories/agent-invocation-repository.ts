import {
  AppError,
  compactJsonValue,
  redact,
  type AgentDefinition,
  type AgentInvokeResult,
  type AgentToolCall,
} from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { iso } from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'

export interface AgentInvocationRow {
  id: string
  public_id: string
  workspace_id: string
  agent_id: string | null
  conversation_id: string | null
  run_id: string | null
  node_id: string | null
  kind: 'chat' | 'workflow_node' | 'external'
  status: string
  definition_snapshot: AgentDefinition
  request: Record<string, unknown>
  result: AgentInvokeResult | null
  error: Record<string, unknown> | null
  thread_id: string
  resume_checkpoint_id: string | null
  idempotency_key: string | null
  cancel_requested_at: Date | null
  worker_id: string | null
  lease_expires_at: Date | null
  attempts: number
  started_at: Date | null
  finished_at: Date | null
  duration_ms: number | null
  created_at: Date
  updated_at: Date
}

export interface AgentInvocationEventRow {
  invocation_public_id: string
  seq: number
  type: string
  payload: Record<string, unknown>
  created_at: Date
}

export interface ClaimedAgentInvocation {
  id: string
  publicId: string
  agentId: string | null
  conversationId: string | null
  kind: AgentInvocationRow['kind']
  definition: AgentDefinition
  request: Record<string, unknown>
  threadId: string
  resumeCheckpointId: string | null
  attempts: number
}

export interface AgentInvocationClaim {
  workerId: string
  attempt: number
}

/**
 * 判断调用状态是否仍占用会话。
 * @param status invocation 状态。
 * @returns 是否属于活动状态。
 */
export function isActiveInvocationStatus(status: string) {
  return ['queued', 'running', 'waiting'].includes(status)
}

/**
 * 根据运行时结束原因决定 invocation 终态和 SSE 事件。
 * @param result Agent 运行时结果。
 * @returns 数据库状态、事件类型和可选错误。
 */
export function invocationCompletion(result: AgentInvokeResult) {
  if (result.finishReason === 'cancelled') {
    return {
      status: 'cancelled' as const,
      eventType: 'invocation.cancelled',
      error: {
        code: 'INVOCATION_CANCELLED',
        message: 'Agent 调用已取消。',
      },
    }
  }
  return {
    status: 'succeeded' as const,
    eventType: 'invocation.completed',
    error: null,
  }
}

/**
 * 把 invocation 行投影为 API DTO。
 * @param row invocation 行。
 * @returns 调用 DTO。
 */
export function toAgentInvocationDto(row: AgentInvocationRow) {
  return {
    id: row.public_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    nodeId: row.node_id,
    kind: row.kind,
    status: row.status,
    definitionSnapshot: row.definition_snapshot,
    request: row.request,
    result: row.result,
    error: row.error,
    threadId: row.thread_id,
    resumeCheckpointId: row.resume_checkpoint_id,
    attempts: row.attempts,
    cancelRequestedAt: iso(row.cancel_requested_at),
    workerId: row.worker_id,
    leaseExpiresAt: iso(row.lease_expires_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms ?? undefined,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

/**
 * 将事件行投影为 SSE DTO。
 * @param row 事件行。
 * @returns 带 invocation 外部 ID 的事件。
 */
export function toAgentInvocationEvent(row: AgentInvocationEventRow) {
  return {
    seq: row.seq,
    type: row.type,
    invocationId: row.invocation_public_id,
    at: iso(row.created_at)!,
    payload: row.payload,
  }
}

/**
 * 在已有事务中分配单调序号并写入 invocation 事件。
 * 调用方必须先锁定 invocation 行，或由本函数完成锁定。
 */
export async function appendInvocationEventRecord(
  transaction: Transaction,
  workspaceId: string,
  invocationInternalId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<AgentInvocationEventRow> {
  const [latest] = await transaction<Array<{ seq: number }>>`
    select coalesce(max(seq), 0)::int as seq
    from agent_invocation_events
    where invocation_id = ${invocationInternalId}
  `
  const safePayload = redact(compactJsonValue(payload))
  const [row] = await transaction<AgentInvocationEventRow[]>`
    insert into agent_invocation_events (
      workspace_id, invocation_id, seq, type, payload
    )
    values (
      ${workspaceId}, ${invocationInternalId}, ${latest.seq + 1},
      ${type}, ${jsonb(transaction, safePayload)}
    )
    returning
      ${''}::text as invocation_public_id,
      seq, type, payload, created_at
  `
  return row
}

/**
 * Agent invocation 队列、租约、事件、取消和工具幂等的数据访问层。
 */
export class AgentInvocationRepository {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询调用列表。
   * @param query 会话、Agent、状态和数量筛选。
   * @returns 调用 DTO 列表。
   */
  async list(query: {
    conversationId?: string
    agentId?: string
    status?: string
    limit?: number
  } = {}) {
    const rows = await this.sql<AgentInvocationRow[]>`
      select i.*
      from agent_invocations i
      left join agent_conversations c on c.id = i.conversation_id
      left join agents a on a.id = i.agent_id
      where i.workspace_id = ${this.workspaceId}
        ${query.conversationId
          ? this.sql`and c.public_id = ${query.conversationId}`
          : this.sql``}
        ${query.agentId ? this.sql`and a.public_id = ${query.agentId}` : this.sql``}
        ${query.status ? this.sql`and i.status = ${query.status}` : this.sql``}
      order by i.created_at desc
      limit ${Math.min(500, Math.max(1, query.limit ?? 200))}
    `
    return rows.map(toAgentInvocationDto)
  }

  /**
   * 读取调用详情。
   * @param invocationId 外部 invocation ID。
   * @returns 调用 DTO。
   */
  async get(invocationId: string) {
    return toAgentInvocationDto(await this.require(invocationId))
  }

  /**
   * 读取调用原始行，供 worker 内部使用。
   * @param invocationId 外部 invocation ID。
   * @returns invocation 行。
   */
  async require(invocationId: string) {
    const [row] = await this.sql<AgentInvocationRow[]>`
      select *
      from agent_invocations
      where workspace_id = ${this.workspaceId}
        and public_id = ${invocationId}
      limit 1
    `
    if (!row) throw notFound('Agent 调用')
    return row
  }

  /**
   * 使用 SKIP LOCKED 领取排队或中断的调用。
   * @param workerId worker 实例 ID。
   * @param leaseMs 租约毫秒数。
   * @returns 已领取调用或 null。
   */
  async claimNext(
    workerId: string,
    leaseMs = 60_000,
  ): Promise<ClaimedAgentInvocation | null> {
    return this.sql.begin(async (transaction) => {
      const expired = await transaction<Array<{
        id: string
        cancel_requested_at: Date | null
      }>>`
        select id, cancel_requested_at
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and status = 'running'
          and lease_expires_at is not null
          and lease_expires_at < now()
        for update skip locked
      `
      for (const row of expired) {
        // 已请求取消的调用不能因为 worker 死亡而在租约过期后重新执行。
        const cancelled = Boolean(row.cancel_requested_at)
        await transaction`
          update agent_invocations
          set
            status = ${cancelled ? 'cancelled' : 'interrupted'},
            worker_id = null,
            lease_expires_at = null,
            finished_at = case
              when ${cancelled} then now()
              else finished_at
            end,
            updated_at = now()
          where id = ${row.id}
        `
        if (cancelled) {
          await markAssistantMessagesCancelled(
            transaction,
            this.workspaceId,
            row.id,
          )
          await appendInvocationEventRecord(
            transaction,
            this.workspaceId,
            row.id,
            'invocation.cancelled',
            {
              code: 'INVOCATION_CANCELLED',
              message: 'Agent 调用已取消。',
            },
          )
        }
      }
      const [candidate] = await transaction<Array<{
        id: string
        status: string
      }>>`
        select id, status
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and status in ('queued', 'interrupted')
        order by created_at
        for update skip locked
        limit 1
      `
      if (!candidate) return null
      const [row] = await transaction<AgentInvocationRow[]>`
        update agent_invocations
        set
          status = 'running',
          worker_id = ${workerId},
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          attempts = attempts + 1,
          started_at = coalesce(started_at, now()),
          updated_at = now()
        where id = ${candidate.id}
        returning *
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        row.id,
        candidate.status === 'interrupted'
          ? 'invocation.resumed'
          : 'invocation.started',
        {
          status: 'running',
          workerId,
          attempts: row.attempts,
        },
      )
      return {
        id: row.id,
        publicId: row.public_id,
        agentId: row.agent_id,
        conversationId: row.conversation_id,
        kind: row.kind,
        definition: row.definition_snapshot,
        request: row.request,
        threadId: row.thread_id,
        resumeCheckpointId: row.resume_checkpoint_id,
        attempts: row.attempts,
      }
    })
  }

  /**
   * 续约并检查取消请求。
   * @param invocationInternalId invocation 内部 ID。
   * @param workerId worker ID。
   * @param leaseMs 租约毫秒数。
   * @returns 是否应取消。
   */
  async heartbeat(
    invocationInternalId: string,
    workerId: string,
    attempt?: number,
    leaseMs = 60_000,
  ) {
    const [row] = await this.sql<Array<{ cancel_requested_at: Date | null }>>`
      update agent_invocations
      set
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
        updated_at = now()
      where id = ${invocationInternalId}
        and workspace_id = ${this.workspaceId}
        and worker_id = ${workerId}
        ${attempt === undefined
          ? this.sql``
          : this.sql`and attempts = ${attempt}`}
        and status = 'running'
      returning cancel_requested_at
    `
    // 行不存在说明租约已丢失或已被其它 worker 接管，必须立即停止旧执行。
    return !row || Boolean(row.cancel_requested_at)
  }

  /**
   * 追加调用事件。
   * @param invocationId 外部 invocation ID。
   * @param type 事件类型。
   * @param payload 脱敏前 payload。
   * @returns 已落库事件。
   */
  async appendEvent(
    invocationId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    return this.sql.begin(async (transaction) => {
      const [invocation] = await transaction<Array<{ id: string }>>`
        select id
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and public_id = ${invocationId}
        for update
      `
      if (!invocation) throw notFound('Agent 调用')
      const event = await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        invocation.id,
        type,
        payload,
      )
      return toAgentInvocationEvent({
        ...event,
        invocation_public_id: invocationId,
      })
    })
  }

  /**
   * 分页读取调用事件。
   * @param invocationId 外部 invocation ID。
   * @param afterSeq 只返回大于该序号的事件。
   * @param limit 最大条数。
   * @returns 有序事件列表。
   */
  async eventsPage(invocationId: string, afterSeq = 0, limit = 200) {
    const rows = await this.sql<AgentInvocationEventRow[]>`
      select
        e.seq, e.type, e.payload, e.created_at,
        ${invocationId}::text as invocation_public_id
      from agent_invocation_events e
      join agent_invocations i on i.id = e.invocation_id
      where e.workspace_id = ${this.workspaceId}
        and i.public_id = ${invocationId}
        and e.seq > ${afterSeq}
      order by e.seq
      limit ${Math.min(1000, Math.max(1, limit))}
    `
    return rows.map(toAgentInvocationEvent)
  }

  /**
   * 为 Agent 调试创建一次性 external invocation。
   * @param agentId 外部 Agent ID。
   * @param input 测试输入和元数据。
   * @returns 已排队调用 DTO。
   */
  async createTestInvocation(
    agentId: string,
    input: {
      content: string
      metadata?: Record<string, unknown>
    },
  ) {
    return this.sql.begin(async (transaction) => {
      const [agent] = await transaction<Array<{
        id: string
        config: AgentDefinition
        status: string
      }>>`
        select id, config, status
        from agents
        where workspace_id = ${this.workspaceId}
          and public_id = ${agentId}
        limit 1
      `
      if (!agent) throw notFound('Agent')
      if (agent.status !== 'active') {
        throw new AppError({
          code: 'AGENT_NOT_ACTIVE',
          message: 'Agent 已归档，不能执行测试。',
          status: 409,
        })
      }
      const invocationPublicId = publicId('agi')
      const [invocation] = await transaction<Array<{ id: string }>>`
        insert into agent_invocations (
          public_id, workspace_id, agent_id, kind, status,
          definition_snapshot, request, thread_id
        )
        values (
          ${invocationPublicId}, ${this.workspaceId}, ${agent.id},
          'external', 'queued', ${jsonb(transaction, agent.config)},
          ${jsonb(transaction, {
            content: input.content,
            attachments: [],
            metadata: input.metadata ?? {},
          })},
          ${`test:${invocationPublicId}`}
        )
        returning id
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        invocation.id,
        'invocation.queued',
        { status: 'queued', test: true },
      )
      return invocationPublicId
    }).then((invocationId) => this.get(invocationId))
  }

  /**
   * 请求取消；排队调用立即取消，运行中调用由 worker 心跳中止。
   * @param invocationId 外部 invocation ID。
   * @returns 最新状态。
   */
  async cancel(invocationId: string) {
    return this.sql.begin(async (transaction) => {
      const [row] = await transaction<AgentInvocationRow[]>`
        select *
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and public_id = ${invocationId}
        for update
      `
      if (!row) throw notFound('Agent 调用')
      if (['succeeded', 'failed', 'cancelled'].includes(row.status)) {
        return { invocationId, status: row.status }
      }
      const cancellableNow = ['queued', 'interrupted', 'waiting'].includes(row.status)
      await transaction`
        update agent_invocations
        set
          status = ${cancellableNow ? 'cancelled' : row.status},
          cancel_requested_at = now(),
          finished_at = case when ${cancellableNow} then now() else finished_at end,
          updated_at = now()
        where id = ${row.id}
      `
      if (cancellableNow) {
        await markAssistantMessagesCancelled(
          transaction,
          this.workspaceId,
          row.id,
        )
        await appendInvocationEventRecord(
          transaction,
          this.workspaceId,
          row.id,
          'invocation.cancelled',
          {
            code: 'INVOCATION_CANCELLED',
            message: 'Agent 调用已取消。',
          },
        )
      }
      return {
        invocationId,
        status: cancellableNow ? 'cancelled' : row.status,
      }
    })
  }

  /**
   * 标记调用成功并保存最终结果。
   * @param invocationId 外部 invocation ID。
   * @param result 运行时结果。
   * @returns 更新后的调用 DTO。
   */
  async complete(
    invocationId: string,
    result: AgentInvokeResult,
    claim: AgentInvocationClaim,
  ) {
    const terminal = invocationCompletion(result)
    await this.sql.begin(async (transaction) => {
      const [row] = await transaction<AgentInvocationRow[]>`
        select *
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and public_id = ${invocationId}
        for update
      `
      if (!row) throw notFound('Agent 调用')
      assertInvocationClaim(row, claim)
      await transaction`
        update agent_invocations
        set
          status = ${terminal.status},
          result = ${jsonb(transaction, result)},
          error = ${terminal.error
            ? jsonb(transaction, terminal.error)
            : null},
          resume_checkpoint_id = ${result.resumeCheckpointId ?? row.resume_checkpoint_id},
          finished_at = now(),
          duration_ms = greatest(
            0,
            floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)
          )::int,
          updated_at = now()
        where id = ${row.id}
          and worker_id = ${claim.workerId}
          and attempts = ${claim.attempt}
          and status = 'running'
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        row.id,
        terminal.eventType,
        {
          status: terminal.status,
          finishReason: result.finishReason,
          usage: result.usage,
          ...(terminal.error ? { error: terminal.error } : {}),
        },
      )
    })
    return this.get(invocationId)
  }

  /**
   * 标记调用失败。
   * @param invocationId 外部 invocation ID。
   * @param error 稳定错误码、消息和可重试标记。
   * @returns 更新后的调用 DTO。
   */
  async fail(
    invocationId: string,
    error: { code: string; message: string; retryable?: boolean },
    claim: AgentInvocationClaim,
  ) {
    await this.sql.begin(async (transaction) => {
      const [row] = await transaction<AgentInvocationRow[]>`
        select *
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and public_id = ${invocationId}
        for update
      `
      if (!row) throw notFound('Agent 调用')
      assertInvocationClaim(row, claim)
      const errorPayload = redact(compactJsonValue(error))
      await transaction`
        update agent_invocations
        set
          status = 'failed',
          error = ${jsonb(transaction, errorPayload)},
          finished_at = now(),
          duration_ms = greatest(
            0,
            floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)
          )::int,
          updated_at = now()
        where id = ${row.id}
          and worker_id = ${claim.workerId}
          and attempts = ${claim.attempt}
          and status = 'running'
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        row.id,
        'invocation.failed',
        { status: 'failed', error: errorPayload },
      )
    })
    return this.get(invocationId)
  }

  /**
   * 把中断或失败调用重新放回队列，保持同一 definition snapshot。
   * @param invocationId 外部 invocation ID。
   * @returns 更新后的调用 DTO。
   */
  async resume(invocationId: string) {
    await this.sql.begin(async (transaction) => {
      const [row] = await transaction<AgentInvocationRow[]>`
        select *
        from agent_invocations
        where workspace_id = ${this.workspaceId}
          and public_id = ${invocationId}
        for update
      `
      if (!row) throw notFound('Agent 调用')
      if (!['interrupted', 'failed'].includes(row.status)) {
        throw new AppError({
          code: 'INVOCATION_NOT_RESUMABLE',
          message: '只有中断或失败的调用可以恢复。',
          status: 409,
        })
      }
      await transaction`
        update agent_invocations
        set
          status = 'queued',
          error = null,
          worker_id = null,
          lease_expires_at = null,
          cancel_requested_at = null,
          updated_at = now()
        where id = ${row.id}
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        row.id,
        'invocation.resumed',
        { status: 'queued' },
      )
    })
    return this.get(invocationId)
  }

  /**
   * 查询已完成工具调用，恢复时避免重复副作用。
   * @param invocationId 外部 invocation ID。
   * @param idempotencyKey 工具幂等键。
   * @returns 已完成结果或 null。
   */
  async completedToolCall(invocationId: string, idempotencyKey: string) {
    const [row] = await this.sql<Array<{
      call_id: string
      tool_name: string
      result_summary: unknown
      error: Record<string, unknown> | null
      finished_at: Date | null
    }>>`
      select
        t.call_id, t.tool_name, t.result_summary, t.error, t.finished_at
      from agent_tool_calls t
      join agent_invocations i on i.id = t.invocation_id
      where t.workspace_id = ${this.workspaceId}
        and i.public_id = ${invocationId}
        and t.idempotency_key = ${idempotencyKey}
        and t.status in ('succeeded', 'failed')
      limit 1
    `
    if (!row) return null
    return {
      toolCallId: row.call_id,
      toolName: row.tool_name,
      result: row.result_summary,
      error: row.error ?? undefined,
      finishedAt: row.finished_at?.toISOString(),
    }
  }

  /**
   * 查询工具是否已经写入 started 但尚无终态结果。
   * @param invocationId 外部 invocation ID。
   * @param idempotencyKey 工具幂等键。
   * @returns 是否存在未知副作用的工具执行。
   */
  async startedToolCall(invocationId: string, idempotencyKey: string) {
    const [row] = await this.sql<Array<{ id: string }>>`
      select t.id
      from agent_tool_calls t
      join agent_invocations i on i.id = t.invocation_id
      where t.workspace_id = ${this.workspaceId}
        and i.public_id = ${invocationId}
        and t.idempotency_key = ${idempotencyKey}
        and t.status = 'started'
      limit 1
    `
    return Boolean(row)
  }

  /**
   * 记录工具调用开始。
   * @param invocationId 外部 invocation ID。
   * @param call 运行时工具调用。
   */
  async startToolCall(
    invocationId: string,
    call: AgentToolCall & { idempotencyKey: string },
  ) {
    const invocation = await this.require(invocationId)
    await this.sql`
      insert into agent_tool_calls (
        workspace_id, invocation_id, call_id, tool_name, idempotency_key,
        status, arguments_summary, started_at
      )
      values (
        ${this.workspaceId}, ${invocation.id}, ${call.id}, ${call.name},
        ${call.idempotencyKey}, 'started',
        ${jsonb(this.sql, redact(compactJsonValue(call.arguments)))}, now()
      )
      on conflict (invocation_id, idempotency_key) do nothing
    `
  }

  /**
   * 记录工具调用结果。
   * @param invocationId 外部 invocation ID。
   * @param call 已完成的运行时工具调用。
   */
  async finishToolCall(invocationId: string, call: AgentToolCall) {
    if (!call.idempotencyKey) return
    const invocation = await this.require(invocationId)
    await this.sql`
      update agent_tool_calls
      set
        status = ${call.status === 'failed' ? 'failed' : 'succeeded'},
        result_summary = ${call.result === undefined
          ? null
          : jsonb(this.sql, redact(compactJsonValue(call.result)))},
        error = ${call.error ? jsonb(this.sql, redact(compactJsonValue(call.error))) : null},
        finished_at = now()
      where workspace_id = ${this.workspaceId}
        and invocation_id = ${invocation.id}
        and idempotency_key = ${call.idempotencyKey}
    `
  }
}

function assertInvocationClaim(
  row: AgentInvocationRow,
  claim: AgentInvocationClaim,
) {
  const leaseExpiresAt = timestampMs(row.lease_expires_at)
  const leaseExpired =
    leaseExpiresAt !== undefined && leaseExpiresAt <= Date.now()
  if (
    row.status !== 'running' ||
    row.worker_id !== claim.workerId ||
    row.attempts !== claim.attempt ||
    leaseExpired
  ) {
    throw new AppError({
      code: 'INVOCATION_CLAIM_LOST',
      message: 'Agent 调用的执行租约已失效，旧 worker 不能写入终态。',
      status: 409,
    })
  }
}

function timestampMs(value: unknown) {
  if (!value) return undefined
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : new Date(String(value)).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

async function markAssistantMessagesCancelled(
  transaction: Transaction,
  workspaceId: string,
  invocationInternalId: string,
) {
  await transaction`
    update agent_messages
    set
      status = 'cancelled',
      error = ${jsonb(transaction, {
        code: 'INVOCATION_CANCELLED',
        message: 'Agent 调用已取消。',
      })},
      updated_at = now()
    where workspace_id = ${workspaceId}
      and invocation_id = ${invocationInternalId}
      and role = 'assistant'
      and status in ('pending', 'streaming')
  `
}
