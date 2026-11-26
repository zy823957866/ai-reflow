import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import type { ObjectStorage } from '../../storage'
import { KnowledgeRepository } from './knowledge-repository'

const pdfBytes = Buffer.from('%PDF-1.7\nknowledge file\n%%EOF\n')
const knowledgeBase = {
  id: 'kb-internal',
  public_id: 'kb_one',
  name: '产品资料',
  description: '',
  embedding_model: 'text-embedding-3-small',
  embedding_dimension: 1536,
}

interface QueryLog {
  query: string
  values: unknown[]
}

function fakeKnowledgeDatabase(options: {
  duplicate?: Record<string, unknown> | null
  document?: Record<string, unknown> | null
  previews?: Array<{ storage_key: string }>
  objectKeys?: Array<{ storage_key: string }>
} = {}) {
  const queries: QueryLog[] = []
  const transactionSql = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push({ query, values })
    return []
  }
  const begin = async (
    callback: (transaction: typeof transactionSql) => Promise<unknown>,
  ) => callback(transactionSql)
  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push({ query, values })
    if (query.includes('from knowledge_bases') && query.includes('public_id =')) {
      return [knowledgeBase]
    }
    if (query.includes('from workflow_versions')) {
      return [{ versions: 0, drafts: 0 }]
    }
    if (query.includes('union all') && query.includes('storage_key')) {
      return options.objectKeys ?? []
    }
    if (
      query.includes('from documents')
      && query.includes('sha256 =')
    ) {
      return options.duplicate ? [options.duplicate] : []
    }
    if (query.includes('insert into documents')) {
      return [{ public_id: String(values[0]) }]
    }
    if (
      query.includes('from documents')
      && query.includes('storage_key')
      && query.includes('public_id =')
    ) {
      return options.document ? [options.document] : []
    }
    if (
      query.includes('from document_previews')
      && query.includes('storage_key')
    ) {
      return options.previews ?? []
    }
    if (query.includes('delete from documents') || query.includes('delete from file_assets')) {
      return []
    }
    throw new Error(`Unexpected SQL: ${query}`)
  }) as unknown as DatabaseClient
  Object.assign(sql, { begin })
  return { sql, queries }
}

function fakeStorage() {
  const puts: Array<Parameters<ObjectStorage['putObject']>[0]> = []
  const gets: string[] = []
  const deletes: string[] = []
  const storage: ObjectStorage = {
    async putObject(input) {
      puts.push(input)
    },
    async getObject(key) {
      gets.push(key)
      return {
        body: Readable.from(pdfBytes),
        contentType: 'application/pdf',
        contentLength: pdfBytes.length,
      }
    },
    async deleteObject(key) {
      deletes.push(key)
    },
  }
  return { storage, puts, gets, deletes }
}

test('uploads a knowledge document as queued without exposing storage_key', async () => {
  const { sql, queries } = fakeKnowledgeDatabase()
  const fake = fakeStorage()
  const repository = new KnowledgeRepository(sql, 'workspace-1', fake.storage)

  const result = await repository.upload('kb_one', {
    name: '..\\private\\产品资料.pdf',
    mime: 'application/pdf',
    buffer: pdfBytes,
  })

  assert.equal(result.status, 'queued')
  assert.equal(result.deduplicated, false)
  assert.equal(result.name, '产品资料.pdf')
  assert.equal(result.sizeBytes, pdfBytes.length)
  assert.equal('storageKey' in result, false)
  assert.equal(fake.puts.length, 1)
  assert.match(
    fake.puts[0]?.key ?? '',
    /^workspace\/workspace-1\/knowledge\/kb-internal\/doc_[a-f0-9]{16}\.pdf$/,
  )
  assert.ok(queries.some((entry) =>
    entry.query.includes('insert into documents')
    && entry.query.includes('workspace_id'),
  ))
})

test('returns the existing document and skips storage for a duplicate hash', async () => {
  const duplicate = {
    public_id: 'doc_existing',
    name: 'existing.pdf',
    extension: 'pdf',
    mime: 'application/pdf',
    size_bytes: pdfBytes.length,
    sha256: 'c'.repeat(64),
    status: 'queued',
    preview_status: 'none',
    metadata: {},
    updated_at: new Date(),
  }
  const { sql } = fakeKnowledgeDatabase({ duplicate })
  const fake = fakeStorage()
  const repository = new KnowledgeRepository(sql, 'workspace-1', fake.storage)

  const result = await repository.upload('kb_one', {
    name: 'copy.pdf',
    mime: 'application/pdf',
    buffer: pdfBytes,
  })

  assert.equal(result.id, 'doc_existing')
  assert.equal(result.deduplicated, true)
  assert.equal(fake.puts.length, 0)
})

test('downloads a knowledge document by workspace-scoped storage key', async () => {
  const document = {
    id: 'doc-internal',
    public_id: 'doc_one',
    name: 'manual.pdf',
    mime: 'application/pdf',
    size_bytes: pdfBytes.length,
    sha256: 'd'.repeat(64),
    storage_key: 'workspace/workspace-1/knowledge/kb-internal/doc-one.pdf',
  }
  const { sql, queries } = fakeKnowledgeDatabase({ document })
  const fake = fakeStorage()
  const repository = new KnowledgeRepository(sql, 'workspace-1', fake.storage)

  const content = await repository.documentFile('doc_one')

  assert.deepEqual(content.file, {
    id: 'doc_one',
    name: 'manual.pdf',
    mime: 'application/pdf',
    size: pdfBytes.length,
    sha256: 'd'.repeat(64),
  })
  assert.equal('storageKey' in content.file, false)
  assert.deepEqual(fake.gets, [document.storage_key])
  assert.ok(queries[0]?.query.includes('workspace_id'))
})

test('deletes document and preview objects before metadata', async () => {
  const document = {
    id: 'doc-internal',
    public_id: 'doc_one',
    name: 'manual.pdf',
    extension: 'pdf',
    preview_status: 'none',
    storage_key: 'workspace/workspace-1/knowledge/kb-internal/doc-one.pdf',
  }
  const { sql, queries } = fakeKnowledgeDatabase({
    document,
    previews: [{ storage_key: 'workspace/workspace-1/previews/doc-one.pdf.png' }],
  })
  const fake = fakeStorage()
  const repository = new KnowledgeRepository(sql, 'workspace-1', fake.storage)

  const result = await repository.removeDocument('doc_one')

  assert.deepEqual(result, { deleted: true })
  assert.deepEqual(fake.deletes, [
    document.storage_key,
    'workspace/workspace-1/previews/doc-one.pdf.png',
  ])
  assert.ok(queries.some((entry) =>
    entry.query.includes('delete from documents')
    && entry.query.includes('workspace_id'),
  ))
})

test('returns stable FILE_NOT_FOUND when a document object is unavailable', async () => {
  const { sql } = fakeKnowledgeDatabase({ document: null })
  const storage: ObjectStorage = {
    async putObject() {},
    async getObject() {
      throw new Error('must not be called')
    },
    async deleteObject() {},
  }
  const repository = new KnowledgeRepository(sql, 'workspace-1', storage)

  await assert.rejects(
    () => repository.documentFile('doc_other_workspace'),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_NOT_FOUND')
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('deletes all knowledge-base document and preview objects before cascade', async () => {
  const { sql, queries } = fakeKnowledgeDatabase({
    objectKeys: [
      { storage_key: 'workspace/workspace-1/knowledge/kb-internal/doc-one.pdf' },
      { storage_key: 'workspace/workspace-1/previews/doc-one.pdf.png' },
    ],
  })
  const fake = fakeStorage()
  const repository = new KnowledgeRepository(sql, 'workspace-1', fake.storage)

  const result = await repository.remove('kb_one')

  assert.deepEqual(result, { deleted: true })
  assert.deepEqual(fake.deletes, [
    'workspace/workspace-1/knowledge/kb-internal/doc-one.pdf',
    'workspace/workspace-1/previews/doc-one.pdf.png',
  ])
  assert.ok(queries.some((entry) =>
    entry.query.includes('delete from knowledge_bases')
    && entry.query.includes('workspace_id'),
  ))
})

test('allows an empty knowledge base to be removed without object storage', async () => {
  const { sql } = fakeKnowledgeDatabase()
  const repository = new KnowledgeRepository(sql, 'workspace-1', undefined)

  const result = await repository.remove('kb_one')

  assert.deepEqual(result, { deleted: true })
})
