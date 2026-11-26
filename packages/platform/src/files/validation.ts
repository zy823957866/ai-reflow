import { createHash } from 'node:crypto'
import { AppError } from '@ai-reflow/core'
import { fileTypeFromBuffer, type FileTypeResult } from 'file-type'

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export type UploadScope = 'attachment' | 'knowledge-base'

export interface NormalizedUploadFile {
  name: string
  mime: string
  extension: string
  size: number
  sha256: string
  buffer: Buffer
}

interface FileTypeDefinition {
  mime: string
  clientMimes: readonly string[]
  detectedMimes?: readonly string[]
  detectedExtensions?: readonly string[]
  text: boolean
  signature: (buffer: Buffer) => boolean
}

const magic = {
  pdf: Buffer.from('%PDF-'),
  ole: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  webpRiff: Buffer.from('RIFF'),
  webpMarker: Buffer.from('WEBP'),
}

function startsWith(buffer: Buffer, prefix: Buffer) {
  return buffer.length >= prefix.length
    && buffer.subarray(0, prefix.length).equals(prefix)
}

function looksLikeZip(buffer: Buffer) {
  if (buffer.length < 4) return false
  return buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (
      (buffer[2] === 0x03 && buffer[3] === 0x04)
      || (buffer[2] === 0x05 && buffer[3] === 0x06)
      || (buffer[2] === 0x07 && buffer[3] === 0x08)
    )
}

function looksLikeWebp(buffer: Buffer) {
  return buffer.length >= 12
    && startsWith(buffer, magic.webpRiff)
    && buffer.subarray(8, 12).equals(magic.webpMarker)
}

function isUtf8Text(buffer: Buffer) {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

function alwaysText() {
  return true
}

const definitions: Record<string, FileTypeDefinition> = {
  pdf: {
    mime: 'application/pdf',
    clientMimes: ['application/pdf'],
    detectedMimes: ['application/pdf'],
    detectedExtensions: ['pdf'],
    text: false,
    signature: (buffer) => startsWith(buffer, magic.pdf),
  },
  doc: {
    mime: 'application/msword',
    clientMimes: ['application/msword'],
    detectedMimes: ['application/x-cfb', 'application/msword'],
    detectedExtensions: ['cfb', 'doc'],
    text: false,
    signature: (buffer) => startsWith(buffer, magic.ole),
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    clientMimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    detectedMimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
    ],
    detectedExtensions: ['docx', 'zip'],
    text: false,
    signature: looksLikeZip,
  },
  xls: {
    mime: 'application/vnd.ms-excel',
    clientMimes: ['application/vnd.ms-excel'],
    detectedMimes: ['application/x-cfb', 'application/vnd.ms-excel'],
    detectedExtensions: ['cfb', 'xls'],
    text: false,
    signature: (buffer) => startsWith(buffer, magic.ole),
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    clientMimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    detectedMimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ],
    detectedExtensions: ['xlsx', 'zip'],
    text: false,
    signature: looksLikeZip,
  },
  csv: {
    mime: 'text/csv',
    clientMimes: ['text/csv', 'application/csv', 'text/plain'],
    text: true,
    signature: alwaysText,
  },
  md: {
    mime: 'text/markdown',
    clientMimes: ['text/markdown', 'text/x-markdown', 'text/plain'],
    text: true,
    signature: alwaysText,
  },
  txt: {
    mime: 'text/plain',
    clientMimes: ['text/plain'],
    text: true,
    signature: alwaysText,
  },
  html: {
    mime: 'text/html',
    clientMimes: ['text/html', 'application/xhtml+xml'],
    detectedMimes: ['text/html', 'application/xhtml+xml', 'application/xml'],
    detectedExtensions: ['html', 'htm', 'xml'],
    text: true,
    signature: alwaysText,
  },
  htm: {
    mime: 'text/html',
    clientMimes: ['text/html', 'application/xhtml+xml'],
    detectedMimes: ['text/html', 'application/xhtml+xml', 'application/xml'],
    detectedExtensions: ['html', 'htm', 'xml'],
    text: true,
    signature: alwaysText,
  },
  png: {
    mime: 'image/png',
    clientMimes: ['image/png'],
    detectedMimes: ['image/png'],
    detectedExtensions: ['png'],
    text: false,
    signature: (buffer) => startsWith(buffer, magic.png),
  },
  jpg: {
    mime: 'image/jpeg',
    clientMimes: ['image/jpeg'],
    detectedMimes: ['image/jpeg'],
    detectedExtensions: ['jpg', 'jpeg'],
    text: false,
    signature: (buffer) => startsWith(buffer, magic.jpeg),
  },
  jpeg: {
    mime: 'image/jpeg',
    clientMimes: ['image/jpeg'],
    detectedMimes: ['image/jpeg'],
    detectedExtensions: ['jpg', 'jpeg'],
    text: false,
    signature: (buffer) => startsWith(buffer, magic.jpeg),
  },
  webp: {
    mime: 'image/webp',
    clientMimes: ['image/webp'],
    detectedMimes: ['image/webp'],
    detectedExtensions: ['webp'],
    text: false,
    signature: looksLikeWebp,
  },
}

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp'])

function invalidType(message: string): never {
  throw new AppError({
    code: 'FILE_TYPE_NOT_ALLOWED',
    message,
    status: 415,
  })
}

function invalidName(message = '文件名不合法。'): never {
  throw new AppError({
    code: 'FILE_NAME_INVALID',
    message,
    status: 400,
  })
}

function normalizeFileName(value: string) {
  if (!value || value.length > 1024) invalidName()
  const basename = value.split(/[\\/]/).at(-1) ?? ''
  const normalized = basename
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
  if (!normalized || normalized === '.' || normalized === '..') invalidName()
  if (normalized.length > 255) invalidName('文件名过长。')
  return normalized
}

function extensionOf(name: string) {
  const separator = name.lastIndexOf('.')
  if (separator <= 0 || separator === name.length - 1) return ''
  return name.slice(separator + 1).toLowerCase()
}

function clientMimeOf(value: string) {
  return value.trim().toLowerCase().split(';', 1)[0]?.trim() ?? ''
}

function detectedTypeMatches(
  detected: FileTypeResult,
  definition: FileTypeDefinition,
) {
  if (definition.text && detected.mime.startsWith('text/')) return true
  return Boolean(
    definition.detectedMimes?.includes(detected.mime)
    || definition.detectedExtensions?.includes(detected.ext),
  )
}

/**
 * 校验上传文件名、MIME、大小和内容签名，并生成不可变的元数据。
 */
export async function validateUploadFile(
  input: { name: string; mime: string; buffer: Buffer },
  scope: UploadScope,
): Promise<NormalizedUploadFile> {
  if (input.buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new AppError({
      code: 'FILE_TOO_LARGE',
      message: '文件大小超过 50 MiB 上限。',
      status: 413,
    })
  }

  const name = normalizeFileName(input.name)
  const extension = extensionOf(name)
  const definition = definitions[extension]
  if (!definition) {
    invalidType('不支持该文件类型。')
  }
  if (scope === 'knowledge-base' && imageExtensions.has(extension)) {
    invalidType('知识库不接受图片文件。')
  }

  const clientMime = clientMimeOf(input.mime)
  if (!definition.clientMimes.includes(clientMime)) {
    invalidType('文件 MIME 类型与扩展名不匹配。')
  }

  if (definition.text) {
    if (!isUtf8Text(input.buffer)) invalidType('文本文件包含无效编码或二进制内容。')
  } else if (!definition.signature(input.buffer)) {
    invalidType('文件内容签名与扩展名不匹配。')
  }

  let detected: FileTypeResult | undefined
  try {
    detected = await fileTypeFromBuffer(input.buffer)
  } catch {
    invalidType('无法识别文件内容。')
  }
  if (detected && !detectedTypeMatches(detected, definition)) {
    invalidType('文件内容签名与扩展名不匹配。')
  }

  return {
    name,
    mime: definition.mime,
    extension,
    size: input.buffer.length,
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
    buffer: input.buffer,
  }
}
