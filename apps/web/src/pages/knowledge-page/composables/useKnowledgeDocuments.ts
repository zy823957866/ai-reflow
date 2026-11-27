import type { DocumentChunkDto, KnowledgeStatsDto } from '@/services/reflowApi'
import {
  deleteKnowledgeDocument,
  getKnowledgeStats,
  listDocumentChunks,
  listKnowledgeDocuments,
  reindexKnowledgeDocument,
  retryKnowledgeDocument,
  uploadKnowledgeDocument,
} from '@/services/reflowApi'
import { notifyError, notifyInfo, notifySuccess } from '@/shared/toast'
import type { KnowledgeDocument, UploadItem } from '../types'
import { apiErrorText } from '../utils/errors'
import { ingestErrorStageLabel, isActiveIngestStatus } from '../utils/status'
import {
  applyIngestDocument,
  getUploadValidationError,
  isUploadBatchSettled,
  syncUploadBatchFromDocuments,
} from '../utils/uploadBatch'
import { useKnowledgeBases } from './useKnowledgeBases'

/**
 * 知识库文档管理 composable。
 *
 * 聚合当前知识库的文档列表与统计、上传弹框、轮询、
 * 重建索引、删除以及切片预览等状态和操作。
 */
export function useKnowledgeDocuments() {
  // 知识库上下文：当前选中知识库、选中 ID 与列表刷新方法
  const {
    activeKb,
    activeKbId,
    load: loadKnowledgeBases,
  } = useKnowledgeBases()

  /** 已加载的文档列表 */
  const documents = ref<KnowledgeDocument[]>([])
  /** 知识库统计信息 */
  const stats = ref<KnowledgeStatsDto>()
  /** 文档列表加载中 */
  const loading = ref(false)
  /** 上传弹框开关 */
  const uploadDialogOpen = ref(false)
  /** 上传弹框附件队列 */
  const uploadDialogItems = ref<UploadItem[]>([])
  /** 上传批次处理中 */
  const uploadDialogRunning = ref(false)
  /** 重建索引确认弹框开关 */
  const reindexDialogOpen = ref(false)
  /** 待重建索引的文档 */
  const reindexTarget = ref<KnowledgeDocument>()
  /** 重建索引请求进行中 */
  const reindexRunning = ref(false)
  /** 切片预览抽屉开关 */
  const documentDrawerOpen = ref(false)
  /** 当前预览的文档 ID */
  const selectedDocumentId = ref('')
  /** 预览抽屉中的切片列表 */
  const documentChunks = ref<DocumentChunkDto[]>([])
  /** 切片加载中 */
  const chunksLoading = ref(false)
  /** 加载请求版本号，用于丢弃过期响应 */
  let loadVersion = 0
  /** 轮询定时器句柄 */
  let pollTimer: number | undefined
  /** 轮询进行中标志，防止重复触发 */
  let pollInFlight = false

  /** 当前知识库下的文档列表 */
  const activeDocuments = computed(() =>
    documents.value.filter((document) => document.kbId === activeKbId.value),
  )
  /** 切片总数：优先取统计接口，否则对当前文档切片数求和 */
  const chunkCount = computed(
    () =>
      stats.value?.chunks ??
      activeDocuments.value.reduce((total, item) => total + item.chunks, 0),
  )
  /** 当前选中预览的文档对象 */
  const selectedDocument = computed(() =>
    documents.value.find((item) => item.id === selectedDocumentId.value),
  )

  /**
   * 加载当前知识库的文档列表与统计信息。
   *
   * @param silent 为 true 时用于轮询：不显示 loading，也不弹错误提示。
   */
  async function load(silent = false) {
    const kbId = activeKbId.value
    const version = ++loadVersion
    if (!kbId) {
      documents.value = []
      stats.value = undefined
      return
    }
    if (!silent) loading.value = true
    try {
      const [items, nextStats] = await Promise.all([
        listKnowledgeDocuments(kbId),
        getKnowledgeStats(kbId),
      ])
      if (version !== loadVersion || kbId !== activeKbId.value) return
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
      stats.value = nextStats
      if (uploadDialogRunning.value) {
        uploadDialogItems.value = syncUploadBatchFromDocuments(
          uploadDialogItems.value,
          documents.value,
        )
      }
      if (!silent) schedulePoll()
    } catch (error) {
      if (version !== loadVersion) return
      if (!silent) {
        documents.value = []
        stats.value = undefined
        notifyError({
          title: '知识库文档加载失败',
          description: apiErrorText(error),
          retry: () => void load(),
        })
      }
    } finally {
      if (version === loadVersion && !silent) loading.value = false
    }
  }

  /** 若仍有文档在处理中，则安排下一次轮询 */
  function schedulePoll() {
    window.clearTimeout(pollTimer)
    if (!hasActiveIngest()) return
    pollTimer = window.setTimeout(() => void poll(), 1500)
  }

  /** 判断当前知识库是否有文档仍在 ingest 流水线中 */
  function hasActiveIngest() {
    return activeDocuments.value.some((document) =>
      isActiveIngestStatus(document.status),
    )
  }

  /** 静默加载一次文档列表；若仍有处理中的文档则继续轮询 */
  async function poll() {
    if (pollInFlight || !activeKbId.value) return
    pollInFlight = true
    try {
      await load(true)
    } finally {
      pollInFlight = false
      if (hasActiveIngest()) schedulePoll()
    }
  }

  /** 打开上传弹框并清空上次队列 */
  function openUploadDialog() {
    if (!activeKb.value) return
    uploadDialogItems.value = []
    uploadDialogRunning.value = false
    uploadDialogOpen.value = true
  }

  /**
   * 更新上传弹框开关；批次处理中不允许关闭。
   *
   * @param open 目标开关状态。
   */
  function updateUploadDialogOpen(open: boolean) {
    if (!open && uploadDialogRunning.value) return
    uploadDialogOpen.value = open
    if (!open) uploadDialogItems.value = []
  }

  /**
   * 过滤不合法的文件并启动批量上传。
   *
   * @param files 用户选择的文件列表。
   */
  function startUploadDialog(files: File[]) {
    if (uploadDialogRunning.value || !activeKbId.value) return
    // 仅保留通过格式与大小校验的文件
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
    notifyInfo('文档处理中', '解析完成后弹框自动关闭。')
    void Promise.all(items.map((item) => uploadFile(item)))
  }

  /**
   * 上传单个附件并同步最新文档状态。
   *
   * @param item 上传队列项。
   */
  async function uploadFile(item: UploadItem) {
    const kbId = activeKbId.value
    if (!item.file || !kbId) return
    item.status = 'processing'
    item.progress = 0
    item.stage = '上传中'
    item.error = undefined
    try {
      const accepted = await uploadKnowledgeDocument(kbId, item.file)
      item.documentId = accepted.document.id
      applyIngestDocument(item, accepted.document)
      if (accepted.job.errorMessage) item.error = accepted.job.errorMessage
      if (kbId === activeKbId.value) await load()
      await loadKnowledgeBases(true)
    } catch (error) {
      item.status = 'failed'
      item.stage = '上传失败'
      item.error = apiErrorText(error)
      item.progress = 0
      notifyError({
        title: '文档上传失败',
        description: apiErrorText(error),
        retry: () => void uploadFile(item),
      })
    }
  }

  /**
   * 重试处理失败的文档。
   *
   * @param document 目标文档。
   */
  async function retryDocument(document: KnowledgeDocument) {
    try {
      await retryKnowledgeDocument(document.id)
      await load()
      await loadKnowledgeBases(true)
    } catch (error) {
      notifyError({
        title: '文档重试失败',
        description: apiErrorText(error),
        retry: () => void retryDocument(document),
      })
    }
  }

  /**
   * 打开重建索引确认弹框。
   *
   * @param document 目标文档。
   */
  function requestRebuildDocument(document: KnowledgeDocument) {
    reindexTarget.value = document
    reindexDialogOpen.value = true
  }

  /**
   * 更新重建索引弹框开关；请求进行中不允许关闭。
   *
   * @param open 目标开关状态。
   */
  function updateReindexDialogOpen(open: boolean) {
    if (!open && reindexRunning.value) return
    reindexDialogOpen.value = open
    if (!open) reindexTarget.value = undefined
  }

  /** 确认执行重建索引并刷新文档列表 */
  async function submitReindex() {
    if (reindexRunning.value || !reindexTarget.value) return
    reindexRunning.value = true
    try {
      await reindexKnowledgeDocument(reindexTarget.value.id)
      reindexDialogOpen.value = false
      reindexTarget.value = undefined
      await load()
      await loadKnowledgeBases(true)
    } catch (error) {
      notifyError({
        title: '重建索引失败',
        description: apiErrorText(error),
        retry: () => void submitReindex(),
      })
    } finally {
      reindexRunning.value = false
    }
  }

  /**
   * 删除文档并清理切片、预览等相关状态。
   *
   * @param document 目标文档。
   */
  async function deleteDocument(document: KnowledgeDocument) {
    if (!window.confirm(`删除“${document.name}”？切片和预览也会被清理。`)) return
    try {
      await deleteKnowledgeDocument(document.id)
      if (selectedDocumentId.value === document.id) closeDocumentPreview()
      await Promise.all([loadKnowledgeBases(true), load()])
    } catch (error) {
      notifyError({
        title: '删除文档失败',
        description: apiErrorText(error),
      })
    }
  }

  /**
   * 打开切片预览抽屉并加载该文档的切片。
   *
   * @param document 目标文档。
   */
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
        description: apiErrorText(error),
        retry: () => void openDocument(document),
      })
    } finally {
      chunksLoading.value = false
    }
  }

  /** 关闭切片预览抽屉并重置相关状态 */
  function closeDocumentPreview() {
    documentDrawerOpen.value = false
    selectedDocumentId.value = ''
    documentChunks.value = []
  }

  /**
   * 弹出文档失败详情通知，并附带重试入口。
   *
   * @param document 目标文档。
   */
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

  /** 重置文档相关的弹框与预览状态（切换知识库时调用） */
  function resetDocuments() {
    window.clearTimeout(pollTimer)
    selectedDocumentId.value = ''
    documentDrawerOpen.value = false
    documentChunks.value = []
    chunksLoading.value = false
    reindexDialogOpen.value = false
    reindexTarget.value = undefined
    uploadDialogOpen.value = false
    uploadDialogItems.value = []
    uploadDialogRunning.value = false
  }

  // 切换知识库时重置文档状态并重新加载
  watch(
    activeKbId,
    () => {
      resetDocuments()
      void load()
    },
    { immediate: true },
  )

  // 上传批次全部结束（成功或失败）后自动关闭弹框并提示结果
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
          '文档处理结束',
          `${failedCount} 个附件录入失败，可在文档列表查看并重试。`,
        )
        return
      }
      notifySuccess('文档处理完成', '所有附件已完成解析并建立索引。')
    },
  )

  onScopeDispose(() => window.clearTimeout(pollTimer))

  return {
    activeKb,
    activeDocuments,
    chunkCount,
    loading,
    uploadDialogOpen,
    uploadDialogItems,
    uploadDialogRunning,
    reindexDialogOpen,
    reindexTarget,
    reindexRunning,
    documentDrawerOpen,
    selectedDocument,
    documentChunks,
    chunksLoading,
    openUploadDialog,
    updateUploadDialogOpen,
    startUploadDialog,
    updateReindexDialogOpen,
    submitReindex,
    closeDocumentPreview,
    openDocument,
    retryDocument,
    requestRebuildDocument,
    deleteDocument,
    showDocumentError,
  }
}

/**
 * 将字节数格式化为 KB/MB 展示文本。
 *
 * @param bytes 文件字节数。
 * @returns 大小展示文本。
 */
function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
