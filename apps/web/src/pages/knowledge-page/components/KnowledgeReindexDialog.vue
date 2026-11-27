<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent
      class="w-[min(440px,calc(100vw-28px))]"
      :show-close="!running"
    >
      <DialogTitle class="m-0 text-[17px] font-700">重建索引</DialogTitle>
      <DialogDescription class="mb-3 mt-1.5 text-[12px] leading-[1.6] text-subtle">
        将清理当前切片和向量索引，再使用知识库当前的切片设置重新解析。
      </DialogDescription>

      <div class="rounded-[6px] border border-line bg-[var(--surface-2)] px-3 py-2.5">
        <p class="m-0 truncate text-[13px] font-550 text-ink" :title="document?.name">
          {{ document?.name ?? '未选择文档' }}
        </p>
        <p class="mb-0 mt-1 text-[12px] text-subtle">
          {{ document ? `${document.size} · ${document.chunks} chunks` : '' }}
        </p>
      </div>

      <p class="mb-0 mt-3 text-[12px] leading-[1.6] text-muted">
        提交后将在后台完成解析与向量化，文档列表会持续显示最新进度。
      </p>

      <DialogFooter class="mt-4">
        <Button
          variant="outline"
          :disabled="running"
          @click="$emit('update:open', false)"
        >
          取消
        </Button>
        <Button :disabled="running || !document" @click="$emit('confirm')">
          <LoaderCircle v-if="running" :size="14" class="animate-spin" />
          {{ running ? '正在提交...' : '开始重建' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import type { KnowledgeDocument } from '../types'

defineProps<{
  open: boolean
  document?: KnowledgeDocument
  running: boolean
}>()

defineEmits<{
  'update:open': [open: boolean]
  confirm: []
}>()
</script>
