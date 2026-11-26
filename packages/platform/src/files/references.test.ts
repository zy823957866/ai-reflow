import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AppError,
  createDemoWorkflowDefinitions,
  fileRefSchema,
  type FileRef,
  type WorkflowDefinition,
} from '@ai-reflow/core'
import type { DatabaseClient } from '../db/client'
import { WorkflowRepository } from '../db/repositories/workflow-repository'
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

const repositoryWorkflow = {
  id: 'workflow-internal',
  public_id: 'wf_support',
  workspace_id: 'workspace-1',
  name: '附件运行测试',
  slug: 'attachment-run-test',
  description: '',
  status: 'published',
  tags: [],
  owner: { id: 'demo', name: 'Demo', initials: 'D' },
  draft_definition: createDemoWorkflowDefinitions().wf_support,
  revision: 1,
  published_version_id: 'version-internal',
  published_version_public_id: 'ver_support',
  published_version: 1,
  created_at: new Date(),
  updated_at: new Date(),
}

const repositoryVersion = {
  id: 'version-internal',
  public_id: 'ver_support',
  workspace_id: 'workspace-1',
  workflow_id: 'workflow-internal',
  workflow_public_id: 'wf_support',
  version: 1,
  definition: createDemoWorkflowDefinitions().wf_support,
  schema_hash: 'a'.repeat(64),
  manifest_snapshot: [],
  node_count: 5,
  changelog: '附件运行测试',
  created_by: 'Demo',
  created_at: new Date(),
}

interface WorkflowQueryLog {
  query: string
  values: unknown[]
}

function fakeWorkflowDatabase(assets: Array<Record<string, unknown>> = []) {
  const queries: WorkflowQueryLog[] = []
  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push({ query, values })
    if (query === '?::jsonb') return String(values[0])
    if (query.includes('from workflows w')) return [repositoryWorkflow]
    if (
      query.includes('from workflow_versions v')
      || (
        query.includes('from workflow_versions')
        && query.includes('v.public_id =')
      )
    ) {
      return [repositoryVersion]
    }
    if (query.includes('select public_id from workflow_versions')) {
      return [{ public_id: repositoryVersion.public_id }]
    }
    if (query.includes('from file_assets')) {
      return assets.filter((asset) => asset.public_id === values[1])
    }
    if (query.includes('insert into runs')) {
      return [{ public_id: 'run_created' }]
    }
    throw new Error(`Unexpected SQL: ${query}`)
  }) as unknown as DatabaseClient
  return { sql, queries }
}

function workflowWithFileInput(): WorkflowDefinition {
  const definition = createDemoWorkflowDefinitions().wf_support
  const start = definition.nodes.find((node) => node.type === 'start')
  assert.ok(start)
  start.config.inputSchema = {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string' },
      document: { type: 'object', format: 'file-ref' },
      attachments: {
        type: 'array',
        items: { type: 'object', format: 'file-ref' },
      },
    },
  }
  return definition
}

test('preview runs replace client file metadata with workspace-scoped assets', async () => {
  const definition = workflowWithFileInput()
  const trusted = {
    public_id: 'file_trusted',
    name: 'stored.pdf',
    mime: 'application/pdf',
    size_bytes: 42,
    sha256: 'b'.repeat(64),
  }
  const { sql, queries } = fakeWorkflowDatabase([trusted])
  const repository = new WorkflowRepository(sql, 'workspace-1')

  const created = await repository.createPreviewRun('wf_support', {
    definition,
    input: {
      question: '请分析附件',
      document: {
        id: 'file_trusted',
        name: 'forged.pdf',
        mime: 'text/plain',
        size: 1,
      },
      attachments: [{
        id: 'file_trusted',
        name: 'forged-again.pdf',
        mime: 'text/plain',
        size: 2,
      }],
    },
  })

  assert.equal(created.runId, 'run_created')
  const fileQuery = queries.find((entry) => entry.query.includes('from file_assets'))
  assert.ok(fileQuery, '运行创建前必须查询 file_assets。')
  assert.deepEqual(fileQuery.values, ['workspace-1', 'file_trusted'])
  const insert = queries.find((entry) => entry.query.includes('insert into runs'))
  assert.ok(insert, '有效引用必须创建运行。')
  assert.deepEqual(JSON.parse(String(await insert.values[7])), {
    question: '请分析附件',
    document: { ...storedFile, sha256: 'b'.repeat(64) },
    attachments: [{ ...storedFile, sha256: 'b'.repeat(64) }],
  })
})

test('preview runs reject missing or cross-workspace files without inserting a run', async () => {
  const { sql, queries } = fakeWorkflowDatabase()
  const repository = new WorkflowRepository(sql, 'workspace-1')

  await assert.rejects(
    () => repository.createPreviewRun('wf_support', {
      definition: workflowWithFileInput(),
      input: {
        question: '不能访问其他 workspace',
        document: {
          id: 'file_other_workspace',
          name: 'forged.pdf',
          mime: 'application/pdf',
          size: 1,
        },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_NOT_FOUND')
      assert.equal(error.status, 404)
      return true
    },
  )

  const fileQuery = queries.find((entry) => entry.query.includes('from file_assets'))
  assert.ok(fileQuery)
  assert.deepEqual(fileQuery.values, ['workspace-1', 'file_other_workspace'])
  assert.equal(
    queries.some((entry) => entry.query.includes('insert into runs')),
    false,
  )
})

test('production runs reject missing files without inserting a run', async () => {
  const { sql, queries } = fakeWorkflowDatabase()
  const repository = new WorkflowRepository(sql, 'workspace-1')
  const definition = workflowWithFileInput()
  repositoryVersion.definition = definition

  await assert.rejects(
    () => repository.createProductionRun('wf_support', {
      workflowVersionId: 'ver_support',
      trigger: 'api',
      input: {
        question: '固定版本运行',
        attachments: [{
          id: 'file_missing',
          name: 'forged.pdf',
          mime: 'application/pdf',
          size: 1,
        }],
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_NOT_FOUND')
      return true
    },
  )

  const fileQuery = queries.find((entry) => entry.query.includes('from file_assets'))
  assert.ok(fileQuery)
  assert.deepEqual(fileQuery.values, ['workspace-1', 'file_missing'])
  assert.equal(
    queries.some((entry) => entry.query.includes('insert into runs')),
    false,
  )
})
