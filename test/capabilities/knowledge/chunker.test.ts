import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkParsedDocument } from '../../../packages/capabilities/src/knowledge/chunker'
import {
  KnowledgeIngestError,
  parseKnowledgeDocument,
} from '../../../packages/capabilities/src/knowledge/parser'

test('markdown fenced code is never split even when larger than the target size', async () => {
  const code = [
    '```python',
    ...Array.from({ length: 20 }, (_, index) => `value_${index} = ${index}`),
    '```',
  ].join('\n')
  const parsed = await parseKnowledgeDocument({
    filename: 'code.md',
    bytes: Buffer.from(`# 示例\n\n${code}`),
  })

  const chunks = chunkParsedDocument(parsed, {
    chunkSize: 60,
    overlap: 10,
  })

  assert.ok(chunks.some((chunk) => chunk.content.includes(code)))
  assert.equal(
    chunks.filter((chunk) => chunk.content === code).length,
    1,
  )
})

test('pdf page metadata survives chunking', async () => {
  const parsed = await parseKnowledgeDocument({
    filename: 'manual.pdf',
    bytes: await createPdfBytes(),
  })

  const chunks = chunkParsedDocument(parsed, {
    chunkSize: 200,
    overlap: 20,
  })

  assert.ok(chunks.length >= 2)
  assert.deepEqual(
    chunks.map((chunk) => chunk.metadata.page),
    [1, 2],
  )
})

test('csv row ranges survive chunking', async () => {
  const parsed = await parseKnowledgeDocument({
    filename: 'rows.csv',
    bytes: Buffer.from('sku,stock\nA,1\nB,2\nC,3\n'),
  })

  const chunks = chunkParsedDocument(parsed, {
    chunkSize: 40,
    overlap: 5,
  })

  assert.ok(chunks.every((chunk) => chunk.metadata.sheet === 'CSV'))
  assert.equal(chunks[0].metadata.rowStart, 1)
})

test('custom separators control chunk boundaries', () => {
  const first = 'a'.repeat(30)
  const second = 'b'.repeat(30)
  const chunks = chunkParsedDocument({
    format: 'txt',
    text: `${first}---${second}`,
    metadata: {},
    blocks: [{
      text: `${first}---${second}`,
      kind: 'paragraph',
      metadata: {},
    }],
  }, {
    chunkSize: 40,
    overlap: 0,
    separator: '---',
  })

  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].content, first)
  assert.equal(chunks[1].content, second)
})

test('chunk count limit fails in the chunk stage', () => {
  assert.throws(
    () =>
      chunkParsedDocument({
        format: 'txt',
        text: 'a'.repeat(1000),
        metadata: {},
        blocks: [{
          text: 'a'.repeat(1000),
          kind: 'paragraph',
          metadata: {},
        }],
      }, {
        chunkSize: 10,
        overlap: 0,
        maxChunks: 2,
      }),
    (error: unknown) =>
      error instanceof KnowledgeIngestError &&
      error.code === 'KNOWLEDGE_CHUNK_LIMIT_EXCEEDED' &&
      error.stage === 'chunk',
  )
})

async function createPdfBytes() {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage()
  first.drawText('Page one contains the return window.', {
    x: 40,
    y: 700,
    font,
  })
  const second = pdf.addPage()
  second.drawText('Page two contains the shipping rules.', {
    x: 40,
    y: 700,
    font,
  })
  return Buffer.from(await pdf.save())
}
