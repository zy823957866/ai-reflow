import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AgentInvokeInput,
  AgentInvokeResult,
  AgentRuntimeEvent,
} from '@ai-reflow/core'
import type {
  AgentConversationRepository,
  AgentInvocationRepository,
  ClaimedAgentInvocation,
} from '@ai-reflow/platform'
import {
  agentInvocationInput,
  executeAgentInvocation,
} from './agent-role'

test('agent invocation input separates message content and history', () => {
  const prepared = agentInvocationInput({
    content: '请总结退款政策',
    attachments: [{ documentId: 'doc_refund' }],
    metadata: { locale: 'zh-CN' },
    userMessageId: 'msg_user',
    assistantMessageId: 'msg_assistant',
    history: [
      { role: 'user', content: '之前的问题' },
      { role: 'assistant', content: '之前的回答' },
      { role: 'tool', content: '不可信历史' },
    ],
  })

  assert.deepEqual(prepared.input, {
    text: '请总结退款政策',
    attachments: [{ documentId: 'doc_refund' }],
    metadata: { locale: 'zh-CN' },
    userMessageId: 'msg_user',
    assistantMessageId: 'msg_assistant',
  })
  assert.deepEqual(prepared.history, [
    { role: 'user', content: '之前的问题' },
    { role: 'assistant', content: '之前的回答' },
  ])
  assert.equal(prepared.assistantMessageId, 'msg_assistant')
})

test('agent invocation streams drafts and completes the assistant placeholder', async () => {
  const capturedInputs: AgentInvokeInput[] = []
  const draftUpdates: string[] = []
  const appendedEvents: AgentRuntimeEvent[] = []
  const completedMessages: Array<Record<string, unknown>> = []
  const completedInvocations: AgentInvokeResult[] = []
  const runtimeEvents: AgentRuntimeEvent[] = [
    { type: 'message.delta', payload: { text: '你好' } },
    { type: 'message.delta', payload: { text: '，世界' } },
    { type: 'message.completed', payload: { text: '你好，世界' } },
    { type: 'invocation.completed', payload: { finishReason: 'complete' } },
  ]
  const result: AgentInvokeResult = {
    text: '你好，世界',
    messages: [],
    steps: [],
    toolCalls: [],
    citations: [],
    usage: { totalTokens: 8 },
    finishReason: 'complete',
  }
  const runtime = {
    async invoke(input: AgentInvokeInput) {
      capturedInputs.push(input)
      for (const event of runtimeEvents) await input.emit?.(event)
      return result
    },
  }
  const invocations = {
    async heartbeat() {
      return false
    },
    async appendEvent(_invocationId: string, type: string, payload: Record<string, unknown>) {
      appendedEvents.push({ type: type as AgentRuntimeEvent['type'], payload })
    },
    async complete(_invocationId: string, invocationResult: AgentInvokeResult) {
      completedInvocations.push(invocationResult)
      return {}
    },
    async fail() {
      throw new Error('unexpected invocation failure')
    },
  } as unknown as Pick<
    AgentInvocationRepository,
    'heartbeat' | 'appendEvent' | 'complete' | 'fail'
  >
  const conversations = {
    async updateAssistantDraft(_messageId: string, text: string) {
      draftUpdates.push(text)
    },
    async completeAssistantMessage(
      _messageId: string,
      input: Record<string, unknown>,
    ) {
      completedMessages.push(input)
    },
  } as unknown as Pick<
    AgentConversationRepository,
    'updateAssistantDraft' | 'completeAssistantMessage'
  >

  await executeAgentInvocation({
    workspaceId: 'workspace_1',
    invocation: makeClaimedInvocation(),
    runtime,
    invocations,
    conversations,
    workerId: 'worker_1',
    signal: new AbortController().signal,
    heartbeatIntervalMs: 60_000,
    draftFlushIntervalMs: 0,
  })

  assert.equal(capturedInputs.length, 1)
  assert.equal(capturedInputs[0].kind, 'chat')
  assert.equal(capturedInputs[0].invocationId, 'agi_1')
  assert.equal(capturedInputs[0].threadId, 'conversation:conv_1')
  assert.deepEqual(capturedInputs[0].input, {
    text: '请总结退款政策',
    attachments: [],
    metadata: { locale: 'zh-CN' },
    userMessageId: 'msg_user',
    assistantMessageId: 'msg_assistant',
  })
  assert.deepEqual(draftUpdates, ['你好', '你好，世界'])
  assert.deepEqual(
    appendedEvents.map((event) => event.type),
    ['message.delta', 'message.delta', 'message.completed'],
  )
  assert.deepEqual(completedMessages, [
    {
      text: '你好，世界',
      status: 'completed',
      citations: [],
      usage: { totalTokens: 8 },
    },
  ])
  assert.deepEqual(completedInvocations, [result])
})

function makeClaimedInvocation(): ClaimedAgentInvocation {
  return {
    id: '018f0000-0000-7000-8000-000000000010',
    publicId: 'agi_1',
    agentId: 'agent_1',
    conversationId: '018f0000-0000-7000-8000-000000000011',
    kind: 'chat',
    definition: {
      instructions: '你是售后助手。',
      modelConnectionId: 'mc_local',
      mcpTools: [],
      maxSteps: 4,
      timeoutMs: 30_000,
      memory: { mode: 'conversation' },
    },
    request: {
      content: '请总结退款政策',
      attachments: [],
      metadata: { locale: 'zh-CN' },
      userMessageId: 'msg_user',
      assistantMessageId: 'msg_assistant',
      history: [],
    },
    threadId: 'conversation:conv_1',
    resumeCheckpointId: null,
    attempts: 1,
  }
}
