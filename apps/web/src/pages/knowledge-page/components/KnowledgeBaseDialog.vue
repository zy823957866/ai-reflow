<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-80 bg-[rgba(18,20,26,0.28)] backdrop-blur-[2px]" />
      <DialogContent class="fixed left-1/2 top-1/2 z-81 w-[min(480px,calc(100vw-28px))] -translate-1/2 rounded-8px border border-line bg-surface p-[22px] shadow-lg">
        <DialogTitle class="m-0 text-[17px] font-700">{{ knowledgeBase ? '编辑知识库' : '新建知识库' }}</DialogTitle>
        <DialogDescription class="mb-[13px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
          embedding 模型与维度由部署配置决定，创建后不可单独切换。
        </DialogDescription>
        <form class="flex flex-col gap-3" @submit.prevent="submit">
          <label class="flex flex-col gap-1.5">
            <span class="text-[12px] font-600 text-muted">名称</span>
            <input v-model="name" placeholder="例如：售后政策中心" autofocus />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[12px] font-600 text-muted">描述</span>
            <textarea v-model="description" rows="3" placeholder="说明文档范围与使用场景" />
          </label>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line">
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">embedding 模型</span>
              <strong class="truncate font-mono text-muted">text-embedding-3-small</strong>
            </div>
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">维度</span>
              <strong class="text-muted">1536</strong>
            </div>
          </div>
          <div class="mt-2 flex justify-end gap-2">
            <DialogClose as-child><button class="btn" type="button">取消</button></DialogClose>
            <button class="btn btn-primary" type="submit" :disabled="!name.trim() || saving">
              {{ saving ? '保存中...' : knowledgeBase ? '保存修改' : '创建知识库' }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import type { KnowledgeBaseItem } from '../types'

const props = defineProps<{
  open: boolean
  knowledgeBase?: KnowledgeBaseItem
  saving: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [value: { name: string; description: string }]
}>()

const name = ref('')
const description = ref('')

watch(
  () => [props.open, props.knowledgeBase] as const,
  ([open, knowledgeBase]) => {
    if (!open) return
    name.value = knowledgeBase?.name ?? ''
    description.value = knowledgeBase?.description ?? ''
  },
  { immediate: true },
)

function submit() {
  if (!name.value.trim() || props.saving) return
  emit('submit', {
    name: name.value.trim(),
    description: description.value.trim(),
  })
}
</script>
