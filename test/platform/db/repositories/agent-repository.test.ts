import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'

test('only queued, running, and waiting invocations are active', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/agent-invocation-repository')

  assert.equal(module.isActiveInvocationStatus('queued'), true)
  assert.equal(module.isActiveInvocationStatus('running'), true)
  assert.equal(module.isActiveInvocationStatus('waiting'), true)
  assert.equal(module.isActiveInvocationStatus('succeeded'), false)
  assert.equal(module.isActiveInvocationStatus('failed'), false)
  assert.equal(module.isActiveInvocationStatus('cancelled'), false)
  assert.equal(module.isActiveInvocationStatus('interrupted'), false)
})

test('cancelled agent results complete as cancelled invocations', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/agent-invocation-repository')
  const terminal = module.invocationCompletion({
    text: '已经生成的部分回答',
    messages: [],
    steps: [],
    toolCalls: [],
    citations: [],
    usage: {},
    finishReason: 'cancelled',
  })

  assert.equal(terminal.status, 'cancelled')
  assert.equal(terminal.eventType, 'invocation.cancelled')
  assert.equal(terminal.error?.code, 'INVOCATION_CANCELLED')
})

test('agent row mapping preserves revision and snapshot config', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/agent-repository')
  const updatedAt = new Date('2026-11-26T08:00:00.000Z')
  const dto = module.toAgentDto({
    id: '018f0000-0000-7000-8000-000000000001',
    public_id: 'agent_support',
    workspace_id: '018f0000-0000-7000-8000-000000000002',
    name: '售后助手',
    description: '处理退款问题',
    config: {
      instructions: '你是售后助手。',
      modelConnectionId: 'mc_local',
      mcpTools: [],
      maxSteps: 8,
      timeoutMs: 120_000,
      memory: { mode: 'conversation' },
    },
    revision: 4,
    status: 'active',
    created_at: updatedAt,
    updated_at: updatedAt,
  })

  assert.equal(dto.id, 'agent_support')
  assert.equal(dto.revision, 4)
  assert.equal(dto.config.modelConnectionId, 'mc_local')
  assert.equal(dto.updatedAt, '2026-11-26T08:00:00.000Z')
})

test('agent message mapping exposes completed text and citations', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/agent-repository')
  const createdAt = new Date('2026-11-26T08:01:00.000Z')
  const dto = module.toAgentMessageDto({
    id: '018f0000-0000-7000-8000-000000000003',
    public_id: 'msg_01',
    workspace_id: '018f0000-0000-7000-8000-000000000002',
    conversation_id: '018f0000-0000-7000-8000-000000000004',
    invocation_id: null,
    seq: 2,
    role: 'assistant',
    content: { text: '退款将在 1-3 个工作日到账。' },
    status: 'completed',
    citations: [
      {
        documentId: 'doc_refund',
        documentName: '退款政策',
        location: '第 2 页',
      },
    ],
    usage: { inputTokens: 40, outputTokens: 12 },
    error: null,
    created_at: createdAt,
    updated_at: createdAt,
  })

  assert.equal(dto.content, '退款将在 1-3 个工作日到账。')
  assert.equal(dto.citations.length, 1)
  assert.equal(dto.usage.outputTokens, 12)
})

test('ingest retries use bounded exponential backoff', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/knowledge-ingest-repository')

  assert.equal(module.nextIngestRetryDelayMs(1), 5_000)
  assert.equal(module.nextIngestRetryDelayMs(2), 10_000)
  assert.equal(module.nextIngestRetryDelayMs(3), 20_000)
  assert.equal(module.nextIngestRetryDelayMs(12), 300_000)
})

test('vector dimension guard rejects mixed embeddings', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/knowledge-ingest-repository')

  assert.doesNotThrow(() => module.assertVectorDimension(768, 768))
  assert.throws(
    () => module.assertVectorDimension(768, 1536),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'EMBEDDING_DIMENSION_MISMATCH' &&
      error.status === 422,
  )
})

test('knowledge embedding configuration is fixed to the local 768d model', async () => {
  const module = await import('../../../../packages/platform/src/db/repositories/knowledge-repository')
  assert.deepEqual(
    module.normalizeKnowledgeEmbeddingConfig({
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
    }),
    {
      embeddingProvider: 'ollama',
      embeddingModel: 'nomic-embed-text',
      embeddingDimension: 768,
    },
  )
})

test('sendMessage replays the first invocation for the same idempotency key', async () => {
  const { AgentConversationRepository } = await import('../../../../packages/platform/src/db/repositories/agent-repository')
  const createdAt = new Date('2026-11-26T08:02:00.000Z')
  let began = 0
  const sql = Object.assign(
    (strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('from agent_invocations i')) {
        return [{
          public_id: 'agi_existing',
          conversation_public_id: 'conv_1',
          status: 'running',
          request: {
            userMessageId: 'msg_user',
            assistantMessageId: 'msg_assistant',
          },
        }]
      }
      if (query.includes('from agent_messages')) {
        return [
          {
            id: '018f0000-0000-7000-8000-000000000011',
            public_id: 'msg_user',
            workspace_id: '018f0000-0000-7000-8000-000000000001',
            conversation_id: '018f0000-0000-7000-8000-000000000004',
            invocation_id: '018f0000-0000-7000-8000-000000000012',
            seq: 1,
            role: 'user',
            content: { text: '重复请求' },
            status: 'completed',
            citations: [],
            usage: {},
            error: null,
            created_at: createdAt,
            updated_at: createdAt,
          },
          {
            id: '018f0000-0000-7000-8000-000000000013',
            public_id: 'msg_assistant',
            workspace_id: '018f0000-0000-7000-8000-000000000001',
            conversation_id: '018f0000-0000-7000-8000-000000000004',
            invocation_id: '018f0000-0000-7000-8000-000000000012',
            seq: 2,
            role: 'assistant',
            content: { text: '' },
            status: 'pending',
            citations: [],
            usage: {},
            error: null,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ]
      }
      return []
    },
    {
      async begin() {
        began += 1
        throw new Error('idempotent replay must not create a new transaction')
      },
    },
  )
  const repository = new AgentConversationRepository(
    sql as never,
    '018f0000-0000-7000-8000-000000000001',
  )

  const result = await repository.sendMessage('conv_1', {
    content: '重复请求',
    idempotencyKey: 'idem_replay',
  })

  assert.equal(began, 0)
  assert.equal(result.invocationId, 'agi_existing')
  assert.equal(result.userMessageId, 'msg_user')
  assert.equal(result.assistantMessageId, 'msg_assistant')
  assert.deepEqual(
    result.messages.map((message) => message.content),
    ['重复请求', ''],
  )
})

test('concurrent same-key send replays after acquiring the conversation lock', async () => {
  const { AgentConversationRepository } = await import('../../../../packages/platform/src/db/repositories/agent-repository')
  const createdAt = new Date('2026-11-26T08:03:00.000Z')
  let busyChecks = 0
  const conversationRow = {
    id: '018f0000-0000-7000-8000-000000000004',
    public_id: 'conv_1',
    workspace_id: '018f0000-0000-7000-8000-000000000001',
    agent_id: '018f0000-0000-7000-8000-000000000002',
    agent_revision: 1,
    agent_snapshot: {
      instructions: '你是售后助手。',
      modelConnectionId: 'mc_local',
      mcpTools: [],
      maxSteps: 4,
      timeoutMs: 30_000,
      memory: { mode: 'conversation' },
    },
    thread_id: 'conversation:conv_1',
    title: '重复请求',
    status: 'active',
    metadata: {},
    last_message_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
    agent_name: '售后助手',
    agent_public_id: 'agent_1',
  }
  const messages = [
    {
      id: '018f0000-0000-7000-8000-000000000011',
      public_id: 'msg_user',
      workspace_id: conversationRow.workspace_id,
      conversation_id: conversationRow.id,
      invocation_id: '018f0000-0000-7000-8000-000000000012',
      seq: 1,
      role: 'user',
      content: { text: '重复请求' },
      status: 'completed',
      citations: [],
      usage: {},
      error: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: '018f0000-0000-7000-8000-000000000013',
      public_id: 'msg_assistant',
      workspace_id: conversationRow.workspace_id,
      conversation_id: conversationRow.id,
      invocation_id: '018f0000-0000-7000-8000-000000000012',
      seq: 2,
      role: 'assistant',
      content: { text: '' },
      status: 'pending',
      citations: [],
      usage: {},
      error: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]
  const transaction = (strings: TemplateStringsArray) => {
    const query = strings.join('?')
    if (
      query.includes('from agent_invocations i') &&
      query.includes('join agent_conversations')
    ) {
      return [{
        public_id: 'agi_existing',
        conversation_public_id: 'conv_1',
        status: 'queued',
        request: {
          userMessageId: 'msg_user',
          assistantMessageId: 'msg_assistant',
        },
      }]
    }
    if (
      query.includes('from agent_invocations') &&
      query.includes('status in')
    ) {
      busyChecks += 1
      return [{ public_id: 'agi_existing' }]
    }
    if (query.includes('from agent_conversations c')) {
      return [conversationRow]
    }
    if (query.includes('from agent_messages')) {
      return messages
    }
    return []
  }
  const sql = Object.assign(
    (strings: TemplateStringsArray) => {
      const query = strings.join('?')
      // 模拟第一次查询发生在首个事务提交之前。
      if (query.includes('from agent_invocations i')) return []
      return []
    },
    {
      async begin(task: (query: typeof transaction) => Promise<unknown>) {
        return task(transaction)
      },
    },
  )
  const repository = new AgentConversationRepository(
    sql as never,
    '018f0000-0000-7000-8000-000000000001',
  )

  const result = await repository.sendMessage('conv_1', {
    content: '重复请求',
    idempotencyKey: 'idem_concurrent',
  })

  assert.equal(busyChecks, 0)
  assert.equal(result.invocationId, 'agi_existing')
  assert.equal(result.userMessageId, 'msg_user')
  assert.equal(result.assistantMessageId, 'msg_assistant')
})
