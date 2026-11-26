import assert from 'node:assert/strict'
import test from 'node:test'
import type { NodeExecutionContext } from '@ai-reflow/core'

test('agent definition applies the approved defaults', async () => {
  const core = await import('@ai-reflow/core')
  const schema = (core as Record<string, unknown>).agentDefinitionSchema as
    | { parse(value: unknown): Record<string, unknown> }
    | undefined

  assert.equal(typeof schema?.parse, 'function')
  const definition = schema!.parse({
    instructions: '回答用户问题。',
    modelConnectionId: 'mc_local',
  })

  assert.equal(definition.maxSteps, 8)
  assert.equal(definition.timeoutMs, 120_000)
  assert.deepEqual(definition.memory, { mode: 'run' })
})

test('agent definition rejects maxSteps outside the P0 range', async () => {
  const core = await import('@ai-reflow/core')
  const schema = (core as Record<string, unknown>).agentDefinitionSchema as
    | { safeParse(value: unknown): { success: boolean } }
    | undefined

  assert.equal(typeof schema?.safeParse, 'function')
  assert.equal(
    schema!.safeParse({
      instructions: '回答用户问题。',
      modelConnectionId: 'mc_local',
      maxSteps: 33,
    }).success,
    false,
  )
})

test('workflow agent executor forwards the resolved runtime context', async () => {
  const modulePath = './executor'
  const module = (await import(modulePath).catch(() => ({}))) as {
    AgentExecutor?: new () => {
      execute(
        context: NodeExecutionContext,
        nodeId: string,
        config: Record<string, unknown>,
      ): Promise<{ output: Record<string, unknown> }>
    }
  }
  assert.equal(typeof module.AgentExecutor, 'function')

  let received: Record<string, unknown> | undefined
  const context: NodeExecutionContext = {
    runId: 'run_01',
    workspaceId: '00000000-0000-7000-8000-000000000001',
    workflowId: 'wf_01',
    runKind: 'preview',
    trigger: 'manual_preview',
    input: { question: '退款多久到账？' },
    variables: {},
    outputs: {},
    signal: new AbortController().signal,
    async emit() {},
    services: {
      agent: {
        async invoke(input) {
          received = input as unknown as Record<string, unknown>
          return {
            text: '1-3 个工作日。',
            messages: [],
            steps: [],
            toolCalls: [],
            citations: [],
            usage: { inputTokens: 4, outputTokens: 8 },
            finishReason: 'complete',
          }
        },
      },
    },
  }

  const executor = new module.AgentExecutor!()
  const result = await executor.execute(
    context,
    'n_agent',
    {
      instructions: '你是售后助手。',
      modelConnectionId: 'mc_local',
      inputExpression: '{{ $input.question }}',
    },
  )

  assert.equal(result.output.text, '1-3 个工作日。')
  assert.equal(received?.workspaceId, context.workspaceId)
  assert.equal(received?.runId, 'run_01')
  assert.equal(received?.nodeId, 'n_agent')
  assert.equal(received?.threadId, 'workflow:run_01:n_agent')
  assert.deepEqual(received?.input, { text: '退款多久到账？' })
  assert.equal(
    (received?.definition as Record<string, unknown>).maxSteps,
    8,
  )
})
