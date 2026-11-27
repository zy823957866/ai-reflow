<template>
  <section class="surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <header class="flex min-h-[58px] shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div class="min-w-0 flex-1">
        <h2 class="m-0 truncate text-[14px] font-650">{{ activeKb?.name ?? '文档列表' }}</h2>
        <p class="mb-0 mt-1 truncate text-[12px] text-subtle">
          {{ activeKb
            ? `${activeDocuments.length} 文档 · ${chunkCount} chunks`
            : '选择知识库后管理文档' }}
        </p>
      </div>
      <div v-if="activeKb" class="flex shrink-0 items-center gap-1">
        <Button class="!h-8 !px-2.5" @click="openUploadDialog">
          <Plus :size="13" /> 上传文档
        </Button>
      </div>
    </header>

    <KnowledgeDocumentTable
      :documents="activeDocuments"
      :loading="loading"
      :active="Boolean(activeKb)"
      @open="openDocument"
      @retry="retryDocument"
      @reindex="requestRebuildDocument"
      @remove="deleteDocument"
      @show-error="showDocumentError"
    />
  </section>

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
</template>

<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { useKnowledgeDocuments } from '../composables/useKnowledgeDocuments'
import DocumentPreviewDrawer from './DocumentPreviewDrawer.vue'
import KnowledgeDocumentTable from './KnowledgeDocumentTable.vue'
import KnowledgeReindexDialog from './KnowledgeReindexDialog.vue'
import KnowledgeUploadDialog from './KnowledgeUploadDialog.vue'

// 文档列表、上传弹窗、重建索引与预览抽屉的状态和操作统一由文档 composable 提供
const {
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
} = useKnowledgeDocuments()
</script>
