<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="w-[min(720px,calc(100vw-28px))]"
      :show-close="!running"
    >
      <div>
        <DialogTitle class="m-0">新增知识库</DialogTitle>
        <DialogDescription class="mt-1.5">
          上传附件到“{{ knowledgeBase?.name ?? '当前知识库' }}”，确认后开始解析并建立索引。
        </DialogDescription>
      </div>

      <div
        v-if="!running"
        class="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[7px] border border-dashed px-4 py-5 text-center text-[12px] transition-colors"
        :class="dragActive
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border-strong bg-[var(--surface-2)] text-subtle hover:border-primary hover:text-primary'"
        @click="triggerFilePicker"
        @dragover.prevent="dragActive = true"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="handleDrop"
      >
        <span class="flex h-10 w-10 items-center justify-center rounded-[8px] bg-surface text-primary">
          <UploadCloud :size="20" />
        </span>
        <span>
          <strong class="block text-[13px] text-ink">选择或拖入附件</strong>
          <small class="mt-1 block text-[12px] text-subtle">
            支持 PDF、Word、Excel、CSV、Markdown、TXT 和 HTML，单文件不超过 50 MB
          </small>
        </span>
        <Button variant="outline" size="xs" @click.stop="triggerFilePicker">
          选择文件
        </Button>
        <input
          ref="fileInput"
          class="hidden"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.md,.markdown,.txt,.html"
          @change="handleFileInput"
        />
      </div>

      <div v-if="visibleFiles.length" class="min-w-0">
        <div class="mb-2 flex items-center justify-between gap-2 text-[12px]">
          <strong class="text-ink">{{ running ? '正在录入' : '待上传附件' }}</strong>
          <span class="text-subtle">{{ visibleFiles.length }} 个附件</span>
        </div>
        <div class="max-h-[300px] overflow-y-auto rounded-[7px] border border-line">
          <div
            v-for="item in visibleFiles"
            :key="item.id"
            class="grid min-h-[58px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-dashed border-line px-3 py-2 text-[12px] last:border-b-0"
          >
            <span class="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary-soft text-primary">
              <FileText :size="15" />
            </span>
            <span class="min-w-0">
              <strong class="block truncate text-ink">{{ item.name }}</strong>
              <small
                class="mt-0.5 block truncate"
                :class="item.error ? 'text-danger' : 'text-subtle'"
                :title="statusDetail(item)"
              >
                {{ statusDetail(item) }}
              </small>
              <span
                v-if="running"
                class="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--surface-3)]"
              >
                <i
                  class="block h-full rounded-full transition-[width]"
                  :class="item.status === 'failed' ? 'bg-danger' : 'bg-primary'"
                  :style="{ width: `${item.progress}%` }"
                />
              </span>
            </span>
            <span class="flex items-center gap-1">
              <template v-if="running">
                <StatusBadge :status="item.status" />
              </template>
              <Button
                v-else
                variant="ghost"
                size="icon-sm"
                class="!h-7 !w-7 text-subtle hover:text-danger"
                aria-label="移除附件"
                title="移除附件"
                @click="removeFile(item.id)"
              >
                <Trash2 :size="13" />
              </Button>
            </span>
          </div>
        </div>
      </div>

      <DialogFooter class="mt-1">
        <Button variant="outline" :disabled="running" @click="close">取消</Button>
        <Button
          :disabled="running || !pendingFiles.length || hasInvalidFiles"
          @click="submit"
        >
          <LoaderCircle v-if="running" :size="14" class="animate-spin" />
          {{ running ? '录入中...' : '确定' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileText, LoaderCircle, Trash2, UploadCloud } from 'lucide-vue-next'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@ai-reflow/ui'
import StatusBadge from '@/components/StatusBadge.vue'
import { getUploadValidationError } from '../uploadBatch'
import type { KnowledgeBaseItem, UploadItem } from '../types'

interface PendingUploadFile {
  id: string
  name: string
  sizeLabel: string
  file: File
  error?: string
}

interface UploadDialogRow {
  id: string
  name: string
  sizeLabel: string
  progress: number
  status: UploadItem['status'] | 'pending'
  stage: string
  error?: string
}

const props = defineProps<{
  open: boolean
  knowledgeBase?: KnowledgeBaseItem
  items: UploadItem[]
  running: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [files: File[]]
}>()

const fileInput = ref<HTMLInputElement>()
const dragActive = ref(false)
const pendingFiles = ref<PendingUploadFile[]>([])
let nextFileId = 0

const visibleFiles = computed<UploadDialogRow[]>(() =>
  props.running
    ? props.items.map((item) => ({
        id: item.id,
        name: item.name,
        sizeLabel: item.sizeLabel,
        progress: item.progress,
        status: item.status,
        stage: item.stage,
        error: item.error,
      }))
    : pendingFiles.value.map((item) => ({
        id: item.id,
        name: item.name,
        sizeLabel: item.sizeLabel,
        progress: 0,
        status: 'pending',
        stage: '待上传',
        error: item.error,
      })),
)
const hasInvalidFiles = computed(() =>
  pendingFiles.value.some((item) => Boolean(item.error)),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pendingFiles.value = []
    dragActive.value = false
  },
)

watch(
  () => props.running,
  (running) => {
    if (running) dragActive.value = false
  },
)

function triggerFilePicker() {
  if (props.running) return
  fileInput.value?.click()
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) addFiles([...input.files])
  input.value = ''
}

function handleDrop(event: DragEvent) {
  dragActive.value = false
  if (props.running || !event.dataTransfer?.files.length) return
  addFiles([...event.dataTransfer.files])
}

function addFiles(files: File[]) {
  pendingFiles.value.push(
    ...files.map((file) => ({
      id: `pending_${nextFileId++}`,
      name: file.name,
      sizeLabel: formatFileSize(file.size),
      file,
      error: getUploadValidationError(file),
    })),
  )
}

function removeFile(id: string) {
  if (props.running) return
  pendingFiles.value = pendingFiles.value.filter((item) => item.id !== id)
}

function submit() {
  if (props.running || !pendingFiles.value.length || hasInvalidFiles.value) return
  emit('submit', pendingFiles.value.map((item) => item.file))
}

function handleOpenChange(open: boolean) {
  if (!open && props.running) return
  emit('update:open', open)
}

function close() {
  handleOpenChange(false)
}

function statusDetail(item: UploadDialogRow) {
  return `${item.sizeLabel} · ${item.error || item.stage}`
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
</script>
