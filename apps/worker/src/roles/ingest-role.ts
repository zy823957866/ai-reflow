import type {
  ClaimedIngestJob,
  KnowledgeIngestRepository,
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
  const heartbeat = setInterval(() => {
    void input.jobs
      .heartbeat(
        input.job.id,
        input.workerId,
        input.leaseMs ?? 120_000,
      )
      .catch((error) => {
        console.error('Knowledge ingest heartbeat failed', error)
      })
  }, input.heartbeatIntervalMs ?? 2000)

  try {
    await input.jobs.updateStage(input.job.id, input.job.stage)
    const result = await input.process({ job: input.job, signal })
    await input.jobs.complete(
      input.job.id,
      result?.metadata ?? {},
    )
  } catch (error) {
    const normalized = normalizeIngestError(error)
    await input.jobs.fail(input.job.id, {
      stage: normalized.stage ?? input.job.stage,
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
    })
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
