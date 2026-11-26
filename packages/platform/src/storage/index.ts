import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { AppError } from '@ai-reflow/core'
import type { Readable } from 'node:stream'
import type { ObjectStorageConfig } from '../config'

export type { ObjectStorageConfig } from '../config'

export interface ObjectStorageObject {
  body: Readable
  contentType?: string
  contentLength?: number
}

export interface ObjectStorage {
  putObject(input: {
    key: string
    body: Buffer
    contentType: string
    metadata?: Record<string, string>
  }): Promise<void>
  getObject(key: string): Promise<ObjectStorageObject>
  deleteObject(key: string): Promise<void>
}

/**
 * 将 S3 SDK 异常转换为不含内部凭据和对象路径的稳定应用错误。
 * @param error 原始 S3 异常。
 * @returns 从不返回，始终抛出稳定错误。
 */
function storageError(error: unknown): never {
  if (error instanceof AppError) throw error
  throw new AppError({
    code: 'OBJECT_STORAGE_ERROR',
    message: '对象存储操作失败，请稍后重试。',
    status: 502,
    retryable: true,
    details: {
      cause: error instanceof Error ? error.name : 'UnknownError',
    },
  })
}

/**
 * 创建 S3 兼容对象存储适配器。
 * @param config 已校验的完整配置。
 * @returns 对象存储适配器；未配置时返回 undefined。
 */
export function createObjectStorage(
  config?: ObjectStorageConfig,
): ObjectStorage | undefined {
  if (!config) return undefined
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  return {
    async putObject(input) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }))
      } catch (error) {
        storageError(error)
      }
    },
    async getObject(key) {
      try {
        const output = await client.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }))
        if (!output.Body) {
          throw new AppError({
            code: 'FILE_NOT_FOUND',
            message: '文件正文不存在。',
            status: 404,
          })
        }
        return {
          body: output.Body as Readable,
          contentType: output.ContentType,
          contentLength: output.ContentLength,
        }
      } catch (error) {
        storageError(error)
      }
    },
    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }))
      } catch (error) {
        storageError(error)
      }
    },
  }
}

/**
 * 获取已配置对象存储，或在未配置时抛出稳定 503。
 * @param config 可选对象存储配置。
 * @returns 可用对象存储适配器。
 */
export function requireObjectStorage(config?: ObjectStorageConfig): ObjectStorage {
  const storage = createObjectStorage(config)
  if (!storage) {
    throw new AppError({
      code: 'OBJECT_STORAGE_NOT_CONFIGURED',
      message: 'MinIO/S3 对象存储尚未配置。',
      status: 503,
      retryable: true,
    })
  }
  return storage
}
