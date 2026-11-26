import type { RunError, ValidationIssue } from './types'

/**
 * 带稳定错误码、HTTP 状态和重试语义的应用异常基类。
 */
export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly details?: Record<string, unknown>
  readonly issues?: ValidationIssue[]

  /**
   * 创建可安全返回给 API 调用方的应用异常。
   * @param input 错误码、消息与可选诊断信息。
   */
  constructor(input: {
    code: string
    message: string
    status?: number
    retryable?: boolean
    details?: Record<string, unknown>
    issues?: ValidationIssue[]
  }) {
    super(input.message)
    this.name = 'AppError'
    this.code = input.code
    this.status = input.status ?? 400
    this.retryable = input.retryable ?? false
    this.details = input.details
    this.issues = input.issues
  }
}

/**
 * 节点执行失败时使用的统一异常。
 */
export class NodeExecutionError extends AppError {
  readonly nodeId?: string
  readonly nodeType?: string
  readonly attempt?: number

  /**
   * 创建节点级执行错误。
   * @param input 节点定位信息与业务错误。
   */
  constructor(input: {
    code: string
    message: string
    nodeId?: string
    nodeType?: string
    attempt?: number
    retryable?: boolean
    details?: Record<string, unknown>
  }) {
    super({
      code: input.code,
      message: input.message,
      status: 422,
      retryable: input.retryable,
      details: input.details,
    })
    this.name = 'NodeExecutionError'
    this.nodeId = input.nodeId
    this.nodeType = input.nodeType
    this.attempt = input.attempt
  }
}

/**
 * 将未知异常归一化成稳定的运行错误 DTO。
 * @param error 原始异常。
 * @param nodeId 可选节点 ID。
 * @returns 可写入 runs.error 或 node_runs.error 的结构。
 */
export function toRunError(error: unknown, nodeId?: string): RunError {
  if (error instanceof NodeExecutionError || error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      nodeId: error instanceof NodeExecutionError ? error.nodeId ?? nodeId : nodeId,
      retryable: error.retryable,
      details: error.details,
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    nodeId,
    retryable: false,
  }
}

/**
 * 判断异常是否声明为可重试。
 * @param error 原始异常。
 * @returns 是否可重试。
 */
export function isRetryableError(error: unknown) {
  return error instanceof AppError && error.retryable
}
