import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'

test('only queued, running, and waiting invocations are active', async () => {
  const module = await import('./agent-invocation-repository')

  assert.equal(module.isActiveInvocationStatus('queued'), true)
  assert.equal(module.isActiveInvocationStatus('running'), true)
  assert.equal(module.isActiveInvocationStatus('waiting'), true)
  assert.equal(module.isActiveInvocationStatus('succeeded'), false)
  assert.equal(module.isActiveInvocationStatus('failed'), false)
  assert.equal(module.isActiveInvocationStatus('cancelled'), false)
  assert.equal(module.isActiveInvocationStatus('interrupted'), false)
})

test('cancelled agent results complete as cancelled invocations', async () => {
  const module = await import('./agent-invocation-repository')
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
  const module = await import('./agent-repository')
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
  const module = await import('./agent-repository')
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
  const module = await import('./knowledge-ingest-repository')

  assert.equal(module.nextIngestRetryDelayMs(1), 5_000)
  assert.equal(module.nextIngestRetryDelayMs(2), 10_000)
  assert.equal(module.nextIngestRetryDelayMs(3), 20_000)
  assert.equal(module.nextIngestRetryDelayMs(12), 300_000)
})

test('vector dimension guard rejects mixed embeddings', async () => {
  const module = await import('./knowledge-ingest-repository')

  assert.doesNotThrow(() => module.assertVectorDimension(768, 768))
  assert.throws(
    () => module.assertVectorDimension(768, 1536),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'EMBEDDING_DIMENSION_MISMATCH' &&
      error.status === 422,
  )
})
