import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeRepository } from '../../../../packages/platform/src/db/repositories/knowledge-repository'

test('knowledge source loads the stored attachment through its workspace key', async () => {
  const bytes = Buffer.from('original document')
  const queries: string[] = []
  const storageReads: string[] = []
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join('?'))
    assert.ok(values.includes('doc_1'))
    assert.ok(values.includes('018f0000-0000-7000-8000-000000000001'))
    return [{
      public_id: 'doc_1',
      name: 'knowledge.md',
      extension: 'md',
      mime: 'text/markdown',
      size_bytes: bytes.byteLength,
      storage_key: 'kb/kb_1/hash/knowledge.md',
    }]
  }
  const repository = new KnowledgeRepository(
    sql as never,
    '018f0000-0000-7000-8000-000000000001',
    {
      async put() {},
      async get(key) {
        storageReads.push(key)
        return bytes
      },
      async delete() {},
    },
  )

  const source = await repository.source('doc_1')

  assert.deepEqual(storageReads, ['kb/kb_1/hash/knowledge.md'])
  assert.equal(source.name, 'knowledge.md')
  assert.equal(source.mime, 'text/markdown')
  assert.deepEqual(source.bytes, bytes)
  assert.ok(queries.some((query) => query.includes('storage_key')))
})
