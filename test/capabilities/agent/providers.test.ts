import assert from 'node:assert/strict'
import test from 'node:test'
import { AIMessageChunk, HumanMessage } from '@langchain/core/messages'
import {
  createAgentChatProvider,
  type AgentChatModelLike,
  type AgentChatModelOptions,
  type AgentModelConnection,
} from '../../../packages/capabilities/src/agent/providers'

test('chat provider binds normalized tools to Ollama models', async () => {
  const model = new StubChatModel()
  let received: AgentChatModelOptions | undefined
  const provider = createAgentChatProvider({
    resolveConnection: async () => ({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'http://127.0.0.1:11434',
    }),
    factories: {
      createOllama(input) {
        received = input
        return model
      },
      createOpenAI() {
        throw new Error('OpenAI factory should not be used.')
      },
    },
  })

  const chunks = await collect(
    await provider.stream({
      connectionId: 'mc_local',
      messages: [new HumanMessage('你好')],
      tools: [
        {
          name: 'lookup_order',
          description: '查询订单',
          parameters: {
            type: 'object',
            properties: { orderId: { type: 'string' } },
          },
        },
      ],
      signal: new AbortController().signal,
    }),
  )

  assert.equal(received?.model, 'qwen2.5:7b')
  assert.equal(received?.baseUrl, 'http://127.0.0.1:11434')
  assert.equal(model.boundTools.length, 1)
  assert.equal(
    (model.boundTools[0] as { function?: { name?: string } }).function?.name,
    'lookup_order',
  )
  assert.equal(chunks[0].content, '模型回答')
})

test('DeepSeek connections use the OpenAI-compatible default endpoint', async () => {
  const model = new StubChatModel()
  let received: AgentChatModelOptions | undefined
  const connection: AgentModelConnection = {
    provider: 'deepseek',
    model: 'deepseek-chat',
  }
  const provider = createAgentChatProvider({
    resolveConnection: async () => connection,
    env: { DEEPSEEK_API_KEY: 'secret-from-env' },
    factories: {
      createOllama() {
        throw new Error('Ollama factory should not be used.')
      },
      createOpenAI(input) {
        received = input
        return model
      },
    },
  })

  await collect(
    await provider.stream({
      connectionId: 'mc_deepseek',
      messages: [new HumanMessage('你好')],
      tools: [],
      signal: new AbortController().signal,
    }),
  )

  assert.equal(received?.model, 'deepseek-chat')
  assert.equal(received?.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(received?.apiKey, 'secret-from-env')
})

test('chat provider rejects unsupported providers', async () => {
  const provider = createAgentChatProvider({
    resolveConnection: async () => ({
      provider: 'anthropic',
      model: 'claude',
    }),
    env: { AI_REFLOW_MODEL_API_KEY: 'secret' },
    factories: {
      createOllama() {
        throw new Error('Ollama factory should not be used.')
      },
      createOpenAI() {
        throw new Error('OpenAI factory should not be used.')
      },
    },
  })

  await assert.rejects(
    collect(
      await provider.stream({
        connectionId: 'mc_unknown',
        messages: [new HumanMessage('你好')],
        tools: [],
        signal: new AbortController().signal,
      }),
    ),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code ===
        'MODEL_PROVIDER_UNSUPPORTED',
  )
})

class StubChatModel implements AgentChatModelLike {
  boundTools: unknown[] = []

  bindTools(tools: unknown[]) {
    this.boundTools = tools
    return this
  }

  async stream() {
    return (async function* () {
      yield new AIMessageChunk({ content: '模型回答' })
    })()
  }
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}
