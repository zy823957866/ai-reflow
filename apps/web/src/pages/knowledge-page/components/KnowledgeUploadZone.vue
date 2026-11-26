<template>
  <div class="border-b border-line p-3">
    <div
      class="flex min-h-[72px] flex-wrap items-center justify-center gap-2 rounded-[7px] border border-dashed px-3 py-2 text-center text-[12px]"
      :class="dragActive
        ? 'border-primary bg-primary-soft text-primary'
        : disabled
          ? 'cursor-not-allowed border-line bg-[var(--surface-2)] text-subtle opacity-70'
          : 'border-border-strong bg-[var(--surface-2)] text-subtle'"
      @dragover.prevent="!disabled && (dragActive = true)"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <UploadCloud :size="18" />
      <span>拖入 PDF、Word、Excel、CSV、Markdown 或 TXT</span>
      <Button variant="link" size="xs" :disabled="disabled" @click="triggerFilePicker">
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

    <div v-if="items.length" class="mt-2 max-h-32 overflow-y-auto rounded-[7px] border border-line">
      <div
        v-for="item in items"
        :key="item.id"
        class="grid min-h-11 grid-cols-[26px_minmax(0,1fr)_minmax(60px,96px)_auto] items-center gap-2 border-b border-dashed border-line px-2 text-[12px] last:border-b-0"
      >
        <span class="flex h-7 w-7 items-center justify-center rounded-[5px] bg-primary-soft text-primary">
          <FileText :size="14" />
        </span>
        <span class="min-w-0">
          <strong class="block truncate">{{ item.name }}</strong>
          <small class="block truncate text-[12px] text-subtle">{{ item.sizeLabel }} · {{ item.stage }}</small>
        </span>
        <span class="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <i class="block h-full rounded-full bg-primary transition-[width]" :style="{ width: `${item.progress}%` }" />
        </span>
        <span class="flex items-center gap-1">
          <StatusBadge :status="item.status" />
          <Button v-if="item.status === 'failed'" variant="link" size="xs" @click="$emit('retry', item)">
            重试
          </Button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FileText, UploadCloud } from 'lucide-vue-next'
import { Button } from '@ai-reflow/ui'
import StatusBadge from '@/components/StatusBadge.vue'
import type { UploadItem } from '../types'

const props = defineProps<{
  disabled: boolean
  items: UploadItem[]
}>()

const emit = defineEmits<{
  files: [files: File[]]
  retry: [item: UploadItem]
}>()

const fileInput = ref<HTMLInputElement>()
const dragActive = ref(false)

function triggerFilePicker() {
  fileInput.value?.click()
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) emit('files', [...input.files])
  input.value = ''
}

function handleDrop(event: DragEvent) {
  dragActive.value = false
  if (props.disabled) return
  if (event.dataTransfer?.files) emit('files', [...event.dataTransfer.files])
}
</script>
