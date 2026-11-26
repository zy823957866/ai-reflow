<template>
  <AppShell>
    <div class="min-h-screen">
      <header class="flex min-h-62px items-center justify-between gap-4 border-b border-line bg-white/96 px-7">
        <div class="flex min-w-0 items-center gap-2 text-10px text-subtle">
          <span>Acme 团队</span>
          <ChevronRight :size="13" />
          <strong class="truncate text-ink">模板市场</strong>
        </div>
        <div class="flex min-w-0 flex-1 items-center justify-end gap-2 sm:max-w-130">
          <label class="flex h-9 w-[min(420px,100%)] items-center gap-2 rounded-7px border border-line bg-surface px-3">
            <Search :size="14" class="shrink-0 text-subtle" />
            <input
              v-model="searchInput"
              class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-10px shadow-none outline-none"
              placeholder="搜索模板、节点组合、作者..."
            />
            <kbd class="rounded-4px border border-line bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">⌘K</kbd>
          </label>
          <button class="icon-btn" title="刷新目录" @click="reloadCatalog"><RefreshCw :size="15" /></button>
        </div>
      </header>

      <main class="mx-auto max-w-1380px px-7 pt-7 pb-16">
        <section class="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="m-0 text-27px font-730 leading-tight text-ink">模板市场</h1>
            <p class="mb-0 mt-2 text-10px leading-1.6 text-subtle">
              {{ templateEntries.length }} 个可克隆模板 · 依赖状态由服务端实时校验 · 克隆前始终展示计划
            </p>
          </div>
          <div class="flex items-center gap-2">
            <label class="management-select flex items-center">
              <ArrowUpDown :size="12" />
              <select v-model="sortMode" class="h-8 border-0 bg-transparent py-0 pl-1.5 text-[11.5px] shadow-none">
                <option value="recommended">最多克隆</option>
                <option value="updated">最近更新</option>
                <option value="name">名称</option>
                <option value="nodes">节点数</option>
              </select>
            </label>
            <span class="rounded-6px border border-line bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-subtle">
              catalog: {{ loadingCatalog ? 'loading' : `${templateEntries.length} templates` }}
            </span>
          </div>
        </section>

        <section class="mb-4 flex flex-wrap items-center gap-1.5">
          <button
            v-for="category in templateCategories"
            :key="category"
            class="inline-flex h-7 items-center gap-1.5 rounded-6px border border-line bg-surface px-2.5 text-[11.5px] text-muted transition hover:(bg-[var(--surface-2)] text-ink)"
            :class="{ '!border-primary !bg-primary !text-white': activeCategory === category }"
            @click="activeCategory = category"
          >
            {{ category }}
          </button>
        </section>

        <section
          v-if="featuredTemplate"
          class="mb-6 grid min-h-196px overflow-hidden rounded-8px border border-[#30265f] bg-[#211846] text-white shadow-md lg:grid-cols-[1.05fr_0.95fr]"
        >
          <div class="flex flex-col justify-center p-6">
            <span class="mb-auto inline-flex w-fit items-center gap-1.5 rounded-5px bg-white/12 px-2 py-1 text-[10.5px] text-white/85">
              <Sparkles :size="11" /> 官方精选 · 本周
            </span>
            <div class="mt-5">
              <h2 class="m-0 max-w-480px text-24px font-750 leading-tight">{{ featuredTemplate.name }}</h2>
              <p class="mb-0 mt-2 max-w-540px text-10px leading-1.65 text-white/72">{{ featuredTemplate.description }}</p>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-3 text-[11.5px] text-white/70">
              <span><Workflow :size="12" class="inline" /> {{ featuredTemplate.definition.nodes.length }} 节点</span>
              <span><Download :size="12" class="inline" /> {{ compactNumber(featuredTemplate.installs) }}</span>
              <span><PackageCheck :size="12" class="inline" /> v{{ featuredTemplate.latestVersion }}</span>
            </div>
            <div class="mt-4 flex gap-2">
              <button class="btn !border-white !bg-white !text-[#211846]" @click="openClonePlan(featuredTemplate)">
                <Copy :size="14" /> 克隆模板
              </button>
              <button class="btn !border-white/20 !bg-white/10 !text-white" @click="openDetail(featuredTemplate)">
                查看详情
              </button>
            </div>
          </div>
          <div class="relative hidden min-h-196px overflow-hidden bg-[#17102f] lg:block">
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(124,92,255,0.18),transparent_48%)]" />
            <WorkflowThumbnail :graph="thumbnailGraph(featuredTemplate)" class="absolute inset-4" />
          </div>
        </section>

        <section class="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 class="m-0 text-15px font-700 text-ink">模板目录</h2>
            <p class="mb-0 mt-1 text-[11.5px] text-subtle">{{ filteredTemplates.length }} 个结果 · 依赖和版本在克隆前校验</p>
          </div>
          <span class="text-[10.5px] text-subtle">点击卡片查看依赖清单</span>
        </section>

        <div
          v-if="!filteredTemplates.length"
          class="surface flex min-h-160px flex-col items-center justify-center gap-2 text-subtle"
        >
          <SearchX :size="23" />
          <strong class="text-12px text-ink">没有匹配模板</strong>
            <span class="text-[11.5px]">{{ loadingCatalog ? '正在加载模板目录…' : templateError || '试试清除关键词或切换其他类别。' }}</span>
          <button class="btn" @click="clearFilters">清除筛选</button>
        </div>

        <section v-else class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article
            v-for="template in filteredTemplates"
            :key="template.id"
            class="surface group flex min-h-250px cursor-pointer flex-col overflow-hidden transition hover:(-translate-y-1px border-[var(--border-strong)] shadow-md)"
            @click="openDetail(template)"
          >
            <div class="relative h-26 overflow-hidden border-b border-line bg-[var(--surface-2)]">
              <WorkflowThumbnail :graph="thumbnailGraph(template)" />
              <span class="absolute left-3 top-3 rounded-5px border border-line bg-white/92 px-2 py-1 text-[10.5px] font-600 text-muted">
                {{ template.category }}
              </span>
              <span
                class="absolute right-3 top-3 rounded-5px px-2 py-1 text-[10.5px] font-600"
                :class="dependencyBadge(template).className"
              >
                {{ dependencyBadge(template).label }}
              </span>
            </div>
            <div class="flex flex-1 flex-col p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="m-0 truncate text-13px font-700 text-ink">{{ template.name }}</h3>
                  <p class="mb-0 mt-1 line-clamp-2 min-h-30px text-[11.5px] leading-1.65 text-muted">{{ template.description }}</p>
                </div>
                <ArrowUpRight :size="14" class="shrink-0 text-subtle" />
              </div>
              <div class="mt-3 flex flex-wrap gap-1">
                <span
                  v-for="tag in template.tags"
                  :key="tag"
                  class="rounded-4px border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[10.5px] text-subtle"
                >
                  {{ tag }}
                </span>
              </div>
              <div class="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[10.5px] text-subtle">
                <span>v{{ template.latestVersion }} · {{ template.license }} · {{ template.author }}</span>
                <span class="flex items-center gap-2">
                  <span><Download :size="10" class="inline" /> {{ compactNumber(template.installs) }}</span>
                  <span class="flex items-center gap-1 text-primary" @click.stop="openClonePlan(template)">
                    <Copy :size="11" /> 克隆
                  </span>
                </span>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  </AppShell>

  <DialogRoot :open="Boolean(detailTemplate)" @update:open="(open) => !open && (detailTemplate = null)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" />
      <DialogContent class="fixed inset-y-0 right-0 z-71 flex w-[min(720px,100vw)] flex-col bg-surface shadow-lg outline-none">
        <header class="flex min-h-64px items-center justify-between gap-4 border-b border-line px-5">
          <div class="min-w-0">
            <DialogTitle class="truncate text-17px font-700 text-ink">{{ detailTemplate?.name }}</DialogTitle>
            <DialogDescription class="mt-1 block text-[11.5px] text-subtle">
              v{{ detailTemplate?.latestVersion }} · {{ detailTemplate?.author }} · {{ detailTemplate?.license }}
            </DialogDescription>
          </div>
          <DialogClose as-child><button class="icon-btn" title="关闭模板详情"><X :size="16" /></button></DialogClose>
        </header>
        <div v-if="detailTemplate" class="flex-1 overflow-y-auto px-5 py-4">
          <p class="m-0 text-10px leading-1.7 text-muted">{{ detailTemplate.description }}</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <button class="btn btn-primary" @click="openPreview(detailTemplate)">
              <Eye :size="14" /> 只读预览节点图
            </button>
            <button class="btn" @click="openClonePlan(detailTemplate)">
              <Copy :size="14" /> 使用模板
            </button>
          </div>

          <section class="mt-5 rounded-7px border border-line bg-[var(--surface-2)] p-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="m-0 text-12px font-650 text-ink">示例输入与输出</h3>
              <span class="text-[10.5px] text-subtle">只读 · 不写运行历史</span>
            </div>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <div class="rounded-6px border border-line bg-surface p-3">
                <span class="text-[10.5px] font-600 text-subtle">INPUT</span>
                <pre class="mb-0 mt-2 max-h-150px overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-1.55 text-muted">{{ prettyJson(detailTemplate.examples.input) }}</pre>
              </div>
              <div class="rounded-6px border border-line bg-surface p-3">
                <span class="text-[10.5px] font-600 text-subtle">EXPECTED OUTPUT</span>
                <pre class="mb-0 mt-2 max-h-150px overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-1.55 text-muted">{{ prettyJson(detailTemplate.examples.output) }}</pre>
              </div>
            </div>
          </section>

          <section class="mt-5">
            <h3 class="mb-2 text-12px font-650 text-ink">依赖清单</h3>
            <div v-if="loadingDetail" class="flex items-center gap-2 rounded-7px border border-line p-3 text-[11.5px] text-subtle">
              <LoaderCircle :size="13" class="animate-spin" /> 正在计算服务端依赖计划
            </div>
            <div class="space-y-2">
              <div
                v-for="dependency in detailDependencies"
                :key="`${dependency.type}-${dependency.id}`"
                class="flex items-start gap-3 rounded-7px border border-line p-3"
              >
                <span
                  class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-5px"
                  :class="dependencyIconClass(dependency.state)"
                >
                  <Check v-if="dependency.state === 'available'" :size="12" />
                  <AlertCircle v-else :size="12" />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <strong class="text-10px text-ink">{{ dependency.label }}</strong>
                    <span class="rounded-4px bg-[var(--surface-3)] px-1.5 py-0.5 text-[10.5px] text-subtle">{{ dependency.type }} · {{ dependency.required }}</span>
                  </div>
                  <p class="mb-0 mt-1 text-[11.5px] leading-1.55 text-muted">{{ dependency.detail }}</p>
                </div>
              </div>
            </div>
          </section>

          <section class="mt-5">
            <h3 class="mb-2 text-12px font-650 text-ink">版本记录</h3>
            <div class="overflow-hidden rounded-7px border border-line">
              <div
                v-for="version in detailTemplate.versions"
                :key="version.version"
                class="grid gap-2 border-b border-line px-3 py-2.5 last:border-b-0 sm:grid-cols-[72px_110px_1fr]"
              >
                <strong class="font-mono text-[11.5px] text-ink">v{{ version.version }}</strong>
                <span class="text-[10.5px] text-subtle">{{ formatDate(version.createdAt) }}</span>
                <span class="text-[11.5px] text-muted">{{ version.changelog || `schema ${version.schemaVersion}` }}</span>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="Boolean(cloneTemplateEntry)" @update:open="(open) => !open && (cloneTemplateEntry = null)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-80 bg-[rgba(18,20,26,0.28)]" />
      <DialogContent class="fixed inset-y-0 right-0 z-81 flex w-[min(580px,100vw)] flex-col bg-surface shadow-lg outline-none">
        <header class="flex min-h-64px items-center justify-between gap-4 border-b border-line px-5">
          <div>
            <DialogTitle class="text-16px font-700 text-ink">Clone plan</DialogTitle>
            <DialogDescription class="mt-1 block text-[11.5px] text-subtle">
              {{ cloneTemplateEntry?.name }} · v{{ clonePlan?.version ?? cloneTemplateEntry?.latestVersion }}
            </DialogDescription>
          </div>
          <DialogClose as-child><button class="icon-btn" title="关闭克隆计划"><X :size="16" /></button></DialogClose>
        </header>
        <div v-if="cloneTemplateEntry" class="flex-1 overflow-y-auto px-5 py-4">
          <div v-if="!clonePlan && !cloneError" class="flex items-center justify-center gap-2 py-12 text-[11.5px] text-subtle">
            <LoaderCircle :size="15" class="animate-spin" /> 正在计算 clone plan
          </div>
          <template v-if="clonePlan">
          <div class="field">
            <label class="field-label" for="template-target-name">新草稿名称</label>
            <input
              id="template-target-name"
              v-model="targetName"
              placeholder="输入新工作流名称"
              @change="recalculateClonePlan"
            />
            <span class="field-help">同名工作流会自动追加序号；每次克隆都会生成独立草稿。</span>
          </div>

          <div class="mt-4 rounded-7px border border-line bg-[var(--surface-2)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-[11.5px] font-600 text-ink">{{ clonePlan.missingDependencies.length }} 项需关注</span>
              <span class="font-mono text-[10.5px] text-subtle">{{ clonePlan.planId }}</span>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-2">
              <div class="rounded-6px border border-line bg-surface p-2">
                <span class="text-[10.5px] text-subtle">自动安装插件</span>
                <strong class="mt-1 block text-10px text-danger">否</strong>
              </div>
              <div class="rounded-6px border border-line bg-surface p-2">
                <span class="text-[10.5px] text-subtle">写入真实密钥</span>
                <strong class="mt-1 block text-10px text-danger">否</strong>
              </div>
              <div class="rounded-6px border border-line bg-surface p-2">
                <span class="text-[10.5px] text-subtle">覆盖现有工作流</span>
                <strong class="mt-1 block text-10px text-danger">否</strong>
              </div>
            </div>
          </div>

          <section v-if="clonePlan.missingDependencies.length" class="mt-4">
            <h3 class="mb-2 text-12px font-650 text-ink">缺失依赖与需配置项</h3>
            <div class="space-y-2">
              <div
                v-for="dependency in clonePlan.missingDependencies"
                :key="`${dependency.type}-${dependency.id}`"
                class="rounded-7px border border-warning/30 bg-warning-soft p-3"
              >
                <div class="flex items-center justify-between gap-2">
                  <strong class="text-10px text-ink">{{ dependency.label }}</strong>
                  <span class="rounded-4px bg-white/70 px-1.5 py-0.5 text-[10.5px] text-warning">{{ dependency.state }}</span>
                </div>
                <p class="mb-0 mt-1 text-[11.5px] leading-1.55 text-muted">{{ dependency.detail }}</p>
              </div>
            </div>
          </section>

          <section v-if="clonePlan.blockingReasons.length" class="mt-4 rounded-7px border border-danger/30 bg-danger-soft p-3">
            <div class="flex items-center gap-2 text-danger">
              <Ban :size="14" />
              <strong class="text-10px">克隆被阻断</strong>
            </div>
            <ul class="mb-0 mt-2 list-disc pl-5 text-[11.5px] leading-1.65 text-muted">
              <li v-for="reason in clonePlan.blockingReasons" :key="reason">{{ reason }}</li>
            </ul>
          </section>

          <section class="mt-4">
            <h3 class="mb-2 text-12px font-650 text-ink">克隆说明</h3>
            <ul class="m-0 list-disc pl-5 text-[11.5px] leading-1.7 text-muted">
              <li v-for="warning in clonePlan.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </section>

          <div v-if="cloneResult" class="mt-4 rounded-7px border border-success/30 bg-success-soft p-3">
            <strong class="text-10px text-success">已创建新草稿：{{ cloneResult.workflow.name }}</strong>
            <p class="mb-0 mt-1 text-[11.5px] text-muted">forkOf {{ cloneResult.workflow.forkOf?.templateId }} · v{{ cloneResult.workflow.forkOf?.version }}</p>
          </div>
          </template>
          <div v-if="cloneError" class="rounded-7px border border-danger/30 bg-danger-soft p-3 text-[11.5px] text-danger">
            {{ cloneError }}
          </div>
        </div>
        <footer class="flex flex-wrap justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-5 py-3">
          <button class="btn" @click="cloneTemplateEntry = null; clonePlan = null">取消</button>
          <button
            v-if="cloneResult"
            class="btn btn-primary"
            @click="openClonedWorkflow(cloneResult.workflow.workflowId)"
          >
            打开新草稿
          </button>
          <button
            v-else
            class="btn btn-primary"
            :disabled="!clonePlan?.canClone || cloning"
            @click="confirmClone"
          >
            <LoaderCircle v-if="cloning" :size="14" class="animate-spin" />
            <Copy v-else :size="14" />
            {{ cloning ? '克隆中...' : '生成新草稿' }}
          </button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="Boolean(previewTemplate)" @update:open="(open) => !open && (previewTemplate = null)">
    <DialogPortal>
      <DialogContent class="fixed inset-0 z-90 overflow-hidden bg-surface outline-none" aria-label="模板只读预览">
        <WorkflowDesigner
          v-if="previewTemplate"
          :workflow-id="`template_${previewTemplate.id}`"
          mode="readonly"
          :port="previewPort"
          :services="designerServices"
          @leave="previewTemplate = null"
        />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowUpDown,
  ArrowUpRight,
  Ban,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Search,
  SearchX,
  Sparkles,
  Workflow,
  X,
} from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import AppShell from '@/components/AppShell.vue'
import WorkflowThumbnail from '@/components/WorkflowThumbnail.vue'
import WorkflowDesigner from '@/workflow/WorkflowDesigner.vue'
import {
  cloneTemplate,
  createTemplateClonePlan,
  getTemplate,
  listTemplates,
  listWorkflows,
  validateWorkflowDefinition,
  type TemplateClonePlanDto,
  type TemplateDto,
} from '@/services/reflowApi'
import type {
  DesignerServices,
  RunEvent,
  ValidationResult,
  WorkflowDraft,
  WorkflowDesignerPort,
} from '@/shared/types'

interface TemplateDependencyView {
  type: string
  id: string
  label: string
  required: string
  state: 'available' | 'missing' | 'incompatible' | 'unconfigured'
  detail: string
}

interface TemplateCloneResult {
  importId: string
  workflow: WorkflowDraft
  missingDependencies: TemplateDependencyView[]
  warnings: string[]
  canPreview: boolean
}

const router = useRouter()
const templateEntries = ref<TemplateDto[]>([])
const searchInput = ref('')
const debouncedSearch = ref('')
const activeCategory = ref('全部')
const sortMode = ref<'recommended' | 'updated' | 'name' | 'nodes'>('recommended')
const detailTemplate = ref<TemplateDto | null>(null)
const detailPlan = ref<TemplateClonePlanDto | null>(null)
const cloneTemplateEntry = ref<TemplateDto | null>(null)
const clonePlan = ref<TemplateClonePlanDto | null>(null)
const targetName = ref('')
const cloning = ref(false)
const cloneError = ref('')
const cloneResult = ref<TemplateCloneResult | null>(null)
const previewTemplate = ref<TemplateDto | null>(null)
const loadingCatalog = ref(false)
const loadingDetail = ref(false)
const templateError = ref('')
const validationWorkflowId = ref('')
let searchTimer: number | undefined

const templateCategories = computed(() => [
  '全部',
  ...new Set(templateEntries.value.map((template) => template.category)),
])

/** 精选模板始终优先使用目录中 `featured=true` 的第一项。 */
const featuredTemplate = computed(() => templateEntries.value.find((template) => template.featured))

/** 详情抽屉只展示服务端 clone plan 返回的真实依赖状态。 */
const detailDependencies = computed(() =>
  detailPlan.value?.dependencies.map(toDependencyView) ?? [],
)

/** 按类别、搜索、排序生成当前模板列表。 */
const filteredTemplates = computed(() => {
  const keyword = debouncedSearch.value.trim().toLowerCase()
  const list = templateEntries.value.filter((template) => {
    const searchable = [
      template.name,
      template.description,
      template.author,
      template.category,
      ...template.tags,
    ]
      .join(' ')
      .toLowerCase()
    return (
      (!keyword || searchable.includes(keyword)) &&
      (activeCategory.value === '全部' || template.category === activeCategory.value)
    )
  })
  return list.sort((a, b) => {
    if (sortMode.value === 'updated') return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (sortMode.value === 'name') return a.name.localeCompare(b.name, 'zh-CN')
    if (sortMode.value === 'nodes') {
      return (b.definition?.nodes.length ?? 0) - (a.definition?.nodes.length ?? 0)
    }
    return b.installs - a.installs
  })
})

watch(searchInput, (value) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    debouncedSearch.value = value
  }, 300)
})

onUnmounted(() => {
  if (searchTimer) window.clearTimeout(searchTimer)
})

/**
 * 构造只读设计器端口。
 *
 * 所有写能力显式拒绝，预览不创建运行历史，也不返回真实密钥。
 */
const previewPort: WorkflowDesignerPort = {
  async load() {
    if (!previewTemplate.value) throw new Error('模板预览不存在。')
    return toPreviewDraft(previewTemplate.value)
  },
  async save() {
    throw new Error('模板预览为只读模式。')
  },
  async validate({ definition }) {
    if (!validationWorkflowId.value) {
      return {
        valid: false,
        errors: [{ code: 'NO_VALIDATION_WORKFLOW', message: '当前 workspace 没有可用于定义校验的工作流。' }],
      } satisfies ValidationResult
    }
    return await validateWorkflowDefinition(
      validationWorkflowId.value,
      definition,
    ) as unknown as ValidationResult
  },
  async publish() {
    throw new Error('模板预览不能发布。')
  },
  async createPreviewRun() {
    throw new Error('模板只读预览不写运行历史。')
  },
  subscribeRun(input: {
    onError: (error: Error) => void
    onEnd: () => void
    afterSeq?: number
    runId: string
    onEvent: (event: RunEvent) => void
  }) {
    input.onError(new Error('模板示例运行尚未接入。'))
    input.onEnd()
    return () => {}
  },
}

const designerServices: DesignerServices = {
  async confirm(message) {
    return window.confirm(message)
  },
}

/**
 * 将真实模板定义投影为只读设计器草稿。
 *
 * @param template 后端模板 DTO。
 * @returns 不写入数据库的草稿快照。
 */
function toPreviewDraft(template: TemplateDto): WorkflowDraft {
  return {
    workflowId: `template_${template.id}`,
    name: template.name,
    description: template.description,
    status: 'draft',
    tags: template.tags,
    revision: 1,
    savedAt: template.updatedAt,
    definition: structuredClone(template.definition),
    forkOf: {
      templateId: template.id,
      version: template.latestVersion,
    },
  }
}

/**
 * 为卡片缩略图提供轻量坐标与连线索引。
 *
 * @param template 后端模板 DTO。
 * @returns 缩略图可消费的图结构。
 */
function thumbnailGraph(template: TemplateDto) {
  const definition = template.definition
  const nodeIndex = new Map(definition.nodes.map((node, index) => [node.id, index]))
  return {
    nodes: definition.nodes.map((node) => ({ type: node.type, x: node.x, y: node.y })),
    edges: definition.edges
      .filter((edge) => nodeIndex.has(edge.source) && nodeIndex.has(edge.target))
      .map((edge) => ({ from: nodeIndex.get(edge.source)!, to: nodeIndex.get(edge.target)! })),
  }
}

/**
 * 加载模板目录并选择一个真实工作流作为定义校验锚点。
 */
async function loadCatalog() {
  if (loadingCatalog.value) return
  loadingCatalog.value = true
  templateError.value = ''
  try {
    const [templates, workflows] = await Promise.all([
      listTemplates(),
      listWorkflows(),
    ])
    templateEntries.value = templates
    validationWorkflowId.value = workflows[0]?.id ?? ''
  } catch (error) {
    templateError.value = error instanceof Error ? error.message : '模板目录加载失败。'
  } finally {
    loadingCatalog.value = false
  }
}

onMounted(() => {
  void loadCatalog()
})

/**
 * 打开模板详情，并从服务端计算一次真实的依赖计划。
 *
 * @param template 模板摘要。
 */
async function openDetail(template: TemplateDto) {
  detailTemplate.value = template
  detailPlan.value = null
  loadingDetail.value = true
  templateError.value = ''
  try {
    const [detail, plan] = await Promise.all([
      getTemplate(template.id),
      createTemplateClonePlan(template.id, {
        targetName: `${template.name}（副本）`,
        version: template.latestVersion,
      }),
    ])
    if (detailTemplate.value?.id === template.id) detailTemplate.value = detail
    detailPlan.value = plan
  } catch (error) {
    templateError.value = error instanceof Error ? error.message : '模板详情加载失败。'
  } finally {
    loadingDetail.value = false
  }
}

/**
 * 从模板详情进入只读设计器预览。
 *
 * @param template 模板 DTO。
 */
function openPreview(template: TemplateDto) {
  detailTemplate.value = null
  previewTemplate.value = template
}

/**
 * 打开 clone plan 抽屉并调用服务端检查版本、依赖和名称冲突。
 *
 * @param template 目标模板。
 */
async function openClonePlan(template: TemplateDto) {
  cloneTemplateEntry.value = template
  targetName.value = `${template.name}（副本）`
  cloneError.value = ''
  cloneResult.value = null
  clonePlan.value = null
  try {
    const plan = await createTemplateClonePlan(template.id, {
      targetName: targetName.value,
      version: template.latestVersion,
    })
    if (cloneTemplateEntry.value?.id === template.id) {
      clonePlan.value = plan
      targetName.value = plan.targetName
    }
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : 'Clone plan 计算失败。'
  }
}

/**
 * 用户修改目标名称后重新调用服务端计算 clone plan。
 */
async function recalculateClonePlan() {
  if (!cloneTemplateEntry.value) return
  cloneResult.value = null
  cloneError.value = ''
  clonePlan.value = null
  try {
    const plan = await createTemplateClonePlan(cloneTemplateEntry.value.id, {
      targetName: targetName.value,
      version: cloneTemplateEntry.value.latestVersion,
    })
    clonePlan.value = plan
    targetName.value = plan.targetName
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : 'Clone plan 计算失败。'
  }
}

/**
 * 按已确认的 clone plan 创建新草稿，不自动安装依赖或覆盖现有工作流。
 */
async function confirmClone() {
  if (!clonePlan.value || !cloneTemplateEntry.value || cloning.value) return
  cloning.value = true
  cloneError.value = ''
  try {
    const result = await cloneTemplate(
      cloneTemplateEntry.value.id,
      {
        planId: clonePlan.value.planId,
        targetName: clonePlan.value.targetName,
        version: clonePlan.value.version,
      },
      `template:${clonePlan.value.planId}`,
    )
    cloneResult.value = {
      ...result,
      missingDependencies: result.missingDependencies.map(toDependencyView),
    }
    await loadCatalog()
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : '模板克隆失败。'
  } finally {
    cloning.value = false
  }
}

/**
 * 打开刚生成的工作流草稿。
 *
 * @param workflowId 新工作流公开 ID。
 */
function openClonedWorkflow(workflowId: string) {
  cloneResult.value = null
  cloneTemplateEntry.value = null
  clonePlan.value = null
  void router.push(`/workflows/${workflowId}`)
}

/** 清空搜索与分类筛选。 */
function clearFilters() {
  searchInput.value = ''
  debouncedSearch.value = ''
  activeCategory.value = '全部'
}

/** 重新加载真实模板目录，保持当前搜索与筛选状态。 */
async function reloadCatalog() {
  debouncedSearch.value = debouncedSearch.value.trim()
  await loadCatalog()
}

/**
 * 返回模板声明依赖的校验提示，不在目录阶段伪造可克隆状态。
 *
 * @param template 模板 DTO。
 * @returns 徽标文案与颜色类。
 */
function dependencyBadge(template: TemplateDto) {
  const latest = template.versions.find((version) => version.version === template.latestVersion)
    ?? template.versions[0]
  const count = latest
    ? latest.requiredPlugins.length
      + latest.requiredModels.length
      + latest.requiredSecrets.length
      + latest.requiredKnowledge.length
      + latest.nodeDependencies.length
    : 0
  return count
    ? { label: `${count} 项依赖待校验`, className: 'bg-warning-soft text-warning' }
    : { label: '无声明依赖', className: 'bg-success-soft text-success' }
}

/**
 * 将服务端依赖 JSON 归一化为稳定页面结构。
 *
 * @param value 依赖 JSON。
 * @returns 页面依赖。
 */
function toDependencyView(value: unknown): TemplateDependencyView {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const state = String(record.state ?? 'unconfigured')
  return {
    type: String(record.type ?? 'dependency'),
    id: String(record.id ?? record.key ?? record.type ?? 'unknown'),
    label: String(record.label ?? record.name ?? record.id ?? '未命名依赖'),
    required: String(record.required ?? record.version ?? ''),
    state: ['available', 'missing', 'incompatible', 'unconfigured'].includes(state)
      ? state as TemplateDependencyView['state']
      : 'unconfigured',
    detail: String(record.detail ?? '需生成克隆计划后确认状态。'),
  }
}

/**
 * 返回依赖状态的显式图标颜色。
 *
 * @param state 服务端依赖状态。
 * @returns UnoCSS 原子类。
 */
function dependencyIconClass(state: TemplateDependencyView['state']): string {
  if (state === 'available') return 'bg-success-soft text-success'
  if (state === 'incompatible' || state === 'missing') return 'bg-danger-soft text-danger'
  return 'bg-warning-soft text-warning'
}

/**
 * 格式化模板日期。
 *
 * @param value ISO 时间。
 * @returns 本地月日。
 */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/**
 * 以千位单位压缩模板使用量。
 *
 * @param value 数值。
 * @returns 紧凑文本。
 */
function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

/**
 * 格式化只读示例 JSON。
 *
 * @param value 任意 JSON。
 * @returns 格式化文本。
 */
function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}
</script>
