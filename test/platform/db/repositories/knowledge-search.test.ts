import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeRepository } from '../../../../packages/platform/src/db/repositories/knowledge-repository'
import { normalizeKnowledgeChunkSettings } from '../../../../packages/platform/src/db/repositories/knowledge-chunk-settings'
import { normalizeFilenameEncoding } from '../../../../packages/platform/src/storage/filename'

test('filename normalization repairs UTF-8 names decoded as latin1', () => {
  const name = '中文标题.txt'
  const mojibake = Buffer.from(name, 'utf8').toString('latin1')

  assert.equal(normalizeFilenameEncoding(mojibake), name)
  assert.equal(normalizeFilenameEncoding(name), name)
})

test('knowledge chunk settings keep overlap inside the chunk size', () => {
  assert.deepEqual(
    normalizeKnowledgeChunkSettings({
      chunkSize: 320,
      overlapSize: 500,
      separator: '\\n---\\n',
    }),
    {
      chunkSize: 320,
      overlapSize: 319,
      separator: '\\n---\\n',
    },
  )
})

test('keyword search SQL scopes workspace and requested knowledge bases', async () => {
  const queries: string[] = []
  const sql = createSearchSql(queries)
  const repository = new KnowledgeRepository(
    sql as never,
    '018f0000-0000-7000-8000-000000000001',
    {
      async put() {},
      async get() {
        return Buffer.from('')
      },
      async delete() {},
    },
  )

  const rows = await repository.keywordSearch(
    ['kb_1'],
    '退款',
    5,
  )

  assert.equal(rows.length, 1)
  assert.ok(
    queries.some(
      (query) =>
        query.includes('c.workspace_id =') &&
        query.includes('d.kb_id = any'),
    ),
  )
})

test('keyword search passes CJK n-gram terms into the full-text fallback', async () => {
  const queries: string[] = []
  const params: unknown[] = []
  const sql = createSearchSql(queries, params)
  const repository = new KnowledgeRepository(
    sql as never,
    '018f0000-0000-7000-8000-000000000001',
    {
      async put() {},
      async get() {
        return Buffer.from('')
      },
      async delete() {},
    },
  )

  await repository.keywordSearch(['kb_1'], '小红多少分', 5)

  const chunkQuery = queries.find((query) =>
    query.includes('from document_chunks'),
  )
  assert.ok(chunkQuery)
  assert.match(chunkQuery, /term_matches/)
  assert.ok(params.flat().includes('小红'))
})

test('chunk persistence rejects batches over the document limit', async () => {
  const repository = new KnowledgeRepository(
    createSearchSql([]) as never,
    '018f0000-0000-7000-8000-000000000001',
    {
      async put() {},
      async get() {
        return Buffer.from('')
      },
      async delete() {},
    },
  )

  await assert.rejects(
    repository.replaceDocumentChunks(
      'doc_1',
      Array.from({ length: 5001 }, (_, index) => ({
        content: `chunk ${index}`,
        tokenCount: 2,
        metadata: { chunkIndex: index },
      })),
      'nomic-embed-text',
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'KNOWLEDGE_CHUNK_LIMIT_EXCEEDED',
  )
})

function createSearchSql(
  queries: string[],
  params: unknown[] = [],
) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?')
    queries.push(query)
    params.push(...values)
    if (query.includes('from knowledge_bases')) {
      return [{
        id: '018f0000-0000-7000-8000-000000000010',
        public_id: String(values[1] ?? 'kb_1'),
      }]
    }
    if (query.includes('from document_chunks')) {
      return [{
        id: 'chunk-1',
        content: '退款政策内容',
        chunk_index: 0,
        metadata: { page: 1 },
        document_public_id: 'doc_1',
        document_name: '政策.pdf',
        knowledge_base_public_id: 'kb_1',
        rank: 0.8,
      }]
    }
    return []
  }
}
