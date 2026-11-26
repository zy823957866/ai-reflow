import { AppError } from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import { iso } from './dto'
import { jsonb, publicId, type Transaction } from './helpers'

export type OperationPlanKind =
  | 'template_clone'
  | 'plugin_install'
  | 'plugin_upgrade'
  | 'plugin_rollback'

interface OperationPlanRow {
  public_id: string
  kind: OperationPlanKind
  payload: Record<string, unknown>
  expires_at: Date | string
  consumed_at: Date | string | null
}

/**
 * 创建一次性的操作计划。
 *
 * @param sql 当前数据库连接。
 * @param workspaceId 当前 workspace 内部 ID。
 * @param kind 计划类型。
 * @param payload 已校验的计划内容。
 * @param ttlMs 有效期，默认五分钟。
 * @returns 计划 ID 与过期时间。
 */
export async function createOperationPlan(
  sql: DatabaseClient,
  workspaceId: string,
  kind: OperationPlanKind,
  payload: Record<string, unknown>,
  ttlMs = 5 * 60 * 1000,
) {
  const planId = publicId('plan')
  const expiresAt = new Date(Date.now() + ttlMs)
  await sql`
    insert into operation_plans (
      public_id, workspace_id, kind, payload, expires_at
    )
    values (
      ${planId}, ${workspaceId}, ${kind}, ${jsonb(sql, payload)}, ${expiresAt.toISOString()}
    )
  `
  return {
    planId,
    expiresAt: iso(expiresAt)!,
  }
}

/**
 * 在事务内锁定并消费一次性计划。
 *
 * 同一 planId 只能成功消费一次；过期、跨 workspace 或类型不匹配均返回稳定错误。
 *
 * @param transaction 当前数据库事务。
 * @param workspaceId 当前 workspace 内部 ID。
 * @param kind 期望计划类型。
 * @param planId 客户端提交的计划 ID。
 * @returns 计划 payload。
 */
export async function consumeOperationPlan(
  transaction: Transaction,
  workspaceId: string,
  kind: OperationPlanKind,
  planId: string,
) {
  const [plan] = await transaction<OperationPlanRow[]>`
    select public_id, kind, payload, expires_at, consumed_at
    from operation_plans
    where workspace_id = ${workspaceId}
      and public_id = ${planId}
    for update
  `
  if (!plan || plan.kind !== kind) {
    throw new AppError({
      code: 'PLAN_NOT_FOUND',
      message: '操作计划不存在或类型不匹配，请重新计算。',
      status: 404,
    })
  }
  if (plan.consumed_at) {
    throw new AppError({
      code: 'PLAN_ALREADY_CONSUMED',
      message: '操作计划已执行，请重新计算。',
      status: 409,
    })
  }
  if (new Date(plan.expires_at).getTime() <= Date.now()) {
    throw new AppError({
      code: 'PLAN_EXPIRED',
      message: '操作计划已过期，请重新计算。',
      status: 409,
    })
  }
  await transaction`
    update operation_plans
    set consumed_at = now()
    where id = (
      select id from operation_plans
      where workspace_id = ${workspaceId} and public_id = ${planId}
    )
  `
  return plan.payload
}
