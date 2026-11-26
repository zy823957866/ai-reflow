import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { schema } from '../schema'
import type { ObjectStorage } from '../../storage'
import { FileRepository } from './file-repository'

const pdfBytes = Buffer.from('%PDF-1.7\nintegration file\n%%EOF\n')

interface QueryLog {
  query: string
  values: unknown[]
}

function fakeDatabase(options: {
  asset?: Record<string, unknown> | null
  failInsert?: Error
} = {}) {
  const queries: QueryLog[] = []
  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push({ query, values })
    if (query.includes('insert into file_assets')) {
      if (options.failInsert) throw options.failInsert
      return [{}]
    }
    if (query.includes('from file_assets')) {
      return options.asset ? [options.asset] : []
    }
    if (query.includes('delete from file_assets')) {
      return []
    }
    throw new Error(`Unexpected SQL: ${query}`)
  }) as unknown as DatabaseClient
  return { sql, queries }
}

function fakeStorage(options: {
  failPut?: Error
  missingObject?: boolean
} = {}) {
  const puts: Array<Parameters<ObjectStorage['putObject']>[0]> = []
  const gets: string[] = []
  const deletes: string[] = []
  const storage: ObjectStorage = {
    async putObject(input) {
      puts.push(input)
      if (options.failPut) throw options.failPut
    },
    async getObject(key) {
      gets.push(key)
      if (options.missingObject) {
        throw new AppError({
          code: 'FILE_NOT_FOUND',
          message: '文件正文不存在。',
          status: 404,
        })
      }
      return {
        body: Readable.from('stored content'),
        contentType: 'application/pdf',
        contentLength: 42,
      }
    },
    async deleteObject(key) {
      deletes.push(key)
    },
  }
  return { storage, puts, gets, deletes }
}

test('registers file_assets in the Drizzle schema', () => {
  assert.ok(schema.fileAssets)
})

test('uploads through storage and returns only a public FileRef', async () => {
  const { sql, queries } = fakeDatabase()
  const fake = fakeStorage()
  const repository = new FileRepository(sql, 'workspace-1', fake.storage)

  const file = await repository.upload({
    name: '..\\private\\quarterly.pdf',
    mime: 'application/pdf',
    buffer: pdfBytes,
  })

  assert.match(file.id, /^file_[a-f0-9]{16}$/)
  assert.equal(file.name, 'quarterly.pdf')
  assert.equal(file.mime, 'application/pdf')
  assert.equal(file.size, pdfBytes.length)
  assert.match(file.sha256 ?? '', /^[a-f0-9]{64}$/)
  assert.equal('storageKey' in file, false)
  assert.equal(fake.puts.length, 1)
  assert.match(
    fake.puts[0]?.key ?? '',
    new RegExp(`^workspace/workspace-1/files/${file.id}\\.pdf$`),
  )
  assert.equal(fake.puts[0]?.key.includes('quarterly'), false)
  assert.ok(queries.some((entry) => entry.query.includes('insert into file_assets')))
})

test('best-effort deletes an object when metadata persistence fails', async () => {
  const { sql } = fakeDatabase({ failInsert: new Error('database offline') })
  const fake = fakeStorage()
  const repository = new FileRepository(sql, 'workspace-1', fake.storage)

  await assert.rejects(() => repository.upload({
    name: 'quarterly.pdf',
    mime: 'application/pdf',
    buffer: pdfBytes,
  }))

  assert.equal(fake.puts.length, 1)
  assert.deepEqual(fake.deletes, [fake.puts[0]?.key])
})

test('returns a stable 503 before writing when storage is disabled', async () => {
  const { sql } = fakeDatabase()
  const repository = new FileRepository(sql, 'workspace-1', undefined)

  await assert.rejects(
    () => repository.upload({
      name: 'quarterly.pdf',
      mime: 'application/pdf',
      buffer: pdfBytes,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'OBJECT_STORAGE_NOT_CONFIGURED')
      assert.equal(error.status, 503)
      return true
    },
  )
})

test('reads content by workspace-scoped ID without exposing storage_key', async () => {
  const asset = {
    id: '00000000-0000-7000-8000-000000000099',
    public_id: 'file_content',
    name: 'report.pdf',
    mime: 'application/pdf',
    size_bytes: 42,
    sha256: 'b'.repeat(64),
    storage_key: 'workspace/workspace-1/files/private-object.pdf',
  }
  const { sql, queries } = fakeDatabase({ asset })
  const fake = fakeStorage()
  const repository = new FileRepository(sql, 'workspace-1', fake.storage)

  const content = await repository.content('file_content')

  assert.deepEqual(content.file, {
    id: 'file_content',
    name: 'report.pdf',
    mime: 'application/pdf',
    size: 42,
    sha256: 'b'.repeat(64),
  })
  assert.equal('storageKey' in content.file, false)
  assert.deepEqual(fake.gets, [asset.storage_key])
  assert.ok(queries[0]?.query.includes('workspace_id'))
})

test('removes the object before deleting workspace-scoped metadata', async () => {
  const asset = {
    id: '00000000-0000-7000-8000-000000000099',
    public_id: 'file_remove',
    storage_key: 'workspace/workspace-1/files/remove.pdf',
  }
  const { sql, queries } = fakeDatabase({ asset })
  const fake = fakeStorage()
  const repository = new FileRepository(sql, 'workspace-1', fake.storage)

  const result = await repository.remove('file_remove')

  assert.deepEqual(result, { deleted: true })
  assert.deepEqual(fake.deletes, [asset.storage_key])
  assert.ok(queries.some((entry) =>
    entry.query.includes('delete from file_assets')
    && entry.query.includes('workspace_id'),
  ))
})

test('returns FILE_NOT_FOUND for missing or cross-workspace assets', async () => {
  const { sql } = fakeDatabase({ asset: null })
  const fake = fakeStorage()
  const repository = new FileRepository(sql, 'workspace-1', fake.storage)

  await assert.rejects(
    () => repository.content('file_other_workspace'),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_NOT_FOUND')
      assert.equal(error.status, 404)
      return true
    },
  )
  assert.equal(fake.gets.length, 0)
})
