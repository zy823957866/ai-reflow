import { basename } from 'node:path'
import { load } from 'cheerio'
import { parse as parseCsv } from 'csv-parse/sync'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

export type KnowledgeFormat =
  | 'txt'
  | 'markdown'
  | 'html'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'xlsx'

export type KnowledgeIngestStage =
  | 'parse'
  | 'normalize'
  | 'chunk'
  | 'embedding'
  | 'index'

export interface ParsedKnowledgeBlockMetadata {
  page?: number
  sheet?: string
  rowStart?: number
  rowEnd?: number
  headingPath?: string[]
  charStart?: number
  charEnd?: number
}

export interface ParsedKnowledgeBlock {
  text: string
  kind?: 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'page'
  atomic?: boolean
  metadata?: ParsedKnowledgeBlockMetadata
}

export interface ParsedKnowledgeDocument {
  text: string
  format: KnowledgeFormat
  blocks: ParsedKnowledgeBlock[]
  metadata: Record<string, unknown>
}

/**
 * 带稳定错误码和流水线阶段的 ingest 异常。
 */
export class KnowledgeIngestError extends Error {
  readonly code: string
  readonly stage: KnowledgeIngestStage
  readonly retryable: boolean

  constructor(input: {
    code: string
    message: string
    stage: KnowledgeIngestStage
    retryable?: boolean
    cause?: unknown
  }) {
    super(input.message)
    this.name = 'KnowledgeIngestError'
    this.code = input.code
    this.stage = input.stage
    this.retryable = input.retryable ?? false
    if (input.cause !== undefined) this.cause = input.cause
  }
}

/**
 * 根据文件扩展名与 MIME 选择 P0 支持的解析器。
 * @param filename 原始文件名。
 * @param mime 可选 MIME。
 * @returns 规范化的文件格式。
 */
export function detectKnowledgeFormat(
  filename: string,
  mime?: string,
): KnowledgeFormat {
  const extension = basename(filename)
    .split('.')
    .at(-1)
    ?.toLowerCase() ?? ''
  if (extension === 'doc' || extension === 'xls') {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_LEGACY_OFFICE_UNSUPPORTED',
      message: '不支持旧版 Office 文件，请转换为 DOCX 或 XLSX。',
      stage: 'parse',
    })
  }
  if (extension === 'txt' || mime === 'text/plain') return 'txt'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'csv') return 'csv'
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  if (extension === 'xlsx') return 'xlsx'
  throw new KnowledgeIngestError({
    code: 'KNOWLEDGE_FILE_TYPE_UNSUPPORTED',
    message: `不支持文件类型 .${extension || 'unknown'}。`,
    stage: 'parse',
  })
}

/**
 * 解析一个知识库源文件为结构感知文本块。
 * @param input 文件名、MIME 与原始字节。
 * @returns 规范化文本和可保留定位信息的块。
 */
export async function parseKnowledgeDocument(input: {
  filename: string
  mime?: string
  bytes: Uint8Array
}): Promise<ParsedKnowledgeDocument> {
  const format = detectKnowledgeFormat(input.filename, input.mime)
  if (!input.bytes.byteLength) {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_PARSE_EMPTY',
      message: '文件内容为空。',
      stage: 'parse',
    })
  }

  let parsed: ParsedKnowledgeDocument
  if (format === 'txt') {
    const text = decodeText(input.bytes)
    parsed = fromText(text, 'txt')
  } else if (format === 'markdown') {
    parsed = parseMarkdown(decodeText(input.bytes))
  } else if (format === 'html') {
    parsed = parseHtml(decodeText(input.bytes), 'html')
  } else if (format === 'csv') {
    parsed = parseCsvDocument(input.bytes)
  } else if (format === 'xlsx') {
    parsed = parseXlsx(input.bytes)
  } else if (format === 'docx') {
    parsed = await parseDocx(input.bytes)
  } else {
    parsed = await parsePdf(input.bytes)
  }

  const text = normalizeText(parsed.text)
  if (!text) {
    if (format === 'pdf') {
      throw new KnowledgeIngestError({
        code: 'KNOWLEDGE_PDF_NO_TEXT',
        message: 'PDF 未提取到文本，可能是扫描件或空文档。',
        stage: 'parse',
      })
    }
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_PARSE_EMPTY',
      message: '文件未提取到可用文本。',
      stage: 'parse',
    })
  }

  return {
    ...parsed,
    text,
    blocks: parsed.blocks
      .map((block) => ({
        ...block,
        text: normalizeText(block.text),
      }))
      .filter((block) => block.text),
  }
}

function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_TEXT_DECODE_FAILED',
      message: '文本文件不是合法的 UTF-8 编码。',
      stage: 'parse',
      cause: error,
    })
  }
}

function fromText(
  text: string,
  format: 'txt' | 'markdown',
): ParsedKnowledgeDocument {
  const normalized = normalizeText(text)
  return {
    text: normalized,
    format,
    blocks: normalized
      ? [{
          text: normalized,
          kind: 'paragraph',
          metadata: {},
        }]
      : [],
    metadata: {},
  }
}

function parseMarkdown(text: string): ParsedKnowledgeDocument {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ParsedKnowledgeBlock[] = []
  const headingPath: string[] = []
  let paragraph: string[] = []
  let codeLines: string[] | null = null
  let fence = ''

  const flushParagraph = () => {
    const content = paragraph.join('\n').trim()
    paragraph = []
    if (!content) return
    blocks.push({
      text: content,
      kind: 'paragraph',
      metadata: { headingPath: [...headingPath] },
    })
  }

  for (const line of lines) {
    if (codeLines) {
      codeLines.push(line)
      if (line.trimStart().startsWith(fence)) {
        blocks.push({
          text: codeLines.join('\n'),
          kind: 'code',
          atomic: true,
          metadata: { headingPath: [...headingPath] },
        })
        codeLines = null
        fence = ''
      }
      continue
    }
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      flushParagraph()
      fence = fenceMatch[1]
      codeLines = [line]
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      headingPath.splice(level - 1)
      headingPath[level - 1] = heading[2].trim()
      blocks.push({
        text: line,
        kind: 'heading',
        metadata: { headingPath: [...headingPath] },
      })
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }
  if (codeLines) {
    blocks.push({
      text: codeLines.join('\n'),
      kind: 'code',
      atomic: true,
      metadata: { headingPath: [...headingPath] },
    })
  }
  flushParagraph()
  return {
    text: normalizeText(text),
    format: 'markdown',
    blocks,
    metadata: {},
  }
}

function parseHtml(
  html: string,
  format: 'html' | 'docx',
): ParsedKnowledgeDocument {
  const $ = load(html)
  $('script,style,noscript,template,svg').remove()
  const blocks: ParsedKnowledgeBlock[] = []
  const headingPath: string[] = []
  $('body').find('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,table')
    .each((_index, element) => {
      if ($(element).parents('pre,table').length) return
      const tag = element.tagName.toLowerCase()
      if (tag === 'li' && $(element).parents('li').length) return
      if (tag === 'p' && $(element).parents('li,blockquote').length) return
      const content = cleanInlineText($(element).text())
      if (!content) return
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1))
        headingPath.splice(level - 1)
        headingPath[level - 1] = content
        blocks.push({
          text: `${'#'.repeat(level)} ${content}`,
          kind: 'heading',
          metadata: { headingPath: [...headingPath] },
        })
        return
      }
      if (tag === 'pre') {
        blocks.push({
          text: `\`\`\`\n${$(element).text().trim()}\n\`\`\``,
          kind: 'code',
          atomic: true,
          metadata: { headingPath: [...headingPath] },
        })
        return
      }
      blocks.push({
        text: tag === 'li' ? `- ${content}` : content,
        kind: tag === 'li' ? 'list' : 'paragraph',
        metadata: { headingPath: [...headingPath] },
      })
    })

  if (!blocks.length) {
    const content = cleanInlineText($('body').text())
    if (content) {
      blocks.push({
        text: content,
        kind: 'paragraph',
        metadata: {},
      })
    }
  }
  return {
    text: blocks.map((block) => block.text).join('\n\n'),
    format,
    blocks,
    metadata: {},
  }
}

function parseCsvDocument(bytes: Uint8Array): ParsedKnowledgeDocument {
  let rows: string[][]
  try {
    rows = parseCsv(decodeText(bytes), {
      bom: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    }) as string[][]
  } catch (error) {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_CSV_INVALID',
      message: 'CSV 文件格式不合法。',
      stage: 'parse',
      cause: error,
    })
  }
  const blocks = tabularBlocks(rows, 'CSV')
  return {
    text: blocks.map((block) => block.text).join('\n\n'),
    format: 'csv',
    blocks,
    metadata: { rows: rows.length },
  }
}

function parseXlsx(bytes: Uint8Array): ParsedKnowledgeDocument {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, {
      type: 'buffer',
      cellDates: false,
    })
  } catch (error) {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_XLSX_INVALID',
      message: 'XLSX 文件格式不合法。',
      stage: 'parse',
      cause: error,
    })
  }
  const blocks: ParsedKnowledgeBlock[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    }).map((row) => row.map((value) => String(value ?? '')))
    blocks.push(...tabularBlocks(rows, sheetName))
  }
  return {
    text: blocks.map((block) => block.text).join('\n\n'),
    format: 'xlsx',
    blocks,
    metadata: { sheets: workbook.SheetNames },
  }
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedKnowledgeDocument> {
  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>
  try {
    result = await mammoth.convertToHtml({
      buffer: Buffer.from(bytes),
    })
  } catch (error) {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_DOCX_INVALID',
      message: 'DOCX 文件损坏或无法解析。',
      stage: 'parse',
      cause: error,
    })
  }
  return parseHtml(result.value, 'docx')
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedKnowledgeDocument> {
  const legacyPdfModule = 'pdfjs-dist/legacy/build/pdf.mjs'
  const pdfjs = (await import(legacyPdfModule)) as typeof import('pdfjs-dist')
  let document: Awaited<
    ReturnType<typeof pdfjs.getDocument>['promise']
  > | undefined
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise
    const blocks: ParsedKnowledgeBlock[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) =>
          'str' in item && typeof item.str === 'string' ? item.str : '',
        )
        .join(' ')
      const normalized = cleanInlineText(text)
      if (!normalized) continue
      blocks.push({
        text: normalized,
        kind: 'page',
        metadata: { page: pageNumber },
      })
      page.cleanup()
    }
    return {
      text: blocks.map((block) => block.text).join('\n\n'),
      format: 'pdf',
      blocks,
      metadata: { pages: document.numPages },
    }
  } catch (error) {
    if (error instanceof KnowledgeIngestError) throw error
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_PDF_INVALID',
      message: 'PDF 文件损坏、加密或无法解析。',
      stage: 'parse',
      cause: error,
    })
  } finally {
    await document?.destroy()
  }
}

function tabularBlocks(
  rows: unknown[][],
  sheet: string,
): ParsedKnowledgeBlock[] {
  const normalized = rows
    .map((row) => row.map((value) => String(value ?? '').trim()))
    .filter((row) => row.some(Boolean))
  const blocks: ParsedKnowledgeBlock[] = []
  let batch: Array<{ rowNumber: number; values: string[] }> = []
  let batchChars = 0

  const flush = () => {
    if (!batch.length) return
    blocks.push({
      text: batch
        .map(({ rowNumber, values }) => `行 ${rowNumber}: ${values.join(' | ')}`)
        .join('\n'),
      kind: 'table',
      metadata: {
        sheet,
        rowStart: batch[0].rowNumber,
        rowEnd: batch.at(-1)!.rowNumber,
      },
    })
    batch = []
    batchChars = 0
  }

  normalized.forEach((values, index) => {
    const line = values.join(' | ')
    if (
      batch.length &&
      (batch.length >= 100 || batchChars + line.length > 4000)
    ) {
      flush()
    }
    batch.push({ rowNumber: index + 1, values })
    batchChars += line.length
  })
  flush()
  return blocks
}

function cleanInlineText(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
