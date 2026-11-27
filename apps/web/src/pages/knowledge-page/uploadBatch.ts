import {
  ingestErrorStageLabel,
  ingestProgress,
  ingestStageLabel,
} from './status'
import type { KnowledgeDocument, UploadItem } from './types'

const supportedExtensions = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'md',
  'markdown',
  'txt',
  'html',
])
const maxUploadBytes = 50 * 1024 * 1024

/**
 * 校验知识库附件格式与单文件大小。
 *
 * @param file 文件名和字节数。
 * @returns 校验失败原因；通过时返回 undefined。
 */
export function getUploadValidationError(
  file: Pick<File, 'name' | 'size'>,
) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!supportedExtensions.has(extension)) return '格式不支持'
  if (file.size > maxUploadBytes) return '超过 50 MB'
  return undefined
}

/**
 * 判断一批上传是否都已进入终态。
 *
 * @param items 当前上传批次。
 * @returns 没有处理中项时返回 true。
 */
export function isUploadBatchSettled(items: UploadItem[]) {
  return items.every((item) => item.status !== 'processing')
}

/**
 * 将文档列表中的最新 ingest 状态同步到弹框上传批次。
 *
 * @param items 当前上传批次。
 * @param documents 当前知识库文档。
 * @returns 保留全部附件并更新状态后的批次。
 */
export function syncUploadBatchFromDocuments(
  items: UploadItem[],
  documents: KnowledgeDocument[],
) {
  const byId = new Map(documents.map((document) => [document.id, document]))
  return items.map((item) => {
    const document = byId.get(item.documentId ?? '')
    if (!document) return item
    applyIngestDocument(item, document)
    return item
  })
}

/**
 * 将文档状态投影到上传队列项。
 *
 * @param item 上传队列项。
 * @param document 最新文档 DTO。
 * @returns 更新后的队列项。
 */
export function applyIngestDocument(
  item: UploadItem,
  document: KnowledgeDocument,
) {
  item.status =
    document.status === 'ready'
      ? 'ready'
      : document.status === 'failed'
        ? 'failed'
        : 'processing'
  item.stage =
    document.status === 'failed' && document.errorStage
      ? ingestErrorStageLabel(document.errorStage)
      : ingestStageLabel(document.status)
  item.progress = ingestProgress(document.status, document.progress)
  item.error =
    document.status === 'failed'
      ? [
          document.errorCode,
          document.error ?? '索引失败，请重试或重建索引。',
          document.errorRetryable === false ? '不可自动重试' : '',
        ]
          .filter(Boolean)
          .join('：')
      : undefined
  return item
}
