<template>
  <section class="surface flex h-full min-h-0 flex-col overflow-hidden">
    <header class="flex min-h-[58px] items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div class="min-w-0">
        <h2 class="m-0 text-[14px] font-650">知识库分组</h2>
        <p class="mb-0 mt-1 text-[12px] text-subtle">{{ knowledgeBases.length }} 个知识库</p>
      </div>
      <button class="btn btn-primary !h-8 !px-2.5" @click="$emit('create')">
        <Plus :size="14" /> 新建
      </button>
    </header>

    <div class="border-b border-line p-3">
      <label class="control-shell flex h-9 items-center gap-2 rounded-[7px] px-2.5">
        <Search :size="14" class="shrink-0 text-subtle" />
        <input
          :value="query"
          class="min-w-0 flex-1 bg-transparent p-0 text-[12px]"
          placeholder="搜索知识库..."
          @input="$emit('update:query', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="mt-2.5 inline-flex w-full rounded-[7px] border border-line bg-[var(--surface-2)] p-[3px]">
        <button
          v-for="option in statusOptions"
          :key="option.value"
          class="h-7 min-w-0 flex-1 rounded-[5px] border-0 px-1.5 text-[12px]"
          :class="statusFilter === option.value ? 'bg-ink text-white' : 'bg-transparent text-subtle'"
          @click="$emit('update:statusFilter', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <button
        v-for="kb in knowledgeBases"
        :key="kb.id"
        class="mb-1.5 w-full rounded-[7px] border p-2.5 text-left transition-colors"
        :class="activeKbId === kb.id
          ? 'border-primary bg-primary-soft'
          : 'border-transparent bg-transparent hover:border-line hover:bg-[var(--surface-2)]'"
        @click="$emit('select', kb.id)"
      >
        <span class="flex min-w-0 items-start gap-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-surface text-primary">
            <BookOpen :size="16" />
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-[12px]">{{ kb.name }}</strong>
            <small class="mt-0.5 line-clamp-2 block text-[12px] leading-[1.45] text-subtle">
              {{ kb.description || '暂无描述' }}
            </small>
          </span>
        </span>
        <span class="mt-2 flex min-w-0 items-center gap-1.5 border-t border-line/70 pt-2 text-[12px] text-subtle">
          <StatusBadge :status="kb.status === 'ready' ? 'ready' : kb.status" />
          <span>{{ kb.documents }} 文档</span>
          <span class="ml-auto">{{ compactNumber(kb.chunks) }} chunks</span>
        </span>
      </button>

      <div v-if="loading" class="flex min-h-28 items-center justify-center text-[12px] text-subtle">
        <LoaderCircle :size="16" class="mr-2 animate-spin" /> 正在加载
      </div>
      <div
        v-else-if="!knowledgeBases.length"
        class="flex min-h-36 flex-col items-center justify-center gap-2 px-2 text-center text-[12px] text-subtle"
      >
        <BookOpen :size="20" />
        <span>{{ query.trim() ? '没有匹配的知识库。' : '当前没有知识库。' }}</span>
        <button class="border-0 bg-transparent p-0 text-primary" @click="$emit('create')">新建知识库</button>
      </div>
    </div>

    <footer v-if="activeKb" class="flex items-center gap-1 border-t border-line p-2">
      <button class="btn btn-ghost !h-8 flex-1 !px-2" @click="$emit('edit', activeKb)">
        <Pencil :size="13" /> 编辑
      </button>
      <button class="btn btn-danger !h-8 flex-1 !px-2" @click="$emit('remove', activeKb)">
        <Trash2 :size="13" /> 删除
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-vue-next'
import StatusBadge from '@/components/StatusBadge.vue'
import type { KnowledgeBaseItem } from '../types'

const props = defineProps<{
  knowledgeBases: KnowledgeBaseItem[]
  activeKbId: string
  loading: boolean
  query: string
  statusFilter: string
}>()

defineEmits<{
  select: [id: string]
  create: []
  edit: [knowledgeBase: KnowledgeBaseItem]
  remove: [knowledgeBase: KnowledgeBaseItem]
  'update:query': [value: string]
  'update:statusFilter': [value: string]
}>()

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'indexing', label: '同步中' },
  { value: 'ready', label: '完成' },
]

const activeKb = computed(() => props.knowledgeBases.find((item) => item.id === props.activeKbId))

function compactNumber(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}
</script>
