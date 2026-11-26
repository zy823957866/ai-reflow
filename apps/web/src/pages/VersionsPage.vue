<template>
  <PageHeaderActions>
    <button class="btn" @click="router.push(`/workflows/${workflowId}`)">
      <ArrowLeft :size="14" /> 返回编辑器
    </button>
  </PageHeaderActions>
  <div class="mx-auto max-w-[1120px] px-8 pb-[70px] pt-9 max-[900px]:px-4">
        <div class="mb-6 flex items-end justify-between gap-5">
          <div>
            <h1 class="m-0 text-[27px] tracking-0">版本列表</h1>
            <p class="mb-0 mt-[7px] text-[12px] text-subtle">发布版本不可变。试运行始终使用 URL 中的固定版本。</p>
          </div>
          <button class="btn btn-primary" @click="router.push(`/workflows/${workflowId}`)">
            <GitCommitHorizontal :size="14" /> 发布新版本
          </button>
        </div>

        <div v-if="loadError" class="mb-3 flex items-start justify-between gap-3 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-danger">
          <div class="min-w-0">
            <strong class="text-[12px]">版本加载失败</strong>
            <p class="mb-0 mt-1 text-[12px] leading-[1.55] text-[#9c4045]">{{ loadError }}</p>
          </div>
          <button class="btn !h-[30px] shrink-0 text-[12px]" @click="loadData">重试</button>
        </div>

        <div v-if="loading" class="surface flex min-h-[220px] items-center justify-center text-[12px] text-subtle">
          <RefreshCw :size="15" class="mr-2 animate-spin" /> 正在读取固定版本
        </div>

        <div v-else-if="!versions.length && !loadError" class="surface">
          <EmptyState title="还没有发布版本" description="在编辑器中完成校验并发布后，版本快照会出现在这里。">
            <button class="btn btn-primary" @click="router.push(`/workflows/${workflowId}`)">打开编辑器</button>
          </EmptyState>
        </div>

        <div v-else class="flex flex-col gap-2.5">
          <article v-for="version in versions" :key="version.id" class="surface flex items-center justify-between gap-5 p-[17px] max-[900px]:flex-col max-[900px]:items-stretch">
            <div class="flex min-w-0 items-start gap-3">
              <div class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-8px" :class="version.isCurrent ? 'bg-primary-soft text-primary' : 'bg-[var(--surface-3)] text-subtle'">
                <GitCommitHorizontal :size="17" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-[9px]">
                  <h2 class="m-0 text-[14px]">版本 v{{ version.version }}</h2>
                  <span v-if="version.isCurrent" class="rounded-[4px] bg-success-soft px-1.5 py-0.5 text-[12px] font-600 text-success">当前发布版本</span>
                </div>
                <p class="mb-[9px] mt-[5px] text-[12px] text-muted">{{ version.changelog }}</p>
                <div class="flex flex-wrap items-center gap-3.5 text-[12px] text-subtle">
                  <span class="inline-flex items-center gap-1"><CalendarClock :size="12" /> {{ formatDateTime(version.createdAt) }}</span>
                  <span class="inline-flex items-center gap-1"><Boxes :size="12" /> {{ version.nodeCount }} 节点</span>
                  <span class="font-mono">{{ version.schemaHash }}</span>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 gap-[7px] max-[900px]:justify-end">
              <button class="btn !h-[34px] text-[12px]" @click="showDefinition(version)">
                <FileJson :size="14" /> 查看定义
              </button>
              <button
                class="btn btn-primary !h-[34px] text-[12px]"
                @click="router.push({ path: `/workflows/${workflowId}/trial`, query: { versionId: version.id } })"
              >
                <Play :size="14" /> 固定版本试运行
              </button>
            </div>
          </article>
        </div>
  </div>

  <div v-if="previewDefinition" class="fixed inset-0 z-50 bg-[rgba(18,20,26,0.22)]" @click.self="previewDefinition = null">
      <aside class="absolute inset-y-0 right-0 flex w-[min(560px,100vw)] flex-col bg-surface shadow-lg">
        <div class="flex h-[62px] items-center justify-between border-b border-line px-[17px]">
          <div>
            <div class="flex flex-col gap-[3px] text-[12px] text-subtle">
              <span>版本定义</span>
              <strong class="font-mono text-[12px] text-muted">{{ previewVersionId }}</strong>
            </div>
          </div>
          <button class="icon-btn" @click="previewDefinition = null"><X :size="16" /></button>
        </div>
        <pre class="m-0 flex-1 overflow-auto bg-[var(--code-bg)] p-4 font-mono text-[12px] leading-[1.65] text-[#d8dbe5]">{{ JSON.stringify(previewDefinition, null, 2) }}</pre>
      </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  FileJson,
  GitCommitHorizontal,
  Play,
  RefreshCw,
  X,
} from 'lucide-vue-next'
import EmptyState from '@/components/EmptyState.vue'
import PageHeaderActions from '@/components/PageHeaderActions.vue'
import { formatDateTime } from '@/shared/format'
import { getWorkflow, listWorkflowVersions } from '@/services/reflowApi'
import type {
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowVersion,
} from '@/shared/types'

const route = useRoute()
const router = useRouter()
const workflowId = computed(() => String(route.params.id))
const draft = ref<WorkflowDraft | null>(null)
const versions = ref<WorkflowVersion[]>([])
const loading = ref(false)
const loadError = ref('')
const previewDefinition = ref<WorkflowDefinition | null>(null)
const previewVersionId = ref('')

/**
 * 读取工作流元数据和不可变版本列表。
 *
 * @returns 读取完成时结束。
 */
async function loadData() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const [workflow, items] = await Promise.all([
      getWorkflow(workflowId.value),
      listWorkflowVersions(workflowId.value),
    ])
    draft.value = workflow
    versions.value = items
  } catch (error) {
    versions.value = []
    loadError.value =
      error instanceof Error ? error.message : '无法读取工作流版本。'
  } finally {
    loading.value = false
  }
}

/**
 * 打开固定版本的只读定义。
 * @param version 目标工作流版本。
 */
function showDefinition(version: WorkflowVersion) {
  previewDefinition.value = version.definition
  previewVersionId.value = version.id
}

onMounted(loadData)
</script>
