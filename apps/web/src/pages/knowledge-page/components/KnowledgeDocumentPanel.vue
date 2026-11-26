<template>
  <section class="surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <header class="flex min-h-[58px] shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div class="min-w-0">
        <h2 class="m-0 truncate text-[14px] font-650">{{ activeKb?.name ?? '文档列表' }}</h2>
        <p class="mb-0 mt-1 truncate text-[12px] text-subtle">
          {{ activeKb ? `${documents.length} 文档 · ${chunkCount} chunks` : '选择知识库后管理文档' }}
        </p>
      </div>
      <div v-if="activeKb" class="flex shrink-0 items-center gap-1">
        <Button variant="ghost" class="!h-8 !px-2.5" @click="$emit('edit', activeKb)">
          <Pencil :size="13" /> 编辑
        </Button>
        <Button variant="destructive" class="!h-8 !px-2.5" @click="$emit('remove', activeKb)">
          <Trash2 :size="13" /> 删除
        </Button>
      </div>
    </header>

    <KnowledgeUploadZone
      :disabled="!activeKb"
      :items="uploadQueue"
      @files="$emit('files', $event)"
      @retry="$emit('retryUpload', $event)"
    />
    <KnowledgeDocumentTable
      :documents="documents"
      :loading="loading"
      :active="Boolean(activeKb)"
      @open="$emit('openDocument', $event)"
      @retry="$emit('retryDocument', $event)"
      @remove="$emit('removeDocument', $event)"
      @show-error="$emit('showDocumentError', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { Pencil, Trash2 } from 'lucide-vue-next'
import { Button } from '@ai-reflow/ui'
import type { KnowledgeBaseItem, KnowledgeDocument, UploadItem } from '../types'
import KnowledgeDocumentTable from './KnowledgeDocumentTable.vue'
import KnowledgeUploadZone from './KnowledgeUploadZone.vue'

defineProps<{
  activeKb?: KnowledgeBaseItem
  documents: KnowledgeDocument[]
  chunkCount: number
  loading: boolean
  uploadQueue: UploadItem[]
}>()

defineEmits<{
  edit: [knowledgeBase: KnowledgeBaseItem]
  remove: [knowledgeBase: KnowledgeBaseItem]
  files: [files: File[]]
  retryUpload: [item: UploadItem]
  openDocument: [document: KnowledgeDocument]
  retryDocument: [document: KnowledgeDocument]
  removeDocument: [document: KnowledgeDocument]
  showDocumentError: [document: KnowledgeDocument]
}>()
</script>
