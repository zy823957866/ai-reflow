import { randomUUID } from 'node:crypto'
import { createCapabilityRegistry } from '@ai-reflow/capabilities'
import { compileWorkflow, executeWorkflow } from '@ai-reflow/engine'
import type {
  NodeExecutionContext,
  NodeRuntimeServices,
} from '@ai-reflow/core'
import {
  AgentConversationRepository,
  KnowledgeIngestRepository,
  RunRepository,
  createDatabase,
  loadEnvironment,
  type ClaimedRun,
} from '@ai-reflow/platform'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import {
  createAgentRuntimeFactory,
  createPostgresAgentCheckpointer,
} from './agent-runtime-factory'
import { createRuntimeServices } from './runtime-services'
import { runAgentRole } from './roles/agent-role'
import { runIngestRole } from './roles/ingest-role'
import { runRolePool } from './roles/role-pool'

const workerId = `worker_${randomUUID().slice(0, 8)}`
const config = loadEnvironment()
const database = createDatabase(config.DATABASE_URL)
const runs = new RunRepository(
  database.sql,
  config.DEFAULT_WORKSPACE_ID,
)
const executors = createCapabilityRegistry()
const stopping = new AbortController()

/**
 * 执行一个已领取的运行，并把所有生命周期事件写入 PostgreSQL。
 * @param run 已领取运行。
 * @param services 当前 worker 的共享运行时服务。
 */
async function executeClaimedRun(
  run: ClaimedRun,
  services: NodeRuntimeServices,
) {
  const planResult = compileWorkflow(run.definition)
  if (!planResult.plan) {
    await runs.failClaimedRun(run.id, {
      code: 'WORKFLOW_COMPILE_FAILED',
      message: '工作流无法生成执行计划。',
      details: { issues: planResult.validation.errors },
    })
    await runs.appendEvent(run.publicId, {
      type: 'run.failed',
      status: 'failed',
      payload: { error: planResult.validation.errors },
    })
    return
  }

  const abortController = new AbortController()
  const timeoutMs = Math.max(1000, Number(run.metadata.timeoutMs ?? 120_000))
  const runTimeout = setTimeout(() => {
    void runs.appendEvent(run.publicId, {
      type: 'run.timeout',
      status: 'running',
      payload: { timeoutMs },
    })
    abortController.abort(new Error(`运行超过 ${timeoutMs}ms`))
  }, timeoutMs)
  const heartbeat = setInterval(() => {
    void runs.heartbeat(run.id, workerId).then((cancelled) => {
      if (cancelled) abortController.abort(new Error('运行已取消'))
    })
  }, 1000)

  await runs.startClaimedRun(run)
  const context: NodeExecutionContext = {
    runId: run.publicId,
    workspaceId: config.DEFAULT_WORKSPACE_ID,
    workflowId: run.workflowPublicId,
    workflowVersionId: run.workflowVersionId ?? undefined,
    runKind: run.runKind,
    trigger: run.trigger,
    input: run.input,
    variables: {},
    outputs: {},
    services,
    signal: abortController.signal,
    /**
     * 将节点事件统一追加到运行事件表。
     * @param event 节点事件。
     */
    async emit(event) {
      await runs.appendEvent(run.publicId, event)
    },
  }
  try {
    const result = await executeWorkflow({
      plan: planResult.plan,
      context,
      executors,
    })
    await runs.completeRun(run.id, result)
    const terminalType =
      result.status === 'succeeded'
        ? 'run.completed'
        : result.status === 'failed'
          ? 'run.failed'
          : 'run.cancelled'
    await runs.appendEvent(run.publicId, {
      type: terminalType,
      status: result.status,
      payload: {
        output: result.output,
        error: result.error,
        usage: result.usage,
      },
    })
  } catch (error) {
    await runs.failClaimedRun(run.id, error)
    await runs.appendEvent(run.publicId, {
      type: 'run.failed',
      status: 'failed',
      payload: {
        error:
          error instanceof Error
            ? { code: 'WORKER_EXECUTION_FAILED', message: error.message }
            : { code: 'WORKER_EXECUTION_FAILED', message: String(error) },
      },
    })
  } finally {
    clearTimeout(runTimeout)
    clearInterval(heartbeat)
  }
}

/**
 * 启动 workflow 队列消费角色。
 * @param services 共享运行时服务。
 */
async function runWorkflowRole(services: NodeRuntimeServices) {
  console.log(
    `Workflow role 已启动：concurrency=${config.WORKER_WORKFLOW_CONCURRENCY}`,
  )
  await runRolePool({
    concurrency: config.WORKER_WORKFLOW_CONCURRENCY,
    pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
    signal: stopping.signal,
    async claim() {
      return runs.claimNext(workerId)
    },
    async execute(run) {
      await executeClaimedRun(run, services)
    },
    onError(error, phase) {
      console.error(`Workflow role ${phase} failed`, error)
    },
  })
  console.log('Workflow role 已停止')
}

/**
 * Task 6 之前的真实入库占位，明确失败，不伪造文档 ready。
 */
async function processKnowledgeIngest() {
  const error = new Error('知识库解析、切片和 embedding 处理器尚未接入。') as Error & {
    code: string
    retryable: boolean
  }
  error.code = 'KNOWLEDGE_INGEST_NOT_CONFIGURED'
  error.retryable = false
  throw error
}

async function bootstrap() {
  let checkpointer: PostgresSaver | undefined
  let services = createRuntimeServices(
    database.sql,
    config.DEFAULT_WORKSPACE_ID,
  )
  let runtimeFactory:
    | ReturnType<typeof createAgentRuntimeFactory>
    | undefined

  const needsAgentRuntime =
    config.WORKER_ROLES.includes('workflow') ||
    config.WORKER_ROLES.includes('agent')
  if (needsAgentRuntime) {
    checkpointer = await createPostgresAgentCheckpointer(
      config.DATABASE_URL,
    )
    runtimeFactory = createAgentRuntimeFactory({
      sql: database.sql,
      workspaceId: config.DEFAULT_WORKSPACE_ID,
      services,
      checkpointer,
    })
    services = createRuntimeServices(
      database.sql,
      config.DEFAULT_WORKSPACE_ID,
      runtimeFactory.runtime,
    )
  }

  const tasks: Array<Promise<void>> = []
  if (config.WORKER_ROLES.includes('workflow')) {
    tasks.push(runWorkflowRole(services))
  }
  if (config.WORKER_ROLES.includes('agent') && runtimeFactory) {
    tasks.push(
      runAgentRole({
        invocations: runtimeFactory.invocations,
        conversations: new AgentConversationRepository(
          database.sql,
          config.DEFAULT_WORKSPACE_ID,
        ),
        runtime: runtimeFactory.runtime,
        workspaceId: config.DEFAULT_WORKSPACE_ID,
        workerId,
        concurrency: config.WORKER_AGENT_CONCURRENCY,
        pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
        signal: stopping.signal,
      }),
    )
  }
  if (config.WORKER_ROLES.includes('ingest')) {
    tasks.push(
      runIngestRole({
        jobs: new KnowledgeIngestRepository(
          database.sql,
          config.DEFAULT_WORKSPACE_ID,
        ),
        workerId,
        concurrency: config.WORKER_INGEST_CONCURRENCY,
        pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
        signal: stopping.signal,
        process: processKnowledgeIngest,
      }),
    )
  }

  console.log(
    `AI Reflow worker 已启动：${workerId}，roles=${config.WORKER_ROLES.join(',')}`,
  )
  await Promise.all(tasks)

  try {
    await checkpointer?.end()
  } finally {
    await database.sql.end()
  }
  console.log(`AI Reflow worker 已停止：${workerId}`)
}

function shutdown(signal: string) {
  if (stopping.signal.aborted) return
  console.log(`AI Reflow worker 收到 ${signal}，等待在途任务结束。`)
  stopping.abort()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

void bootstrap().catch(async (error) => {
  console.error(error)
  process.exitCode = 1
  try {
    await database.sql.end()
  } catch {
    // The original startup error is more useful than a close error.
  }
})
