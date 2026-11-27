<template>
  <Drawer
    :open="isOpen"
    direction="right"
    :should-scale-background="false"
    :set-background-color-on-scale="false"
    @update:open="handleOpenChange"
    @animation-end="handleAnimationEnd"
  >
    <DrawerContent v-if="activeDocument">
      <header
        class="flex min-h-[64px] shrink-0 items-center gap-4 border-b border-line px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <DrawerTitle class="m-0 truncate text-[16px]">
              {{ activeDocument.name }}
            </DrawerTitle>
            <StatusBadge :status="documentBadgeStatus(activeDocument)" />
          </div>
          <DrawerDescription class="mb-0 mt-1 text-[12px] text-subtle">
            {{ activeDocument.extension.toUpperCase() }} · {{ activeDocument.size }} ·
            {{ activeDocument.chunks }} chunks
          </DrawerDescription>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <Button
            v-if="activeDocument.error"
            variant="link"
            size="xs"
            class="text-danger"
            @click="emit('showError', activeDocument)"
          >
            查看错误
          </Button>
          <Button
            v-if="activeDocument.status === 'failed'"
            variant="link"
            size="xs"
            @click="emit('retry', activeDocument)"
          >
            重试失败阶段
          </Button>
          <Button variant="outline" size="xs" @click="emit('rebuild', activeDocument)">
            重建索引
          </Button>
          <DrawerClose as-child>
            <Button variant="ghost" size="icon-sm" aria-label="关闭预览">
              <X :size="16" />
            </Button>
          </DrawerClose>
        </div>
      </header>

      <div data-vaul-no-drag class="min-h-0 flex-1 p-4">
        <div class="grid h-full min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] gap-3">
          <DocumentSourcePreview :document="activeDocument" />

          <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
            <div class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3 text-[12px] text-muted">
              <span>切片</span>
              <small class="text-[12px] text-subtle">{{ chunks.length }} 条</small>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <Button
                v-for="chunk in chunks"
                :key="chunk.id"
                variant="unstyled"
                type="button"
                class="mx-1.5 mt-1.5 flex w-[calc(100%-12px)] flex-col items-start gap-1.5 rounded-[6px] border p-2.5 text-left transition-colors"
                :class="selectedChunkId === chunk.id ? 'border-primary bg-primary-soft' : 'border-line bg-white hover:border-border-strong hover:bg-[var(--surface-3)]'"
                @click="selectedChunkId = chunk.id"
              >
                <span class="flex w-full min-w-0 items-baseline justify-between gap-2">
                  <strong class="min-w-0 flex-1 truncate text-[12px] font-600 text-ink" :title="chunk.title">
                    {{ chunk.title }}
                  </strong>
                  <span class="max-w-[62%] shrink-0 truncate font-mono text-[11px] text-subtle" :title="chunk.id">
                    {{ chunk.id }}
                  </span>
                </span>
                <p class="m-0 line-clamp-3 text-[12px] leading-[1.5] text-muted">{{ chunk.content }}</p>
                <span class="text-[12px] text-subtle">{{ chunk.location }} · {{ chunk.tokens }} tokens</span>
              </Button>
              <div v-if="chunksLoading" class="flex min-h-60 items-center justify-center gap-2 text-[12px] text-subtle">
                <LoaderCircle :size="14" class="animate-spin" /> 正在读取切片
              </div>
              <div v-else-if="!chunks.length" class="flex min-h-60 items-center justify-center text-[12px] text-subtle">
                没有可展示的切片。
              </div>
            </div>
          </section>

          <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
            <div class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3 text-[12px] text-muted">
              <span class="shrink-0 whitespace-nowrap">选中切片预览</span>
              <small v-if="selectedChunk" class="truncate text-[12px] text-subtle">{{ selectedChunk.location }}</small>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto bg-white">
              <div v-if="chunksLoading" class="flex min-h-60 items-center justify-center gap-2 text-[12px] text-subtle">
                <LoaderCircle :size="14" class="animate-spin" /> 正在读取切片
              </div>
              <div v-else-if="!selectedChunk" class="flex min-h-60 flex-col items-center justify-center gap-2 text-[12px] text-subtle">
                <FileSearch :size="18" /> 该文档尚无可展示切片。
              </div>
              <article v-else class="px-5 py-5">
                <div class="flex flex-wrap items-center gap-2 text-[12px] text-subtle">
                  <span class="rounded-[4px] bg-primary-soft px-1.5 py-0.5 font-mono text-primary">{{ selectedChunk.id }}</span>
                  <span>{{ selectedChunk.tokens }} tokens</span>
                  <span>{{ selectedChunk.embeddingStatus }}</span>
                </div>
                <h3 class="mb-2.5 mt-4 text-[15px] leading-6 text-ink">{{ selectedChunk.title }}</h3>
                <p class="m-0 whitespace-pre-wrap text-[13px] leading-[1.8] text-muted">{{ selectedChunk.content }}</p>
              </article>
            </div>
          </section>
        </div>
      </div>
    </DrawerContent>
  </Drawer>
</template>

<script setup lang="ts">
import { FileSearch, LoaderCircle, X } from 'lucide-vue-next'
import StatusBadge from '@/components/StatusBadge.vue'
import type { DocumentChunkDto } from '@/services/reflowApi'
import type { KnowledgeDocument } from '../types'
import DocumentSourcePreview from './DocumentSourcePreview.vue'

const props = defineProps<{
  open: boolean
  document?: KnowledgeDocument
  documentChunks: DocumentChunkDto[]
  chunksLoading: boolean
}>()

const emit = defineEmits<{
  close: []
  retry: [document: KnowledgeDocument]
  rebuild: [document: KnowledgeDocument]
  showError: [document: KnowledgeDocument]
}>()

/** 最近一次查看的文档，关闭抽屉后仍保留，避免收起动画期间内容闪空 */
const lastDocument = ref<KnowledgeDocument>()
/** 最近一次展示的切片，作用同上 */
const lastChunks = ref<DocumentChunkDto[]>([])
/** 当前选中的切片 id */
const selectedChunkId = ref('')

/** 抽屉实际可见状态：open 为真且传入了文档 */
const isOpen = computed(() => props.open && Boolean(props.document))
/** 当前展示的文档：优先取 props，关闭后回退到最近一次缓存 */
const activeDocument = computed(() => props.document ?? lastDocument.value)
/** 打开时取父级最新切片，关闭时用缓存（保证退出动画有内容可展示） */
const visibleDocumentChunks = computed(() =>
  props.open ? props.documentChunks : lastChunks.value,
)

/** 切片渲染行：把切片 DTO 映射为展示所需字段 */
const chunks = computed(() => visibleDocumentChunks.value.map((chunk) => ({
  id: chunk.id,
  title: String(chunk.metadata.title ?? `切片 ${chunk.chunkIndex + 1}`),
  content: chunk.snippet,
  location: chunk.location,
  tokens: chunk.tokenCount ?? 0,
  embeddingStatus: chunk.embeddingStatus,
})))
/** 选中的切片详情；未选中或选中项失效时默认取第一条 */
const selectedChunk = computed(() =>
  chunks.value.find((chunk) => chunk.id === selectedChunkId.value) ?? chunks.value[0],
)

// 记录最近一次传入的文档
watch(
  () => props.document,
  (document) => {
    if (document) lastDocument.value = document
  },
  { immediate: true },
)

// 打开期间记录最新切片，并保证选中项存在于新列表中
watch(
  () => props.documentChunks,
  (chunksValue) => {
    if (!props.open) return
    lastChunks.value = chunksValue
    if (!chunksValue.some((chunk) => chunk.id === selectedChunkId.value)) {
      selectedChunkId.value = chunksValue[0]?.id ?? ''
    }
  },
  { immediate: true },
)

/** 抽屉开关变化：用户关闭时通知父组件 */
function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

/** 关闭动画结束后清空缓存，为下一次打开做准备 */
function handleAnimationEnd(open: boolean) {
  if (open) return
  lastDocument.value = undefined
  lastChunks.value = []
  selectedChunkId.value = ''
}

/** 文档状态映射为状态徽标的三态展示 */
function documentBadgeStatus(document: KnowledgeDocument) {
  if (document.status === 'ready') return 'ready'
  if (document.status === 'failed') return 'failed'
  return 'processing'
}
</script>
