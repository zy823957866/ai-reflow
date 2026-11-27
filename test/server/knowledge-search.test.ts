import assert from 'node:assert/strict'
import test from 'node:test'
import { createKnowledgeSearchService } from '../../apps/server/src/knowledge-search'

test('knowledge search uses vector retrieval and keeps the snippet response contract', async () => {
  const calls = {
    keyword: 0,
    vector: 0,
    config: 0,
  }
  const service = createKnowledgeSearchService(
    {
      async keywordSearch() {
        calls.keyword += 1
        return []
      },
      async vectorSearch(_ids, embedding, topK) {
        calls.vector += 1
        assert.deepEqual(embedding, [0.1, 0.2])
        assert.equal(topK, 15)
        return [{
          id: 'chunk_1',
          documentId: 'doc_1',
          documentName: '退款政策.pdf',
          chunkIndex: 0,
          text: '退款将在七天内原路退回。',
          metadata: { page: 2 },
          score: 0.92,
          knowledgeBaseId: 'kb_1',
          vectorScore: 0.92,
        }]
      },
      async embeddingConfig(ids) {
        calls.config += 1
        assert.deepEqual(ids, ['kb_1'])
        return {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimension: 2,
        }
      },
    },
    {
      createEmbeddingProvider() {
        return {
          async embedDocuments() {
            return [[0.1, 0.2]]
          },
        }
      },
    },
  )

  const result = await service.search('kb_1', {
    query: '退款多久到账？',
    topK: 5,
    scoreThreshold: 0,
    retrievalMode: 'vector',
  })

  assert.deepEqual(calls, {
    keyword: 0,
    vector: 1,
    config: 1,
  })
  assert.equal(result.chunks[0].snippet, '退款将在七天内原路退回。')
  assert.equal(result.chunks[0].location, '第 2 页')
  assert.equal(result.citations[0].id, 'c1')
})
