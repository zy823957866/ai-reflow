import {
  AppError,
  type AgentCitation,
  type AgentConversationMessage,
  type AgentDefinition,
} from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { iso } from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'
import { appendInvocationEventRecord } from './agent-invocation-repository'

export interface AgentRow {
  id: string
  public_id: string
  workspace_id: string
  name: string
  description: string
  config: AgentDefinition
  revision: number
  status: string
  created_at: Date
  updated_at: Date
}

export interface ConversationRow {
  id: string
  public_id: string
  workspace_id: string
  agent_id: string
  agent_revision: number
  agent_snapshot: AgentDefinition
  thread_id: string
  title: string
  status: string
  metadata: Record<string, unknown>
  last_message_at: Date | null
  created_at: Date
  updated_at: Date
  agent_name?: string
  message_count?: number
  last_message_preview?: string | null
}

export interface AgentMessageRow {
  id: string
  public_id: string
  workspace_id: string
  conversation_id: string
  invocation_id: string | null
  seq: number
  role: 'user' | 'assistant' | 'system'
  content: Record<string, unknown>
  status: string
  citations: AgentCitation[]
  usage: Record<string, unknown>
  error: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

export interface AgentCreateInput {
  name: string
  description?: string
  config: AgentDefinition
}

export interface AgentUpdateInput {
  name?: string
  description?: string
  config?: AgentDefinition
  status?: 'draft' | 'active' | 'archived'
}

/**
 * 把 Agent 数据库行投影为 API DTO。
 * @param row Agent 行。
 * @returns 不含内部主键的 Agent DTO。
 */
export function toAgentDto(row: AgentRow) {
  return {
    id: row.public_id,
    name: row.name,
    description: row.description,
    config: row.config,
    revision: row.revision,
    status: row.status,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

/**
 * 把会话行投影为 API DTO。
 * @param row 会话行及可选聚合列。
 * @returns 会话 DTO。
 */
export function toAgentConversationDto(row: ConversationRow) {
  return {
    id: row.public_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    revision: row.agent_revision,
    title: row.title,
    status: row.status,
    messageCount: row.message_count ?? 0,
    preview: row.last_message_preview ?? '',
    lastMessageAt: iso(row.last_message_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

/**
 * 把消息行投影为 API DTO。
 * @param row 消息行。
 * @returns 消息 DTO。
 */
export function toAgentMessageDto(row: AgentMessageRow) {
  return {
    id: row.public_id,
    conversationId: row.conversation_id,
    invocationId: row.invocation_id,
    seq: row.seq,
    role: row.role,
    content:
      typeof row.content.text === 'string' ? row.content.text : '',
    status: row.status,
    citations: row.citations,
    usage: row.usage,
    error: row.error,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

/**
 * Agent Profile 的数据访问层。
 */
export class AgentRepository {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询当前 workspace 的 Agent。
   * @param includeArchived 是否包含已归档记录。
   * @returns Agent DTO 列表。
   */
  async list(includeArchived = false) {
    const rows = await this.sql<AgentRow[]>`
      select *
      from agents
      where workspace_id = ${this.workspaceId}
        ${includeArchived ? this.sql`` : this.sql`and status <> 'archived'`}
      order by updated_at desc
    `
    return rows.map(toAgentDto)
  }

  /**
   * 读取一个 Agent。
   * @param agentId 外部 Agent ID。
   * @returns Agent DTO。
   */
  async get(agentId: string) {
    return toAgentDto(await this.require(agentId))
  }

  /**
   * 创建 Agent，初始 revision 为 1。
   * @param input 名称、描述和配置。
   * @returns 新 Agent DTO。
   */
  async create(input: AgentCreateInput) {
    const [created] = await this.sql<Array<{ public_id: string }>>`
      insert into agents (
        public_id, workspace_id, name, description, config, revision, status
      )
      values (
        ${publicId('agent')}, ${this.workspaceId}, ${input.name},
        ${input.description ?? ''}, ${jsonb(this.sql, input.config)}, 1, 'active'
      )
      returning public_id
    `
    return this.get(created.public_id)
  }

  /**
   * 更新 Agent；配置变化时 revision 原子递增。
   * @param agentId 外部 Agent ID。
   * @param input 部分更新字段。
   * @returns 更新后的 Agent DTO。
   */
  async update(agentId: string, input: AgentUpdateInput) {
    await this.sql.begin(async (transaction) => {
      const existing = await this.require(agentId, transaction, true)
      await transaction`
        update agents
        set
          name = ${input.name ?? existing.name},
          description = ${input.description ?? existing.description},
          config = ${jsonb(transaction, input.config ?? existing.config)},
          revision = revision + ${input.config ? 1 : 0},
          status = ${input.status ?? existing.status},
          updated_at = now()
        where workspace_id = ${this.workspaceId} and id = ${existing.id}
      `
    })
    return this.get(agentId)
  }

  /**
   * 归档 Agent，不删除历史会话。
   * @param agentId 外部 Agent ID。
   * @returns 归档结果。
   */
  async archive(agentId: string) {
    await this.update(agentId, { status: 'archived' })
    return { archived: true as const }
  }

  /**
   * 读取创建会话时需要固定的 Agent 快照。
   * @param agentId 外部 Agent ID。
   * @returns 内部 ID、版本和配置。
   */
  async snapshot(agentId: string) {
    const agent = await this.require(agentId)
    if (agent.status !== 'active') {
      throw new AppError({
        code: 'AGENT_NOT_ACTIVE',
        message: 'Agent 已归档，不能创建新会话。',
        status: 409,
      })
    }
    return agent
  }

  private async require(
    agentId: string,
    sql: DatabaseClient | Transaction = this.sql,
    lock = false,
  ) {
    const [row] = await sql<AgentRow[]>`
      select *
      from agents
      where workspace_id = ${this.workspaceId}
        and public_id = ${agentId}
      ${lock ? sql`for update` : sql``}
      limit 1
    `
    if (!row) throw notFound('Agent')
    return row
  }
}

/**
 * 会话、消息和发送事务的数据访问层。
 */
export class AgentConversationRepository {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询某个 Agent 的会话列表。
   * @param agentId 外部 Agent ID。
   * @returns 会话 DTO 列表。
   */
  async list(agentId: string) {
    const rows = await this.sql<ConversationRow[]>`
      select
        c.*, a.name as agent_name,
        (
          select count(*)::int
          from agent_messages m
          where m.conversation_id = c.id
        ) as message_count,
        (
          select m.content->>'text'
          from agent_messages m
          where m.conversation_id = c.id
          order by m.seq desc
          limit 1
        ) as last_message_preview
      from agent_conversations c
      join agents a on a.id = c.agent_id
      where c.workspace_id = ${this.workspaceId}
        and a.public_id = ${agentId}
      order by c.updated_at desc
    `
    return rows.map(toAgentConversationDto)
  }

  /**
   * 新建会话并固定 Agent revision 与快照。
   * @param agentId 外部 Agent ID。
   * @param input 可选标题。
   * @returns 会话 DTO。
   */
  async create(agentId: string, input: { title?: string }) {
    const agent = await new AgentRepository(this.sql, this.workspaceId).snapshot(agentId)
    const conversationPublicId = publicId('conv')
    await this.sql`
      insert into agent_conversations (
        public_id, workspace_id, agent_id, agent_revision, agent_snapshot,
        thread_id, title, status
      )
      values (
        ${conversationPublicId}, ${this.workspaceId}, ${agent.id},
        ${agent.revision}, ${jsonb(this.sql, agent.config)},
        ${`conversation:${conversationPublicId}`}, ${input.title ?? '新会话'}, 'active'
      )
    `
    return this.get(conversationPublicId)
  }

  /**
   * 查询会话详情。
   * @param conversationId 外部会话 ID。
   * @returns 会话 DTO。
   */
  async get(conversationId: string) {
    const row = await this.require(conversationId)
    return toAgentConversationDto(row)
  }

  /**
   * 重命名或归档会话。
   * @param conversationId 外部会话 ID。
   * @param input 修改字段。
   * @returns 更新后的会话。
   */
  async update(
    conversationId: string,
    input: { title?: string; status?: 'active' | 'archived' },
  ) {
    const row = await this.require(conversationId)
    await this.sql`
      update agent_conversations
      set
        title = ${input.title ?? row.title},
        status = ${input.status ?? row.status},
        updated_at = now()
      where workspace_id = ${this.workspaceId} and id = ${row.id}
    `
    return this.get(conversationId)
  }

  /**
   * 分页读取会话消息。
   * @param conversationId 外部会话 ID。
   * @param afterSeq 只读取该序号之后的消息。
   * @param limit 最大条数。
   * @returns 消息 DTO 列表。
   */
  async messages(conversationId: string, afterSeq = 0, limit = 200) {
    const conversation = await this.require(conversationId)
    const rows = await this.sql<AgentMessageRow[]>`
      select *
      from agent_messages
      where workspace_id = ${this.workspaceId}
        and conversation_id = ${conversation.id}
        and seq > ${afterSeq}
      order by seq
      limit ${Math.min(500, Math.max(1, limit))}
    `
    return rows.map(toAgentMessageDto)
  }

  /**
   * 发送消息并在同一事务内创建 invocation。
   * @param conversationId 外部会话 ID。
   * @param input 消息正文、附件和元数据。
   * @returns 用户消息、助手占位和 invocation 链接。
   */
  async sendMessage(
    conversationId: string,
    input: {
      content: string
      attachments?: Array<Record<string, unknown>>
      metadata?: Record<string, unknown>
      idempotencyKey?: string
    },
  ) {
    return this.sql.begin(async (transaction) => {
      const conversation = await this.require(conversationId, transaction, true)
      if (conversation.status !== 'active') {
        throw new AppError({
          code: 'CONVERSATION_ARCHIVED',
          message: '会话已归档，不能继续发送消息。',
          status: 409,
        })
      }
      await this.assertNotBusy(transaction, conversation.id)
      const history = await this.history(transaction, conversation.id)
      const [latest] = await transaction<Array<{ seq: number }>>`
        select coalesce(max(seq), 0)::int as seq
        from agent_messages
        where conversation_id = ${conversation.id}
      `
      const userPublicId = publicId('msg')
      const assistantPublicId = publicId('msg')
      const userSeq = latest.seq + 1
      const assistantSeq = userSeq + 1
      await transaction`
        insert into agent_messages (
          public_id, workspace_id, conversation_id, seq, role, content,
          status, citations, usage
        )
        values (
          ${userPublicId}, ${this.workspaceId}, ${conversation.id}, ${userSeq},
          'user', ${jsonb(transaction, { text: input.content })}, 'completed',
          ${jsonb(transaction, [])}, ${jsonb(transaction, {})}
        )
      `
      await transaction`
        insert into agent_messages (
          public_id, workspace_id, conversation_id, seq, role, content,
          status, citations, usage
        )
        values (
          ${assistantPublicId}, ${this.workspaceId}, ${conversation.id},
          ${assistantSeq}, 'assistant', ${jsonb(transaction, { text: '' })},
          'pending', ${jsonb(transaction, [])}, ${jsonb(transaction, {})}
        )
      `
      const invocationPublicId = publicId('agi')
      const [invocation] = await transaction<Array<{ id: string }>>`
        insert into agent_invocations (
          public_id, workspace_id, agent_id, conversation_id, kind, status,
          definition_snapshot, request, thread_id, idempotency_key
        )
        values (
          ${invocationPublicId}, ${this.workspaceId}, ${conversation.agent_id},
          ${conversation.id}, 'chat', 'queued',
          ${jsonb(transaction, conversation.agent_snapshot)},
          ${jsonb(transaction, {
            content: input.content,
            attachments: input.attachments ?? [],
            metadata: input.metadata ?? {},
            userMessageId: userPublicId,
            assistantMessageId: assistantPublicId,
            history,
          })},
          ${conversation.thread_id}, ${input.idempotencyKey ?? null}
        )
        returning id
      `
      await transaction`
        update agent_messages
        set invocation_id = ${invocation.id}
        where conversation_id = ${conversation.id}
          and public_id in (${userPublicId}, ${assistantPublicId})
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        invocation.id,
        'invocation.queued',
        { status: 'queued' },
      )
      await transaction`
        update agent_conversations
        set
          title = case
            when title = '新会话' then left(${input.content}, 40)
            else title
          end,
          last_message_at = now(),
          updated_at = now()
        where id = ${conversation.id}
      `
      const messages = await transaction<AgentMessageRow[]>`
        select *
        from agent_messages
        where conversation_id = ${conversation.id}
          and public_id in (${userPublicId}, ${assistantPublicId})
        order by seq
      `
      return {
        conversationId,
        userMessageId: userPublicId,
        assistantMessageId: assistantPublicId,
        invocationId: invocationPublicId,
        status: 'queued' as const,
        events: `/api/agent-invocations/${invocationPublicId}/events`,
        messages: messages.map(toAgentMessageDto),
      }
    })
  }

  /**
   * 从指定用户轮次创建新的助手生成。
   * @param conversationId 外部会话 ID。
   * @param userMessageId 外部用户消息 ID。
   * @returns 新 invocation 与助手占位。
   */
  async retryMessage(conversationId: string, userMessageId: string) {
    return this.sql.begin(async (transaction) => {
      const conversation = await this.require(conversationId, transaction, true)
      await this.assertNotBusy(transaction, conversation.id)
      const [userMessage] = await transaction<AgentMessageRow[]>`
        select *
        from agent_messages
        where workspace_id = ${this.workspaceId}
          and conversation_id = ${conversation.id}
          and public_id = ${userMessageId}
          and role = 'user'
        limit 1
      `
      if (!userMessage) throw notFound('用户消息')
      const history = await this.history(
        transaction,
        conversation.id,
        userMessage.seq,
      )
      const [latest] = await transaction<Array<{ seq: number }>>`
        select coalesce(max(seq), 0)::int as seq
        from agent_messages
        where conversation_id = ${conversation.id}
      `
      const assistantPublicId = publicId('msg')
      const assistantSeq = latest.seq + 1
      await transaction`
        insert into agent_messages (
          public_id, workspace_id, conversation_id, seq, role, content,
          status, citations, usage
        )
        values (
          ${assistantPublicId}, ${this.workspaceId}, ${conversation.id},
          ${assistantSeq}, 'assistant', ${jsonb(transaction, { text: '' })},
          'pending', ${jsonb(transaction, [])}, ${jsonb(transaction, {})}
        )
      `
      const invocationPublicId = publicId('agi')
      const content =
        typeof userMessage.content.text === 'string'
          ? userMessage.content.text
          : ''
      const [invocation] = await transaction<Array<{ id: string }>>`
        insert into agent_invocations (
          public_id, workspace_id, agent_id, conversation_id, kind, status,
          definition_snapshot, request, thread_id
        )
        values (
          ${invocationPublicId}, ${this.workspaceId}, ${conversation.agent_id},
          ${conversation.id}, 'chat', 'queued',
          ${jsonb(transaction, conversation.agent_snapshot)},
          ${jsonb(transaction, {
            content,
            attachments: [],
            metadata: { retryOf: userMessageId },
            userMessageId,
            assistantMessageId: assistantPublicId,
            history,
          })},
          ${conversation.thread_id}
        )
        returning id
      `
      await transaction`
        update agent_messages
        set invocation_id = ${invocation.id}
        where conversation_id = ${conversation.id}
          and public_id = ${assistantPublicId}
      `
      await appendInvocationEventRecord(
        transaction,
        this.workspaceId,
        invocation.id,
        'invocation.queued',
        { status: 'queued', retry: true },
      )
      await transaction`
        update agent_conversations
        set last_message_at = now(), updated_at = now()
        where id = ${conversation.id}
      `
      const messages = await transaction<AgentMessageRow[]>`
        select * from agent_messages
        where conversation_id = ${conversation.id}
          and public_id = ${assistantPublicId}
      `
      return {
        conversationId,
        userMessageId,
        assistantMessageId: assistantPublicId,
        invocationId: invocationPublicId,
        status: 'queued' as const,
        events: `/api/agent-invocations/${invocationPublicId}/events`,
        messages: messages.map(toAgentMessageDto),
      }
    })
  }

  /**
   * 更新助手消息的流式草稿。
   * @param messageId 外部消息 ID。
   * @param text 当前累计文本。
   */
  async updateAssistantDraft(messageId: string, text: string) {
    await this.sql`
      update agent_messages
      set
        content = ${jsonb(this.sql, { text })},
        status = 'streaming',
        updated_at = now()
      where workspace_id = ${this.workspaceId}
        and public_id = ${messageId}
        and role = 'assistant'
    `
  }

  /**
   * 完成、失败或取消助手消息。
   * @param messageId 外部消息 ID。
   * @param input 最终内容、引用、usage 和错误。
   */
  async completeAssistantMessage(
    messageId: string,
    input: {
      text: string
      status: 'completed' | 'failed' | 'cancelled'
      citations?: AgentCitation[]
      usage?: Record<string, unknown>
      error?: Record<string, unknown>
    },
  ) {
    await this.sql`
      update agent_messages
      set
        content = ${jsonb(this.sql, { text: input.text })},
        status = ${input.status},
        citations = ${jsonb(this.sql, input.citations ?? [])},
        usage = ${jsonb(this.sql, input.usage ?? {})},
        error = ${input.error ? jsonb(this.sql, input.error) : null},
        updated_at = now()
      where workspace_id = ${this.workspaceId}
        and public_id = ${messageId}
        and role = 'assistant'
    `
    await this.sql`
      update agent_conversations c
      set last_message_at = now(), updated_at = now()
      from agent_messages m
      where m.public_id = ${messageId}
        and m.workspace_id = ${this.workspaceId}
        and m.conversation_id = c.id
    `
  }

  private async require(
    conversationId: string,
    sql: DatabaseClient | Transaction = this.sql,
    lock = false,
  ) {
    const [row] = await sql<ConversationRow[]>`
      select c.*, a.name as agent_name
      from agent_conversations c
      join agents a on a.id = c.agent_id
      where c.workspace_id = ${this.workspaceId}
        and c.public_id = ${conversationId}
      ${lock ? sql`for update of c` : sql``}
      limit 1
    `
    if (!row) throw notFound('会话')
    return row
  }

  private async assertNotBusy(
    transaction: Transaction,
    conversationInternalId: string,
  ) {
    const [active] = await transaction<Array<{ public_id: string }>>`
      select public_id
      from agent_invocations
      where workspace_id = ${this.workspaceId}
        and conversation_id = ${conversationInternalId}
        and status in ('queued', 'running', 'waiting')
      limit 1
    `
    if (active) {
      throw new AppError({
        code: 'CONVERSATION_BUSY',
        message: '当前会话已有正在执行的回答，请等待完成或先停止。',
        status: 409,
        details: { invocationId: active.public_id },
      })
    }
  }

  private async history(
    transaction: Transaction,
    conversationInternalId: string,
    beforeSeq?: number,
  ): Promise<AgentConversationMessage[]> {
    const rows = await transaction<AgentMessageRow[]>`
      select *
      from agent_messages
      where workspace_id = ${this.workspaceId}
        and conversation_id = ${conversationInternalId}
        ${beforeSeq ? transaction`and seq < ${beforeSeq}` : transaction``}
        and status = 'completed'
        and role in ('user', 'assistant')
      order by seq desc
      limit 40
    `
    return rows.reverse().map((row) => ({
      role: row.role,
      content: typeof row.content.text === 'string' ? row.content.text : '',
      citations: row.citations,
      createdAt: iso(row.created_at),
    }))
  }
}
