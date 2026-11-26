const activeStatuses = new Set([
  'queued',
  'parsing',
  'chunking',
  'embedding',
])

const stageLabels: Record<string, string> = {
  queued: '排队中',
  parsing: '解析中',
  chunking: '分块中',
  embedding: '向量化中',
  ready: '已索引',
  failed: '索引失败',
}

const stageProgress: Record<string, number> = {
  queued: 8,
  parsing: 30,
  chunking: 60,
  embedding: 85,
  ready: 100,
  failed: 0,
}

const errorStageLabels: Record<string, string> = {
  parse: '解析失败',
  normalize: '规范化失败',
  chunk: '分块失败',
  embedding: '向量化失败',
  index: '索引失败',
}

/**
 * 判断文档是否仍在 ingest 流水线中。
 *
 * @param status 文档或作业状态。
 * @returns 是否需要继续轮询。
 */
export function isActiveIngestStatus(status: string) {
  return activeStatuses.has(status)
}

/**
 * 把 ingest 状态转换为稳定的中文阶段文案。
 *
 * @param status 文档或作业状态。
 * @returns 展示文案。
 */
export function ingestStageLabel(status: string) {
  return stageLabels[status] ?? status
}

/**
 * 将服务端阶段错误转换为失败阶段文案。
 * @param stage ingest 阶段。
 * @returns 可读的错误阶段。
 */
export function ingestErrorStageLabel(stage?: string) {
  return stage ? (errorStageLabels[stage] ?? stage) : ''
}

/**
 * 根据阶段估算进度；优先使用服务端返回的百分比。
 *
 * @param status 文档状态。
 * @param progress 服务端进度。
 * @returns 0 到 100 的进度值。
 */
export function ingestProgress(status: string, progress?: number) {
  if (typeof progress === 'number' && progress > 0) {
    return Math.min(100, Math.max(0, progress))
  }
  return stageProgress[status] ?? 0
}

/**
 * 把检索警告码转换为可读的降级说明。
 *
 * @param warning 服务端警告。
 * @returns 可读说明。
 */
export function retrievalWarningLabel(warning: string) {
  const separator = warning.indexOf(':')
  const code = separator >= 0 ? warning.slice(0, separator) : warning
  const message = separator >= 0 ? warning.slice(separator + 1).trim() : ''
  const labels: Record<string, string> = {
    EMBEDDING_UNAVAILABLE: '向量检索不可用，已降级为全文检索。',
    RERANK_NOT_CONFIGURED: 'Rerank 未配置，已降级为原始排序。',
    CONTEXT_TRUNCATED: '检索上下文已按预算截断。',
  }
  return message && !labels[code] ? message : (labels[code] ?? warning)
}
