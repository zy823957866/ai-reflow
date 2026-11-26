import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import { attachmentHeaders, multipartFileInput } from './http'

test('forces active HTML downloads to use attachment and nosniff', () => {
  const headers = attachmentHeaders({
    name: 'policy.html',
    mime: 'text/html',
    size: 128,
  })

  assert.equal(headers['Content-Type'], 'text/html')
  assert.equal(headers['Content-Length'], '128')
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['Cache-Control'], 'private, no-store')
  assert.match(headers['Content-Disposition'], /^attachment;/)
  assert.match(headers['Content-Disposition'], /filename\*=UTF-8''policy\.html/)
})

test('encodes Unicode filenames with an ASCII-safe disposition fallback', () => {
  const headers = attachmentHeaders({
    name: '季度 报告.pdf',
    mime: 'application/pdf',
    size: 42,
  })

  assert.match(headers['Content-Disposition'], /filename="__ __.pdf"/)
  assert.match(
    headers['Content-Disposition'],
    /filename\*=UTF-8''%E5%AD%A3%E5%BA%A6%20%E6%8A%A5%E5%91%8A\.pdf/,
  )
})

test('rejects an upload request without the file field', () => {
  assert.throws(
    () => multipartFileInput(undefined),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'FILE_REQUIRED')
      assert.equal(error.status, 400)
      return true
    },
  )
})

test('restores UTF-8 filenames decoded as latin1 by multipart parsing', () => {
  const original = '集成附件-季度报告.pdf'
  const input = multipartFileInput({
    originalname: Buffer.from(original, 'utf8').toString('latin1'),
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-'),
  })

  assert.equal(input.name, original)
})

test('keeps already decoded Unicode and ASCII filenames unchanged', () => {
  const unicode = multipartFileInput({
    originalname: '季度报告.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-'),
  })
  const ascii = multipartFileInput({
    originalname: 'report.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-'),
  })

  assert.equal(unicode.name, '季度报告.pdf')
  assert.equal(ascii.name, 'report.pdf')
})
