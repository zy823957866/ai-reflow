<template>
  <div v-if="open && document" class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" @click.self="$emit('close')">
    <aside class="absolute inset-y-0 right-0 flex w-[min(820px,100vw)] flex-col bg-surface shadow-lg">
      <header class="flex min-h-[62px] shrink-0 items-center justify-between gap-3.5 border-b border-line px-4 py-3">
        <div class="min-w-0">
          <h2 class="m-0 truncate text-[16px]">{{ document.name }}</h2>
          <p class="mb-0 mt-1 text-[12px] text-subtle">
            {{ document.extension.toUpperCase() }} · {{ document.size }} · {{ document.chunks }} chunks
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="关闭预览" @click="$emit('close')"><X :size="16" /></Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex min-h-10 flex-wrap items-center gap-2 text-[12px] text-subtle">
          <StatusBadge :status="documentBadgeStatus(document)" />
          <span v-if="preview?.previewStatus">预览：{{ preview.previewStatus }}</span>
          <Button v-if="document.error" variant="link" size="xs" class="text-danger" @click="$emit('showError', document)">
            查看错误
          </Button>
          <Button v-if="document.status === 'failed'" variant="link" size="xs" @click="$emit('retry', document)">
            重试失败阶段
          </Button>
          <Button variant="link" size="xs" class="ml-auto" @click="$emit('rebuild', document)">重建索引</Button>
        </div>

        <div class="mt-3 grid min-h-[390px] grid-cols-[minmax(0,1.1fr)_minmax(250px,0.9fr)] gap-2.5 max-[980px]:grid-cols-1">
          <section class="flex min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
            <div class="flex min-h-9 items-center justify-between border-b border-line px-2.5 text-[12px] text-muted">
              <span>切片文本预览</span>
              <small class="text-[12px] text-subtle">{{ locationSummary(document) }}</small>
            </div>
            <div class="relative min-h-[354px] bg-[#fdfdfc] px-[18px] py-5">
              <div class="flex items-center justify-between gap-3 text-[12px] text-subtle">
                <span class="truncate">{{ document.name }}</span>
                <span class="shrink-0">{{ selectedChunk?.location ?? '未提供定位' }}</span>
              </div>
              <div v-if="chunksLoading" class="mt-8 flex items-center justify-center gap-2 text-[12px] text-subtle">
                <LoaderCircle :size="14" class="animate-spin" /> 正在读取切片
              </div>
              <div v-else-if="!selectedChunk" class="mt-8 flex flex-col items-center justify-center gap-2 text-[12px] text-subtle">
                <FileSearch :size="18" /> 该文档尚无可展示切片。
              </div>
              <template v-else>
                <h3 class="mb-3 mt-6 text-[14px]">{{ document.titlePath?.[0] ?? selectedChunk.title }}</h3>
                <p class="mb-2.5 whitespace-pre-wrap text-[12px] leading-[1.75] text-muted">{{ selectedChunk.content }}</p>
              </template>
              <span class="absolute bottom-2.5 right-2.5 rounded-[4px] bg-white/80 px-1.5 py-0.5 font-mono text-[12px] text-subtle">
                切片正文
              </span>
            </div>
          </section>

          <section class="flex min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
            <div class="flex min-h-9 items-center justify-between border-b border-line px-2.5 text-[12px] text-muted">
              <span>切片</span>
              <small class="text-[12px] text-subtle">{{ chunks.length }} 条</small>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <Button variant="unstyled" type="button"
                v-for="chunk in chunks"
                :key="chunk.id"
                class="mx-1.5 mt-1.5 flex w-[calc(100%-12px)] flex-col items-start gap-1 rounded-[6px] border p-2 text-left"
                :class="selectedChunkId === chunk.id ? 'border-primary bg-primary-soft' : 'border-line hover:border-border-strong'"
                @click="selectedChunkId = chunk.id"
              >
                <span class="font-mono text-[12px] text-primary">{{ chunk.id }}</span>
                <strong class="text-[12px]">{{ chunk.title }}</strong>
                <p class="m-0 line-clamp-3 text-[12px] leading-[1.45] text-muted">{{ chunk.content }}</p>
                <span class="text-[12px] text-subtle">{{ chunk.location }} · {{ chunk.tokens }} tokens</span>
              </Button>
              <div v-if="!chunks.length && !chunksLoading" class="flex min-h-60 items-center justify-center text-[12px] text-subtle">
                没有可展示的切片。
              </div>
            </div>
          </section>
        </div>

        <section class="mt-3">
          <div class="mb-2 text-[12px] font-650 text-muted">定位元数据</div>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line max-[620px]:grid-cols-1">
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">文件类型</span>
              <strong class="truncate text-muted">{{ document.mime }}</strong>
            </div>
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">分块策略</span>
              <strong class="truncate text-muted">{{ document.chunkStrategy }}</strong>
            </div>
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">embedding</span>
              <strong class="truncate font-mono text-muted">{{ embeddingModel }}</strong>
            </div>
            <div class="flex min-h-[48px] flex-col justify-center gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]">
              <span class="text-subtle">向量状态</span>
              <strong :class="embeddingStatusClass">{{ chunks[0]?.embeddingStatus ?? '无切片' }}</strong>
            </div>
          </div>
        </section>
      </div>

      <footer class="flex shrink-0 justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-4 py-3">
        <Button variant="outline" @click="copyChunks">复制切片</Button>
        <Button @click="$emit('close')">关闭预览</Button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileSearch, LoaderCircle, X } from 'lucide-vue-next'
import { Button } from '@ai-reflow/ui'
import StatusBadge from '@/components/StatusBadge.vue'
import type { DocumentChunkDto, KnowledgePreviewDto } from '@/services/reflowApi'
import type { KnowledgeDocument } from '../types'

const props = defineProps<{
  open: boolean
  document?: KnowledgeDocument
  documentChunks: DocumentChunkDto[]
  chunksLoading: boolean
  preview?: KnowledgePreviewDto
  embeddingModel?: string
}>()

defineEmits<{
  close: []
  retry: [document: KnowledgeDocument]
  rebuild: [document: KnowledgeDocument]
  showError: [document: KnowledgeDocument]
}>()

const selectedChunkId = ref('')

const chunks = computed(() => props.documentChunks.map((chunk) => ({
  id: chunk.id,
  title: String(chunk.metadata.title ?? `切片 ${chunk.chunkIndex + 1}`),
  content: chunk.snippet,
  location: chunk.location,
  tokens: chunk.tokenCount ?? 0,
  embeddingStatus: chunk.embeddingStatus,
})))
const selectedChunk = computed(() =>
  chunks.value.find((chunk) => chunk.id === selectedChunkId.value) ?? chunks.value[0],
)
const embeddingStatusClass = computed(() => {
  const status = chunks.value[0]?.embeddingStatus
  if (status === 'failed') return 'text-danger'
  if (status === 'ready') return 'text-success'
  return 'text-warning'
})

watch(
  () => props.documentChunks,
  (chunksValue) => {
    if (!chunksValue.some((chunk) => chunk.id === selectedChunkId.value)) {
      selectedChunkId.value = chunksValue[0]?.id ?? ''
    }
  },
  { immediate: true },
)

function documentBadgeStatus(document: KnowledgeDocument) {
  if (document.status === 'ready') return 'ready'
  if (document.status === 'failed') return 'failed'
  return 'processing'
}

function locationSummary(document: KnowledgeDocument) {
  if (document.pages) return `${document.pages} 页`
  if (document.rows) return `${document.rows} 行`
  return '文本文件'
}

async function copyChunks() {
  await navigator.clipboard?.writeText(chunks.value.map((item) => item.content).join('\n\n'))
}

</script>
