import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '@ai-reflow/core'

export interface ObjectStorage {
  put(input: {
    key: string
    bytes: Uint8Array
    contentType: string
  }): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

/**
 * 开发环境本地对象存储。对象 key 只能落在配置根目录内。
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async put(input: {
    key: string
    bytes: Uint8Array
    contentType: string
  }) {
    const target = this.resolveKey(input.key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, input.bytes)
  }

  async get(key: string) {
    return readFile(this.resolveKey(key))
  }

  async delete(key: string) {
    await rm(this.resolveKey(key), { force: true })
  }

  private resolveKey(key: string) {
    const segments = key.replaceAll('\\', '/').split('/')
    if (
      !key ||
      key.startsWith('/') ||
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    ) {
      throw new AppError({
        code: 'OBJECT_STORAGE_KEY_INVALID',
        message: '对象存储 key 不合法。',
        status: 422,
      })
    }
    const target = resolve(this.root, ...segments)
    if (
      target !== this.root &&
      !target.startsWith(`${this.root}${sep}`)
    ) {
      throw new AppError({
        code: 'OBJECT_STORAGE_KEY_INVALID',
        message: '对象存储 key 超出允许目录。',
        status: 422,
      })
    }
    return target
  }
}

export function createObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
) {
  return new LocalObjectStorage(defaultObjectStoragePath(env))
}

/**
 * 返回与进程工作目录无关的默认对象存储目录。
 * @param env 可覆盖目录的环境变量。
 * @returns 绝对存储根目录。
 */
export function defaultObjectStoragePath(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.OBJECT_STORAGE_PATH) {
    return resolve(env.OBJECT_STORAGE_PATH)
  }
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  return resolve(
    moduleDirectory,
    '../../../..',
    '.data',
    'object-storage',
  )
}
