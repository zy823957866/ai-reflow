import type {
  KnowledgeBaseDto,
  KnowledgeDocumentDto,
  KnowledgeSearchChunk,
} from '@/services/reflowApi'

/** 知识库条目（直接复用后端 DTO） */
export type KnowledgeBaseItem = KnowledgeBaseDto

/** 知识库文档：在 DTO 基础上补充从 metadata 解析出的展示字段 */
export type KnowledgeDocument = KnowledgeDocumentDto & {
  /** 页数（来自 metadata.pages） */
  pages?: number
  /** 行数（来自 metadata.rows 或 metadata.rowCount） */
  rows?: number
  /** 标题层级路径（来自 metadata.headingPath） */
  titlePath?: string[]
}

/** 上传弹框中的附件队列项 */
export interface UploadItem {
  /** 队列项唯一 ID */
  id: string
  /** 附件名 */
  name: string
  /** 大小展示文本 */
  sizeLabel: string
  /** 进度百分比（0-100） */
  progress: number
  /** 当前阶段文案 */
  stage: string
  /** 处理状态 */
  status: 'processing' | 'ready' | 'failed'
  /** 原始文件 */
  file?: File
  /** 上传成功后对应的文档 ID */
  documentId?: string
  /** 失败原因 */
  error?: string
}

/** 知识库检索结果（附带对话引用 ID） */
export type SearchResult = KnowledgeSearchChunk & { citationId?: string }

/** 知识库检索请求参数 */
export interface SearchRequest {
  /** 检索关键词 */
  query: string
  /** 检索模式：混合 / 向量 / 全文 */
  retrievalMode: 'hybrid' | 'vector' | 'keyword'
  /** 返回条数上限 */
  topK: number
  /** 分数过滤阈值 */
  scoreThreshold: number
  /** 是否启用重排序 */
  rerankEnabled: boolean
}
