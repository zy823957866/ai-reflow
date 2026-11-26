import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import {
  MAX_FILE_SIZE_BYTES,
  validateUploadFile,
} from './validation'

const pdfBytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
  0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const oleBytes = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  0x00, 0x00, 0x00, 0x00,
])
const zipBytes = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
  0x08, 0x00,
])

async function expectAppError(
  operation: () => Promise<unknown>,
  code: string,
  status?: number,
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, code)
    if (status !== undefined) assert.equal(error.status, status)
    return true
  })
}

test('accepts exactly 50 MiB and computes the canonical metadata', async () => {
  const content = Buffer.alloc(MAX_FILE_SIZE_BYTES, 0x61)
  content.write('%PDF-1.7\n', 0)
  const normalized = await validateUploadFile({
    name: '  quarterly.report.pdf ',
    mime: 'Application/PDF',
    buffer: content,
  }, 'attachment')

  assert.equal(normalized.name, 'quarterly.report.pdf')
  assert.equal(normalized.extension, 'pdf')
  assert.equal(normalized.mime, 'application/pdf')
  assert.equal(normalized.size, MAX_FILE_SIZE_BYTES)
  assert.equal(normalized.buffer, content)
  assert.equal(
    normalized.sha256,
    createHash('sha256').update(content).digest('hex'),
  )
})

test('rejects a file one byte over the 50 MiB limit', async () => {
  const content = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 0x61)
  content.write('%PDF-1.7\n', 0)
  await expectAppError(
    () => validateUploadFile({
      name: 'too-large.pdf',
      mime: 'application/pdf',
      buffer: content,
    }, 'attachment'),
    'FILE_TOO_LARGE',
    413,
  )
})

test('strips client paths and unsafe filename characters', async () => {
  const normalized = await validateUploadFile({
    name: '..\\private\\Q2:summary?.pdf',
    mime: 'application/pdf',
    buffer: pdfBytes,
  }, 'attachment')
  assert.equal(normalized.name, 'Q2_summary_.pdf')
})

test('rejects a filename that has no safe basename', async () => {
  await expectAppError(
    () => validateUploadFile({
      name: '..\\..\\',
      mime: 'text/plain',
      buffer: Buffer.from('safe text'),
    }, 'attachment'),
    'FILE_NAME_INVALID',
    400,
  )
})

test('rejects disallowed extensions before storing the body', async () => {
  await expectAppError(
    () => validateUploadFile({
      name: 'payload.exe',
      mime: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    }, 'attachment'),
    'FILE_TYPE_NOT_ALLOWED',
    415,
  )
})

test('rejects client MIME values that disagree with the extension', async () => {
  await expectAppError(
    () => validateUploadFile({
      name: 'report.pdf',
      mime: 'image/png',
      buffer: pdfBytes,
    }, 'attachment'),
    'FILE_TYPE_NOT_ALLOWED',
    415,
  )
})

test('rejects content signatures that disagree with the extension', async () => {
  await expectAppError(
    () => validateUploadFile({
      name: 'photo.png',
      mime: 'image/png',
      buffer: Buffer.from('this is not a png'),
    }, 'attachment'),
    'FILE_TYPE_NOT_ALLOWED',
    415,
  )
})

test('accepts supported binary and text formats', async () => {
  const cases = [
    ['report.pdf', 'application/pdf', pdfBytes],
    ['legacy.doc', 'application/msword', oleBytes],
    [
      'current.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zipBytes,
    ],
    ['legacy.xls', 'application/vnd.ms-excel', oleBytes],
    [
      'current.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zipBytes,
    ],
    ['table.csv', 'text/csv', Buffer.from('name,value\nalpha,1\n')],
    ['notes.md', 'text/markdown', Buffer.from('# Notes\n')],
    ['notes.markdown', 'text/markdown', Buffer.from('# Notes\n')],
    ['notes.txt', 'text/plain', Buffer.from('plain text\n')],
    ['page.html', 'text/html', Buffer.from('<!doctype html><html></html>')],
    ['pixel.png', 'image/png', pngBytes],
    [
      'photo.jpg',
      'image/jpeg',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    ],
    [
      'photo.webp',
      'image/webp',
      Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
      ]),
    ],
  ] as const

  for (const [name, mime, buffer] of cases) {
    const normalized = await validateUploadFile({ name, mime, buffer }, 'attachment')
    assert.equal(`${normalized.name}|${normalized.mime}`, `${name}|${mime}`)
  }
})

test('excludes images from knowledge-base uploads', async () => {
  await expectAppError(
    () => validateUploadFile({
      name: 'scan.png',
      mime: 'image/png',
      buffer: pngBytes,
    }, 'knowledge-base'),
    'FILE_TYPE_NOT_ALLOWED',
    415,
  )
})
