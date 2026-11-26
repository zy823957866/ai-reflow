import { ApiError } from '@/api/client'
import type { FileRef } from '@/shared/types'

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export const ATTACHMENT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.md,.markdown,.txt,.html,.png,.jpg,.jpeg,.webp'

export const KNOWLEDGE_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.md,.markdown,.txt,.html'

const ATTACHMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'md',
  'markdown',
  'txt',
  'html',
  'png',
  'jpg',
  'jpeg',
  'webp',
])

const KNOWLEDGE_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'md',
  'markdown',
  'txt',
  'html',
])

/**
 * 读取文件名扩展名。
 *
 * @param name 原文件名。
 * @returns 小写扩展名。
 */
export function fileExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

/**
 * 格式化文件大小。
 *
 * @param bytes 字节数。
 * @returns 适合界面展示的大小。
 */
export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.max(1, bytes)} B`
}

/**
 * 在上传前检查文件类型和大小。
 *
 * @param file 用户选择的文件。
 * @param scope 通用附件或知识库文档。
 * @returns 错误文案；通过时返回 undefined。
 */
export function selectedFileError(
  file: File,
  scope: 'attachment' | 'knowledge' = 'attachment',
) {
  const extension = fileExtension(file.name)
  const extensions = scope === 'knowledge' ? KNOWLEDGE_EXTENSIONS : ATTACHMENT_EXTENSIONS
  if (!extension || !extensions.has(extension)) {
    return `${file.name} 不是支持的${scope === 'knowledge' ? '文档' : '附件'}格式。`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} 超过 50 MB 单文件限制。`
  }
  return undefined
}

/**
 * 判断对象是否符合 FileRef 公共契约。
 *
 * @param value 待检查值。
 * @returns 是否为有效 FileRef。
 */
export function isFileRef(value: unknown): value is FileRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string'
    && Boolean(record.id.trim())
    && typeof record.name === 'string'
    && Boolean(record.name.trim())
    && typeof record.mime === 'string'
    && Boolean(record.mime.trim())
    && typeof record.size === 'number'
    && Number.isInteger(record.size)
    && record.size >= 0
  )
}

/**
 * 将上传异常转换为面向用户的中文提示。
 *
 * @param error 上传异常。
 * @returns 可展示错误文案。
 */
export function uploadErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      FILE_TOO_LARGE: '文件超过 50 MB 单文件限制。',
      FILE_TYPE_NOT_ALLOWED: '文件类型不支持。',
      FILE_NAME_INVALID: '文件名不符合要求。',
      OBJECT_STORAGE_NOT_CONFIGURED: '对象存储尚未配置，暂时不能上传文件。',
      OBJECT_STORAGE_ERROR: '对象存储写入失败，请稍后重试。',
      NETWORK_ERROR: '无法连接上传服务，请检查网络后重试。',
    }
    return messages[error.code] ?? `${error.code}：${error.message}`
  }
  return error instanceof Error ? error.message : '上传失败，请稍后重试。'
}
