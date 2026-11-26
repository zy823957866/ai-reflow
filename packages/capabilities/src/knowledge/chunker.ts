import {
  KnowledgeIngestError,
  type ParsedKnowledgeBlock,
  type ParsedKnowledgeDocument,
} from './parser'

export interface KnowledgeChunk {
  content: string
  tokenCount: number
  metadata: Record<string, unknown>
}

export interface ChunkOptions {
  chunkSize?: number
  overlap?: number
  maxChunks?: number
}

/**
 * 估算 token 数；P0 使用稳定的字符近似，避免引入模型特定 tokenizer。
 * @param text 文本。
 * @returns 估算 token 数。
 */
export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * 将结构块组合为带重叠和定位元数据的 chunk。
 * @param document 已解析文档。
 * @param options 目标大小、重叠和数量上限。
 * @returns 可直接持久化的 chunk 列表。
 */
export function chunkParsedDocument(
  document: ParsedKnowledgeDocument,
  options: ChunkOptions = {},
): KnowledgeChunk[] {
  const chunkSize = Math.max(40, options.chunkSize ?? 800)
  const overlap = Math.max(0, Math.min(options.overlap ?? 120, chunkSize - 1))
  const maxChunks = Math.max(1, options.maxChunks ?? 5000)
  const blocks = document.blocks.length
    ? document.blocks
    : document.text
      ? [{
          text: document.text,
          kind: 'paragraph' as const,
          metadata: {},
        }]
      : []
  const chunks: KnowledgeChunk[] = []
  let current = ''
  let currentMetadata: Record<string, unknown> = {}
  let previousChunk = ''

  const push = () => {
    const content = current.trim()
    current = ''
    if (!content) return
    chunks.push({
      content,
      tokenCount: estimateTokenCount(content),
      metadata: {
        format: document.format,
        ...currentMetadata,
        charStart: 0,
        charEnd: content.length,
      },
    })
    previousChunk = content
  }

  for (const block of blocks) {
    const metadata = blockMetadata(block, document.format)
    if (block.atomic || block.kind === 'code' || block.kind === 'page') {
      push()
      current = block.text
      currentMetadata = metadata
      push()
      continue
    }
    const segments = splitBlock(block.text, chunkSize)
    for (const segment of segments) {
      const prefix =
        !current && previousChunk && overlap > 0
          ? tail(previousChunk, overlap)
          : ''
      const candidate = [current, segment].filter(Boolean).join('\n\n')
      if (current && candidate.length > chunkSize) {
        push()
        current = [tail(previousChunk, overlap), segment]
          .filter(Boolean)
          .join('\n\n')
        currentMetadata = metadata
      } else {
        current = [prefix, current, segment]
          .filter(Boolean)
          .join(current ? '\n\n' : '')
        currentMetadata = metadata
      }
      if (current.length >= chunkSize) push()
    }
  }
  push()

  if (chunks.length > maxChunks) {
    throw new KnowledgeIngestError({
      code: 'KNOWLEDGE_CHUNK_LIMIT_EXCEEDED',
      message: `切片数量 ${chunks.length} 超过单文档上限 ${maxChunks}。`,
      stage: 'chunk',
    })
  }
  return chunks
}

function blockMetadata(
  block: ParsedKnowledgeBlock,
  format: ParsedKnowledgeDocument['format'],
) {
  return {
    format,
    ...(block.kind ? { kind: block.kind } : {}),
    ...(block.metadata ?? {}),
  }
}

function splitBlock(text: string, size: number) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
  const segments: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      segments.push(paragraph)
      continue
    }
    const sentences = paragraph
      .split(/(?<=[。！？.!?])\s+/)
      .filter(Boolean)
    let current = ''
    for (const sentence of sentences.length ? sentences : [paragraph]) {
      if (sentence.length > size) {
        if (current) {
          segments.push(current)
          current = ''
        }
        segments.push(...splitHard(sentence, size))
        continue
      }
      if (current && current.length + sentence.length + 1 > size) {
        segments.push(current)
        current = sentence
      } else {
        current = [current, sentence].filter(Boolean).join(' ')
      }
    }
    if (current) segments.push(current)
  }
  return segments
}

function splitHard(text: string, size: number) {
  const parts: string[] = []
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size))
  }
  return parts
}

function tail(text: string, length: number) {
  return text.slice(Math.max(0, text.length - length))
}
