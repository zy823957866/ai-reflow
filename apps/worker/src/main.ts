import { randomUUID } from 'node:crypto'
import { createCapabilityRegistry } from '@ai-reflow/capabilities'
import { executeWorkflow, compileWorkflow } from '@ai-reflow/engine'
import type { NodeExecutionContext } from '@ai-reflow/core'
import {
  createDatabase,
  loadEnvironment,
  RunRepository,
  type ClaimedRun,
} from '@ai-reflow/platform'
import { createRuntimeServices } from './runtime-services'

const workerId = `worker_${randomUUID().slice(0, 8)}`
const config = loadEnvironment()
const database = createDatabase(config.DATABASE_URL)
const runs = new RunRepository(database.sql, config.DEFAULT_WORKSPACE_ID)
const executors = createCapabilityRegistry()
let stopping = false
let activeRun = false

/**
 * 执行一个已领取的运行，并把所有生命周期事件写入 PostgreSQL。
 * @param run 已领取运行。
 */
async function executeClaimedRun(run: ClaimedRun) {
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
  const services = createRuntimeServices(database.sql, config.DEFAULT_WORKSPACE_ID)
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
 * 轮询 PostgreSQL 队列并执行已领取任务。
 */
async function pollLoop() {
  console.log(`AI Reflow worker 已启动：${workerId}`)
  while (!stopping) {
    try {
      const run = await runs.claimNext(workerId)
      if (!run) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS),
        )
        continue
      }
      activeRun = true
      await executeClaimedRun(run)
      activeRun = false
    } catch (error) {
      activeRun = false
      console.error(error)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  await database.sql.end()
  console.log(`AI Reflow worker 已停止：${workerId}`)
}

process.on('SIGINT', () => {
  stopping = true
})
process.on('SIGTERM', () => {
  stopping = true
})

void pollLoop().catch(async (error) => {
  console.error(error)
  if (!activeRun) await database.sql.end()
  process.exitCode = 1
})
