import type {
  KnowledgeBaseDto,
  KnowledgeDocumentDto,
  KnowledgeSearchChunk,
} from '@/services/reflowApi'

export type KnowledgeBaseItem = KnowledgeBaseDto

export type KnowledgeDocument = KnowledgeDocumentDto & {
  pages?: number
  rows?: number
  titlePath?: string[]
}

export interface UploadItem {
  id: string
  name: string
  sizeLabel: string
  progress: number
  stage: string
  status: 'processing' | 'ready' | 'failed'
  file?: File
  knowledgeBaseId?: string
}

export type SearchResult = KnowledgeSearchChunk & { citationId?: string }

export interface SearchRequest {
  query: string
  retrievalMode: 'hybrid' | 'vector' | 'keyword'
  topK: number
  scoreThreshold: number
  rerankEnabled: boolean
}
