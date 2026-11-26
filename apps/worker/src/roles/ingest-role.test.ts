import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ClaimedIngestJob,
  KnowledgeIngestRepository,
} from '@ai-reflow/platform'
import { executeClaimedIngest } from './ingest-role'

test('ingest role records a real failure instead of fake success', async () => {
  const failures: Array<Record<string, unknown>> = []
  let completed = 0
  const jobs = {
    async heartbeat() {},
    async updateStage() {},
    async complete() {
      completed += 1
    },
    async fail(
      _jobId: string,
      input: Record<string, unknown>,
    ) {
      failures.push(input)
      return { status: 'failed' }
    },
  } as unknown as Pick<
    KnowledgeIngestRepository,
    'heartbeat' | 'updateStage' | 'complete' | 'fail'
  >

  await executeClaimedIngest({
    job: makeClaimedIngestJob(),
    jobs,
    workerId: 'worker_1',
    signal: new AbortController().signal,
    heartbeatIntervalMs: 60_000,
    async process() {
      const error = new Error('真实解析器尚未接入。') as Error & {
        code: string
        retryable: boolean
      }
      error.code = 'KNOWLEDGE_INGEST_NOT_CONFIGURED'
      error.retryable = false
      throw error
    },
  })

  assert.equal(completed, 0)
  assert.deepEqual(failures, [
    {
      stage: 'parse',
      code: 'KNOWLEDGE_INGEST_NOT_CONFIGURED',
      message: '真实解析器尚未接入。',
      retryable: false,
    },
  ])
})

test('ingest cancellation aborts active work without recording failure or success', {
  timeout: 2_000,
}, async () => {
  let completed = 0
  let failures = 0
  let heartbeatCount = 0
  const jobs = {
    async heartbeat() {
      heartbeatCount += 1
      return heartbeatCount > 1
    },
    async updateStage() {},
    async complete() {
      completed += 1
    },
    async fail() {
      failures += 1
    },
  } as unknown as Pick<
    KnowledgeIngestRepository,
    'heartbeat' | 'updateStage' | 'complete' | 'fail'
  >

  await executeClaimedIngest({
    job: makeClaimedIngestJob(),
    jobs,
    workerId: 'worker_1',
    signal: new AbortController().signal,
    heartbeatIntervalMs: 10,
    async process({ signal }) {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        )
      })
    },
  })

  assert.equal(completed, 0)
  assert.equal(failures, 0)
})

function makeClaimedIngestJob(): ClaimedIngestJob {
  return {
    id: '018f0000-0000-7000-8000-000000000020',
    publicId: 'kij_1',
    kind: 'ingest',
    stage: 'parse',
    attempt: 1,
    maxAttempts: 3,
    documentId: '018f0000-0000-7000-8000-000000000021',
    documentPublicId: 'doc_1',
    documentName: '退款政策.pdf',
    documentMime: 'application/pdf',
    documentExtension: 'pdf',
    documentSizeBytes: 1024,
    documentSha256: 'abc',
    storageKey: 'kb/doc.pdf',
    knowledgeBaseId: '018f0000-0000-7000-8000-000000000022',
    knowledgeBasePublicId: 'kb_1',
    knowledgeBaseName: '售后知识库',
    embeddingProvider: 'ollama',
    embeddingModel: 'nomic-embed-text',
    embeddingDimension: 768,
  }
}
