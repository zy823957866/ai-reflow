import { randomBytes } from 'node:crypto'
import type { TransactionSql } from 'postgres'
import { AppError, type WorkflowDefinition } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'

export type Transaction = TransactionSql<Record<string, never>>

/**
 * 生成可读、不可猜测的外部资源 ID。
 * @param prefix `wf`、`ver`、`run` 等资源前缀。
 * @returns 带前缀的随机 ID。
 */
export function publicId(prefix: string) {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

/**
 * 生成工作流内部 slug，并保证只包含 URL 安全字符。
 * @param name 工作流名称。
 * @returns 稳定的 slug 候选值。
 */
export function slugify(name: string) {
  const ascii = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || `workflow-${randomBytes(4).toString('hex')}`
}

/**
 * 将任意 JSON 值安全转换为 PostgreSQL jsonb 参数。
 * @param sql 当前数据库连接或事务。
 * @param value 待存储值。
 * @returns postgres.js 参数片段。
 */
export function jsonb(
  sql: DatabaseClient | Transaction,
  value: unknown,
) {
  return sql`${JSON.stringify(value)}::jsonb`
}

/**
 * 将内部 ID 映射为 404 应用错误，避免跨 workspace 暴露资源存在性。
 * @param resource 资源名称。
 * @returns 统一 404 异常。
 */
export function notFound(resource: string) {
  return new AppError({
    code: 'NOT_FOUND',
    message: `${resource}不存在。`,
    status: 404,
  })
}

/**
 * 创建包含单个开始与输出节点的空白工作流定义。
 * @param name 工作流名称。
 * @returns 可立即在画布中编辑的合法定义。
 */
export function blankDefinition(name: string): WorkflowDefinition {
  return {
    schemaVersion: '1.0',
    name,
    nodes: [
      {
        id: 'n_start',
        type: 'start',
        title: '开始',
        x: 80,
        y: 220,
        manifestVersion: '1.0.0',
        config: {
          entryMode: 'manual',
          inputSchema: { type: 'object', properties: {} },
        },
      },
      {
        id: 'n_output',
        type: 'output',
        title: '输出',
        x: 500,
        y: 220,
        manifestVersion: '1.0.0',
        config: {
          mode: 'workflow_output',
          content: '{{ $node.n_start.output.input }}',
        },
      },
    ],
    edges: [
      {
        id: 'e_start_output',
        source: 'n_start',
        target: 'n_output',
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'default',
      },
    ],
  }
}

/**
 * 将数据库中的 JSONB 文本或对象安全读取为对象。
 * @param value 数据库返回值。
 * @returns 对象值；非对象时返回空对象。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
