<template>
  <PageHeaderActions>
    <div class="ml-auto flex items-center gap-2">
          <div class="control-shell flex h-34px w-70 items-center gap-2 rounded-7px bg-[var(--surface-2)] px-2 text-subtle max-md:hidden max-[1100px]:w-52">
            <Search :size="15" />
            <Input class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] shadow-none" placeholder="搜索工作流、运行 ID..." />
            <kbd class="rounded-3px border border-line bg-surface px-1 py-0.5 font-sans text-[12px] text-subtle">⌘K</kbd>
          </div>
          <Button variant="ghost" size="icon" class="relative h-34px w-34px border border-line bg-surface max-md:hidden" title="通知">
            <Bell :size="17" />
            <span class="absolute right-2 top-2 h-1.25 w-1.25 rounded-full bg-danger" />
          </Button>
          <Button class="h-34px text-[12px]" @click="openCreate"><Plus :size="15" /> 创建工作流</Button>
    </div>
  </PageHeaderActions>

  <main class="px-8 pb-15 pt-6 max-md:px-4">
        <section class="mb-4 flex items-end justify-between gap-5 max-md:flex-col max-md:items-start">
          <div>
            <h1 class="m-0 text-28px font-720 leading-tight">工作流</h1>
            <p class="mb-0 mt-1.5 text-[12px] text-subtle">{{ workflows.length }} 个工作流 · {{ publishedCount }} 个已发布 · 最近更新于 {{ latestRelative }}</p>
          </div>
          <div class="flex items-center gap-2.5 max-md:w-full max-md:flex-wrap">
            <div class="flex gap-px overflow-x-auto rounded-7px bg-surface p-0.75 shadow-[inset_0_0_0_1px_var(--border)]">
              <Button variant="unstyled" type="button"
                v-for="option in statusOptions"
                :key="option.value"
                class="flex h-7 shrink-0 items-center gap-1.5 rounded-5px border-0 bg-transparent px-2.5 text-[12px] text-muted"
                :class="statusFilter === option.value ? 'bg-ink text-white' : ''"
                @click="statusFilter = option.value"
              >
                {{ option.label }}
                <span class="opacity-65">{{ countByStatus(option.value) }}</span>
              </Button>
            </div>
            <div class="control-shell flex h-35px items-center gap-1.5 rounded-7px bg-surface px-2 text-subtle">
              <ArrowUpDown :size="14" />
              <Select v-model="sortBy">
                <SelectTrigger class="h-auto w-auto border-0 bg-transparent py-0 pl-0 pr-3 text-[12px] shadow-none" aria-label="工作流排序">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div v-if="actionError" class="mb-4 flex items-start gap-2 rounded-7px border border-[#efbfc1] bg-danger-soft px-3 py-2 text-[12px] text-danger">
          <CircleAlert :size="14" class="shrink-0" />
          <span class="min-w-0 flex-1 leading-1.55">{{ actionError }}</span>
          <Button variant="link" size="xs" class="text-[12px] text-danger" @click="actionError = ''">关闭</Button>
        </div>

        <section class="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-8px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
          <Button variant="unstyled" type="button" class="flex min-h-86px flex-col justify-center gap-2 bg-surface px-5 text-left transition-colors hover:bg-[var(--surface-2)]" @click="statusFilter = 'all'">
            <span class="text-[12px] text-subtle">工作流总数</span>
            <div class="flex items-baseline gap-2"><strong class="text-23px font-700">{{ workflows.length }}</strong><em class="rounded-4px bg-[var(--surface-3)] px-1.5 py-0.5 text-[12px] font-600 not-italic text-subtle">服务端数据</em></div>
          </Button>
          <Button variant="unstyled" type="button" class="flex min-h-86px flex-col justify-center gap-2 bg-surface px-5 text-left transition-colors hover:bg-[var(--surface-2)]" @click="statusFilter = 'published'">
            <span class="text-[12px] text-subtle">已发布数</span>
            <div class="flex items-baseline gap-2"><strong class="text-23px font-700">{{ publishedCount }}</strong><em class="rounded-4px bg-success-soft px-1.5 py-0.5 text-[12px] font-600 not-italic text-success">{{ publishRate }} 占比</em></div>
          </Button>
          <Button variant="unstyled" type="button" class="flex min-h-86px flex-col justify-center gap-2 bg-surface px-5 text-left transition-colors hover:bg-[var(--surface-2)]" @click="sortBy = 'runs'">
            <span class="text-[12px] text-subtle">累计运行数</span>
            <div class="flex items-baseline gap-2"><strong class="text-23px font-700">{{ totalRunCount }}</strong><em class="rounded-4px bg-success-soft px-1.5 py-0.5 text-[12px] font-600 not-italic text-success">真实运行</em></div>
          </Button>
          <Button variant="unstyled" type="button" class="flex min-h-86px flex-col justify-center gap-2 bg-surface px-5 text-left transition-colors hover:bg-[var(--surface-2)]" @click="sortBy = 'success'">
            <span class="text-[12px] text-subtle">整体成功率</span>
            <div class="flex items-baseline gap-2"><strong class="text-23px font-700">{{ overallSuccessRate }}</strong><em class="rounded-4px bg-warning-soft px-1.5 py-0.5 text-[12px] font-600 not-italic text-warning">按运行聚合</em></div>
          </Button>
        </section>

        <section class="mb-3 flex flex-wrap items-center justify-between gap-3 max-md:items-start">
          <div class="flex items-center gap-2 max-md:w-full">
            <div class="control-shell flex h-34px w-[min(230px,100%)] items-center gap-1.5 rounded-7px bg-surface px-2 text-subtle max-md:flex-1">
              <Search :size="14" />
              <Input v-model="searchInput" class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] shadow-none" placeholder="搜索名称、描述、标签" @input="scheduleSearch" />
              <Button v-if="search" variant="ghost" size="icon-sm" class="!h-4 !w-4 text-subtle" @click="clearSearch"><X :size="12" /></Button>
            </div>
            <Button variant="outline" class="h-34px gap-1.5 px-2 text-[12px] text-muted" :class="tagFilter ? '!border-[#cdc8fb] !text-primary' : ''" @click="tagFilter = tagFilter ? '' : 'MCP'">
              <Filter :size="14" />
              标签
              <span v-if="tagFilter" class="rounded-3px bg-primary-soft px-1 py-0.5 text-[12px]">{{ tagFilter }}</span>
            </Button>
          </div>
          <div class="flex items-center gap-2 max-md:w-full">
            <Button variant="outline" size="icon" class="h-34px w-34px text-muted" :class="viewMode === 'grid' ? '!border-[#d4d0fb] !bg-primary-soft !text-primary' : ''" title="卡片网格" @click="setView('grid')">
              <LayoutGrid :size="15" />
            </Button>
            <Button variant="outline" size="icon" class="h-34px w-34px text-muted" :class="viewMode === 'list' ? '!border-[#d4d0fb] !bg-primary-soft !text-primary' : ''" title="紧凑列表" @click="setView('list')">
              <List :size="15" />
            </Button>
            <RouterLink to="/templates" class="inline-flex h-34px items-center gap-1.5 text-[12px] font-600 text-primary">
              <Sparkles :size="14" /> 从模板开始
            </RouterLink>
          </div>
        </section>

        <div v-if="loading" class="grid grid-cols-1 gap-3.25 md:grid-cols-2 lg:grid-cols-3">
          <div v-for="index in 6" :key="index" class="surface h-67.5 p-4">
            <span class="block h-21 mb-3.75 animate-pulse rounded-5px bg-[var(--surface-3)]" />
            <span class="mb-3.75 block h-3 animate-pulse rounded-5px bg-[var(--surface-3)]" />
            <span class="block h-3 w-1/2 animate-pulse rounded-5px bg-[var(--surface-3)]" />
          </div>
        </div>

        <EmptyState
          v-else-if="loadError"
          title="工作流加载失败"
          :description="loadError"
          :icon="FileSearch"
        >
          <Button @click="reload">重新加载</Button>
        </EmptyState>

        <EmptyState
          v-else-if="!filteredWorkflows.length"
          title="没有匹配的工作流"
          description="调整关键词或清除筛选，也可以从模板快速开始。"
          :icon="FileSearch"
        >
          <Button variant="outline" @click="clearAllFilters">清除筛选</Button>
          <Button @click="openCreate">创建空白工作流</Button>
        </EmptyState>

        <div v-else-if="viewMode === 'grid'" class="grid grid-cols-1 gap-3.25 md:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="workflow in filteredWorkflows"
            :key="workflow.id"
            class="surface relative overflow-visible transition hover:(-translate-y-1px border-[var(--border-strong)] shadow-lg)"
          >
            <div class="relative h-20 overflow-hidden rounded-t-8px border-b border-line bg-[linear-gradient(90deg,rgba(255,255,255,0.2),transparent),radial-gradient(circle_at_1px_1px,rgba(139,147,163,0.12)_1px,transparent_0)] bg-[length:auto,16px_16px] bg-[var(--surface-2)]">
              <WorkflowThumbnail :graph="workflow.previewGraph" class="px-[36px_21px] py-[13px]" />
              <span class="absolute right-9 top-2.5"><StatusBadge :status="workflow.status" /></span>
              <Button variant="ghost" size="icon-sm" class="absolute right-2 top-2 !h-6.25 !w-6.25 rounded-5px bg-white/85 text-subtle" title="更多操作" @click.stop="toggleMenu(workflow.id)">
                <MoreHorizontal :size="16" />
              </Button>
              <Transition name="menu">
                <div v-if="activeMenu === workflow.id" class="absolute right-2 top-8.5 z-5 w-33 rounded-7px border border-line bg-surface p-1 shadow-md" @click.stop>
                  <Button variant="ghost" size="xs" class="h-7.5 w-full justify-start gap-1.5 px-2 text-[12px] font-normal text-muted" @click="openWorkflow(workflow)"><ExternalLink :size="13" /> 打开</Button>
                  <Button variant="ghost" size="xs" class="h-7.5 w-full justify-start gap-1.5 px-2 text-[12px] font-normal text-muted" @click="quickRun(workflow)"><Play :size="13" /> 运行</Button>
                  <Button variant="ghost" size="xs" class="h-7.5 w-full justify-start gap-1.5 px-2 text-[12px] font-normal text-muted" @click="duplicate(workflow.id)"><Copy :size="13" /> 复制</Button>
                  <Button variant="ghost" size="xs" class="h-7.5 w-full justify-start gap-1.5 px-2 text-[12px] font-normal text-muted" @click="openRename(workflow)"><Pencil :size="13" /> 重命名</Button>
                  <Button variant="ghost" size="xs" class="h-7.5 w-full justify-start gap-1.5 px-2 text-[12px] font-normal text-danger" @click="archive(workflow.id)"><Archive :size="13" /> 归档</Button>
                </div>
              </Transition>
            </div>
            <Button variant="unstyled" type="button" class="block w-full border-0 bg-transparent px-4 pb-3 pt-3.5 text-left" @click="openWorkflow(workflow)">
              <h2 class="m-0 text-14px font-650 text-ink">{{ workflow.name }}</h2>
              <p class="mb-2 mt-1.5 line-clamp-2 min-h-8.75 text-[12px] leading-1.6 text-subtle">{{ workflow.description }}</p>
              <div class="flex min-h-5.5 flex-wrap gap-1">
                <span v-for="tag in workflow.tags" :key="tag" class="tag">{{ tag }}</span>
              </div>
              <div class="mt-3 flex items-center justify-between gap-2.5 border-t border-line pt-2.5">
                <div class="flex items-center gap-2 text-[12px] text-subtle">
                  <span>{{ workflow.nodeCount }} 节点</span>
                  <span>{{ relativeTime(workflow.updatedAt) }}</span>
                  <span>{{ Math.round(workflow.successRate * 1000) / 10 }}%</span>
                </div>
                <div class="flex min-w-0 items-center gap-1 text-[12px] text-subtle">
                  <StatusBadge :status="workflow.status" />
                  <span class="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary-soft text-[12px] text-primary">{{ workflow.owner.initials }}</span>
                  <span class="truncate">{{ workflow.owner.name }}</span>
                </div>
              </div>
            </Button>
          </article>
        </div>

        <div v-else class="surface overflow-x-auto">
          <div class="grid min-w-780px h-9.5 grid-cols-[2.2fr_0.8fr_0.5fr_0.7fr_1fr_0.9fr_70px] items-center gap-3.5 border-b border-line bg-[var(--surface-2)] px-4 text-[12px] font-600 text-subtle">
            <span>名称</span><span>状态</span><span>节点</span><span>成功率</span><span>负责人</span><span>更新</span><span />
          </div>
          <Button variant="unstyled" type="button"
            v-for="workflow in filteredWorkflows"
            :key="workflow.id"
            class="grid min-w-780px w-full min-h-15 grid-cols-[2.2fr_0.8fr_0.5fr_0.7fr_1fr_0.9fr_70px] items-center gap-3.5 border-0 border-b border-line bg-transparent px-4 text-left text-[12px] text-muted transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
            @click="openWorkflow(workflow)"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="h-8 w-11.25 shrink-0 overflow-hidden rounded-5px border border-line bg-[var(--surface-2)]"><WorkflowThumbnail :graph="workflow.previewGraph" /></span>
              <span class="flex min-w-0 flex-col gap-0.5"><strong class="text-[12px] text-ink">{{ workflow.name }}</strong><small class="truncate text-[12px] text-subtle">{{ workflow.description }}</small></span>
            </div>
            <StatusBadge :status="workflow.status" />
            <span>{{ workflow.nodeCount }}</span>
            <span>{{ Math.round(workflow.successRate * 1000) / 10 }}%</span>
            <span class="flex items-center gap-1.25 text-subtle"><i class="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary-soft text-[12px] not-italic text-primary">{{ workflow.owner.initials }}</i>{{ workflow.owner.name }}</span>
            <span>{{ relativeTime(workflow.updatedAt) }}</span>
            <span class="inline-flex items-center gap-1 font-600 text-primary"><Play :size="13" /> 运行</span>
          </Button>
        </div>
  </main>

  <Dialog v-model:open="createOpen">
      <DialogContent class="w-[min(480px,calc(100vw-32px))]">
        <DialogTitle class="m-0 text-17px font-700">创建工作流</DialogTitle>
        <DialogDescription class="mb-3.25 mt-1.5 text-[12px] leading-1.6 text-subtle">
          创建后会进入设计器。空白工作流包含一个开始节点和一个输出节点。
        </DialogDescription>
        <div class="mt-3 flex flex-col gap-1.5">
          <Label>名称</Label>
          <Input v-model="createName" class="px-2.5 py-2 text-[12px]" placeholder="例如：售后政策问答" @keyup.enter="createWorkflowNow" />
        </div>
        <div class="mt-3 flex flex-col gap-1.5">
          <Label>描述</Label>
          <Textarea v-model="createDescription" class="px-2.5 py-2 text-[12px]" rows="3" placeholder="这个工作流解决什么问题？" />
        </div>
        <DialogFooter class="mt-5">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button :disabled="!createName.trim() || createPending" @click="createWorkflowNow">{{ createPending ? '创建中…' : '创建并进入编辑器' }}</Button>
        </DialogFooter>
      </DialogContent>
  </Dialog>

  <Dialog v-model:open="renameOpen">
      <DialogContent class="w-[min(390px,calc(100vw-32px))]">
        <DialogTitle class="m-0 text-17px font-700">重命名工作流</DialogTitle>
        <div class="mt-3 flex flex-col gap-1.5">
          <Label>名称</Label>
          <Input v-model="renameValue" class="px-2.5 py-2 text-[12px]" @keyup.enter="confirmRename" />
        </div>
        <DialogFooter class="mt-5">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button :disabled="renamePending" @click="confirmRename">{{ renamePending ? '保存中…' : '保存名称' }}</Button>
        </DialogFooter>
      </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  Archive,
  ArrowUpDown,
  Bell,
  CircleAlert,
  Copy,
  ExternalLink,
  FileSearch,
  Filter,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-vue-next'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@ai-reflow/ui'
import EmptyState from '@/components/EmptyState.vue'
import PageHeaderActions from '@/components/PageHeaderActions.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import WorkflowThumbnail from '@/components/WorkflowThumbnail.vue'
import {
  archiveWorkflow,
  createWorkflow,
  duplicateWorkflow,
  listWorkflows,
  updateWorkflow,
} from '@/services/reflowApi'
import { formatPercent, relativeTime } from '@/shared/format'
import type { WorkflowCard } from '@/shared/types'

const router = useRouter()
const workflows = ref<WorkflowCard[]>([])
const loading = ref(true)
const loadError = ref('')
const actionError = ref('')
const createPending = ref(false)
const renamePending = ref(false)
const viewMode = ref(localStorage.getItem('reflow_workflow_view') === 'list' ? 'list' : 'grid')
const statusFilter = ref(localStorage.getItem('reflow_status_filter') ?? 'all')
const tagFilter = ref('')
const searchInput = ref('')
const search = ref('')
const sortBy = ref(localStorage.getItem('reflow_sort') ?? 'updated')
const activeMenu = ref('')
const createOpen = ref(false)
const createName = ref('')
const createDescription = ref('')
const renameOpen = ref(false)
const renameValue = ref('')
const renameWorkflowId = ref('')
let searchTimer: number | undefined

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'reviewing', label: '审核中' },
]

const sortOptions = [
  { value: 'updated', label: '最近更新' },
  { value: 'runs', label: '最近运行' },
  { value: 'count', label: '运行次数' },
  { value: 'success', label: '成功率' },
]

const publishedCount = computed(() => workflows.value.filter((workflow) => workflow.status === 'published').length)
const publishRate = computed(() =>
  formatPercent(workflows.value.length ? publishedCount.value / workflows.value.length : 0),
)
const totalRunCount = computed(() =>
  workflows.value.reduce((total, workflow) => total + workflow.runCount, 0),
)
const overallSuccessRate = computed(() => {
  const succeededRuns = workflows.value.reduce(
    (total, workflow) => total + workflow.runCount * workflow.successRate,
    0,
  )
  return formatPercent(totalRunCount.value ? succeededRuns / totalRunCount.value : 0)
})
const latestRelative = computed(() => {
  const latest = workflows.value
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  return latest ? relativeTime(latest.updatedAt) : '-'
})

/**
 * 从服务端重新加载工作流卡片。
 *
 * @returns 加载完成后的 Promise。
 */
async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    workflows.value = await listWorkflows()
  } catch (error) {
    workflows.value = []
    loadError.value = error instanceof Error ? error.message : '无法加载工作流。'
  } finally {
    loading.value = false
  }
}

const filteredWorkflows = computed(() => {
  const query = search.value.toLowerCase()
  const items = workflows.value.filter((workflow) => {
    const matchesSearch =
      !query ||
      workflow.name.toLowerCase().includes(query) ||
      workflow.description.toLowerCase().includes(query) ||
      workflow.tags.some((tag) => tag.toLowerCase().includes(query))
    const matchesStatus = statusFilter.value === 'all' || workflow.status === statusFilter.value
    const matchesTag = !tagFilter.value || workflow.tags.includes(tagFilter.value)
    return matchesSearch && matchesStatus && matchesTag
  })
  return items.sort((a, b) => {
    if (sortBy.value === 'count') return b.runCount - a.runCount
    if (sortBy.value === 'success') return b.successRate - a.successRate
    if (sortBy.value === 'runs') {
      return Date.parse(b.lastRun?.at ?? b.updatedAt) - Date.parse(a.lastRun?.at ?? a.updatedAt)
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
})

/**
 * 返回指定状态的工作流数量。
 * @param status 状态筛选值，`all` 表示全部。
 * @returns 匹配当前状态的工作流数量。
 */
function countByStatus(status: string) {
  if (status === 'all') return workflows.value.length
  return workflows.value.filter((workflow) => workflow.status === status).length
}

/** 在 300ms 防抖后提交工作流搜索关键词。 */
function scheduleSearch() {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    search.value = searchInput.value.trim()
  }, 300)
}

/** 清空搜索输入与已提交关键词。 */
function clearSearch() {
  searchInput.value = ''
  search.value = ''
}

/** 清除搜索、状态与标签筛选。 */
function clearAllFilters() {
  clearSearch()
  statusFilter.value = 'all'
  tagFilter.value = ''
}

/**
 * 切换工作流视图并持久化用户偏好。
 * @param mode 卡片网格或紧凑列表。
 */
function setView(mode: 'grid' | 'list') {
  viewMode.value = mode
  localStorage.setItem('reflow_workflow_view', mode)
}

/** 打开创建工作流对话框并重置表单。 */
function openCreate() {
  createName.value = ''
  createDescription.value = ''
  createOpen.value = true
}

/** 创建空白工作流并进入服务端返回的草稿。 */
async function createWorkflowNow() {
  if (!createName.value.trim() || createPending.value) return
  createPending.value = true
  actionError.value = ''
  try {
    const draft = await createWorkflow({
      name: createName.value.trim(),
      description: createDescription.value.trim(),
    })
    createOpen.value = false
    await router.push(`/workflows/${draft.workflowId}`)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '创建工作流失败。'
  } finally {
    createPending.value = false
  }
}

/**
 * 打开工作流编辑器或固定版本试运行入口。
 * @param workflow 目标工作流卡片。
 */
function openWorkflow(workflow: WorkflowCard) {
  router.push(`/workflows/${workflow.id}`)
}

/**
 * 按发布状态选择固定版本试运行或草稿编辑。
 * @param workflow 目标工作流卡片。
 */
function quickRun(workflow: WorkflowCard) {
  if (workflow.status === 'published' && workflow.publishedVersionId) {
    router.push({
      path: `/workflows/${workflow.id}/trial`,
      query: { versionId: workflow.publishedVersionId },
    })
  } else {
    router.push(`/workflows/${workflow.id}`)
  }
}

/**
 * 切换或关闭工作流卡片快捷菜单。
 * @param id 工作流 ID。
 */
function toggleMenu(id: string) {
  activeMenu.value = activeMenu.value === id ? '' : id
}

/**
 * 复制工作流并刷新列表。
 * @param id 源工作流 ID。
 */
async function duplicate(id: string) {
  actionError.value = ''
  try {
    await duplicateWorkflow(id)
    activeMenu.value = ''
    await reload()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '复制工作流失败。'
  }
}

/**
 * 打开重命名对话框。
 * @param workflow 目标工作流卡片。
 */
function openRename(workflow: WorkflowCard) {
  renameWorkflowId.value = workflow.id
  renameValue.value = workflow.name
  renameOpen.value = true
  activeMenu.value = ''
}

/** 保存重命名结果并刷新列表。 */
async function confirmRename() {
  if (!renameValue.value.trim() || renamePending.value) return
  renamePending.value = true
  actionError.value = ''
  try {
    await updateWorkflow(renameWorkflowId.value, { name: renameValue.value.trim() })
    renameOpen.value = false
    await reload()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '重命名工作流失败。'
  } finally {
    renamePending.value = false
  }
}

/**
 * 确认后归档指定工作流。
 * @param id 工作流 ID。
 */
async function archive(id: string) {
  if (!window.confirm('归档后工作流会从默认列表隐藏，是否继续？')) return
  actionError.value = ''
  try {
    await archiveWorkflow(id)
    activeMenu.value = ''
    await reload()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '归档工作流失败。'
  }
}

/** 点击页面任意位置时关闭卡片快捷菜单。 */
function onWindowClick() {
  activeMenu.value = ''
}
window.addEventListener('click', onWindowClick)
onUnmounted(() => window.removeEventListener('click', onWindowClick))
onMounted(reload)
</script>

<style scoped>
.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
