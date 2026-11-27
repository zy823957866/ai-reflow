import {
  KnowledgeIngestError,
  chunkParsedDocument,
  embedTexts,
  parseKnowledgeDocument,
  type EmbeddingProvider,
} from '@ai-reflow/capabilities'
import {
  knowledgeChunkStrategyLabel,
  type ClaimedIngestJob,
  type KnowledgeIngestRepository,
  type ObjectStorage,
} from '@ai-reflow/platform'
import { runRolePool } from './role-pool'

type IngestJobPort = Pick<
  KnowledgeIngestRepository,
  'heartbeat' | 'updateStage' | 'complete' | 'fail'
>
type IngestStage = ClaimedIngestJob['stage']

export interface IngestProcessResult {
  metadata?: Record<string, unknown>
}

export interface IngestProcessContext {
  job: ClaimedIngestJob
  signal: AbortSignal
  setStage(stage: IngestStage): Promise<void>
}

export interface IngestChunkStore {
  replaceDocumentChunks(
    documentId: string,
    chunks: Array<{
      content: string
      tokenCount: number
      metadata: Record<string, unknown>
    }>,
    embeddingModel: string,
  ): Promise<number>
  pendingDocumentChunks(documentId: string): Promise<Array<{
    chunkIndex: number
    content: string
  }>>
  updateChunkEmbedding(
    documentId: string,
    chunkIndex: number,
    embedding: number[],
    embeddingModel: string,
  ): Promise<void>
}

export interface KnowledgeIngestProcessorDependencies {
  storage: Pick<ObjectStorage, 'get'>
  chunks: IngestChunkStore
  embeddings:
    | EmbeddingProvider
    | ((job: ClaimedIngestJob) => EmbeddingProvider)
  chunkSize?: number
  overlap?: number
  separator?: string
  maxChunks?: number
  embeddingBatchSize?: number
  embeddingMaxRetries?: number
}

/**
 * 创建真实文档 ingest 处理器；失败阶段由 KnowledgeIngestError 携带。
 * @param dependencies 对象存储、chunk 仓库和 embedding Provider。
 * @returns 可由 ingest role 调用的处理器。
 */
export function createKnowledgeIngestProcessor(
  dependencies: KnowledgeIngestProcessorDependencies,
) {
  return async function processKnowledgeIngest(
    context: IngestProcessContext,
  ): Promise<IngestProcessResult> {
    const { job, signal } = context
    let chunkCount = 0
    const chunkSize = job.chunkSize ?? dependencies.chunkSize ?? 800
    const overlapSize = job.overlapSize ?? dependencies.overlap ?? 120
    const separator = job.separator ?? dependencies.separator ?? '\\n\\n'

    if (['parse', 'normalize', 'chunk'].includes(job.stage)) {
      const bytes = await dependencies.storage.get(job.storageKey)
      signal.throwIfAborted()
      const parsed = await parseKnowledgeDocument({
        filename: job.documentName,
        mime: job.documentMime,
        bytes,
      })
      await context.setStage('normalize')
      signal.throwIfAborted()
      await context.setStage('chunk')
      const chunks = chunkParsedDocument(parsed, {
        chunkSize,
        overlap: overlapSize,
        separator,
        maxChunks: dependencies.maxChunks,
      })
      chunkCount = await dependencies.chunks.replaceDocumentChunks(
        job.documentPublicId,
        chunks,
        job.embeddingModel,
      )
      await context.setStage('embedding')
    }

    let pending = await dependencies.chunks.pendingDocumentChunks(
      job.documentPublicId,
    )
    if (!pending.length && job.stage === 'embedding' && !chunkCount) {
      throw new KnowledgeIngestError({
        code: 'KNOWLEDGE_INGEST_CHUNKS_MISSING',
        message: '待向量化切片不存在，请从 parse 阶段重新入库。',
        stage: 'embedding',
      })
    }
    if (pending.length) {
      const embeddings =
        typeof dependencies.embeddings === 'function'
          ? dependencies.embeddings(job)
          : dependencies.embeddings
      const vectors = await embedTexts(
        embeddings,
        pending.map((chunk) => chunk.content),
        {
          batchSize: dependencies.embeddingBatchSize,
          dimensions: job.embeddingDimension,
          maxRetries: dependencies.embeddingMaxRetries,
          signal,
        },
      )
      for (const [index, chunk] of pending.entries()) {
        await dependencies.chunks.updateChunkEmbedding(
          job.documentPublicId,
          chunk.chunkIndex,
          vectors[index],
          job.embeddingModel,
        )
      }
      chunkCount = Math.max(chunkCount, pending.length)
      pending = []
    }
    await context.setStage('index')
    return {
      metadata: {
        chunks: chunkCount,
        embeddingModel: job.embeddingModel,
        embeddingDimension: job.embeddingDimension,
        chunkSize,
        overlapSize,
        separator,
        chunkStrategy: knowledgeChunkStrategyLabel({
          chunkSize,
          overlapSize,
          separator,
        }),
        resumedFrom: job.stage,
      },
    }
  }
}

/**
 * 执行一个已领取的入库作业，不伪造解析成功。
 * @param input 作业、仓库端口和真实处理器。
 */
export async function executeClaimedIngest(input: {
  job: ClaimedIngestJob
  jobs: IngestJobPort
  workerId: string
  signal: AbortSignal
  process: (
    context: IngestProcessContext,
  ) => Promise<IngestProcessResult | void>
  heartbeatIntervalMs?: number
  leaseMs?: number
}) {
  const internal = new AbortController()
  const signal = AbortSignal.any([input.signal, internal.signal])
  const claim = {
    workerId: input.workerId,
    attempt: input.job.attempt,
  }
  const heartbeat = setInterval(() => {
    void input.jobs
      .heartbeat(
        input.job.id,
        input.workerId,
        input.job.attempt,
        input.leaseMs ?? 120_000,
      )
      .then((shouldStop) => {
        if (!shouldStop || internal.signal.aborted) return
        internal.abort(new Error('知识库入库任务已取消或租约丢失'))
      })
      .catch((error) => {
        console.error('Knowledge ingest heartbeat failed', error)
      })
  }, input.heartbeatIntervalMs ?? 2000)

  try {
    await input.jobs.updateStage(input.job.id, input.job.stage, claim)
    const result = await input.process({
      job: input.job,
      signal,
      async setStage(stage) {
        await input.jobs.updateStage(input.job.id, stage, claim)
      },
    })
    if (signal.aborted) return
    await input.jobs.complete(
      input.job.id,
      result?.metadata ?? {},
      claim,
    )
  } catch (error) {
    // 用户取消、worker 关闭或租约丢失都不是处理失败，不能覆盖队列状态。
    if (signal.aborted) return
    const normalized = normalizeIngestError(error)
    await input.jobs.fail(input.job.id, {
      stage: normalized.stage ?? input.job.stage,
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
    }, claim)
  } finally {
    clearInterval(heartbeat)
  }
}

/**
 * 启动知识库入库消费角色。
 * @param input 队列、处理器和并发配置。
 */
export async function runIngestRole(input: {
  jobs: KnowledgeIngestRepository
  workerId: string
  concurrency: number
  pollIntervalMs: number
  signal: AbortSignal
  process: (
    context: IngestProcessContext,
  ) => Promise<IngestProcessResult | void>
}) {
  console.log(
    `Ingest role 已启动：concurrency=${input.concurrency}`,
  )
  await runRolePool({
    concurrency: input.concurrency,
    pollIntervalMs: input.pollIntervalMs,
    signal: input.signal,
    async claim() {
      return input.jobs.claimNext(input.workerId)
    },
    async execute(job) {
      await executeClaimedIngest({
        job,
        jobs: input.jobs,
        workerId: input.workerId,
        signal: input.signal,
        process: input.process,
      })
    },
    onError(error, phase) {
      console.error(`Ingest role ${phase} failed`, error)
    },
  })
  console.log('Ingest role 已停止')
}

function normalizeIngestError(error: unknown): {
  stage?: IngestStage
  code: string
  message: string
  retryable: boolean
} {
  if (error instanceof Error) {
    const record = error as Error & {
      code?: unknown
      retryable?: unknown
      stage?: unknown
    }
    return {
      ...(typeof record.stage === 'string'
        ? { stage: record.stage as IngestStage }
        : {}),
      code:
        typeof record.code === 'string'
          ? record.code
          : 'KNOWLEDGE_INGEST_FAILED',
      message: error.message,
      retryable:
        typeof record.retryable === 'boolean'
          ? record.retryable
          : true,
    }
  }
  return {
    code: 'KNOWLEDGE_INGEST_FAILED',
    message: String(error),
    retryable: true,
  }
}
