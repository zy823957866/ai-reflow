import { z } from 'zod'

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
