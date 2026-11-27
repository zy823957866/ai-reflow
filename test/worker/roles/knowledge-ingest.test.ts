import assert from 'node:assert/strict'
import test from 'node:test'
import type { EmbeddingProvider } from '@ai-reflow/capabilities'
import type {
  ClaimedIngestJob,
  KnowledgeIngestRepository,
} from '@ai-reflow/platform'
import {
  createKnowledgeIngestProcessor,
  executeClaimedIngest,
  type IngestChunkStore,
} from '../../../apps/worker/src/roles/ingest-role'

test('real ingest parses, chunks, embeds, and persists staged metadata', async () => {
  const stages: string[] = []
  const replaced: Array<Record<string, unknown>> = []
  const embedded: Array<Record<string, unknown>> = []
  let completedMetadata: Record<string, unknown> | undefined
  const jobs = makeJobs(stages, (metadata) => {
    completedMetadata = metadata
  })
  const chunks = makeChunkStore(replaced, embedded)
  const process = createKnowledgeIngestProcessor({
    storage: {
      async get() {
        return Buffer.from('退款政策：签收后七天内可申请。')
      },
    },
    chunks,
    embeddings: embeddingsProvider(),
  })

  await executeClaimedIngest({
    job: makeClaimedIngestJob('parse'),
    jobs,
    workerId: 'worker_1',
    signal: new AbortController().signal,
    heartbeatIntervalMs: 60_000,
    process,
  })

  assert.deepEqual(stages, [
    'parse',
    'normalize',
    'chunk',
    'embedding',
    'index',
  ])
  assert.equal(replaced.length, 1)
  assert.equal(embedded.length, 1)
  assert.equal(completedMetadata?.chunks, 1)
})

test('embedding-stage retry reuses persisted chunks without rereading storage', async () => {
  const stages: string[] = []
  const replaced: Array<Record<string, unknown>> = []
  const embedded: Array<Record<string, unknown>> = []
  let reads = 0
  const process = createKnowledgeIngestProcessor({
    storage: {
      async get() {
        reads += 1
        return Buffer.from('unexpected')
      },
    },
    chunks: makeChunkStore(replaced, embedded),
    embeddings: embeddingsProvider(),
  })

  await executeClaimedIngest({
    job: makeClaimedIngestJob('embedding'),
    jobs: makeJobs(stages),
    workerId: 'worker_1',
    signal: new AbortController().signal,
    heartbeatIntervalMs: 60_000,
    process,
  })

  assert.equal(reads, 0)
  assert.equal(replaced.length, 0)
  assert.equal(embedded.length, 1)
  assert.deepEqual(stages, ['embedding', 'index'])
})

test('ingest creates an embedding provider from each claimed job config', async () => {
  const stages: string[] = []
  const providerConfigs: Array<Record<string, unknown>> = []
  const process = createKnowledgeIngestProcessor({
    storage: {
      async get() {
        return Buffer.from('退款政策：签收后七天内可申请。')
      },
    },
    chunks: makeChunkStore([], []),
    embeddings(job) {
      providerConfigs.push({
        provider: job.embeddingProvider,
        model: job.embeddingModel,
        dimensions: job.embeddingDimension,
      })
      return embeddingsProvider()
    },
  })

  await executeClaimedIngest({
    job: makeClaimedIngestJob('parse'),
    jobs: makeJobs(stages),
    workerId: 'worker_1',
    signal: new AbortController().signal,
    heartbeatIntervalMs: 60_000,
    process,
  })

  assert.deepEqual(providerConfigs, [{
    provider: 'ollama',
    model: 'nomic-embed-text',
    dimensions: 2,
  }])
})

function makeJobs(
  stages: string[],
  onComplete?: (metadata: Record<string, unknown>) => void,
) {
  return {
    async heartbeat() {},
    async updateStage(_jobId: string, stage: string) {
      stages.push(stage)
    },
    async complete(
      _jobId: string,
      metadata: Record<string, unknown>,
    ) {
      onComplete?.(metadata)
    },
    async fail() {
      throw new Error('unexpected failure')
    },
  } as unknown as Pick<
    KnowledgeIngestRepository,
    'heartbeat' | 'updateStage' | 'complete' | 'fail'
  >
}

function makeChunkStore(
  replaced: Array<Record<string, unknown>>,
  embedded: Array<Record<string, unknown>>,
): IngestChunkStore {
  return {
    async replaceDocumentChunks(_documentId, chunks, embeddingModel) {
      replaced.push({ chunks, embeddingModel })
      return chunks.length
    },
    async pendingDocumentChunks() {
      return [{
        chunkIndex: 0,
        content: '退款政策：签收后七天内可申请。',
      }]
    },
    async updateChunkEmbedding(
      _documentId,
      chunkIndex,
      embedding,
      embeddingModel,
    ) {
      embedded.push({ chunkIndex, embedding, embeddingModel })
    },
  }
}

function embeddingsProvider(): EmbeddingProvider {
  return {
    async embedDocuments(texts) {
      return texts.map(() => [0.1, 0.2])
    },
  }
}

function makeClaimedIngestJob(
  stage: ClaimedIngestJob['stage'],
): ClaimedIngestJob {
  return {
    id: '018f0000-0000-7000-8000-000000000020',
    publicId: 'kij_1',
    kind: 'ingest',
    stage,
    attempt: 1,
    maxAttempts: 3,
    documentId: '018f0000-0000-7000-8000-000000000021',
    documentPublicId: 'doc_1',
    documentName: '退款政策.txt',
    documentMime: 'text/plain',
    documentExtension: 'txt',
    documentSizeBytes: 60,
    documentSha256: 'abc',
    storageKey: 'kb/doc.txt',
    knowledgeBaseId: '018f0000-0000-7000-8000-000000000022',
    knowledgeBasePublicId: 'kb_1',
    knowledgeBaseName: '售后知识库',
    embeddingProvider: 'ollama',
    embeddingModel: 'nomic-embed-text',
    embeddingDimension: 2,
  }
}
