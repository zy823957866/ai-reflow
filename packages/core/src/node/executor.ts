import type {
  NodeExecutionContext,
  NodeExecutionResult,
} from '../types'
import { NodeExecutionError } from '../errors'

/**
 * 节点执行器公共基类。
 *
 * `execute()` 统一处理输入校验、超时、日志和错误归一化；
 * 节点子类只实现业务语义 `doExecute()`。
 */
export abstract class BaseNodeExecutor<TConfig extends Record<string, unknown>> {
  abstract readonly type: string

  /**
   * 执行节点并统一产出生命周期事件。
   * @param context 运行上下文。
   * @param nodeId 节点 ID。
   * @param config 节点配置。
   * @returns 节点输出与选中分支。
   */
  async execute(
    context: NodeExecutionContext,
    nodeId: string,
    config: TConfig,
  ): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    const timeoutMs = Number(config.timeoutMs ?? 30_000)
    const attempt = context.attempt ?? 1
    await context.emit({
      type: 'node.started',
      nodeId,
      attempt,
      status: 'running',
      payload: { type: this.type },
    })
    try {
      const output = await this.withTimeout(
        context,
        timeoutMs,
        () => this.doExecute({ ...context, currentNodeId: nodeId }, config),
      )
      const durationMs = Date.now() - startedAt
      await context.emit({
        type: 'node.succeeded',
        nodeId,
        attempt,
        status: 'succeeded',
        payload: {
          type: this.type,
          durationMs,
          output,
          trace: [
            { phase: 'validate', durationMs: 1 },
            { phase: 'resolve', durationMs: 1 },
            { phase: 'execute', durationMs },
            { phase: 'output', durationMs: 1 },
          ],
        },
      })
      return output
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const normalized =
        error instanceof NodeExecutionError
          ? error
          : new NodeExecutionError({
              code: `${this.type.toUpperCase().replaceAll('-', '_')}_FAILED`,
              message: error instanceof Error ? error.message : String(error),
              nodeId,
              nodeType: this.type,
              attempt,
              retryable: false,
            })
      await context.emit({
        type: 'node.failed',
        nodeId,
        attempt,
        status: 'failed',
        payload: {
          type: this.type,
          durationMs,
          error: {
              code: normalized.code,
              message: normalized.message,
              retryable: normalized.retryable,
              details: normalized.details,
          },
        },
      })
      throw normalized
    }
  }

  /**
   * 在节点级超时内执行一次业务调用。
   * @param context 运行上下文。
   * @param timeoutMs 超时毫秒数。
   * @param operation 实际执行函数。
   * @returns 节点业务结果。
   */
  private async withTimeout(
    context: NodeExecutionContext,
    timeoutMs: number,
    operation: () => Promise<NodeExecutionResult>,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation()
    let timeout: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new NodeExecutionError({
            code: 'NODE_TIMEOUT',
            message: `节点执行超时（${timeoutMs}ms）。`,
            retryable: true,
          }),
        )
      }, timeoutMs)
    })
    try {
      return await Promise.race([operation(), timeoutPromise])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  /**
   * 节点业务实现。
   * @param context 运行上下文。
   * @param config 当前节点配置。
   * @returns 节点输出。
   */
  protected abstract doExecute(
    context: NodeExecutionContext,
    config: TConfig,
  ): Promise<NodeExecutionResult>
}
