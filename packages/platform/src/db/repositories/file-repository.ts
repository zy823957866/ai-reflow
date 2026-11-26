import { AppError, type FileRef } from '@ai-reflow/core'
import type { Readable } from 'node:stream'
import type { DatabaseClient } from '../client'
import type { ObjectStorage } from '../../storage'
import { validateUploadFile } from '../../files/validation'
import { publicId } from './helpers'

interface FileAssetRow {
  id: string
  public_id: string
  name: string
  mime: string
  size_bytes: number | string
  sha256: string
  storage_key: string
}

export interface FileContent {
  file: FileRef
  object: {
    body: Readable
    contentType?: string
    contentLength?: number
  }
}

function fileNotFound(): never {
  throw new AppError({
    code: 'FILE_NOT_FOUND',
    message: '附件不存在或无权访问。',
    status: 404,
  })
}

function storageUnavailable(): never {
  throw new AppError({
    code: 'OBJECT_STORAGE_NOT_CONFIGURED',
    message: 'MinIO/S3 对象存储尚未配置。',
    status: 503,
    retryable: true,
  })
}

function toFileRef(row: FileAssetRow): FileRef {
  return {
    id: row.public_id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size_bytes),
    sha256: row.sha256,
  }
}

/**
 * 管理当前 workspace 的通用附件元数据和对象存储正文。
 */
export class FileRepository {
  /**
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   * @param storage 可选对象存储适配器。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
    private readonly storage?: ObjectStorage,
  ) {}

  /**
   * 校验、写入对象并保存通用附件元数据。
   */
  async upload(file: {
    name: string
    mime: string
    buffer: Buffer
  }): Promise<FileRef> {
    if (!this.storage) storageUnavailable()
    const normalized = await validateUploadFile(file, 'attachment')
    const id = publicId('file')
    const storageKey = `workspace/${this.workspaceId}/files/${id}.${normalized.extension}`

    let objectWritten = false
    try {
      await this.storage.putObject({
        key: storageKey,
        body: normalized.buffer,
        contentType: normalized.mime,
      })
      objectWritten = true
      await this.sql`
        insert into file_assets (
          public_id, workspace_id, storage_key, name, mime, extension,
          size_bytes, sha256, metadata
        )
        values (
          ${id}, ${this.workspaceId}, ${storageKey}, ${normalized.name},
          ${normalized.mime}, ${normalized.extension}, ${normalized.size},
          ${normalized.sha256}, ${'{}'}::jsonb
        )
      `
    } catch (error) {
      if (objectWritten) {
        await this.storage.deleteObject(storageKey).catch(() => undefined)
      }
      throw error
    }

    return {
      id,
      name: normalized.name,
      mime: normalized.mime,
      size: normalized.size,
      sha256: normalized.sha256,
    }
  }

  /**
   * 读取当前 workspace 附件正文。
   */
  async content(id: string): Promise<FileContent> {
    if (!this.storage) storageUnavailable()
    const [row] = await this.sql<FileAssetRow[]>`
      select
        id, public_id, name, mime, size_bytes, sha256, storage_key
      from file_assets
      where workspace_id = ${this.workspaceId}
        and public_id = ${id}
      limit 1
    `
    if (!row) fileNotFound()
    const object = await this.storage.getObject(row.storage_key)
    return {
      file: toFileRef(row),
      object,
    }
  }

  /**
   * 删除附件对象和当前 workspace 的元数据。
   */
  async remove(id: string) {
    if (!this.storage) storageUnavailable()
    const [row] = await this.sql<Pick<FileAssetRow, 'id' | 'storage_key'>[]>`
      select id, storage_key
      from file_assets
      where workspace_id = ${this.workspaceId}
        and public_id = ${id}
      limit 1
    `
    if (!row) fileNotFound()
    await this.storage.deleteObject(row.storage_key)
    await this.sql`
      delete from file_assets
      where workspace_id = ${this.workspaceId}
        and id = ${row.id}
    `
    return { deleted: true as const }
  }
}
