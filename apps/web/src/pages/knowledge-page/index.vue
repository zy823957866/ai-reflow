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
        @settings="openChunkSettings"
        @upload="openUploadDialog"
        @open-document="openDocument"
        @retry-document="retryDocument"
        @reindex-document="requestRebuildDocument"
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
          @settings="openChunkSettings"
          @upload="openUploadDialog"
          @open-document="openDocument"
          @retry-document="retryDocument"
          @reindex-document="requestRebuildDocument"
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
          @settings="openChunkSettings"
          @upload="openUploadDialog"
          @open-document="openDocument"
          @retry-document="retryDocument"
          @reindex-document="requestRebuildDocument"
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
    <KnowledgeChunkSettingsDialog
      :open="chunkSettingsOpen"
      :knowledge-base="chunkSettingsKb"
      :saving="savingChunkSettings"
      @update:open="chunkSettingsOpen = $event"
      @submit="saveChunkSettings"
    />
    <KnowledgeUploadDialog
      :open="uploadDialogOpen"
      :knowledge-base="activeKb"
      :items="uploadDialogItems"
      :running="uploadDialogRunning"
      @update:open="updateUploadDialogOpen"
      @submit="startUploadDialog"
    />
    <KnowledgeReindexDialog
      :open="reindexDialogOpen"
      :document="reindexTarget"
      :running="reindexRunning"
      @update:open="updateReindexDialogOpen"
      @confirm="submitReindex"
    />
    <DocumentPreviewDrawer
      :open="documentDrawerOpen"
      :document="selectedDocument"
      :document-chunks="documentChunks"
      :chunks-loading="chunksLoading"
      @close="closeDocumentPreview"
      @retry="retryDocument"
      @rebuild="requestRebuildDocument"
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
  type KnowledgeStatsDto,
} from '@/services/reflowApi'
import { notifyError, notifyInfo, notifySuccess } from '@/shared/toast'
import type {
  KnowledgeBaseItem,
  KnowledgeDocument,
  SearchRequest,
  SearchResult,
  UploadItem,
} from './types'
import {
  ingestErrorStageLabel,
  isActiveIngestStatus,
} from './status'
import DocumentPreviewDrawer from './components/DocumentPreviewDrawer.vue'
import KnowledgeBaseDialog from './components/KnowledgeBaseDialog.vue'
import KnowledgeChunkSettingsDialog from './components/KnowledgeChunkSettingsDialog.vue'
import KnowledgeDocumentPanel from './components/KnowledgeDocumentPanel.vue'
import KnowledgeGroupPanel from './components/KnowledgeGroupPanel.vue'
import KnowledgeReindexDialog from './components/KnowledgeReindexDialog.vue'
import KnowledgeSearchPanel from './components/KnowledgeSearchPanel.vue'
import KnowledgeUploadDialog from './components/KnowledgeUploadDialog.vue'
import {
  applyIngestDocument,
  getUploadValidationError,
  isUploadBatchSettled,
  syncUploadBatchFromDocuments,
} from './uploadBatch'

type MobilePane = 'groups' | 'documents' | 'search'

const kbList = ref<KnowledgeBaseItem[]>([])
const documents = ref<KnowledgeDocument[]>([])
const activeKbId = ref('')
const kbQuery = ref('')
const kbStatusFilter = ref('all')
const mobilePane = ref<MobilePane>('groups')
const createOpen = ref(false)
const editingKbId = ref('')
const saving = ref(false)
const chunkSettingsOpen = ref(false)
const chunkSettingsKbId = ref('')
const savingChunkSettings = ref(false)
const uploadDialogOpen = ref(false)
const uploadDialogItems = ref<UploadItem[]>([])
const uploadDialogRunning = ref(false)
const reindexDialogOpen = ref(false)
const reindexTarget = ref<KnowledgeDocument>()
const reindexRunning = ref(false)
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
const chunkSettingsKb = computed(() => kbList.value.find((item) => item.id === chunkSettingsKbId.value))
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

watch(
  () => uploadDialogItems.value.map((item) => item.status).join('|'),
  () => {
    if (
      !uploadDialogRunning.value ||
      !uploadDialogItems.value.length ||
      !isUploadBatchSettled(uploadDialogItems.value)
    ) {
      return
    }
    const failedCount = uploadDialogItems.value.filter(
      (item) => item.status === 'failed',
    ).length
    uploadDialogRunning.value = false
    uploadDialogOpen.value = false
    uploadDialogItems.value = []
    if (failedCount) {
      notifyInfo(
        '知识库录入结束',
        `${failedCount} 个附件录入失败，可在文档列表查看并重试。`,
      )
      return
    }
    notifySuccess('知识库录入完成', '所有附件已完成解析并建立索引。')
  },
)

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
    if (uploadDialogRunning.value) {
      uploadDialogItems.value = syncUploadBatchFromDocuments(
        uploadDialogItems.value,
        documents.value,
      )
    }
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
 * 判断当前知识库是否仍有活动任务。
 *
 * @returns 是否需要继续轮询。
 */
function hasActiveIngest() {
  return activeDocuments.value.some((document) =>
    isActiveIngestStatus(document.status),
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

function openChunkSettings(knowledgeBase: KnowledgeBaseItem) {
  chunkSettingsKbId.value = knowledgeBase.id
  chunkSettingsOpen.value = true
}

async function saveChunkSettings(value: {
  chunkSize: number
  overlapSize: number
  separator: string
}) {
  if (savingChunkSettings.value || !chunkSettingsKbId.value) return
  savingChunkSettings.value = true
  try {
    await updateKnowledgeBase(chunkSettingsKbId.value, value)
    chunkSettingsOpen.value = false
    await loadKnowledgeBases(true)
  } catch (error) {
    notifyError({
      title: '保存切片设置失败',
      description: errorText(error),
    })
  } finally {
    savingChunkSettings.value = false
  }
}

async function saveKnowledgeBase(value: { name: string; description: string }) {
  if (saving.value) return
  saving.value = true
  try {
    const saved = editingKbId.value
      ? await updateKnowledgeBase(editingKbId.value, value)
      : await createKnowledgeBase({
          ...value,
          embeddingProvider: 'ollama',
          embeddingModel: 'nomic-embed-text',
          embeddingDimension: 768,
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

function openUploadDialog() {
  if (!activeKb.value) return
  uploadDialogItems.value = []
  uploadDialogRunning.value = false
  uploadDialogOpen.value = true
}

function updateUploadDialogOpen(open: boolean) {
  if (!open && uploadDialogRunning.value) return
  uploadDialogOpen.value = open
  if (!open) uploadDialogItems.value = []
}

function startUploadDialog(files: File[]) {
  if (uploadDialogRunning.value || !activeKb.value) return
  const validFiles = files.filter((file) => !getUploadValidationError(file))
  if (!validFiles.length) return
  const items = validFiles.map((file) =>
    reactive<UploadItem>({
      id: `upload_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      sizeLabel: formatFileSize(file.size),
      progress: 0,
      stage: '待上传',
      status: 'processing',
      file,
    }),
  )
  uploadDialogItems.value = items
  uploadDialogRunning.value = true
  notifyInfo('知识库录入中', '录入完成后弹框自动关闭。')
  void Promise.all(items.map((item) => uploadFile(item)))
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

async function retryDocument(document: KnowledgeDocument) {
  try {
    await retryKnowledgeDocument(document.id)
    await loadActiveKnowledge()
  } catch (error) {
    notifyError({
      title: '文档重试失败',
      description: errorText(error),
      retry: () => void retryDocument(document),
    })
  }
}

function requestRebuildDocument(document: KnowledgeDocument) {
  reindexTarget.value = document
  reindexDialogOpen.value = true
}

function updateReindexDialogOpen(open: boolean) {
  if (!open && reindexRunning.value) return
  reindexDialogOpen.value = open
  if (!open) reindexTarget.value = undefined
}

async function submitReindex() {
  if (reindexRunning.value || !reindexTarget.value) return
  reindexRunning.value = true
  try {
    await reindexKnowledgeDocument(reindexTarget.value.id)
    reindexDialogOpen.value = false
    reindexTarget.value = undefined
    await loadActiveKnowledge()
  } catch (error) {
    notifyError({
      title: '重建索引失败',
      description: errorText(error),
      retry: () => void submitReindex(),
    })
  } finally {
    reindexRunning.value = false
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
  documentDrawerOpen.value = true
  chunksLoading.value = true
  try {
    documentChunks.value = await listDocumentChunks(document.id)
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
}

function showDocumentError(document: KnowledgeDocument) {
  notifyError({
    title: ingestErrorStageLabel(document.errorStage) || '文档处理失败',
    description:
      [document.errorCode, document.error]
        .filter(Boolean)
        .join('：') || '服务端未返回详细错误。',
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
