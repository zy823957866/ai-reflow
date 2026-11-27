import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHttpRerankProvider,
  createOllamaRerankProvider,
  type RerankCandidate,
} from '../../../packages/capabilities/src/knowledge/rerank'

test('ollama rerank maps model scores back to candidate ids', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const provider = createOllamaRerankProvider({
    model: 'qwen-test',
    baseUrl: 'http://ollama.local:11434',
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return jsonResponse({
        message: {
          content: '{"scores":[{"index":1,"score":20},{"index":2,"score":95}]}',
        },
      })
    },
  })

  const scores = await provider.rerank({
    query: '退款',
    candidates: [
      candidate('chunk_low', '退款将在七天内退回。'),
      candidate('chunk_high', '退款政策说明。'),
    ],
  })

  assert.deepEqual(scores, [
    { id: 'chunk_low', score: 0.2 },
    { id: 'chunk_high', score: 0.95 },
  ])
  assert.equal(requests[0].url, 'http://ollama.local:11434/api/chat')
  assert.equal(requests[0].body.format, 'json')
  assert.equal(requests[0].body.think, false)
})

test('http rerank provider reads cohere-compatible results', async () => {
  const requests: Array<{
    url: string
    authorization: string | null
    body: Record<string, unknown>
  }> = []
  const provider = createHttpRerankProvider({
    model: 'bge-reranker',
    baseUrl: 'http://rerank.local/v1',
    apiKey: 'secret',
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return jsonResponse({
        results: [
          { index: 1, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.12 },
        ],
      })
    },
  })

  const scores = await provider.rerank({
    query: '退款',
    candidates: [
      candidate('chunk_low', '退款将在七天内退回。'),
      candidate('chunk_high', '退款政策说明。'),
    ],
  })

  assert.deepEqual(scores, [
    { id: 'chunk_low', score: 0.12 },
    { id: 'chunk_high', score: 0.91 },
  ])
  assert.equal(requests[0].url, 'http://rerank.local/v1/rerank')
  assert.equal(requests[0].authorization, 'Bearer secret')
  assert.deepEqual(requests[0].body.documents, [
    '退款将在七天内退回。',
    '退款政策说明。',
  ])
})

test('ollama rerank rejects incomplete score sets', async () => {
  const provider = createOllamaRerankProvider({
    model: 'qwen-test',
    baseUrl: 'http://ollama.local:11434',
    fetch: async () =>
      jsonResponse({
        message: { content: '{"scores":[{"index":1,"score":90}]}' },
      }),
  })

  await assert.rejects(
    provider.rerank({
      query: '退款',
      candidates: [
        candidate('chunk_a'),
        candidate('chunk_b'),
      ],
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'RERANK_INVALID_RESPONSE',
  )
})

test('ollama rerank batches candidates and merges scores by order', async () => {
  const requests: Array<Record<string, unknown>> = []
  const provider = createOllamaRerankProvider({
    model: 'qwen-test',
    baseUrl: 'http://ollama.local:11434',
    batchSize: 2,
    maxTextChars: 100,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      const messages = body.messages as Array<{ role: string; content: string }>
      const candidateCount = messages[1].content.includes('候选 1 到 2')
        ? 2
        : 1
      return jsonResponse({
        message: {
          content: JSON.stringify({
            scores: Array.from({ length: candidateCount }, (_, index) => ({
              index: index + 1,
              score: (index + 1) * 10 + requests.length * 5,
            })),
          }),
        },
      })
    },
  })

  const scores = await provider.rerank({
    query: '退款',
    candidates: [
      candidate('chunk_1', `${'1'.repeat(100)}TAIL`),
      candidate('chunk_2', `${'a'.repeat(100)}TAIL`),
      candidate('chunk_3', `${'A'.repeat(100)}TAIL`),
    ],
  })

  assert.equal(requests.length, 2)
  assert.deepEqual(scores, [
    { id: 'chunk_1', score: 0.15 },
    { id: 'chunk_2', score: 0.25 },
    { id: 'chunk_3', score: 0.2 },
  ])
  const firstMessages = requests[0].messages as Array<{ content: string }>
  const secondMessages = requests[1].messages as Array<{ content: string }>
  assert.match(firstMessages[1].content, /1{100}/)
  assert.doesNotMatch(firstMessages[1].content, /TAIL/)
  assert.match(secondMessages[1].content, /A{100}/)
  assert.doesNotMatch(secondMessages[1].content, /TAIL/)
})

function candidate(id: string, text = `${id} 内容`): RerankCandidate {
  return {
    id,
    text,
    documentName: `${id}.md`,
    metadata: {},
  }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
