import assert from 'node:assert/strict'
import test from 'node:test'
import {
  retrieveKnowledge,
  type KnowledgeRetrievalStore,
  type RetrievedKnowledgeChunk,
} from '../../../packages/capabilities/src/knowledge/retrieval'

test('vector retrieval falls back to keyword with an explicit warning', async () => {
  const keywordCalls: string[][] = []
  const store: KnowledgeRetrievalStore = {
    async keyword(input) {
      keywordCalls.push(input.knowledgeBaseIds)
      return [chunk('chunk_1', 0.8)]
    },
    async vector() {
      throw new Error('should not run')
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '退款',
    topK: 5,
    scoreThreshold: 0,
    retrievalMode: 'vector',
  }, {
    store,
    allowKeywordFallback: true,
  })

  assert.deepEqual(keywordCalls, [['kb_1']])
  assert.equal(result.total, 1)
  assert.match(result.warnings?.[0] ?? '', /EMBEDDING_UNAVAILABLE/)
})

test('citations preserve descending retrieval order', async () => {
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return []
    },
    async vector() {
      return [
        chunk('chunk_low', 0.4),
        chunk('chunk_high', 0.9),
      ]
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '发票',
    topK: 5,
    scoreThreshold: 0,
    retrievalMode: 'vector',
  }, {
    store,
    embedder: {
      async embedQuery() {
        return [0.1, 0.2]
      },
    },
  })

  assert.deepEqual(
    result.citations.map((citation) => citation.chunkId),
    ['chunk_high', 'chunk_low'],
  )
  assert.deepEqual(
    result.citations.map((citation) => citation.id),
    ['c1', 'c2'],
  )
})

test('hybrid retrieval merges duplicate chunks without losing vector rank', async () => {
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return [
        chunk('chunk_a', 0.5),
        chunk('chunk_c', 0.4),
      ]
    },
    async vector() {
      return [
        chunk('chunk_a', 0.9),
        chunk('chunk_b', 0.8),
      ]
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '保修',
    topK: 5,
    scoreThreshold: 0,
    retrievalMode: 'hybrid',
  }, {
    store,
    embedder: {
      async embedQuery() {
        return [0.3]
      },
    },
  })

  assert.deepEqual(
    result.chunks.map((item) => item.id),
    ['chunk_a', 'chunk_b', 'chunk_c'],
  )
  assert.equal(result.chunks[0].vectorScore, 0.9)
})

test('retrieval drops chunks outside the requested knowledge bases', async () => {
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return [
        { ...chunk('allowed', 0.8), knowledgeBaseId: 'kb_allowed' },
        { ...chunk('foreign', 0.99), knowledgeBaseId: 'kb_foreign' },
      ]
    },
    async vector() {
      return []
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_allowed'],
    query: '库存',
    topK: 5,
    scoreThreshold: 0,
    retrievalMode: 'keyword',
  }, {
    store,
  })

  assert.deepEqual(result.chunks.map((item) => item.id), ['allowed'])
})

test('rerank reorders the candidate pool before topK is applied', async () => {
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return [
        chunk('chunk_strong', 0.9),
        chunk('chunk_mid', 0.7),
        chunk('chunk_weak', 0.3),
      ]
    },
    async vector() {
      return []
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '退款',
    topK: 2,
    scoreThreshold: 0,
    retrievalMode: 'keyword',
    rerank: { enabled: true },
  }, {
    store,
    reranker: {
      model: 'test-reranker',
      async rerank(input) {
        assert.equal(input.query, '退款')
        assert.deepEqual(
          input.candidates.map((candidate) => candidate.id),
          ['chunk_strong', 'chunk_mid', 'chunk_weak'],
        )
        return [
          { id: 'chunk_strong', score: 0.2 },
          { id: 'chunk_mid', score: 0.95 },
          { id: 'chunk_weak', score: 0.8 },
        ]
      },
    },
  })

  assert.deepEqual(
    result.chunks.map((item) => item.id),
    ['chunk_mid', 'chunk_weak'],
  )
  assert.equal(result.chunks[0].rerankScore, 0.95)
  assert.equal(result.rerankApplied, true)
  assert.equal(result.rerankModel, 'test-reranker')
  assert.deepEqual(
    result.citations.map((citation) => citation.rerankScore),
    [0.95, 0.8],
  )
})

test('rerank failure falls back to retrieval order with a warning', async () => {
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return [
        chunk('chunk_high', 0.9),
        chunk('chunk_low', 0.4),
      ]
    },
    async vector() {
      return []
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '退款',
    topK: 2,
    scoreThreshold: 0,
    retrievalMode: 'keyword',
    rerank: { enabled: true },
  }, {
    store,
    reranker: {
      model: 'test-reranker',
      async rerank() {
        throw new Error('reranker offline')
      },
    },
  })

  assert.deepEqual(
    result.chunks.map((item) => item.id),
    ['chunk_high', 'chunk_low'],
  )
  assert.equal(result.rerankApplied, false)
  assert.match(result.warnings.at(-1) ?? '', /RERANK_FAILED/)
})

test('rerank is skipped when the request does not enable it', async () => {
  let called = 0
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return [chunk('chunk_high', 0.9)]
    },
    async vector() {
      return []
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '退款',
    topK: 1,
    scoreThreshold: 0,
    retrievalMode: 'keyword',
    rerank: { enabled: false },
  }, {
    store,
    reranker: {
      model: 'test-reranker',
      async rerank() {
        called += 1
        return []
      },
    },
  })

  assert.equal(called, 0)
  assert.equal(result.rerankApplied, false)
})

test('rerank without a configured provider keeps retrieval order and warns', async () => {
  const store: KnowledgeRetrievalStore = {
    async keyword() {
      return [chunk('chunk_high', 0.9)]
    },
    async vector() {
      return []
    },
  }

  const result = await retrieveKnowledge({
    knowledgeBaseIds: ['kb_1'],
    query: '退款',
    topK: 1,
    scoreThreshold: 0,
    retrievalMode: 'keyword',
    rerank: { enabled: true },
  }, {
    store,
  })

  assert.deepEqual(result.chunks.map((item) => item.id), ['chunk_high'])
  assert.equal(result.rerankApplied, false)
  assert.match(result.warnings.at(-1) ?? '', /RERANK_NOT_CONFIGURED/)
})

function chunk(id: string, score: number): RetrievedKnowledgeChunk {
  return {
    id,
    documentId: 'doc_1',
    documentName: '政策.pdf',
    chunkIndex: id === 'chunk_a' ? 0 : 1,
    text: `${id} 内容`,
    metadata: { page: 1 },
    score,
  }
}
