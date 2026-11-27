<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="w-[min(460px,calc(100vw-28px))]">
      <DialogTitle class="m-0 text-[17px] font-700">切片设置</DialogTitle>
      <DialogDescription class="mb-[13px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
        新上传文档和重新构建索引时使用以下参数。
      </DialogDescription>
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label for="knowledge-chunk-size">chunkSize</Label>
            <Input
              id="knowledge-chunk-size"
              v-model.number="chunkSize"
              type="number"
              min="40"
              max="4000"
              step="1"
            />
            <small class="text-[12px] text-subtle">40 - 4000 字符</small>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="knowledge-overlap-size">overlapSize</Label>
            <Input
              id="knowledge-overlap-size"
              v-model.number="overlapSize"
              type="number"
              min="0"
              :max="maxOverlap"
              step="1"
            />
            <small class="text-[12px] text-subtle">必须小于 chunkSize</small>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="knowledge-separator">分隔符</Label>
          <Input
            id="knowledge-separator"
            v-model="separator"
            placeholder="\\n\\n"
          />
          <small class="text-[12px] text-subtle">支持 \\n、\\r、\\t 转义</small>
        </div>
        <div class="rounded-[6px] border border-line bg-[var(--surface-2)] px-3 py-2 text-[12px] text-muted">
          当前策略：structured · {{ chunkSize }}/{{ overlapSize }}
        </div>
        <DialogFooter class="mt-2">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button type="submit" :disabled="!valid || saving">
            {{ saving ? '保存中...' : '保存设置' }}
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
  submit: [value: {
    chunkSize: number
    overlapSize: number
    separator: string
  }]
}>()

/** 切片大小（字符数），范围 40 - 4000 */
const chunkSize = ref(800)
/** 相邻切片的重叠字符数，必须小于 chunkSize */
const overlapSize = ref(120)
/** 切片分隔符（支持 \n、\r、\t 转义写法） */
const separator = ref('\\n\\n')
/** overlapSize 输入框的动态上限（chunkSize - 1） */
const maxOverlap = computed(() => Math.max(0, chunkSize.value - 1))

/** 表单整体校验结果：范围、整数与非空分隔符 */
const valid = computed(
  () =>
    Number.isInteger(chunkSize.value) &&
    chunkSize.value >= 40 &&
    chunkSize.value <= 4000 &&
    Number.isInteger(overlapSize.value) &&
    overlapSize.value >= 0 &&
    overlapSize.value < chunkSize.value &&
    Boolean(separator.value.trim()),
)

// 打开弹窗时用知识库当前切片参数回填表单
watch(
  () => [props.open, props.knowledgeBase] as const,
  ([open, knowledgeBase]) => {
    if (!open || !knowledgeBase) return
    chunkSize.value = knowledgeBase.chunkSize ?? 800
    overlapSize.value = knowledgeBase.overlapSize ?? 120
    separator.value = knowledgeBase.separator ?? '\\n\\n'
  },
  { immediate: true },
)

// chunkSize 调小到不大于 overlapSize 时，自动下调 overlapSize
watch(chunkSize, (value) => {
  if (Number.isFinite(value) && overlapSize.value >= value) {
    overlapSize.value = Math.max(0, Math.round(value) - 1)
  }
})

/** 提交切片设置（校验通过且非保存中才 emit） */
function submit() {
  if (!valid.value || props.saving) return
  emit('submit', {
    chunkSize: chunkSize.value,
    overlapSize: overlapSize.value,
    separator: separator.value,
  })
}
</script>
