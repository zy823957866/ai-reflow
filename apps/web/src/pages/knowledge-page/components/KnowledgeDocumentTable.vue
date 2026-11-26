<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex min-h-[42px] shrink-0 items-center justify-between gap-2 border-b border-line px-3">
      <span class="text-[12px] text-subtle">文档列表</span>
      <Select v-model="documentStatus">
        <SelectTrigger class="h-8 w-auto min-w-[112px] px-2 text-[12px]" aria-label="按文档状态筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="ready">已索引</SelectItem>
          <SelectItem value="processing">处理中</SelectItem>
          <SelectItem value="failed">索引失败</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full min-w-[760px] border-collapse [&_th]:h-9 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[12px] [&_th]:font-500 [&_th]:text-subtle [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-[12px] [&_td]:text-muted [&_tbody_tr:last-child_td]:border-b-0">
        <thead>
          <tr>
            <th>文档</th>
            <th>类型</th>
            <th>大小</th>
            <th>分块</th>
            <th>状态</th>
            <th>更新</th>
            <th class="!w-[92px]" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="document in pagedDocuments" :key="document.id">
            <td>
              <Button variant="unstyled" type="button" class="flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left" @click="$emit('open', document)">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] font-mono font-700 uppercase"
                  :class="fileMarkClass(document.extension)"
                >
                  {{ document.extension }}
                </span>
                <span class="flex min-w-0 flex-col">
                  <strong class="max-w-[240px] truncate font-500">{{ document.name }}</strong>
                  <small class="max-w-[240px] truncate text-[12px] text-subtle">{{ document.chunkStrategy }}</small>
                </span>
              </Button>
            </td>
            <td>{{ document.extension.toUpperCase() }}</td>
            <td>{{ document.size }}</td>
            <td>{{ document.chunks }}</td>
            <td>
              <Button variant="unstyled" type="button"
                class="flex flex-col items-start gap-1 border-0 bg-transparent p-0"
                :title="document.error || '查看文档'"
                @click="document.error ? $emit('showError', document) : $emit('open', document)"
              >
                <StatusBadge :status="document.status" />
                <small class="text-[12px] text-subtle">
                  {{ ingestStageLabel(document.status) }}
                  <template v-if="isProcessing(document)">
                    · {{ documentProgress(document) }}%
                  </template>
                </small>
                <span v-if="document.error" class="inline-flex max-w-[180px] items-center gap-1 truncate text-danger" :title="document.error">
                  <CircleAlert :size="12" /> 查看错误
                </span>
              </Button>
            </td>
            <td>{{ relativeTime(document.updatedAt) }}</td>
            <td>
              <div class="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" class="!h-7 !w-7" title="查看切片与原文" @click="$emit('open', document)">
                  <Eye :size="13" />
                </Button>
                <Button
                  v-if="document.status === 'failed'"
                  variant="ghost"
                  size="icon-sm"
                  class="!h-7 !w-7"
                  title="重试索引"
                  @click="$emit('retry', document)"
                >
                  <RefreshCw :size="13" />
                </Button>
                <Button
                  v-if="document.status === 'ready' || document.status === 'failed'"
                  variant="ghost"
                  size="icon-sm"
                  class="!h-7 !w-7"
                  title="重建索引"
                  @click="$emit('reindex', document)"
                >
                  <RefreshCcw :size="13" />
                </Button>
                <Button variant="ghost" size="icon-sm" class="!h-7 !w-7" title="删除文档" @click="$emit('remove', document)">
                  <Trash2 :size="13" />
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="loading" class="flex min-h-32 items-center justify-center gap-2 text-[12px] text-subtle">
        <LoaderCircle :size="16" class="animate-spin" /> 正在加载文档
      </div>
      <div v-else-if="!pagedDocuments.length" class="flex min-h-32 flex-col items-center justify-center gap-2 text-[12px] text-subtle">
        <FileSearch :size="20" />
        <span>{{ active ? '当前知识库没有匹配文档。' : '请先选择知识库。' }}</span>
      </div>
    </div>

    <footer class="flex min-h-10 shrink-0 items-center justify-between border-t border-line px-3 text-[12px] text-subtle">
      <span>显示 {{ filteredDocuments.length ? pageStart + 1 : 0 }}–{{ Math.min(pageStart + pageSize, filteredDocuments.length) }} / {{ filteredDocuments.length }}</span>
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" class="!h-7 !w-7" :disabled="page === 1" @click="page--"><ChevronLeft :size="13" /></Button>
        <span>{{ page }} / {{ totalPages }}</span>
        <Button variant="ghost" size="icon-sm" class="!h-7 !w-7" :disabled="page >= totalPages" @click="page++"><ChevronRight :size="13" /></Button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  FileSearch,
  LoaderCircle,
  RefreshCcw,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai-reflow/ui'
import StatusBadge from '@/components/StatusBadge.vue'
import { relativeTime } from '@/shared/format'
import { ingestProgress, ingestStageLabel } from '../status'
import type { KnowledgeDocument } from '../types'

const props = defineProps<{
  documents: KnowledgeDocument[]
  loading: boolean
  active: boolean
}>()

defineEmits<{
  open: [document: KnowledgeDocument]
  retry: [document: KnowledgeDocument]
  reindex: [document: KnowledgeDocument]
  remove: [document: KnowledgeDocument]
  showError: [document: KnowledgeDocument]
}>()

const documentStatus = ref('all')
const page = ref(1)
const pageSize = 8

const filteredDocuments = computed(() => props.documents.filter((document) => {
  if (
    documentStatus.value !== 'all' &&
    (documentStatus.value === 'processing'
      ? !isProcessing(document)
      : document.status !== documentStatus.value)
  ) {
    return false
  }
  return true
}))
const totalPages = computed(() => Math.max(1, Math.ceil(filteredDocuments.value.length / pageSize)))
const pageStart = computed(() => (page.value - 1) * pageSize)
const pagedDocuments = computed(() => filteredDocuments.value.slice(pageStart.value, pageStart.value + pageSize))

watch([documentStatus, () => props.documents.length], () => {
  page.value = 1
})
watch(totalPages, (value) => {
  if (page.value > value) page.value = value
})

function isProcessing(document: KnowledgeDocument) {
  return ['queued', 'parsing', 'chunking', 'embedding'].includes(document.status)
}

function documentProgress(document: KnowledgeDocument) {
  return ingestProgress(document.status, document.progress)
}

function fileMarkClass(extension: string) {
  if (extension === 'xlsx' || extension === 'csv') return 'bg-success-soft text-success'
  if (extension === 'docx' || extension === 'doc') return 'bg-primary-soft text-primary'
  return 'bg-info-soft text-info'
}
</script>
