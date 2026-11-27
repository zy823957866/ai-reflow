<template>
  <section class="surface flex h-full min-h-0 flex-col overflow-hidden">
    <header class="flex min-h-[58px] items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div class="min-w-0">
        <h2 class="m-0 text-[14px] font-650">知识库分组</h2>
        <p class="mb-0 mt-1 text-[12px] text-subtle">{{ knowledgeBases.length }} 个知识库</p>
      </div>
      <Button class="!h-8 !px-2.5" @click="openCreate">
        <Plus :size="14" /> 新建
      </Button>
    </header>

    <div class="border-b border-line p-3">
      <label class="control-shell flex h-9 items-center gap-2 rounded-[7px] px-2.5">
        <Search :size="14" class="shrink-0 text-subtle" />
        <Input
          v-model="query"
          class="min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-[12px]"
          placeholder="搜索知识库..."
        />
      </label>
      <div class="mt-2.5 inline-flex w-full rounded-[7px] border border-line bg-[var(--surface-2)] p-[3px]">
        <Button
          v-for="option in statusOptions"
          :key="option.value"
          variant="unstyled"
          type="button"
          class="h-7 min-w-0 flex-1 rounded-[5px] border-0 px-1.5 text-[12px]"
          :class="statusFilter === option.value ? 'bg-ink text-white' : 'bg-transparent text-subtle'"
          @click="statusFilter = option.value"
        >
          {{ option.label }}
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <Button
        v-for="knowledgeBase in knowledgeBases"
        :key="knowledgeBase.id"
        variant="unstyled"
        type="button"
        class="mb-1.5 w-full rounded-[7px] border p-2.5 text-left transition-colors"
        :class="activeKbId === knowledgeBase.id
          ? 'border-primary bg-primary-soft'
          : 'border-transparent bg-[#f6f8fa] hover:border-line hover:bg-[var(--surface-3)]'"
        @click="select(knowledgeBase.id)"
      >
        <span class="flex w-full min-w-0 items-start gap-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-surface text-primary">
            <BookOpen :size="16" />
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block truncate text-[12px]">{{ knowledgeBase.name }}</strong>
            <small class="mt-0.5 block truncate text-[12px] leading-[1.45] text-subtle">
              {{ knowledgeBase.description || '暂无描述' }}
            </small>
          </span>
        </span>
      </Button>

      <div v-if="loading" class="flex min-h-28 items-center justify-center text-[12px] text-subtle">
        <LoaderCircle :size="16" class="mr-2 animate-spin" /> 正在加载
      </div>
      <div
        v-else-if="!knowledgeBases.length"
        class="flex min-h-36 flex-col items-center justify-center gap-2 px-2 text-center text-[12px] text-subtle"
      >
        <BookOpen :size="20" />
        <span>{{ query.trim() ? '没有匹配的知识库。' : '当前没有知识库。' }}</span>
        <Button variant="link" size="xs" @click="openCreate">新建知识库</Button>
      </div>
    </div>

    <footer v-if="activeKb" class="flex h-11! items-center gap-1 border-t border-line p-2">
      <Button variant="ghost" class="h-8 flex-1 px-1.5" @click="openEdit(activeKb)">
        <Pencil :size="13" /> 编辑
      </Button>
      <Button variant="ghost" class="h-8 flex-1 px-1.5" @click="openChunkSettings(activeKb)">
        <SlidersHorizontal :size="13" /> 切片
      </Button>
      <Button
        variant="ghost"
        class="h-8 flex-1 px-1.5 text-danger hover:bg-danger-soft hover:text-danger"
        @click="removeKnowledgeBase(activeKb)"
      >
        <Trash2 :size="13" /> 删除
      </Button>
    </footer>

    <KnowledgeBaseDialog
      :open="editorOpen"
      :knowledge-base="editingKnowledgeBase"
      :saving="saving"
      @update:open="editorOpen = $event"
      @submit="submitEditor"
    />
    <KnowledgeChunkSettingsDialog
      :open="chunkSettingsOpen"
      :knowledge-base="chunkSettingsKnowledgeBase"
      :saving="savingChunkSettings"
      @update:open="chunkSettingsOpen = $event"
      @submit="submitChunkSettings"
    />
  </section>
</template>

<script setup lang="ts">
import { BookOpen, LoaderCircle, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-vue-next'
import { notifyError } from '@/shared/toast'
import { useKnowledgeBases } from '../composables/useKnowledgeBases'
import type { KnowledgeBaseItem } from '../types'
import { apiErrorText } from '../utils/errors'
import KnowledgeBaseDialog from './KnowledgeBaseDialog.vue'
import KnowledgeChunkSettingsDialog from './KnowledgeChunkSettingsDialog.vue'

const {
  knowledgeBases,
  activeKbId,
  activeKb,
  query,
  statusFilter,
  loading,
  load,
  select,
  save,
  saveChunkSettings,
  remove,
} = useKnowledgeBases()

/** 知识库列表顶部的状态筛选项 */
const statusOptions: Array<{ value: 'all' | 'indexing' | 'ready'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'indexing', label: '同步中' },
  { value: 'ready', label: '完成' },
]
/** 知识库新建/编辑弹窗开关 */
const editorOpen = ref(false)
/** 正在编辑的知识库；undefined 表示新建 */
const editingKnowledgeBase = ref<KnowledgeBaseItem>()
/** 知识库表单保存请求进行中 */
const saving = ref(false)
/** 切片设置弹窗开关 */
const chunkSettingsOpen = ref(false)
/** 正在调整切片设置的知识库 */
const chunkSettingsKnowledgeBase = ref<KnowledgeBaseItem>()
/** 切片设置保存请求进行中 */
const savingChunkSettings = ref(false)

/** 打开“新建知识库”弹窗 */
function openCreate() {
  editingKnowledgeBase.value = undefined
  editorOpen.value = true
}

/** 打开“编辑知识库”弹窗 */
function openEdit(knowledgeBase: KnowledgeBaseItem) {
  editingKnowledgeBase.value = knowledgeBase
  editorOpen.value = true
}

/** 提交新建/编辑知识库表单，成功后关闭弹窗 */
async function submitEditor(value: { name: string; description: string }) {
  if (saving.value) return
  saving.value = true
  try {
    await save(value, editingKnowledgeBase.value?.id)
    editorOpen.value = false
  } catch (error) {
    notifyError({
      title: '保存知识库失败',
      description: apiErrorText(error),
    })
  } finally {
    saving.value = false
  }
}

/** 打开切片设置弹窗 */
function openChunkSettings(knowledgeBase: KnowledgeBaseItem) {
  chunkSettingsKnowledgeBase.value = knowledgeBase
  chunkSettingsOpen.value = true
}

/** 提交切片设置，成功后关闭弹窗 */
async function submitChunkSettings(value: {
  chunkSize: number
  overlapSize: number
  separator: string
}) {
  if (savingChunkSettings.value || !chunkSettingsKnowledgeBase.value) return
  savingChunkSettings.value = true
  try {
    await saveChunkSettings(chunkSettingsKnowledgeBase.value.id, value)
    chunkSettingsOpen.value = false
  } catch (error) {
    notifyError({
      title: '保存切片设置失败',
      description: apiErrorText(error),
    })
  } finally {
    savingChunkSettings.value = false
  }
}

/** 删除知识库：前端确认后调用，失败时弹出错误提示 */
async function removeKnowledgeBase(knowledgeBase: KnowledgeBaseItem) {
  if (!window.confirm(`删除“${knowledgeBase.name}”？服务端会检查工作流引用。`)) return
  try {
    await remove(knowledgeBase)
  } catch (error) {
    notifyError({
      title: '删除知识库失败',
      description: apiErrorText(error),
    })
  }
}

/** 挂载后加载知识库列表 */
onMounted(() => void load())
</script>
