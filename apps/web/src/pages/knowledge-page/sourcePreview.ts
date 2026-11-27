export type KnowledgeSourcePreviewKind =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'text'
  | 'unsupported'

const previewKinds: Record<string, KnowledgeSourcePreviewKind> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  txt: 'text',
}

const MAX_PREVIEW_ROWS = 2000

/**
 * 根据附件扩展名选择原件预览方式。
 *
 * @param extension 文档扩展名，可带前导点。
 * @returns 原件预览类型。
 */
export function knowledgeSourcePreviewKind(
  extension: string,
): KnowledgeSourcePreviewKind {
  return previewKinds[extension.replace(/^\./, '').toLowerCase()] ?? 'unsupported'
}

/**
 * 解析 CSV 文本用于表格预览，支持引号内的逗号、换行和双引号。
 *
 * @param source CSV 原始文本。
 * @param limit 最大渲染行数。
 * @returns 二维单元格数组。
 */
export function parseCsvPreview(source: string, limit = MAX_PREVIEW_ROWS) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const flushRow = () => {
    row.push(cell)
    rows.push(row)
    row = []
    cell = ''
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      flushRow()
      if (character === '\r' && source[index + 1] === '\n') index += 1
      if (rows.length >= limit) return rows
    } else {
      cell += character
    }
  }

  if (cell || row.length) flushRow()
  return rows.slice(0, limit)
}
