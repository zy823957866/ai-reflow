import {
  BaseNodeExecutor,
  NodeExecutionError,
  toRunError,
  validateWorkflowDefinition,
  type NodeExecutionContext,
  type RunError,
  type ValidationResult,
  type WorkflowDefinition,
} from '@ai-reflow/core'

export interface CompiledWorkflow {
  definition: WorkflowDefinition
  order: string[]
  incoming: Map<string, WorkflowEdgeView[]>
  outgoing: Map<string, WorkflowEdgeView[]>
}

interface WorkflowEdgeView {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

/**
 * 编译工作流为可执行 DAG。
 *
 * @param definition 工作流定义。
 * @returns 校验结果与拓扑顺序。
 */
export function compileWorkflow(definition: WorkflowDefinition): {
  validation: ValidationResult
  plan?: CompiledWorkflow
} {
  const validation = validateWorkflowDefinition(definition)
  if (!validation.valid) return { validation }
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  const incoming = new Map<string, WorkflowEdgeView[]>()
  const outgoing = new Map<string, WorkflowEdgeView[]>()
  for (const nodeId of nodeIds) {
    incoming.set(nodeId, [])
    outgoing.set(nodeId, [])
  }
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    const view = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    }
    incoming.get(edge.target)!.push(view)
    outgoing.get(edge.source)!.push(view)
  }
  const indegree = new Map<string, number>()
  for (const [nodeId, edges] of incoming) indegree.set(nodeId, edges.length)
  const queue = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId)
  const order: string[] = []
  while (queue.length) {
    const nodeId = queue.shift()!
    order.push(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) {
      const next = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, next)
      if (next === 0) queue.push(edge.target)
    }
  }
  if (order.length !== definition.nodes.length) {
    return {
      validation: {
        valid: false,
        errors: [
          ...validation.errors,
          {
            code: 'WORKFLOW_CYCLE',
            message: '工作流编译检测到环路，无法生成执行计划。',
          },
        ],
        warnings: validation.warnings,
      },
    }
  }
  return {
    validation,
    plan: { definition, order, incoming, outgoing },
  }
}

/**
 * 执行已编译工作流。
 *
 * @param input 执行计划、运行上下文和节点执行器注册表。
 * @returns 节点输出、最终输出与错误。
 */
export async function executeWorkflow(input: {
  plan: CompiledWorkflow
  context: NodeExecutionContext
  executors: Map<string, BaseNodeExecutor<Record<string, unknown>>>
}): Promise<{
  status: 'succeeded' | 'failed' | 'cancelled'
  output?: Record<string, unknown>
  error?: RunError
  nodeOutputs: Record<string, unknown>
  usage: Record<string, unknown>
}> {
  const { plan, context, executors } = input
  const { definition } = plan
  const nodeMap = new Map(definition.nodes.map((node) => [node.id, node]))
  const status = new Map<string, 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'>()
  for (const node of definition.nodes) status.set(node.id, 'pending')
  const edgeActive = new Map<string, boolean>()
  const nodeOutputs: Record<string, unknown> = {}
  const usage: Record<string, unknown> = {}
  let finalOutput: Record<string, unknown> | undefined

  while (true) {
    if (context.signal.aborted) {
      return {
        status: 'cancelled',
        error: {
          code: 'RUN_CANCELLED',
          message: '运行已取消。',
          retryable: false,
        },
        nodeOutputs,
        usage,
      }
    }
    const candidates = definition.nodes.filter((node) => {
      if (status.get(node.id) !== 'pending') return false
      const incoming = plan.incoming.get(node.id) ?? []
      if (!incoming.length) return true
      const resolved = incoming.every((edge) =>
        ['succeeded', 'failed', 'skipped'].includes(status.get(edge.source) ?? 'pending'),
      )
      if (!resolved) return false
      const active = incoming.filter((edge) => edgeActive.get(edge.id) === true)
      return active.length > 0
    })
    const skippable = definition.nodes.filter((node) => {
      if (status.get(node.id) !== 'pending') return false
      const incoming = plan.incoming.get(node.id) ?? []
      return (
        incoming.length > 0 &&
        incoming.every((edge) =>
          ['succeeded', 'failed', 'skipped'].includes(status.get(edge.source) ?? 'pending'),
        ) &&
        !incoming.some((edge) => edgeActive.get(edge.id) === true)
      )
    })
    for (const node of skippable) {
      status.set(node.id, 'skipped')
      await context.emit({
        type: 'node.skipped',
        nodeId: node.id,
        attempt: 1,
        status: 'skipped',
        payload: { reason: 'branch_not_selected' },
      })
      for (const edge of plan.outgoing.get(node.id) ?? []) edgeActive.set(edge.id, false)
    }
    if (!candidates.length) {
      if (skippable.length) continue
      break
    }

    const results = await Promise.all(
      candidates.map(async (node) => {
        status.set(node.id, 'running')
        const executor = executors.get(node.type)
        if (!executor) {
          const error = new NodeExecutionError({
            code: 'NODE_EXECUTOR_MISSING',
            message: `节点类型 ${node.type} 未注册执行器。`,
            nodeId: node.id,
            nodeType: node.type,
          })
          status.set(node.id, 'failed')
          return { node, error }
        }
        const retry = getRetryConfig(node.config)
        let lastError: unknown
        for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
          if (attempt > 1) {
            await context.emit({
              type: 'node.retry',
              nodeId: node.id,
              attempt,
              status: 'running',
              payload: { delayMs: retry.delayMs, previousAttempt: attempt - 1 },
            })
            await delay(retry.delayMs, context.signal)
          }
          try {
            const result = await executor.execute(
              { ...context, attempt },
              node.id,
              node.config,
            )
            status.set(node.id, 'succeeded')
            nodeOutputs[node.id] = result.output
            context.outputs[node.id] = {
              output: result.output,
              meta: { attempt, runId: context.runId },
            }
            if (result.output.usage && typeof result.output.usage === 'object') {
              usage[node.id] = result.output.usage
            }
            if (node.type === 'output') {
              finalOutput =
                result.output.result && typeof result.output.result === 'object'
                  ? (result.output.result as Record<string, unknown>)
                  : result.output
            }
            return { node, handle: result.handle }
          } catch (error) {
            lastError = error
          }
        }
        const policy = getErrorPolicy(node.config)
        if (policy.mode === 'continue') {
          status.set(node.id, 'succeeded')
          const fallback =
            policy.fallbackOutput && typeof policy.fallbackOutput === 'object'
              ? (policy.fallbackOutput as Record<string, unknown>)
              : { fallback: true }
          nodeOutputs[node.id] = fallback
          context.outputs[node.id] = { output: fallback, meta: { attempt: retry.maxAttempts } }
          return { node, handle: policy.fallbackHandle }
        }
        status.set(node.id, 'failed')
        return { node, error: lastError }
      }),
    )

    const failed = results.find((result) => result.error)
    if (failed) {
      return {
        status: 'failed',
        error: toRunError(failed.error, failed.node.id),
        nodeOutputs,
        usage,
      }
    }

    for (const result of results) {
      if (result.error) continue
      const selectedHandle = result.handle
      for (const edge of plan.outgoing.get(result.node.id) ?? []) {
        const sourceHandle = edge.sourceHandle
        edgeActive.set(
          edge.id,
          selectedHandle ? Boolean(sourceHandle && sourceHandle === selectedHandle) : true,
        )
      }
    }
  }

  const unfinished = definition.nodes.filter(
    (node) => status.get(node.id) === 'pending',
  )
  if (unfinished.length) {
    return {
      status: 'failed',
      error: {
        code: 'WORKFLOW_DEADLOCK',
        message: `调度无法继续，未完成节点：${unfinished.map((node) => node.id).join(', ')}`,
        retryable: false,
      },
      nodeOutputs,
      usage,
    }
  }
  return {
    status: 'succeeded',
    output: finalOutput,
    nodeOutputs,
    usage,
  }
}

/**
 * 读取节点重试配置并限制在文档允许范围内。
 * @param config 节点配置。
 * @returns 重试参数。
 */
function getRetryConfig(config: Record<string, unknown>) {
  const raw =
    config.retry && typeof config.retry === 'object'
      ? (config.retry as Record<string, unknown>)
      : {}
  return {
    maxAttempts: Math.min(5, Math.max(1, Number(raw.maxAttempts ?? 1))),
    delayMs: Math.max(0, Number(raw.delayMs ?? 1000)),
  }
}

/**
 * 读取节点错误策略。
 * @param config 节点配置。
 * @returns 错误策略配置。
 */
function getErrorPolicy(config: Record<string, unknown>) {
  const raw =
    config.errorPolicy && typeof config.errorPolicy === 'object'
      ? (config.errorPolicy as Record<string, unknown>)
      : {}
  return {
    mode: raw.mode === 'continue' || raw.mode === 'fallback' ? raw.mode : 'fail',
    fallbackOutput: raw.fallbackOutput,
    fallbackHandle:
      typeof raw.fallbackHandle === 'string' ? raw.fallbackHandle : undefined,
  }
}

/**
 * 在可取消等待后继续重试。
 * @param ms 等待毫秒数。
 * @param signal 取消信号。
 */
function delay(ms: number, signal: AbortSignal) {
  if (!ms) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(
          new NodeExecutionError({
            code: 'RUN_CANCELLED',
            message: '运行已取消。',
            retryable: false,
          }),
        )
      },
      { once: true },
    )
  })
}
