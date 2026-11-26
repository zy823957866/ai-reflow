import { AppError, type FileRef } from '@ai-reflow/core'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ServerResponse } from 'node:http'

export interface MultipartFile {
  originalname: string
  mimetype: string
  buffer?: Buffer
}

export interface MultipartFileInput {
  name: string
  mime: string
  buffer: Buffer
}

/**
 * 将 Multer 文件转换为校验器输入。
 */
export function multipartFileInput(file?: MultipartFile): MultipartFileInput {
  if (!file?.buffer) {
    throw new AppError({
      code: 'FILE_REQUIRED',
      message: '请选择一个文件后上传。',
      status: 400,
    })
  }
  return {
    name: file.originalname,
    mime: file.mimetype,
    buffer: file.buffer,
  }
}

function asciiFallback(name: string) {
  return name.replace(/[^\x20-\x7e]|["\\]/g, '_')
}

function encodeRfc5987(name: string) {
  return encodeURIComponent(name).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * 生成禁止浏览器内联执行的文件下载头。
 */
export function attachmentHeaders(
  file: Pick<FileRef, 'name' | 'mime' | 'size'>,
): Record<string, string> {
  return {
    'Content-Type': file.mime,
    'Content-Length': String(file.size),
    'Content-Disposition':
      `attachment; filename="${asciiFallback(file.name)}"; `
      + `filename*=UTF-8''${encodeRfc5987(file.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': 'sandbox',
  }
}

/**
 * 从对象存储流式写出附件响应。
 */
export async function streamAttachment(
  response: ServerResponse,
  file: Pick<FileRef, 'name' | 'mime' | 'size'>,
  body: Readable,
) {
  response.writeHead(200, attachmentHeaders(file))
  await pipeline(body, response)
}
