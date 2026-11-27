import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EmbeddingError,
  embedTexts,
  type EmbeddingProvider,
} from '../../../packages/capabilities/src/knowledge/embeddings'

test('embedding batches texts and preserves order', async () => {
  const batches: number[] = []
  const provider: EmbeddingProvider = {
    async embedDocuments(texts) {
      batches.push(texts.length)
      return texts.map((text) => [text.length, 1])
    },
  }

  const result = await embedTexts(
    provider,
    ['a', 'bb', 'ccc', 'dddd', 'eeeee'],
    {
      batchSize: 2,
      dimensions: 2,
    },
  )

  assert.deepEqual(batches, [2, 2, 1])
  assert.deepEqual(result.map((vector) => vector[0]), [1, 2, 3, 4, 5])
})

test('429 responses retry with exponential backoff', async () => {
  let calls = 0
  const delays: number[] = []
  const provider: EmbeddingProvider = {
    async embedDocuments(texts) {
      calls += 1
      if (calls === 1) {
        throw Object.assign(new Error('rate limited'), { status: 429 })
      }
      return texts.map(() => [0.1, 0.2])
    },
  }

  const result = await embedTexts(provider, ['retry'], {
    dimensions: 2,
    maxRetries: 1,
    initialDelayMs: 25,
    async sleep(ms) {
      delays.push(ms)
    },
  })

  assert.equal(calls, 2)
  assert.deepEqual(delays, [25])
  assert.deepEqual(result, [[0.1, 0.2]])
})

test('400 responses fail without retry', async () => {
  let calls = 0
  const provider: EmbeddingProvider = {
    async embedDocuments() {
      calls += 1
      throw Object.assign(new Error('bad model'), { status: 400 })
    },
  }

  await assert.rejects(
    embedTexts(provider, ['invalid'], {
      dimensions: 2,
      maxRetries: 3,
      initialDelayMs: 1,
      async sleep() {},
    }),
    (error: unknown) =>
      error instanceof EmbeddingError &&
      error.code === 'EMBEDDING_REQUEST_INVALID' &&
      error.retryable === false,
  )
  assert.equal(calls, 1)
})

test('dimension mismatch rejects mixed embedding output', async () => {
  const provider: EmbeddingProvider = {
    async embedDocuments(texts) {
      return texts.map(() => [1, 2, 3])
    },
  }

  await assert.rejects(
    embedTexts(provider, ['wrong dimension'], {
      dimensions: 768,
    }),
    (error: unknown) =>
      error instanceof EmbeddingError &&
      error.code === 'EMBEDDING_DIMENSION_MISMATCH',
  )
})
