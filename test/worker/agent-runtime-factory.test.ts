import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentInvocationRepository,
} from '@ai-reflow/platform'
import {
  createPostgresToolHistoryPort,
  shouldUseInvocationToolHistory,
} from '../../apps/worker/src/agent-runtime-factory'

test('postgres tool history maps runtime records to repository calls', async () => {
  const started: Array<Record<string, unknown>> = []
  const finished: Array<Record<string, unknown>> = []
  const repository = {
    async completedToolCall(invocationId: string, idempotencyKey: string) {
      assert.equal(invocationId, 'agi_1')
      assert.equal(idempotencyKey, 'agi_1:call_1:digest')
      return {
        toolCallId: 'call_1',
        toolName: 'lookup_order',
        result: { status: 'shipped' },
        error: undefined,
        finishedAt: '2026-11-26T08:00:00.000Z',
      }
    },
    async startToolCall(invocationId: string, call: Record<string, unknown>) {
      assert.equal(invocationId, 'agi_1')
      started.push(call)
    },
    async finishToolCall(invocationId: string, call: Record<string, unknown>) {
      assert.equal(invocationId, 'agi_1')
      finished.push(call)
    },
  } as unknown as AgentInvocationRepository
  const port = createPostgresToolHistoryPort('agi_1', repository)

  const cached = await port.get('agi_1:call_1:digest')
  assert.deepEqual(cached, {
    idempotencyKey: 'agi_1:call_1:digest',
    toolCallId: 'call_1',
    toolName: 'lookup_order',
    result: { status: 'shipped' },
    finishedAt: '2026-11-26T08:00:00.000Z',
  })

  await port.start?.({
    idempotencyKey: 'agi_1:call_1:digest',
    toolCallId: 'call_1',
    toolName: 'lookup_order',
    arguments: { orderId: 'A-1' },
    startedAt: '2026-11-26T07:59:59.000Z',
  })
  await port.save({
    idempotencyKey: 'agi_1:call_1:digest',
    toolCallId: 'call_1',
    toolName: 'lookup_order',
    result: { status: 'shipped' },
    finishedAt: '2026-11-26T08:00:00.000Z',
  })

  assert.equal(started.length, 1)
  assert.deepEqual(started[0], {
    id: 'call_1',
    name: 'lookup_order',
    arguments: { orderId: 'A-1' },
    status: 'started',
    idempotencyKey: 'agi_1:call_1:digest',
    startedAt: '2026-11-26T07:59:59.000Z',
  })
  assert.equal(finished.length, 1)
  assert.equal(finished[0].status, 'succeeded')
  assert.deepEqual(finished[0].result, { status: 'shipped' })
})

test('workflow agent nodes do not write tool history under a missing invocation', () => {
  assert.equal(
    shouldUseInvocationToolHistory({ kind: 'workflow_node' }),
    false,
  )
  assert.equal(shouldUseInvocationToolHistory({ kind: 'chat' }), true)
  assert.equal(shouldUseInvocationToolHistory({ kind: 'external' }), true)
})
