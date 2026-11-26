import { z } from 'zod'

export const WORKER_ROLES = ['workflow', 'agent', 'ingest'] as const
export type WorkerRole = (typeof WORKER_ROLES)[number]

/**
 * 解析逗号分隔的 worker 角色，并拒绝未知角色。
 * @param raw WORKER_ROLES 原始值。
 * @returns 去重后的角色列表。
 */
export function parseWorkerRoles(raw: string): WorkerRole[] {
  const roles = raw
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean)
  if (!roles.length) {
    throw new Error('WORKER_ROLES_INVALID: 至少需要启用一个 worker 角色。')
  }
  const allowed = new Set<string>(WORKER_ROLES)
  const invalid = roles.filter((role) => !allowed.has(role))
  if (invalid.length) {
    throw new Error(
      `WORKER_ROLES_INVALID: 未知角色 ${invalid.join(', ')}。`,
    )
  }
  return [...new Set(roles)] as WorkerRole[]
}

const workerRolesSchema = z
  .string()
  .default('workflow,agent,ingest')
  .transform((value, context) => {
    try {
      return parseWorkerRoles(value)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error),
      })
      return z.NEVER
    }
  })

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(8787),
  DEFAULT_WORKSPACE_ID: z.string().uuid(),
  DEFAULT_WORKSPACE_SLUG: z.string().min(1).default('demo'),
  ENCRYPTION_KEY: z.string().min(16),
  WEB_ORIGIN: z.string().default('http://127.0.0.1:5173'),
  QUEUE_MODE: z.enum(['database', 'redis']).default('database'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(350),
  WORKER_ROLES: workerRolesSchema,
  WORKER_WORKFLOW_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  WORKER_AGENT_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  WORKER_INGEST_CONCURRENCY: z.coerce.number().int().min(1).default(2),
})

export type ServerEnvironment = z.infer<typeof environmentSchema>

/**
 * 读取并校验服务启动所需环境变量。
 * @param source 环境变量来源，默认读取当前进程。
 * @returns 通过 Zod 校验的配置。
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  return environmentSchema.parse(source)
}
