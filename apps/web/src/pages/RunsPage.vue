<template>
  <AppShell>
    <div class="min-h-screen">
      <header class="flex min-h-[62px] items-center justify-between gap-[18px] border-b border-line bg-white/96 px-7 max-md:pl-15 max-md:pr-4">
        <div class="flex min-w-0 items-center gap-[7px] text-[10px] text-subtle">
          <span>Acme 团队</span>
          <ChevronRight :size="13" />
          <strong class="truncate font-600 text-ink">运行记录</strong>
        </div>
        <div class="flex items-center gap-2 max-md:flex-wrap">
          <span class="inline-flex h-[29px] items-center gap-1.5 rounded-[6px] border border-[#bfe7d8] bg-success-soft px-2 text-[11.5px] font-600 text-success">
            <span class="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            {{ liveRunCount ? '实时更新' : '历史归档' }}
          </span>
          <button class="btn" :disabled="refreshing" @click="refreshData()">
            <RefreshCw :size="14" :class="refreshing ? 'animate-spin' : ''" /> 刷新
          </button>
          <button class="btn" @click="exportCsv">
            <Download :size="14" /> 导出 CSV
          </button>
        </div>
      </header>

      <main class="mx-auto max-w-[1380px] px-7 pb-16 pt-[26px] max-md:pl-15 max-md:pr-4">
        <section class="mb-[18px] flex items-end justify-between gap-[22px] max-md:flex-col max-md:items-start">
          <div>
            <h1 class="m-0 text-[27px] font-[730] tracking-0 max-sm:text-[23px]">运行记录</h1>
            <p class="mb-0 mt-[7px] text-[10px] leading-[1.55] text-subtle">近 24 小时 · 列表与详情使用同一份运行快照和节点 trace</p>
          </div>
          <div class="flex items-center gap-2">
            <select v-model="workflowFilter" class="h-[34px] w-auto min-w-[112px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按工作流筛选">
              <option value="">全部工作流</option>
              <option v-for="workflow in workflowOptions" :key="workflow.id" :value="workflow.id">
                {{ workflow.name }}
              </option>
            </select>
            <select v-model="kindFilter" class="h-[34px] w-auto min-w-[112px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按运行类型筛选">
              <option value="">全部类型</option>
              <option value="production">正式运行</option>
              <option value="preview">草稿预览</option>
            </select>
            <select v-model="timeRange" class="h-[34px] w-auto min-w-[112px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按时间筛选">
              <option value="24h">近 24 小时</option>
              <option value="7d">近 7 天</option>
              <option value="all">全部时间</option>
            </select>
          </div>
        </section>

        <div v-if="loadError || actionError" class="mb-3 flex items-start justify-between gap-3 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-danger">
          <div class="min-w-0">
            <strong class="text-[10px]">{{ loadError ? '运行列表加载失败' : '操作失败' }}</strong>
            <p class="mb-0 mt-1 text-[11.5px] leading-[1.55] text-[#9c4045]">{{ loadError || actionError }}</p>
          </div>
          <button v-if="loadError" class="btn !h-[30px] shrink-0 text-[11.5px]" @click="refreshData()">重试</button>
          <button v-else class="icon-btn !h-[30px] !w-[30px] shrink-0" title="关闭错误提示" @click="actionError = ''"><X :size="13" /></button>
        </div>

        <section class="surface mb-3 grid grid-cols-1 gap-px overflow-hidden bg-line sm:grid-cols-2 xl:grid-cols-4">
          <button class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] border-0 bg-surface px-4 py-[13px] text-left" @click="statusFilter = ''">
            <span class="text-[11.5px] text-subtle">运行总数</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">{{ filteredByScope.length }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic text-subtle">当前范围</em></div>
          </button>
          <button class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] border-0 bg-surface px-4 py-[13px] text-left" @click="statusFilter = 'succeeded'">
            <span class="text-[11.5px] text-subtle">成功率</span>
            <div class="flex min-w-0 items-baseline gap-[7px]">
              <strong class="truncate text-[19px] tabular-nums">{{ successRate }}</strong>
              <em class="whitespace-nowrap text-[10.5px] not-italic text-success">{{ failedCount }} 失败</em>
            </div>
          </button>
          <button class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] border-0 bg-surface px-4 py-[13px] text-left" @click="statusFilter = 'failed'">
            <span class="text-[11.5px] text-subtle">P95 耗时</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">{{ p95Duration }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic text-warning">已保留节点输出</em></div>
          </button>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[11.5px] text-subtle">累计费用</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">¥{{ totalCost }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic text-success">来源：服务端 usage</em></div>
          </div>
        </section>

        <div class="grid grid-cols-[minmax(0,1fr)_min(390px,34vw)] items-stretch gap-3 max-[1180px]:grid-cols-1">
          <section class="surface flex min-w-0 min-h-[610px] flex-col overflow-hidden">
            <div class="flex min-h-[55px] items-center justify-between gap-2.5 border-b border-line px-3 py-2 max-md:flex-col max-md:items-stretch">
              <div class="inline-flex flex-wrap gap-0.5 rounded-[7px] border border-line bg-[var(--surface-2)] p-[3px]">
                <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap border-0 rounded-[5px] px-[9px] text-[11.5px]" :class="!statusFilter ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="statusFilter = ''">
                  全部 <span>{{ scopeRuns.length }}</span>
                </button>
                <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap border-0 rounded-[5px] px-[9px] text-[11.5px]" :class="statusFilter === 'failed' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="statusFilter = 'failed'">
                  失败 <span>{{ failedCount }}</span>
                </button>
                <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap border-0 rounded-[5px] px-[9px] text-[11.5px]" :class="statusFilter === 'active' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="statusFilter = 'active'">
                  运行中 <span>{{ runningCount }}</span>
                </button>
                <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap border-0 rounded-[5px] px-[9px] text-[11.5px]" :class="statusFilter === 'cancelled' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="statusFilter = 'cancelled'">
                  已取消
                </button>
              </div>
              <div class="flex min-w-0 items-center gap-1.5 max-md:w-full max-md:flex-wrap">
                <select v-model="triggerFilter" class="h-[34px] min-w-[96px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按触发方式筛选">
                  <option value="">全部触发</option>
                  <option value="manual_trial">试运行</option>
                  <option value="manual_preview">草稿预览</option>
                  <option value="api">API</option>
                  <option value="mcp">MCP</option>
                  <option value="webhook">Webhook</option>
                </select>
                <label class="flex h-[32px] w-[185px] items-center gap-[7px] rounded-[7px] border border-line bg-surface px-2.5 max-md:w-auto max-md:min-w-[180px] max-md:flex-1">
                  <Search :size="13" />
                  <input v-model="query" class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[10px] shadow-none focus:shadow-none" placeholder="运行 ID、工作流、错误码" />
                </label>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto">
              <table class="w-full min-w-[840px] border-collapse [&_th]:h-[35px] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[10.5px] [&_th]:font-500 [&_th]:text-subtle [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-middle [&_td]:text-[11.5px] [&_td]:text-muted [&_tbody_tr:last-child_td]:border-b-0">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>运行 ID</th>
                    <th>工作流</th>
                    <th>类型</th>
                    <th>触发</th>
                    <th>耗时</th>
                    <th>费用</th>
                    <th>开始时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="refreshing && !allRuns.length">
                    <td colspan="8" class="h-[120px] text-center text-subtle">
                      <RefreshCw :size="15" class="mr-1 inline animate-spin" /> 正在加载运行记录
                    </td>
                  </tr>
                  <tr
                    v-for="run in pagedRuns"
                    :key="run.id"
                    class="cursor-pointer transition-colors hover:bg-[#fbfcfe]"
                    :class="selectedRunId === run.id ? 'bg-[#f3f1ff] [&>td:first-child]:shadow-[inset_2px_0_var(--primary)]' : ''"
                    @click="selectedRunId = run.id"
                  >
                    <td>
                      <span class="flex flex-col items-start gap-0.75">
                        <StatusBadge :status="run.status" />
                        <span v-if="run.error" class="font-mono text-[10px] text-danger">{{ run.error.code }}</span>
                      </span>
                    </td>
                    <td>
                      <button class="border-0 bg-transparent p-0 font-mono text-[10.5px] text-muted" @click.stop="router.push(`/runs/${run.id}`)">
                        {{ shortId(run.id) }}
                      </button>
                    </td>
                    <td><span class="block max-w-[130px] truncate">{{ run.workflowName }}</span></td>
                    <td>
                      <span class="inline-flex h-[18px] min-w-[38px] items-center justify-center rounded-[4px] text-[10.5px]" :class="run.runKind === 'production' ? 'bg-primary-soft text-primary' : 'bg-[var(--surface-3)] text-subtle'">{{ kindLabel(run.runKind) }}</span>
                    </td>
                    <td>{{ triggerLabel(run.trigger) }}</td>
                    <td>{{ durationLabel(run) }}</td>
                    <td>{{ run.metadata.cost ? `¥${run.metadata.cost.toFixed(2)}` : '—' }}</td>
                    <td>{{ formatTime(run.createdAt) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!pagedRuns.length && !refreshing" class="flex min-h-[120px] flex-col items-center justify-center gap-[7px] text-center text-[11.5px] text-subtle">
                <SearchX :size="20" />
                <strong>没有匹配的运行</strong>
                <span>调整筛选条件或刷新数据。</span>
                <button class="border-0 bg-transparent p-0 text-[11.5px] text-primary" @click="clearFilters">清除全部筛选</button>
              </div>
            </div>

            <div class="flex min-h-[43px] items-center justify-between border-t border-line px-[13px] text-[10.5px] text-subtle">
              <span>
                显示 {{ pageStart + 1 }}–{{ Math.min(pageStart + pageSize, filteredRuns.length) }}
                / {{ filteredRuns.length }}
              </span>
              <div class="flex items-center gap-2">
                <button class="icon-btn !h-[27px] !w-[27px]" :disabled="page === 1" @click="page--">
                  <ChevronLeft :size="14" />
                </button>
                <span>{{ page }} / {{ totalPages }}</span>
                <button class="icon-btn !h-[27px] !w-[27px]" :disabled="page >= totalPages" @click="page++">
                  <ChevronRight :size="14" />
                </button>
              </div>
            </div>
          </section>

          <aside v-if="selectedRun" class="surface flex min-h-[610px] flex-col overflow-hidden max-[1180px]:hidden">
            <div class="flex min-h-[55px] items-center justify-between gap-2.5 border-b border-line px-3 py-[9px]">
              <div class="flex items-center gap-[7px]">
                <span class="text-[10px] font-650 text-muted">运行详情</span>
                <StatusBadge :status="selectedRun.status" />
              </div>
              <div class="flex items-center gap-[7px]">
                <button class="icon-btn !h-7 !w-7" title="原样重跑" :disabled="actionPending" @click="replaySelected">
                  <RotateCcw :size="14" />
                </button>
                <button class="icon-btn !h-7 !w-7" title="关闭详情" @click="selectedRunId = ''">
                  <X :size="15" />
                </button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div class="flex min-h-[48px] items-center justify-between border-b border-dashed border-line px-[13px]">
                <div class="flex items-center gap-[3px]">
                  <strong class="font-mono text-[10px]">{{ shortId(selectedRun.id, 11) }}</strong>
                  <button class="icon-btn !h-6 !w-6" title="复制 runId" @click="copyText(selectedRun.id)">
                    <Copy :size="12" />
                  </button>
                </div>
                <button class="border-0 bg-transparent p-0 text-[11.5px] text-primary" @click="router.push(`/runs/${selectedRun.id}`)">打开完整详情</button>
              </div>

              <section class="mx-3 my-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-[7px] border border-line bg-line">
                <div class="flex min-w-0 min-h-[45px] flex-col justify-center gap-[3px] bg-[var(--surface-2)] px-[9px] py-[7px]"><span class="text-[10px] text-subtle">工作流</span><strong class="truncate text-[11.5px] text-muted">{{ selectedRun.workflowName }}</strong></div>
                <div class="flex min-w-0 min-h-[45px] flex-col justify-center gap-[3px] bg-[var(--surface-2)] px-[9px] py-[7px]"><span class="text-[10px] text-subtle">触发方式</span><strong class="truncate text-[11.5px] text-muted">{{ triggerLabel(selectedRun.trigger) }}</strong></div>
                <div class="flex min-w-0 min-h-[45px] flex-col justify-center gap-[3px] bg-[var(--surface-2)] px-[9px] py-[7px]"><span class="text-[10px] text-subtle">开始时间</span><strong class="truncate text-[11.5px] text-muted">{{ formatDateTime(selectedRun.createdAt) }}</strong></div>
                <div class="flex min-w-0 min-h-[45px] flex-col justify-center gap-[3px] bg-[var(--surface-2)] px-[9px] py-[7px]"><span class="text-[10px] text-subtle">总耗时</span><strong class="truncate text-[11.5px] text-muted">{{ durationLabel(selectedRun) }}</strong></div>
                <div class="flex min-w-0 min-h-[45px] flex-col justify-center gap-[3px] bg-[var(--surface-2)] px-[9px] py-[7px]"><span class="text-[10px] text-subtle">版本</span><strong class="truncate text-[11.5px] text-muted">v{{ selectedRun.version ?? '—' }}</strong></div>
                <div class="flex min-w-0 min-h-[45px] flex-col justify-center gap-[3px] bg-[var(--surface-2)] px-[9px] py-[7px]"><span class="text-[10px] text-subtle">费用</span><strong class="truncate text-[11.5px] text-muted">{{ selectedRun.metadata.cost ? `¥${selectedRun.metadata.cost.toFixed(2)}` : '—' }}</strong></div>
              </section>

              <section class="px-3 pb-[11px] pt-[5px]">
                <div class="flex items-center justify-between gap-2 text-[11.5px] font-650 text-muted">
                  <span>节点时间线</span>
                  <small class="text-[10px] font-400 text-subtle">{{ completedNodes }}/{{ selectedRun.nodeRuns.length }} 已完成</small>
                </div>
                <div class="mt-1.5">
                  <button
                    v-for="nodeRun in selectedRun.nodeRuns"
                    :key="nodeRun.nodeId"
                    class="group grid min-h-[27px] w-full grid-cols-[7px_minmax(84px,0.9fr)_minmax(80px,1.3fr)_46px] items-center gap-[7px] border-0 bg-transparent p-0 text-left"
                    @click="router.push(`/runs/${selectedRun.id}?node=${nodeRun.nodeId}`)"
                  >
                    <span class="h-1.5 w-1.5 rounded-full" :class="nodeRun.status === 'succeeded' ? 'bg-success' : nodeRun.status === 'running' ? 'bg-primary animate-pulse' : nodeRun.status === 'failed' ? 'bg-danger' : 'bg-[#c7ccd6]'" />
                    <span class="truncate text-[10.5px] text-muted group-hover:text-primary">{{ nodeRun.title }}</span>
                    <span class="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <i class="block h-full rounded-full" :class="nodeRun.status === 'succeeded' ? 'bg-success' : nodeRun.status === 'running' ? 'bg-primary' : nodeRun.status === 'failed' ? 'bg-danger' : 'bg-[#c7ccd6]'" :style="{ width: nodeBarWidth(nodeRun) }" />
                    </span>
                    <span class="text-right text-[10px] text-subtle">{{ formatDuration(nodeRun.durationMs) }}</span>
                  </button>
                </div>
              </section>

              <div v-if="selectedRun.error" class="mx-3 mb-2.5 mt-0.5 flex items-start gap-[7px] rounded-[6px] border border-[#efbfc1] bg-danger-soft px-[9px] py-2 text-danger">
                <TriangleAlert :size="14" />
                <div>
                  <strong class="font-mono text-[10.5px]">{{ selectedRun.error.code }}</strong>
                  <p class="mb-0 mt-[3px] text-[10.5px] leading-[1.45] text-[#9c4045]">{{ selectedRun.error.message }}</p>
                </div>
              </div>

              <section class="mx-3 mb-[11px] overflow-hidden rounded-[6px] bg-[var(--code-bg)]">
                <div class="flex h-7 items-center justify-between gap-2 px-2 text-[10.5px] text-[#939bad]">
                  <span>输入快照</span>
                  <button class="border-0 bg-transparent p-0 text-[11.5px] text-[#9f97ff]" @click="copyText(JSON.stringify(selectedRun.input, null, 2))">复制 JSON</button>
                </div>
                <pre class="m-0 max-h-[150px] overflow-auto px-2.5 py-2 font-mono text-[10.5px] leading-[1.55] text-[#d8dbe5]">{{ JSON.stringify(selectedRun.input, null, 2) }}</pre>
              </section>

              <div class="flex justify-end gap-[7px] px-3 pb-[13px]">
                <button v-if="canCancel" class="btn btn-danger !h-[31px] text-[11.5px]" :disabled="actionPending" @click="cancelSelected">取消运行</button>
                <button class="btn !h-[31px] text-[11.5px]" :disabled="actionPending" @click="replaySelected"><RotateCcw :size="13" /> 原样重跑</button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  TriangleAlert,
  X,
} from 'lucide-vue-next'
import AppShell from '@/components/AppShell.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import {
  cancelRun as cancelRunRequest,
  listRuns,
  listWorkflows,
  replayRun as replayRunRequest,
} from '@/services/reflowApi'
import { formatDateTime, formatDuration } from '@/shared/format'
import type {
  NodeRun,
  RunRecord,
  WorkflowCard,
} from '@/shared/types'

const router = useRouter()
const allRuns = ref<RunRecord[]>([])
const workflowOptions = ref<WorkflowCard[]>([])
const workflowFilter = ref('')
const kindFilter = ref('')
const triggerFilter = ref('')
const statusFilter = ref<'' | 'active' | 'succeeded' | 'failed' | 'cancelled'>('')
const timeRange = ref<'24h' | '7d' | 'all'>('24h')
const query = ref('')
const page = ref(1)
const pageSize = 8
const selectedRunId = ref('')
const refreshing = ref(false)
const actionPending = ref(false)
const loadError = ref('')
const actionError = ref('')
let refreshTimer: number | undefined

const scopeRuns = computed(() => {
  const cutoff =
    timeRange.value === '24h'
      ? Date.now() - 24 * 60 * 60 * 1000
      : timeRange.value === '7d'
        ? Date.now() - 7 * 24 * 60 * 60 * 1000
        : 0
  return allRuns.value.filter((run) => {
    if (Date.parse(run.createdAt) < cutoff) return false
    if (workflowFilter.value && run.workflowId !== workflowFilter.value) return false
    if (kindFilter.value && run.runKind !== kindFilter.value) return false
    return true
  })
})

const filteredByScope = computed(() =>
  scopeRuns.value.filter((run) => !triggerFilter.value || run.trigger === triggerFilter.value),
)

const filteredRuns = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return filteredByScope.value.filter((run) => {
    if (statusFilter.value === 'active') {
      if (!['queued', 'pending', 'running', 'waiting'].includes(run.status)) return false
    } else if (statusFilter.value && run.status !== statusFilter.value) {
      return false
    }
    if (!needle) return true
    return [run.id, run.workflowName, run.error?.code, run.trigger]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRuns.value.length / pageSize)))
const pageStart = computed(() => (page.value - 1) * pageSize)
const pagedRuns = computed(() => filteredRuns.value.slice(pageStart.value, pageStart.value + pageSize))
const selectedRun = computed(() =>
  allRuns.value.find((run) => run.id === selectedRunId.value) ??
  undefined,
)
const runningCount = computed(
  () =>
    scopeRuns.value.filter((run) =>
      ['queued', 'pending', 'running', 'waiting'].includes(run.status),
    ).length,
)
const liveRunCount = computed(
  () =>
    allRuns.value.filter((run) =>
      ['queued', 'pending', 'running', 'waiting'].includes(run.status),
    ).length,
)
const failedCount = computed(() => scopeRuns.value.filter((run) => run.status === 'failed').length)
const successRate = computed(() => {
  if (!scopeRuns.value.length) return '—'
  return `${((scopeRuns.value.filter((run) => run.status === 'succeeded').length / scopeRuns.value.length) * 100).toFixed(1)}%`
})
const p95Duration = computed(() => {
  const durations = scopeRuns.value
    .map((run) => run.durationMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)
  if (!durations.length) return '—'
  const value = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
  return formatDuration(value)
})
const totalCost = computed(() =>
  scopeRuns.value.reduce((total, run) => total + (run.metadata.cost ?? 0), 0).toFixed(2),
)
const completedNodes = computed(
  () =>
    selectedRun.value?.nodeRuns.filter((nodeRun) =>
      ['succeeded', 'failed', 'skipped', 'cancelled'].includes(nodeRun.status),
    ).length ?? 0,
)
const canCancel = computed(() =>
  selectedRun.value
    ? ['queued', 'pending', 'running', 'waiting'].includes(selectedRun.value.status)
    : false,
)

watch([workflowFilter, kindFilter, triggerFilter, statusFilter, timeRange, query], () => {
  page.value = 1
})

watch(totalPages, (max) => {
  if (page.value > max) page.value = max
})

/**
 * 截短运行 ID，保留可辨识的后缀。
 * @param value 完整运行 ID。
 * @param size 保留的最大字符数。
 * @returns 适合表格展示的短 ID。
 */
function shortId(value: string, size = 8) {
  const suffix = value.includes('_') ? value.split('_').pop() ?? value : value
  return `${suffix.slice(0, size)}${suffix.length > size ? '…' : ''}`
}

/**
 * 返回运行类型标签。
 * @param value 正式运行或草稿预览。
 * @returns 中文类型标签。
 */
function kindLabel(value: RunRecord['runKind']) {
  return value === 'production' ? '正式' : '预览'
}

/**
 * 返回触发方式的中文标签。
 * @param value 运行触发方式。
 * @returns 用于列表与详情展示的标签。
 */
function triggerLabel(value: RunRecord['trigger']) {
  return {
    manual_trial: '手动试运行',
    manual_preview: '手动预览',
    api: 'API',
    mcp: 'MCP',
    webhook: 'Webhook',
    schedule: '定时',
    event: '事件',
    replay: '重放',
  }[value]
}

/**
 * 将运行耗时格式化为可读文本。
 * @param run 运行记录。
 * @returns 运行中、秒数或占位符。
 */
function durationLabel(run: RunRecord) {
  if (run.status === 'queued') return '排队中'
  if (['pending', 'running', 'waiting'].includes(run.status)) return '运行中'
  return formatDuration(run.durationMs)
}

/**
 * 格式化运行发生时间。
 * @param value ISO 时间字符串。
 * @returns 本地时区的时:分文本。
 */
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 计算节点时间线中进度条宽度。
 * @param nodeRun 节点运行快照。
 * @returns CSS 百分比字符串。
 */
function nodeBarWidth(nodeRun: NodeRun) {
  if (!nodeRun.durationMs) return nodeRun.status === 'running' ? '50%' : '0%'
  return `${Math.min(100, Math.max(8, (nodeRun.durationMs / 1600) * 100))}%`
}

/** 清除运行列表的全部筛选条件。 */
function clearFilters() {
  workflowFilter.value = ''
  kindFilter.value = ''
  triggerFilter.value = ''
  statusFilter.value = ''
  query.value = ''
  timeRange.value = '24h'
}

/**
 * 刷新工作流选项和真实运行快照。
 *
 * @param silent 是否用于后台轮询，避免持续显示按钮加载态。
 * @returns 加载完成时结束。
 */
async function refreshData(silent = false) {
  if (refreshing.value) return
  if (!silent) refreshing.value = true
  loadError.value = ''
  try {
    const [runs, workflows] = await Promise.all([
      listRuns({ limit: 500 }),
      listWorkflows(),
    ])
    allRuns.value = runs
    workflowOptions.value = workflows
    if (!selectedRunId.value) {
      selectedRunId.value =
        runs.find((run) => run.status === 'failed')?.id ?? runs[0]?.id ?? ''
    } else if (!runs.some((run) => run.id === selectedRunId.value)) {
      selectedRunId.value = runs[0]?.id ?? ''
    }
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : '无法读取运行记录。'
  } finally {
    refreshing.value = false
  }
}

/**
 * 将文本写入系统剪贴板。
 * @param value 待复制文本。
 */
async function copyText(value: string) {
  await navigator.clipboard?.writeText(value)
}

/**
 * 取消当前选中的排队中或运行中任务。
 *
 * @returns 请求完成时结束。
 */
async function cancelSelected() {
  if (!selectedRun.value || actionPending.value) return
  actionPending.value = true
  actionError.value = ''
  try {
    await cancelRunRequest(selectedRun.value.id)
    await refreshData()
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : '取消运行失败。'
  } finally {
    actionPending.value = false
  }
}

/**
 * 使用原定义快照重放当前运行并选中新记录。
 *
 * @returns 请求完成时结束。
 */
async function replaySelected() {
  if (!selectedRun.value || actionPending.value) return
  actionPending.value = true
  actionError.value = ''
  try {
    const replay = await replayRunRequest(selectedRun.value.id)
    await refreshData()
    selectedRunId.value = replay.runId
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : '重放运行失败。'
  } finally {
    actionPending.value = false
  }
}

/** 将当前筛选结果导出为带 UTF-8 BOM 的 CSV。 */
function exportCsv() {
  const rows = [
    ['runId', 'workflow', 'kind', 'trigger', 'status', 'durationMs', 'cost', 'createdAt'],
    ...filteredRuns.value.map((run) => [
      run.id,
      run.workflowName,
      run.runKind,
      run.trigger,
      run.status,
      String(run.durationMs ?? ''),
      String(run.metadata.cost ?? ''),
      run.createdAt,
    ]),
  ]
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `reflow-runs-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  void refreshData()
  refreshTimer = window.setInterval(() => {
    if (liveRunCount.value) void refreshData(true)
  }, 3000)
})

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})
</script>

