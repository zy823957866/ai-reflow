import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AppError,
  createDemoWorkflowDefinitions,
  fileRefSchema,
  type FileRef,
} from '@ai-reflow/core'
import { validateFileReferences } from './references'

const storedFile: FileRef = {
  id: 'file_trusted',
  name: 'stored.pdf',
  mime: 'application/pdf',
  size: 42,
  sha256: 'a'.repeat(64),
}

test('fileRefSchema accepts the fixed public contract', () => {
  const parsed = fileRefSchema.parse(storedFile)
  assert.deepEqual(parsed, storedFile)
})

test('fileRefSchema rejects storage-key leakage', () => {
  assert.throws(
    () => fileRefSchema.parse({
      ...storedFile,
      storageKey: 'workspace/private/object.pdf',
    }),
  )
})

test('the default workflow input schema declares attached files', () => {
  const definition = createDemoWorkflowDefinitions().wf_support
  const start = definition.nodes.find((node) => node.type === 'start')
  const files = (
    start?.config.inputSchema as {
      properties?: Record<string, Record<string, unknown>>
    }
  ).properties?.files

  assert.deepEqual(files, {
    type: 'array',
    title: '附件',
    default: [],
    items: {
      type: 'object',
      format: 'file-ref',
    },
  })
})

test('normalizes single and array FileRefs from the resolver', async () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      document: { type: 'object', format: 'file-ref' },
      attachments: {
        type: 'array',
        items: { type: 'object', format: 'file-ref' },
      },
    },
  }
  const input = {
    title: 'Quarterly review',
    document: {
      id: 'file_trusted',
      name: 'client-name.pdf',
      mime: 'application/octet-stream',
      size: 1,
    },
    attachments: [
      {
        id: 'file_trusted',
        name: 'another-client-name.pdf',
        mime: 'text/plain',
        size: 2,
      },
    ],
  }
  const ids: string[] = []

  const normalized = await validateFileReferences(input, schema, async (id) => {
    ids.push(id)
    return id === 'file_trusted' ? storedFile : undefined
  })

  assert.deepEqual(ids, ['file_trusted', 'file_trusted'])
  assert.deepEqual(normalized, {
    title: 'Quarterly review',
    document: storedFile,
    attachments: [storedFile],
  })
  assert.notEqual(normalized, input)
})

test('normalizes FileRefs nested inside object properties', async () => {
  const normalized = await validateFileReferences(
    {
      request: {
        source: {
          id: 'file_trusted',
          name: 'client-name.pdf',
          mime: 'application/pdf',
          size: 1,
        },
      },
    },
    {
      type: 'object',
      properties: {
        request: {
          type: 'object',
          properties: {
            source: { format: 'file-ref' },
          },
        },
      },
    },
    async () => storedFile,
  )

  assert.deepEqual(normalized, { request: { source: storedFile } })
})

test('leaves fields without the file-ref format unchanged', async () => {
  const input = {
    source: { id: 'not-a-file', arbitrary: true },
    files: [{ name: 'not-a-file.txt' }],
  }
  const normalized = await validateFileReferences(
    input,
    {
      type: 'object',
      properties: {
        source: { type: 'object' },
        files: { type: 'array', items: { type: 'object' } },
      },
    },
    async () => {
      assert.fail('resolver must not run for unmarked fields')
    },
  )

  assert.deepEqual(normalized, input)
})

test('rejects missing or cross-workspace FileRefs as FILE_NOT_FOUND', async () => {
  await assert.rejects(
    () => validateFileReferences(
      { document: { id: 'file_other_workspace' } },
      {
        type: 'object',
        properties: { document: { format: 'file-ref' } },
      },
      async () => undefined,
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_NOT_FOUND')
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('rejects malformed FileRef objects before resolving', async () => {
  await assert.rejects(
    () => validateFileReferences(
      { document: { name: 'missing-id.pdf' } },
      {
        type: 'object',
        properties: { document: { format: 'file-ref' } },
      },
      async () => {
        assert.fail('malformed references must not reach the resolver')
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_NOT_FOUND')
      return true
    },
  )
})
