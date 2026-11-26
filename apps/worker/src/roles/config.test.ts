import assert from 'node:assert/strict'
import test from 'node:test'
import { loadEnvironment, parseWorkerRoles } from '@ai-reflow/platform'

test('worker role parsing trims, deduplicates, and preserves order', () => {
  assert.deepEqual(
    parseWorkerRoles('workflow, agent,agent, ingest'),
    ['workflow', 'agent', 'ingest'],
  )
})

test('worker role parsing rejects unknown roles', () => {
  assert.throws(
    () => parseWorkerRoles('workflow,search'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('WORKER_ROLES_INVALID') &&
      error.message.includes('search'),
  )
})

test('worker environment exposes role concurrency defaults', () => {
  const environment = loadEnvironment({
    DATABASE_URL: 'postgres://localhost/ai_reflow',
    DEFAULT_WORKSPACE_ID: '018f0000-0000-7000-8000-000000000001',
    ENCRYPTION_KEY: '1234567890abcdef',
  })

  assert.deepEqual(environment.WORKER_ROLES, [
    'workflow',
    'agent',
    'ingest',
  ])
  assert.equal(environment.WORKER_WORKFLOW_CONCURRENCY, 2)
  assert.equal(environment.WORKER_AGENT_CONCURRENCY, 8)
  assert.equal(environment.WORKER_INGEST_CONCURRENCY, 2)
})
