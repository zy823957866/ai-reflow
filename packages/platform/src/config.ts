import { z } from 'zod'

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().url().optional(),
)

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
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY_ID: optionalText,
  S3_SECRET_ACCESS_KEY: optionalText,
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
}).superRefine((value, context) => {
  const fields = [
    ['S3_BUCKET', value.S3_BUCKET],
    ['S3_ACCESS_KEY_ID', value.S3_ACCESS_KEY_ID],
    ['S3_SECRET_ACCESS_KEY', value.S3_SECRET_ACCESS_KEY],
  ] as const
  const configured = Boolean(value.S3_ENDPOINT)
    || fields.some(([, field]) => Boolean(field))
  if (!configured) return
  for (const [name, field] of fields) {
    if (!field) {
      context.addIssue({
        code: 'custom',
        path: [name],
        message: `对象存储配置不完整：缺少 ${name}。`,
      })
    }
  }
})

export type ServerEnvironment = z.infer<typeof environmentSchema>

export interface ObjectStorageConfig {
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

/**
 * 读取并校验服务启动所需环境变量。
 * @param source 环境变量来源，默认读取当前进程。
 * @returns 通过 Zod 校验的配置。
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  return environmentSchema.parse(source)
}

/**
 * 将可选对象存储环境变量归一成一个完整配置。
 * @param environment 已校验的服务环境。
 * @returns 配置完整时返回对象存储配置，否则返回 undefined。
 */
export function getObjectStorageConfig(
  environment: ServerEnvironment,
): ObjectStorageConfig | undefined {
  if (
    !environment.S3_BUCKET
    || !environment.S3_ACCESS_KEY_ID
    || !environment.S3_SECRET_ACCESS_KEY
  ) {
    return undefined
  }
  return {
    endpoint: environment.S3_ENDPOINT,
    region: environment.S3_REGION,
    bucket: environment.S3_BUCKET,
    accessKeyId: environment.S3_ACCESS_KEY_ID,
    secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE === 'true',
  }
}
