export interface KnowledgeChunkSettings {
  chunkSize: number
  overlapSize: number
  separator: string
}

export const DEFAULT_KNOWLEDGE_CHUNK_SETTINGS: KnowledgeChunkSettings = {
  chunkSize: 800,
  overlapSize: 120,
  separator: '\\n\\n',
}

/**
 * 归一化知识库切片设置，保证重叠长度始终小于切片大小。
 *
 * @param input API 或数据库 metadata 中的原始设置。
 * @returns 可直接执行的切片参数。
 */
export function normalizeKnowledgeChunkSettings(
  input: unknown,
): KnowledgeChunkSettings {
  const value =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {}
  const chunkSize = clampInteger(
    value.chunkSize,
    40,
    4000,
    DEFAULT_KNOWLEDGE_CHUNK_SETTINGS.chunkSize,
  )
  const overlapSize = clampInteger(
    value.overlapSize ?? value.overlap,
    0,
    chunkSize - 1,
    Math.min(DEFAULT_KNOWLEDGE_CHUNK_SETTINGS.overlapSize, chunkSize - 1),
  )
  const separator =
    typeof value.separator === 'string' && value.separator.trim()
      ? value.separator.slice(0, 64)
      : DEFAULT_KNOWLEDGE_CHUNK_SETTINGS.separator

  return {
    chunkSize,
    overlapSize,
    separator,
  }
}

/**
 * 生成文档列表展示的切片策略摘要。
 *
 * @param settings 归一化后的切片设置。
 * @returns 便于扫描的摘要文本。
 */
export function knowledgeChunkStrategyLabel(
  settings: KnowledgeChunkSettings,
) {
  return `structured · ${settings.chunkSize}/${settings.overlapSize}`
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)))
}
