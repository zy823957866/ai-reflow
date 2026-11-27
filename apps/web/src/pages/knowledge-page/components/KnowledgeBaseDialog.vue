<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
      <DialogContent class="w-[min(480px,calc(100vw-28px))]">
        <DialogTitle class="m-0 text-[17px] font-700">{{ knowledgeBase ? '编辑知识库' : '新建知识库' }}</DialogTitle>
        <DialogDescription class="mb-[13px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
          embedding 模型与维度由部署配置决定，创建后不可单独切换。
        </DialogDescription>
        <form class="flex flex-col gap-3" @submit.prevent="submit">
          <div class="flex flex-col gap-1.5">
            <Label for="knowledge-base-name">名称</Label>
            <Input id="knowledge-base-name" v-model="name" placeholder="例如：售后政策中心" autofocus />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="knowledge-base-description">描述</Label>
            <Textarea id="knowledge-base-description" v-model="description" rows="3" placeholder="说明文档范围与使用场景" />
          </div>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line">
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">embedding 模型</span>
              <strong class="truncate font-mono text-muted">nomic-embed-text</strong>
            </div>
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">维度</span>
              <strong class="text-muted">768</strong>
            </div>
          </div>
          <DialogFooter class="mt-2">
            <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="!name.trim() || saving">
              {{ saving ? '保存中...' : knowledgeBase ? '保存修改' : '创建知识库' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
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

/** 表单字段：知识库名称 */
const name = ref('')
/** 表单字段：知识库描述 */
const description = ref('')

// 弹窗打开时回填当前知识库信息（新建则为空）
watch(
  () => [props.open, props.knowledgeBase] as const,
  ([open, knowledgeBase]) => {
    if (!open) return
    name.value = knowledgeBase?.name ?? ''
    description.value = knowledgeBase?.description ?? ''
  },
  { immediate: true },
)

/** 提交表单：去空白后把名称与描述抛给父组件 */
function submit() {
  if (!name.value.trim() || props.saving) return
  emit('submit', {
    name: name.value.trim(),
    description: description.value.trim(),
  })
}
</script>
