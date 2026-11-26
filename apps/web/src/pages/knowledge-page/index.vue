<template>
  <div class="h-[calc(100vh-62px)] min-h-[560px] overflow-hidden p-4 max-md:p-2.5">
    <div data-testid="knowledge-grid-desktop" class="hidden h-full min-h-0 gap-3 min-[1280px]:grid min-[1280px]:grid-cols-[240px_minmax(0,1fr)_360px]">
      <KnowledgeGroupPanel
        data-testid="knowledge-group-panel"
        :knowledge-bases="kbList"
        :active-kb-id="activeKbId"
        :loading="kbLoading"
        :query="kbQuery"
        :status-filter="kbStatusFilter"
        @select="selectKnowledgeBase"
        @create="openCreateKnowledgeBase"
        @edit="openEditKnowledgeBase"
        @remove="removeKnowledgeBase"
        @update:query="kbQuery = $event"
        @update:status-filter="kbStatusFilter = $event"
      />
      <KnowledgeDocumentPanel
        data-testid="knowledge-document-panel"
        :active-kb="activeKb"
        :documents="activeDocuments"
        :chunk-count="activeChunkCount"
        :loading="documentsLoading"
        :upload-queue="uploadQueue"
        @edit="openEditKnowledgeBase"
        @remove="removeKnowledgeBase"
        @files="queueFiles"
        @retry-upload="retryUpload"
        @remove-upload="removeUpload"
        @open-document="openDocument"
        @retry-document="retryDocument"
        @reindex-document="rebuildDocument"
        @remove-document="deleteDocument"
        @show-document-error="showDocumentError"
      />
      <KnowledgeSearchPanel
        data-testid="knowledge-search-panel"
        :active-kb="activeKb"
        :results="searchResults"
        :loading="testLoading"
        :search-ran="searchRan"
        :last-duration="lastSearchDuration"
        :warnings="searchWarnings"
        @search="runSearch"
      />
    </div>

    <div data-testid="knowledge-grid-tablet" class="hidden h-full min-h-0 gap-3 md:grid md:grid-cols-[230px_minmax(0,1fr)] min-[1280px]:hidden">
      <KnowledgeGroupPanel
        data-testid="knowledge-group-panel"
        :knowledge-bases="kbList"
        :active-kb-id="activeKbId"
        :loading="kbLoading"
        :query="kbQuery"
        :status-filter="kbStatusFilter"
        @select="selectKnowledgeBase"
        @create="openCreateKnowledgeBase"
        @edit="openEditKnowledgeBase"
        @remove="removeKnowledgeBase"
        @update:query="kbQuery = $event"
        @update:status-filter="kbStatusFilter = $event"
      />
      <div class="grid min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <KnowledgeDocumentPanel
          data-testid="knowledge-document-panel"
          :active-kb="activeKb"
          :documents="activeDocuments"
          :chunk-count="activeChunkCount"
          :loading="documentsLoading"
          :upload-queue="uploadQueue"
          @edit="openEditKnowledgeBase"
          @remove="removeKnowledgeBase"
          @files="queueFiles"
          @retry-upload="retryUpload"
          @remove-upload="removeUpload"
          @open-document="openDocument"
          @retry-document="retryDocument"
          @reindex-document="rebuildDocument"
          @remove-document="deleteDocument"
          @show-document-error="showDocumentError"
        />
        <KnowledgeSearchPanel
          data-testid="knowledge-search-panel"
          :active-kb="activeKb"
          :results="searchResults"
          :loading="testLoading"
          :search-ran="searchRan"
          :last-duration="lastSearchDuration"
          :warnings="searchWarnings"
          @search="runSearch"
        />
      </div>
    </div>

    <div data-testid="knowledge-mobile" class="flex h-full min-h-0 flex-col md:hidden">
      <div class="mb-2.5 grid shrink-0 grid-cols-3 rounded-[7px] border border-line bg-[var(--surface-2)] p-[3px]">
        <Button variant="unstyled" type="button"
          v-for="pane in mobilePanes"
          :key="pane.value"
          :data-testid="`knowledge-mobile-tab-${pane.value}`"
          class="h-8 rounded-[5px] border-0 text-[12px]"
          :class="mobilePane === pane.value ? 'bg-ink text-white' : 'bg-transparent text-subtle'"
          @click="mobilePane = pane.value"
        >
          {{ pane.label }}
        </Button>
      </div>
      <div class="min-h-0 flex-1">
        <KnowledgeGroupPanel
          v-if="mobilePane === 'groups'"
          :knowledge-bases="kbList"
          :active-kb-id="activeKbId"
          :loading="kbLoading"
          :query="kbQuery"
          :status-filter="kbStatusFilter"
          @select="selectKnowledgeBaseMobile"
          @create="openCreateKnowledgeBase"
          @edit="openEditKnowledgeBase"
          @remove="removeKnowledgeBase"
          @update:query="kbQuery = $event"
          @update:status-filter="kbStatusFilter = $event"
        />
        <KnowledgeDocumentPanel
          v-else-if="mobilePane === 'documents'"
          :active-kb="activeKb"
          :documents="activeDocuments"
          :chunk-count="activeChunkCount"
          :loading="documentsLoading"
          :upload-queue="uploadQueue"
          @edit="openEditKnowledgeBase"
          @remove="removeKnowledgeBase"
          @files="queueFiles"
          @retry-upload="retryUpload"
          @remove-upload="removeUpload"
          @open-document="openDocument"
          @retry-document="retryDocument"
          @reindex-document="rebuildDocument"
          @remove-document="deleteDocument"
          @show-document-error="showDocumentError"
        />
        <KnowledgeSearchPanel
          v-else
          :active-kb="activeKb"
          :results="searchResults"
          :loading="testLoading"
          :search-ran="searchRan"
          :last-duration="lastSearchDuration"
          :warnings="searchWarnings"
          @search="runSearch"
        />
      </div>
    </div>

    <KnowledgeBaseDialog
      :open="createOpen"
      :knowledge-base="editingKb"
      :saving="saving"
      @update:open="createOpen = $event"
      @submit="saveKnowledgeBase"
    />
    <DocumentPreviewDrawer
      :open="documentDrawerOpen"
      :document="selectedDocument"
      :document-chunks="documentChunks"
      :chunks-loading="chunksLoading"
      :preview="selectedPreview"
      :embedding-model="activeKb?.embeddingModel"
      @close="closeDocumentPreview"
      @retry="retryDocument"
      @rebuild="rebuildDocument"
      @show-error="showDocumentError"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Button } from '@ai-reflow/ui'
import { ApiError } from '@/api/client'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  getKnowledgePreview,
  getKnowledgeStats,
  listDocumentChunks,
  listKnowledgeBases,
  listKnowledgeDocuments,
  reindexKnowledgeDocument,
  retryKnowledgeDocument,
  searchKnowledge,
  updateKnowledgeBase,
  uploadKnowledgeDocument,
  type DocumentChunkDto,
  type KnowledgePreviewDto,
  type KnowledgeStatsDto,
} from '@/services/reflowApi'
import { notifyError } from '@/shared/toast'
import type {
  KnowledgeBaseItem,
  KnowledgeDocument,
  SearchRequest,
  SearchResult,
  UploadItem,
} from './types'
import {
  ingestProgress,
  ingestStageLabel,
  isActiveIngestStatus,
} from './status'
import DocumentPreviewDrawer from './components/DocumentPreviewDrawer.vue'
import KnowledgeBaseDialog from './components/KnowledgeBaseDialog.vue'
import KnowledgeDocumentPanel from './components/KnowledgeDocumentPanel.vue'
import KnowledgeGroupPanel from './components/KnowledgeGroupPanel.vue'
import KnowledgeSearchPanel from './components/KnowledgeSearchPanel.vue'

type MobilePane = 'groups' | 'documents' | 'search'

const kbList = ref<KnowledgeBaseItem[]>([])
const documents = ref<KnowledgeDocument[]>([])
const uploadQueue = ref<UploadItem[]>([])
const activeKbId = ref('')
const kbQuery = ref('')
const kbStatusFilter = ref('all')
const mobilePane = ref<MobilePane>('groups')
const createOpen = ref(false)
const editingKbId = ref('')
const saving = ref(false)
const kbLoading = ref(false)
const documentsLoading = ref(false)
const testLoading = ref(false)
const searchRan = ref(false)
const searchResults = ref<SearchResult[]>([])
const searchWarnings = ref<string[]>([])
const lastSearchDuration = ref(0)
const documentDrawerOpen = ref(false)
const selectedDocumentId = ref('')
const documentChunks = ref<DocumentChunkDto[]>([])
const selectedPreview = ref<KnowledgePreviewDto>()
const activeStats = ref<KnowledgeStatsDto>()
const chunksLoading = ref(false)
let filterTimer: number | undefined
let pollTimer: number | undefined
let pollInFlight = false

const mobilePanes: Array<{ value: MobilePane; label: string }> = [
  { value: 'groups', label: '分组' },
  { value: 'documents', label: '文档' },
  { value: 'search', label: '检索' },
]
const activeKb = computed(() => kbList.value.find((item) => item.id === activeKbId.value))
const editingKb = computed(() => kbList.value.find((item) => item.id === editingKbId.value))
const activeDocuments = computed(() => documents.value.filter((document) => document.kbId === activeKbId.value))
const activeChunkCount = computed(
  () => activeStats.value?.chunks ?? activeDocuments.value.reduce((total, item) => total + item.chunks, 0),
)
const selectedDocument = computed(() => documents.value.find((item) => item.id === selectedDocumentId.value))

watch([kbQuery, kbStatusFilter], () => {
  window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(() => {
    void loadKnowledgeBases(true)
  }, 300)
})

watch(activeKbId, async (id) => {
  window.clearTimeout(pollTimer)
  selectedDocumentId.value = ''
  documentDrawerOpen.value = false
  searchResults.value = []
  searchWarnings.value = []
  searchRan.value = false
  if (!id) {
    documents.value = []
    activeStats.value = undefined
    return
  }
  await loadActiveKnowledge()
})

function errorText(error: unknown) {
  if (error instanceof ApiError) {
    return [error.code, error.message].filter(Boolean).join('：')
  }
  return error instanceof Error ? error.message : '请求失败。'
}

async function loadKnowledgeBases(silent = false) {
  if (!silent) kbLoading.value = true
  try {
    kbList.value = await listKnowledgeBases({
      search: kbQuery.value.trim() || undefined,
      status: kbStatusFilter.value === 'all' ? undefined : kbStatusFilter.value,
    })
    if (!kbList.value.some((item) => item.id === activeKbId.value)) {
      activeKbId.value = kbList.value[0]?.id ?? ''
    }
  } catch (error) {
    notifyError({
      title: '知识库列表加载失败',
      description: errorText(error),
      retry: () => void loadKnowledgeBases(),
    })
  } finally {
    if (!silent) kbLoading.value = false
  }
}

async function loadActiveKnowledge(silent = false) {
  if (!activeKbId.value) return
  if (!silent) documentsLoading.value = true
  try {
    const [items, stats] = await Promise.all([
      listKnowledgeDocuments(activeKbId.value),
      getKnowledgeStats(activeKbId.value),
    ])
    documents.value = items.map((item) => ({
      ...item,
      pages:
        typeof item.metadata?.pages === 'number'
          ? item.metadata.pages
          : undefined,
      rows:
        typeof item.metadata?.rows === 'number'
          ? item.metadata.rows
          : typeof item.metadata?.rowCount === 'number'
            ? item.metadata.rowCount
            : undefined,
      titlePath: Array.isArray(item.metadata?.headingPath)
        ? item.metadata.headingPath.map(String)
        : undefined,
    }))
    activeStats.value = stats
    syncUploadQueueFromDocuments()
    if (!silent) scheduleKnowledgePoll()
  } catch (error) {
    if (!silent) {
      documents.value = []
      activeStats.value = undefined
      notifyError({
        title: '知识库文档加载失败',
        description: errorText(error),
        retry: () => void loadActiveKnowledge(),
      })
    }
  } finally {
    if (!silent) documentsLoading.value = false
  }
}

/**
 * 在有活动 ingest 时安排下一次文档状态轮询。
 */
function scheduleKnowledgePoll() {
  window.clearTimeout(pollTimer)
  if (!hasActiveIngest()) return
  pollTimer = window.setTimeout(() => {
    void pollActiveKnowledge()
  }, 1500)
}

/**
 * 判断当前知识库或上传队列是否仍有活动任务。
 *
 * @returns 是否需要继续轮询。
 */
function hasActiveIngest() {
  return (
    activeDocuments.value.some((document) =>
      isActiveIngestStatus(document.status),
    ) ||
    uploadQueue.value.some(
      (item) => item.status === 'processing' && Boolean(item.documentId),
    )
  )
}

/**
 * 静默刷新活动文档，并在仍有任务时继续轮询。
 */
async function pollActiveKnowledge() {
  if (pollInFlight || !activeKbId.value) return
  pollInFlight = true
  try {
    await loadActiveKnowledge(true)
  } finally {
    pollInFlight = false
    if (hasActiveIngest()) scheduleKnowledgePoll()
  }
}

/**
 * 把文档列表中的最新 ingest 状态同步到上传队列。
 */
function syncUploadQueueFromDocuments() {
  const byId = new Map(documents.value.map((document) => [document.id, document]))
  uploadQueue.value = uploadQueue.value.map((item) => {
    const document = byId.get(item.documentId ?? '')
    return document ? applyIngestDocument(item, document) : item
  })
}

/**
 * 将文档状态投影到上传队列项。
 *
 * @param item 上传队列项。
 * @param document 最新文档 DTO。
 * @returns 更新后的队列项。
 */
function applyIngestDocument(
  item: UploadItem,
  document: KnowledgeDocument,
) {
  item.status =
    document.status === 'ready'
      ? 'ready'
      : document.status === 'failed'
        ? 'failed'
        : 'processing'
  item.stage = ingestStageLabel(document.status)
  item.progress = ingestProgress(document.status, document.progress)
  item.error =
    document.status === 'failed'
      ? (document.error ?? '索引失败，请重试或重建索引。')
      : undefined
  return item
}

function selectKnowledgeBase(id: string) {
  activeKbId.value = id
}

function selectKnowledgeBaseMobile(id: string) {
  activeKbId.value = id
  mobilePane.value = 'documents'
}

function openCreateKnowledgeBase() {
  editingKbId.value = ''
  createOpen.value = true
}

function openEditKnowledgeBase(knowledgeBase: KnowledgeBaseItem) {
  editingKbId.value = knowledgeBase.id
  createOpen.value = true
}

async function saveKnowledgeBase(value: { name: string; description: string }) {
  if (saving.value) return
  saving.value = true
  try {
    const saved = editingKbId.value
      ? await updateKnowledgeBase(editingKbId.value, value)
      : await createKnowledgeBase({
          ...value,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimension: 1536,
        })
    createOpen.value = false
    await loadKnowledgeBases()
    activeKbId.value = saved.id
  } catch (error) {
    notifyError({
      title: '保存知识库失败',
      description: errorText(error),
    })
  } finally {
    saving.value = false
  }
}

async function removeKnowledgeBase(knowledgeBase: KnowledgeBaseItem) {
  if (!window.confirm(`删除“${knowledgeBase.name}”？服务端会检查工作流引用。`)) return
  try {
    await deleteKnowledgeBase(knowledgeBase.id)
    if (activeKbId.value === knowledgeBase.id) activeKbId.value = ''
    await loadKnowledgeBases()
  } catch (error) {
    notifyError({
      title: '删除知识库失败',
      description: errorText(error),
    })
  }
}

async function queueFiles(files: File[]) {
  const allowed = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'md', 'markdown', 'txt', 'html']
  await Promise.all(files.map(async (file) => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const item = reactive<UploadItem>({
      id: `upload_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      sizeLabel: formatFileSize(file.size),
      progress: 0,
      stage: 'queued',
      status: 'processing',
      file,
    })
    uploadQueue.value.unshift(item)
    if (!allowed.includes(extension)) {
      Object.assign(item, { status: 'failed', stage: '格式不支持', progress: 0 })
      notifyError({
        title: '文件格式不支持',
        description: `${file.name} 不是支持的文档格式。`,
      })
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      Object.assign(item, { status: 'failed', stage: '超过 50 MB', progress: 0 })
      notifyError({
        title: '文件过大',
        description: `${file.name} 超过 50 MB 单文件限制。`,
      })
      return
    }
    await uploadFile(item)
  }))
}

async function uploadFile(item: UploadItem) {
  if (!item.file || !activeKbId.value) return
  item.status = 'processing'
  item.progress = 0
  item.stage = '上传中'
  item.error = undefined
  try {
    const accepted = await uploadKnowledgeDocument(
      activeKbId.value,
      item.file,
    )
    item.documentId = accepted.document.id
    item.jobId = accepted.job.id
    applyIngestDocument(item, accepted.document)
    if (accepted.job.errorMessage) item.error = accepted.job.errorMessage
    await loadActiveKnowledge()
  } catch (error) {
    item.status = 'failed'
    item.stage = '上传失败'
    item.error = errorText(error)
    item.progress = 0
    notifyError({
      title: '文档上传失败',
      description: errorText(error),
      retry: () => void uploadFile(item),
    })
  }
}

async function retryUpload(item: UploadItem) {
  if (!item.documentId) {
    await uploadFile(item)
    return
  }
  item.status = 'processing'
  item.stage = '排队中'
  item.error = undefined
  item.progress = 8
  try {
    const job = await retryKnowledgeDocument(item.documentId)
    item.jobId = job.id
    await loadActiveKnowledge()
  } catch (error) {
    item.status = 'failed'
    item.stage = '重试失败'
    item.error = errorText(error)
    notifyError({
      title: '文档重试失败',
      description: errorText(error),
      retry: () => void retryUpload(item),
    })
  }
}

function removeUpload(item: UploadItem) {
  uploadQueue.value = uploadQueue.value.filter((entry) => entry.id !== item.id)
}

async function retryDocument(document: KnowledgeDocument) {
  try {
    const job = await retryKnowledgeDocument(document.id)
    const item = uploadQueue.value.find(
      (entry) => entry.documentId === document.id,
    )
    if (item) {
      item.jobId = job.id
      item.status = 'processing'
      item.stage = '排队中'
      item.error = undefined
      item.progress = 8
    }
    await loadActiveKnowledge()
  } catch (error) {
    notifyError({
      title: '文档重试失败',
      description: errorText(error),
      retry: () => void retryDocument(document),
    })
  }
}

async function rebuildDocument(document: KnowledgeDocument) {
  if (
    !window.confirm(
      `重建“${document.name}”的切片与向量索引？当前索引会先被清理。`,
    )
  ) {
    return
  }
  try {
    const job = await reindexKnowledgeDocument(document.id)
    const item = uploadQueue.value.find(
      (entry) => entry.documentId === document.id,
    )
    if (item) {
      item.jobId = job.id
      item.status = 'processing'
      item.stage = '排队中'
      item.error = undefined
      item.progress = 8
    }
    await loadActiveKnowledge()
  } catch (error) {
    notifyError({
      title: '重建索引失败',
      description: errorText(error),
      retry: () => void rebuildDocument(document),
    })
  }
}

async function deleteDocument(document: KnowledgeDocument) {
  if (!window.confirm(`删除“${document.name}”？切片和预览也会被清理。`)) return
  try {
    await deleteKnowledgeDocument(document.id)
    if (selectedDocumentId.value === document.id) closeDocumentPreview()
    await Promise.all([loadKnowledgeBases(true), loadActiveKnowledge()])
  } catch (error) {
    notifyError({
      title: '删除文档失败',
      description: errorText(error),
    })
  }
}

async function openDocument(document: KnowledgeDocument) {
  selectedDocumentId.value = document.id
  documentChunks.value = []
  selectedPreview.value = undefined
  documentDrawerOpen.value = true
  chunksLoading.value = true
  try {
    const [chunksValue, previewValue] = await Promise.all([
      listDocumentChunks(document.id),
      getKnowledgePreview(document.id).catch((error: unknown) => {
        notifyError({
          title: '文档预览加载失败',
          description: errorText(error),
          retry: () => void openDocument(document),
        })
        return undefined
      }),
    ])
    documentChunks.value = chunksValue
    selectedPreview.value = previewValue
  } catch (error) {
    notifyError({
      title: '文档切片加载失败',
      description: errorText(error),
      retry: () => void openDocument(document),
    })
  } finally {
    chunksLoading.value = false
  }
}

function closeDocumentPreview() {
  documentDrawerOpen.value = false
  selectedDocumentId.value = ''
  documentChunks.value = []
  selectedPreview.value = undefined
}

function showDocumentError(document: KnowledgeDocument) {
  notifyError({
    title: '文档处理失败',
    description: document.error || '服务端未返回详细错误。',
    retry: () => void retryDocument(document),
  })
}

async function runSearch(request: SearchRequest) {
  if (testLoading.value || !activeKbId.value) return
  testLoading.value = true
  searchResults.value = []
  searchWarnings.value = []
  searchRan.value = false
  lastSearchDuration.value = 0
  const startedAt = performance.now()
  try {
    const response = await searchKnowledge(activeKbId.value, {
      query: request.query,
      topK: request.topK,
      scoreThreshold: request.scoreThreshold,
      retrievalMode: request.retrievalMode,
      rerank: { enabled: request.rerankEnabled },
    })
    searchResults.value = response.chunks.map((chunk, index) => ({
      ...chunk,
      citationId:
        typeof response.citations[index]?.id === 'string'
          ? response.citations[index].id
          : `c${index + 1}`,
    }))
    lastSearchDuration.value = Math.round(performance.now() - startedAt)
    searchRan.value = true
    searchWarnings.value = response.warnings ?? []
  } catch (error) {
    searchWarnings.value = []
    notifyError({
      title: '知识库检索失败',
      description: errorText(error),
      retry: () => void runSearch(request),
    })
  } finally {
    testLoading.value = false
  }
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

onMounted(() => {
  void loadKnowledgeBases()
})

onUnmounted(() => {
  window.clearTimeout(filterTimer)
  window.clearTimeout(pollTimer)
})
</script>
