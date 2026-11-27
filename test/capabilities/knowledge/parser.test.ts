import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Document,
  Packer,
  Paragraph,
} from 'docx'
import {
  PDFDocument,
  StandardFonts,
} from 'pdf-lib'
import * as XLSX from 'xlsx'
import {
  KnowledgeIngestError,
  parseKnowledgeDocument,
} from '../../../packages/capabilities/src/knowledge/parser'

test('plain text decode failures expose a stable parse error', async () => {
  await assert.rejects(
    parseKnowledgeDocument({
      filename: 'broken.txt',
      bytes: Buffer.from([0xc3, 0x28]),
    }),
    (error: unknown) =>
      error instanceof KnowledgeIngestError &&
      error.code === 'KNOWLEDGE_TEXT_DECODE_FAILED' &&
      error.stage === 'parse' &&
      error.retryable === false,
  )
})

test('markdown keeps headings and fenced code blocks intact', async () => {
  const parsed = await parseKnowledgeDocument({
    filename: 'guide.md',
    bytes: Buffer.from([
      '# 退款规则',
      '',
      '超过七天不支持无理由退款。',
      '',
      '```ts',
      'const days = 7',
      '```',
    ].join('\n')),
  })

  assert.equal(parsed.format, 'markdown')
  assert.ok(parsed.blocks.some((block) => block.kind === 'heading'))
  const code = parsed.blocks.find((block) => block.kind === 'code')
  assert.equal(code?.atomic, true)
  assert.match(code?.text ?? '', /const days = 7/)
})

test('html extracts readable content without scripts', async () => {
  const parsed = await parseKnowledgeDocument({
    filename: 'policy.html',
    bytes: Buffer.from(
      '<html><head><script>alert(1)</script></head>' +
      '<body><h1>售后政策</h1><p>签收后 7 天内可申请。</p></body></html>',
    ),
  })

  assert.match(parsed.text, /售后政策/)
  assert.match(parsed.text, /签收后 7 天内可申请/)
  assert.doesNotMatch(parsed.text, /alert/)
})

test('csv records row ranges for citations', async () => {
  const parsed = await parseKnowledgeDocument({
    filename: 'orders.csv',
    bytes: Buffer.from('order,amount\nA-1,10\nA-2,20\n'),
  })

  const block = parsed.blocks[0]
  assert.equal(parsed.format, 'csv')
  assert.equal(block.metadata?.sheet, 'CSV')
  assert.equal(block.metadata?.rowStart, 1)
  assert.equal(block.metadata?.rowEnd, 3)
})

test('xlsx records sheet and row ranges', async () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['商品', '库存'],
      ['键盘', 12],
      ['鼠标', 8],
    ]),
    '库存',
  )
  const bytes = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'buffer',
  }) as Buffer

  const parsed = await parseKnowledgeDocument({
    filename: 'inventory.xlsx',
    bytes,
  })

  assert.equal(parsed.format, 'xlsx')
  assert.equal(parsed.blocks[0].metadata?.sheet, '库存')
  assert.equal(parsed.blocks[0].metadata?.rowStart, 1)
})

test('pdf pages preserve page metadata', async () => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage()
  first.drawText('Refund policy page one', { x: 40, y: 700, font })
  const second = pdf.addPage()
  second.drawText('Shipping policy page two', { x: 40, y: 700, font })
  const bytes = Buffer.from(await pdf.save())

  const parsed = await parseKnowledgeDocument({
    filename: 'policies.pdf',
    bytes,
  })

  assert.equal(parsed.format, 'pdf')
  assert.deepEqual(
    parsed.blocks
      .filter((block) => block.kind === 'page')
      .map((block) => block.metadata?.page),
    [1, 2],
  )
})

test('pdf without extracted text reports scanned or empty input', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage()
  const bytes = Buffer.from(await pdf.save())

  await assert.rejects(
    parseKnowledgeDocument({
      filename: 'scan.pdf',
      bytes,
    }),
    (error: unknown) =>
      error instanceof KnowledgeIngestError &&
      error.code === 'KNOWLEDGE_PDF_NO_TEXT' &&
      error.stage === 'parse' &&
      error.retryable === false,
  )
})

test('docx extracts paragraphs', async () => {
  const bytes = await Packer.toBuffer(
    new Document({
      sections: [{
        children: [
          new Paragraph('退款需要保留原包装。'),
          new Paragraph('审核通过后原路退回。'),
        ],
      }],
    }),
  )

  const parsed = await parseKnowledgeDocument({
    filename: 'refund.docx',
    bytes,
  })

  assert.equal(parsed.format, 'docx')
  assert.match(parsed.text, /退款需要保留原包装/)
})

test('legacy office files and malformed pdfs fail with stable codes', async () => {
  await assert.rejects(
    parseKnowledgeDocument({
      filename: 'legacy.doc',
      bytes: Buffer.from('legacy'),
    }),
    (error: unknown) =>
      error instanceof KnowledgeIngestError &&
      error.code === 'KNOWLEDGE_LEGACY_OFFICE_UNSUPPORTED',
  )
  await assert.rejects(
    parseKnowledgeDocument({
      filename: 'broken.pdf',
      bytes: Buffer.from('not-a-pdf'),
    }),
    (error: unknown) =>
      error instanceof KnowledgeIngestError &&
      error.code === 'KNOWLEDGE_PDF_INVALID',
  )
})

test('empty extracted content is rejected', async () => {
  await assert.rejects(
    parseKnowledgeDocument({
      filename: 'empty.html',
      bytes: Buffer.from('<html><body>   </body></html>'),
    }),
    (error: unknown) =>
      error instanceof KnowledgeIngestError &&
      error.code === 'KNOWLEDGE_PARSE_EMPTY',
  )
})
