<template>
  <PageHeaderActions>
    <div v-if="version" class="flex min-w-0 items-center justify-end gap-[7px] max-[620px]:flex-wrap">
      <span class="inline-flex h-[29px] items-center gap-[5px] rounded-[6px] bg-primary-soft px-[9px] text-[12px] font-600 text-primary">
        <GitCommitHorizontal :size="13" /> 固定版本 v{{ version.version }}
      </span>
      <span class="mono inline-flex h-[29px] items-center gap-[5px] rounded-[6px] border border-line px-[9px] text-[12px] text-subtle max-[900px]:hidden">
        {{ version.schemaHash }}
      </span>
      <span
        class="inline-flex h-[29px] items-center gap-[5px] rounded-[6px] px-[9px] text-[12px] font-600"
        :class="readinessReady ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
      >
        <CheckCircle2 v-if="readinessReady" :size="13" />
        <CircleAlert v-else :size="13" />
        {{ readinessReady ? '就绪' : `${blockers.length} 项阻断` }}
      </span>
      <Button variant="ghost" class="h-[29px] px-[9px] text-[12px] max-[900px]:hidden" @click="callInfoOpen = true">
        <Code2 :size="14" /> 调用信息
      </Button>
    </div>
  </PageHeaderActions>

  <main class="px-7 pb-[54px] pt-[27px] max-md:px-4">
        <div v-if="loading" class="surface mx-auto my-20 flex max-w-[720px] flex-col items-center gap-2.5 p-[38px] text-center text-subtle">
          <LoaderCircle :size="30" class="animate-spin text-primary" />
          <h1 class="mb-0 mt-[5px] text-[22px] text-ink">正在读取固定版本</h1>
          <p class="m-0 max-w-[500px] text-[12px] leading-[1.7]">正在加载不可变定义、真实依赖就绪状态和该版本运行历史。</p>
        </div>

        <div v-else-if="!versionId" class="surface mx-auto my-20 flex max-w-[720px] flex-col items-center gap-2.5 p-[38px] text-center text-subtle">
          <Link2Off :size="30" class="text-warning" />
          <h1 class="mb-0 mt-[5px] text-[22px] text-ink">缺少固定版本</h1>
          <p class="m-0 max-w-[500px] text-[12px] leading-[1.7]">试运行必须从发布成功页、版本列表或工作流快捷入口携带 <code>versionId</code> 打开，页面不会隐式使用最新版本。</p>
          <div class="mt-[9px] flex gap-2">
            <Button as-child variant="outline"><RouterLink :to="`/workflows/${workflowId}/versions`">选择发布版本</RouterLink></Button>
            <Button as-child><RouterLink :to="`/workflows/${workflowId}`">返回编辑器</RouterLink></Button>
          </div>
        </div>

        <div v-else-if="!version || loadError" class="surface mx-auto my-20 flex max-w-[720px] flex-col items-center gap-2.5 p-[38px] text-center text-subtle">
          <FileQuestion :size="30" class="text-warning" />
          <h1 class="mb-0 mt-[5px] text-[22px] text-ink">{{ loadError ? '固定版本加载失败' : '版本不存在' }}</h1>
          <p class="m-0 max-w-[520px] text-[12px] leading-[1.7]">{{ loadError || `固定版本 ${versionId} 不存在或当前工作区无权访问。` }}</p>
          <Button as-child class="mt-[9px]"><RouterLink :to="`/workflows/${workflowId}/versions`">返回版本列表</RouterLink></Button>
        </div>

        <template v-else>
          <section class="mb-[18px] flex items-end justify-between gap-[22px] max-[900px]:flex-col max-[900px]:items-start">
            <div>
              <h1 class="m-0 text-[27px] font-[730]">发布后试运行台</h1>
              <p class="mb-0 mt-[7px] text-[12px] text-subtle">对固定发布版本做真实执行验证 · 输入 / 执行 / 结果与当前版本历史</p>
            </div>
            <div class="flex flex-wrap justify-end gap-1.5 text-[12px] text-subtle max-[900px]:justify-start">
              <span class="inline-flex h-7 items-center gap-[5px] rounded-[5px] border border-line bg-surface px-2"><strong class="font-500 text-muted">版本</strong> v{{ version.version }}</span>
              <span class="inline-flex h-7 items-center gap-[5px] rounded-[5px] border border-line bg-surface px-2"><strong class="font-500 text-muted">发布时间</strong> {{ formatDateTime(version.createdAt) }}</span>
              <span class="inline-flex h-7 items-center gap-[5px] rounded-[5px] border border-line bg-surface px-2"><strong class="font-500 text-muted">schemaHash</strong> <em class="mono not-italic text-muted">{{ version.schemaHash }}</em></span>
            </div>
          </section>

          <section class="surface flex overflow-hidden max-[900px]:flex-wrap">
            <div
              v-for="(item, index) in readinessItems"
              :key="item.key"
              class="flex min-w-0 flex-1 items-center gap-1.5 border-r border-line px-3 py-[13px] text-[12px] max-[900px]:min-w-[50%] max-[620px]:min-w-full"
              :class="index >= 3 ? 'max-[1180px]:hidden' : ''"
            >
              <component :is="item.icon" :size="14" class="shrink-0" :class="readinessToneClass(item.tone)" />
              <span class="shrink-0 text-subtle">{{ item.label }}</span>
              <strong class="truncate text-[12px]" :class="readinessToneClass(item.tone)">{{ item.summary }}</strong>
            </div>
            <Button variant="unstyled" type="button"
              class="inline-flex min-h-[45px] items-center gap-[5px] border-0 bg-surface-2 px-[15px] py-[13px] text-[12px] text-subtle max-[620px]:w-full max-[620px]:justify-center"
              @click="readinessOpen = !readinessOpen"
            >
              {{ blockers.length ? `${blockers.length} 项阻断` : '就绪' }}
              <span v-if="warnings.length">· {{ warnings.length }} 项警告</span>
              <ChevronDown :size="13" class="transition-transform" :class="readinessOpen ? 'rotate-[-90deg]' : ''" />
            </Button>
          </section>

          <section v-if="readinessOpen" class="surface mt-2 px-[13px] py-2.5">
            <div v-for="item in [...blockers, ...warnings]" :key="item.key" class="flex items-center gap-[9px] border-b border-dashed border-line py-2 last:border-b-0">
              <TriangleAlert :size="14" :class="item.blocking ? 'text-danger' : 'text-warning'" />
              <div class="flex min-w-0 flex-col gap-0.5">
                <strong class="text-[12px]">{{ item.label }}</strong>
                <span class="text-[12px] text-subtle">{{ item.message }}</span>
              </div>
              <RouterLink v-if="item.path" :to="item.path" class="ml-auto shrink-0 border-0 bg-transparent p-0 text-[12px] text-primary">去配置</RouterLink>
            </div>
            <div v-if="!blockers.length && !warnings.length" class="flex items-center gap-[7px] text-[12px] text-success">
              <CheckCircle2 :size="15" /> 模型、知识库、MCP、密钥与节点依赖均已就绪。
            </div>
          </section>

          <section class="my-[11px] flex flex-wrap items-start gap-2 rounded-[7px] border border-[#f3d39f] bg-[#fff9ee] px-3 py-[9px] text-[12px] text-warning">
            <TriangleAlert :size="15" />
            <span class="min-w-0 flex-1">真实执行：使用生产配置与凭证，可能产生模型费用、HTTP 请求或 MCP 工具副作用。</span>
            <div v-if="hasSideEffect" class="max-sm:w-full max-sm:pl-[22px]">
              <Label class="flex items-center gap-[5px] whitespace-nowrap font-normal text-muted max-sm:whitespace-normal">
                <Checkbox v-model="sideEffectConfirmed" />
                我确认执行带副作用的工具
              </Label>
            </div>
          </section>

          <section class="grid grid-cols-[minmax(360px,0.78fr)_minmax(520px,1.22fr)] items-stretch gap-3 max-[1180px]:grid-cols-1">
            <article class="surface flex min-h-[620px] flex-col overflow-hidden max-[1180px]:min-h-0">
              <div class="flex min-h-[65px] items-center justify-between gap-3 border-b border-line px-[15px] py-[13px]">
                <div>
                  <h2 class="m-0 text-[14px]">输入区</h2>
                  <p class="mb-0 mt-1 text-[12px] text-subtle">固定版本的 <span class="mono">start.inputSchema</span></p>
                </div>
                <div class="inline-flex gap-0.5 rounded-[7px] border border-line bg-surface-2 p-0.75">
                  <Button variant="unstyled" type="button" class="h-[25px] rounded-[5px] border-0 px-[9px] text-[12px]" :class="inputMode === 'form' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="switchInputMode('form')">表单</Button>
                  <Button variant="unstyled" type="button" class="h-[25px] rounded-[5px] border-0 px-[9px] text-[12px]" :class="inputMode === 'json' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="switchInputMode('json')">JSON</Button>
                </div>
              </div>

              <div class="mx-3.5 mt-3 flex items-start gap-[7px] rounded-[6px] bg-info-soft px-[9px] py-2 text-[12px] leading-[1.45] text-info">
                <Info :size="13" />
                <span>表单与 JSON 是同一份输入数据；语法或 Schema 错误会阻止运行。</span>
              </div>

              <div v-if="inputMode === 'form'" class="flex flex-col gap-4 px-3.5 pt-[13px]">
                <label v-for="field in inputFields" :key="field.name" class="flex flex-col gap-1.5">
                  <span class="flex items-center gap-1.5 text-[12px] font-600 text-muted">
                    {{ field.name }}
                    <i class="font-mono text-[12px] not-italic text-primary">{{ field.type }}</i>
                    <em v-if="field.required" class="rounded-[3px] bg-warning-soft px-1 py-0.25 text-[12px] not-italic text-warning">必填</em>
                  </span>
                  <p v-if="field.description" class="-mt-0.5 mb-0.25 text-[12px] text-subtle">{{ field.description }}</p>

                  <Input
                    v-if="field.type === 'string'"
                    :model-value="String(inputData[field.name] ?? '')"
                    class="min-h-9 rounded-[6px] px-2.5 py-2 text-[12px]"
                    :placeholder="field.description"
                    @update:model-value="inputData[field.name] = String($event)"
                  />
                  <Input
                    v-else-if="field.type === 'number'"
                    :model-value="numberFieldValue(field.name)"
                    class="min-h-9 rounded-[6px] px-2.5 py-2 text-[12px]"
                    type="number"
                    @update:model-value="setNumberField(field.name, $event)"
                  />
                  <Switch
                    v-else-if="field.type === 'boolean'"
                    class="h-[21px] w-[38px]"
                    :model-value="Boolean(inputData[field.name])"
                    @update:model-value="(value) => inputData[field.name] = value"
                  />
                  <Textarea
                    v-else
                    :model-value="complexFieldText(field.name)"
                    class="min-h-[78px] resize-y rounded-[6px] px-2.5 py-2 font-mono text-[12px]"
                    rows="4"
                    spellcheck="false"
                    @update:model-value="updateComplexField(field.name, String($event))"
                  />
                  <span v-if="fieldErrors[field.name]" class="text-[12px] leading-[1.45] text-danger">{{ fieldErrors[field.name] }}</span>
                </label>
                <div v-if="!inputFields.length" class="flex items-center gap-[7px] rounded-[6px] border border-dashed border-line p-3 text-[12px] text-subtle">
                  <FileQuestion :size="16" />
                  该固定版本没有可用的 start.inputSchema，无法生成输入表单。
                </div>
              </div>

              <div v-else class="px-3.5 pt-[13px]">
                <div class="flex h-[27px] items-center justify-between rounded-t-[7px] border border-[#292d39] border-b-0 bg-[#1d202a] px-2 font-mono text-[12px] text-[#939bad]">
                  <span>input.json</span>
                  <Button variant="link" size="xs" class="text-[12px]" @click="formatJson">格式化</Button>
                </div>
                <Textarea
                  v-model="jsonDraft"
                  class="min-h-[275px] rounded-b-[7px] border-[#292d39] bg-[var(--code-bg)] p-[11px] font-mono text-[12px] leading-[1.65] text-[#d8dbe5]"
                  spellcheck="false"
                  @blur="syncJsonInput"
                />
              </div>

              <div v-if="inputError" class="mx-3.5 mt-[11px] flex items-start gap-[7px] rounded-[6px] bg-danger-soft px-[9px] py-2 text-[12px] text-danger">
                <CircleAlert :size="14" />
                <span>{{ inputError }}</span>
              </div>

              <Button
                class="mx-3.5 mb-2 mt-auto h-10 text-[12px] font-600"
                :disabled="!canRun"
                @click="startTrial"
              >
                <LoaderCircle v-if="isRunning" :size="16" class="animate-spin" />
                <Play v-else :size="16" />
                {{ isRunning ? '真实执行中' : '运行（真实执行）' }}
              </Button>

              <div class="flex min-h-8 items-center justify-between px-3.5 pb-3 text-[12px] text-subtle">
                <span>超时 120s · {{ hasSideEffect ? '写工具需二次确认' : '只读工具' }}</span>
                <Button v-if="isRunning" variant="link" size="xs" class="text-danger" @click="cancelTrial">
                  <Square :size="12" /> 取消运行
                </Button>
              </div>
            </article>

            <article class="surface flex min-h-[620px] flex-col overflow-hidden max-[1180px]:min-h-0">
              <div class="flex min-h-[58px] items-center justify-between gap-3 border-b border-line px-[15px] py-[13px]">
                <div>
                  <h2 class="m-0 text-[14px]">执行区</h2>
                  <p class="mb-0 mt-1 text-[12px] text-subtle">{{ activeRun ? shortRunId(activeRun.id) : '等待创建固定版本运行' }}</p>
                </div>
                <span v-if="activeRun" class="inline-flex items-center gap-[5px] text-[12px] text-subtle">
                  <span class="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_0_3px_var(--success-soft)]" />
                  {{ streamLabel }}
                </span>
              </div>

              <div v-if="activeRun" class="mx-3.5 mt-[11px] overflow-hidden rounded-[7px] border" :class="runStripClass(activeRun.status)">
                <div class="flex min-h-[39px] items-center gap-2 px-2.5 text-[12px] text-muted">
                  <StatusBadge :status="activeRun.status" />
                  <strong class="mono">{{ shortRunId(activeRun.id) }}</strong>
                  <span>{{ completedNodeCount }}/{{ version.definition.nodes.length }} 节点</span>
                  <span class="ml-auto">{{ elapsedLabel }}</span>
                </div>
                <div class="h-0.5 bg-[rgba(14,159,110,0.12)]">
                  <span class="block h-full bg-success transition-[width] duration-250" :style="{ width: `${nodeProgress}%` }" />
                </div>
              </div>

              <div v-if="activeRun" class="mx-3.5 mt-[9px] min-h-[205px] max-h-[265px] overflow-y-auto">
                <div
                  v-for="nodeRun in activeRun.nodeRuns"
                  :key="nodeRun.nodeId"
                  class="grid min-h-[35px] grid-cols-[8px_minmax(100px,1fr)_90px_60px_50px] items-center gap-2 border-b border-dashed border-line text-[12px] text-muted"
                >
                  <span class="h-1.5 w-1.5 rounded-full" :class="nodeStatusDotClass(nodeRun.status)" />
                  <strong>{{ nodeRun.title }}</strong>
                  <span class="mono text-[12px] text-subtle">{{ nodeRun.type }}</span>
                  <span class="text-right text-[12px] text-subtle">{{ formatDuration(nodeRun.durationMs) }}</span>
                  <span class="text-right" :class="nodeStatusLabelClass(nodeRun.status)">{{ nodeStatusLabel(nodeRun.status) }}</span>
                </div>
              </div>

              <div v-else class="flex min-h-[285px] flex-col items-center justify-center gap-2 text-subtle">
                <PlayCircle :size="27" />
                <strong class="text-[12px] text-muted">尚未运行固定版本</strong>
                <span class="max-w-[300px] text-center text-[12px] leading-[1.55]">完成输入并确认依赖后，节点状态会通过事件流实时叠加。</span>
              </div>

              <ExecutionTabs
                v-if="activeRun"
                class="min-h-[255px] flex-1 border-t border-line"
                :run="activeRun"
                :input="activeRun.input"
                :input-fields="inputFields"
                :events="runEvents"
                readonly
              />
            </article>
          </section>

          <section class="surface mt-3 overflow-hidden">
            <div class="flex min-h-[62px] items-center justify-between gap-3 border-b border-line px-3.5 py-[11px]">
              <div>
                <h2 class="m-0 text-[14px]">当前版本试运行历史</h2>
                <p class="mb-0 mt-1 text-[12px] text-subtle">固定版本 v{{ version.version }} · 默认仅显示 <span class="mono">manual_trial</span></p>
              </div>
              <div class="inline-flex gap-0.5 rounded-[7px] border border-line bg-surface-2 p-0.75">
                <Button variant="unstyled" type="button" class="h-[25px] rounded-[5px] border-0 px-[9px] text-[12px]" :class="!allTriggers ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="allTriggers = false">本版本试运行</Button>
                <Button variant="unstyled" type="button" class="h-[25px] rounded-[5px] border-0 px-[9px] text-[12px]" :class="allTriggers ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="allTriggers = true">全部 trigger</Button>
              </div>
            </div>

            <div v-if="versionRuns.length" class="max-[900px]:overflow-x-auto">
              <div class="grid min-w-[760px] grid-cols-[80px_116px_76px_64px_minmax(130px,1fr)_82px_118px] items-center gap-[9px] border-b border-line bg-surface-2 px-3.5 text-[12px] text-subtle max-[900px]:h-8">
                <span>状态</span><span>运行 ID</span><span>触发</span><span>耗时</span><span>结果</span><span>时间</span><span />
              </div>
              <div v-for="run in versionRuns" :key="run.id" class="grid min-h-[43px] min-w-[760px] grid-cols-[80px_116px_76px_64px_minmax(130px,1fr)_82px_118px] items-center gap-[9px] border-b border-line px-3.5 text-[12px] text-muted last:border-b-0">
                <StatusBadge :status="run.status" />
                <Button variant="link" size="xs" class="mono w-fit text-[12px] text-muted" @click="router.push(`/runs/${run.id}`)">{{ shortRunId(run.id) }}</Button>
                <span>{{ triggerLabel(run.trigger) }}</span>
                <span>{{ formatRunDuration(run) }}</span>
                <span class="min-w-0 truncate">
                  <span v-if="run.error" class="mono text-danger">{{ run.error.code }}</span>
                  <span v-else-if="run.metadata.cost">¥{{ run.metadata.cost.toFixed(2) }} · {{ run.metadata.tokens ?? 0 }} tokens</span>
                  <span v-else>-</span>
                </span>
                <span>{{ formatTime(run.createdAt) }}</span>
                <div class="flex justify-end gap-2">
                  <Button variant="link" size="xs" @click="router.push(`/runs/${run.id}`)">打开运行</Button>
                  <Button variant="link" size="xs" @click="replayHistoryRun(run)">重跑</Button>
                </div>
              </div>
            </div>
            <div v-else class="flex min-h-24 items-center justify-center gap-[7px] text-[12px] text-subtle">
              <History :size="20" />
              <span>当前固定版本还没有试运行记录。</span>
            </div>
          </section>
        </template>
  </main>

  <Dialog v-model:open="callInfoOpen">
      <DialogContent class="w-[min(540px,calc(100vw-32px))]">
        <DialogTitle class="m-0 text-[17px] font-700">固定版本调用信息</DialogTitle>
        <DialogDescription class="mb-[15px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
          外部调用只运行当前发布版本，不会读取草稿。凭证以掩码或 secret_ref 展示。
        </DialogDescription>
        <div class="mt-[9px] flex flex-col gap-1.5 rounded-[7px] border border-line bg-surface-2 p-2.5">
          <div class="flex items-center justify-between text-[12px] text-subtle"><span>HTTP</span><Button variant="link" size="xs" class="text-[12px]" @click="copyText('http-endpoint')">复制</Button></div>
          <code id="http-endpoint" class="break-words font-mono text-[12px]">POST http://127.0.0.1:8787/api/workflows/{{ workflowId }}/runs</code>
          <small class="text-[12px] text-subtle">body.workflowVersionId = {{ versionId }}</small>
        </div>
        <div class="mt-[9px] flex flex-col gap-1.5 rounded-[7px] border border-[#292d39] bg-[var(--code-bg)] p-2.5 text-[#d8dbe5]">
          <div class="flex items-center justify-between text-[12px] text-[#939bad]"><span>MCP / Streamable HTTP</span><span class="text-warning">尚未接入</span></div>
          <code class="break-words font-mono text-[12px]">入站暴露与 POST /mcp 完成联调后显示真实 endpoint</code>
          <small class="text-[12px] text-[#939bad]">当前页面不会伪造 MCP 工具名或访问凭证。</small>
        </div>
        <DialogFooter class="mt-[18px]">
          <DialogClose as-child><Button variant="outline">关闭</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Code2,
  Database,
  FileQuestion,
  GitCommitHorizontal,
  History,
  Info,
  KeyRound,
  Link2Off,
  LoaderCircle,
  Play,
  PlayCircle,
  PlugZap,
  Square,
  TriangleAlert,
} from 'lucide-vue-next'
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from '@ai-reflow/ui'
import PageHeaderActions from '@/components/PageHeaderActions.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ExecutionTabs from '@/workflow/shared/ExecutionTabs.vue'
import { subscribeRunEvents } from '@/api/client'
import {
  cancelRun as cancelRunRequest,
  createProductionRun,
  getRun,
  getWorkflow,
  getWorkflowVersion,
  getWorkflowReadiness,
  listRuns,
  replayRun as replayRunRequest,
  type ReadinessResponse,
} from '@/services/reflowApi'
import { clonePlain } from '@/shared/clone'
import { formatDateTime, formatDuration } from '@/shared/format'
import type {
  NodeRunStatus,
  RunEvent,
  RunRecord,
  SchemaField,
  WorkflowDraft,
  WorkflowVersion,
} from '@/shared/types'

const route = useRoute()
const router = useRouter()
const workflowId = computed(() => String(route.params.id))
const versionId = computed(() => {
  const value = route.query.versionId
  return typeof value === 'string' ? value : ''
})
const draft = ref<WorkflowDraft>()
const version = ref<WorkflowVersion>()
const readiness = ref<ReadinessResponse>()
const loading = ref(true)
const loadError = ref('')

const inputMode = ref<'form' | 'json'>('form')
const jsonDraft = ref('{}')
const inputData = reactive<Record<string, unknown>>({})
const inputError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const readinessOpen = ref(false)
const callInfoOpen = ref(false)
const sideEffectConfirmed = ref(false)
const activeRun = ref<RunRecord>()
const runEvents = ref<RunEvent[]>([])
const streamState = ref<'idle' | 'live' | 'ended'>('idle')
const allTriggers = ref(false)
const elapsedLabel = ref('0.0s')
const historyRuns = ref<RunRecord[]>([])
const workflowSlug = computed(() => workflowId.value.replace(/^wf_/, ''))
let unsubscribe: (() => void) | undefined
let elapsedTimer: number | undefined
let runStart = 0

const startNode = computed(() => version.value?.definition.nodes.find((node) => node.type === 'start'))
const inputSchema = computed(() => {
  const schema = startNode.value?.config.inputSchema
  return schema && typeof schema === 'object' ? (schema as Record<string, unknown>) : undefined
})
const inputFields = computed<SchemaField[]>(() => {
  const properties = inputSchema.value?.properties
  if (!properties || typeof properties !== 'object') return []
  const required = Array.isArray(inputSchema.value?.required)
    ? (inputSchema.value!.required as string[])
    : []
  return Object.entries(properties as Record<string, Record<string, unknown>>).map(([name, value]) => ({
    name,
    type: String(value.type ?? 'string'),
    required: required.includes(name),
    description: value.description ? String(value.description) : value.title ? String(value.title) : '',
  }))
})

const readinessItems = computed(() => {
  const definition = version.value?.definition
  if (!definition) return []
  const modelNodes = definition.nodes.filter((node) => ['llm', 'agent', 'quality-gate'].includes(node.type))
  const mcpNodes = definition.nodes.filter(
    (node) => node.type === 'tool' && String(node.config.kind) === 'mcp',
  )
  const blockedCount = (prefixes: string[]) =>
    (readiness.value?.blockers ?? []).filter((issue) =>
      prefixes.some((prefix) => issue.code.startsWith(prefix)),
    ).length
  const warningCount = (prefixes: string[]) =>
    (readiness.value?.warnings ?? []).filter((issue) =>
      prefixes.some((prefix) => issue.code.startsWith(prefix)),
    ).length
  const modelMissing = blockedCount(['MODEL_'])
  const knowledgeMissing = blockedCount(['KNOWLEDGE_'])
  const mcpMissing = blockedCount(['MCP_'])
  const dependencyMissing = blockedCount(['NODE_RUNTIME_'])
  const secretWarnings = warningCount(['MODEL_CREDENTIAL', 'SECRET_', 'MCP_CREDENTIAL'])
  return [
    {
      key: 'model',
      label: '模型连接',
      summary: modelMissing ? `${modelMissing} 个阻断` : readiness.value?.checked.models ? '已检查' : '未使用',
      detail: modelNodes.length ? `检查 ${readiness.value?.checked.models ?? 0} 个模型连接` : '此版本未使用模型节点',
      tone: modelMissing ? 'danger' : 'success',
      icon: Braces,
    },
    {
      key: 'knowledge',
      label: '知识库',
      summary: knowledgeMissing ? `${knowledgeMissing} 个阻断` : readiness.value?.checked.knowledgeBases ? '已检查' : '未使用',
      detail: `检查 ${readiness.value?.checked.knowledgeBases ?? 0} 个知识库`,
      tone: knowledgeMissing ? 'danger' : 'success',
      icon: Database,
    },
    {
      key: 'mcp',
      label: 'MCP 工具',
      summary: mcpMissing ? `${mcpMissing} 个阻断` : mcpNodes.length ? `${readiness.value?.checked.mcpServers ?? mcpNodes.length} 个服务器` : '未使用',
      detail: mcpNodes.length ? '服务端已检查启用状态与健康状态' : '此版本未调用 MCP',
      tone: mcpMissing ? 'danger' : mcpNodes.length ? 'warning' : 'success',
      icon: PlugZap,
    },
    {
      key: 'secret',
      label: '凭据',
      summary: secretWarnings ? `${secretWarnings} 个警告` : '仅检查引用',
      detail: secretWarnings ? '存在未配置凭据的引用' : '页面不会读取或展示明文密钥',
      tone: secretWarnings ? 'warning' : 'success',
      icon: KeyRound,
    },
    {
      key: 'dependency',
      label: '节点依赖',
      summary: dependencyMissing ? `${dependencyMissing} 个阻断` : `${readiness.value?.checked.nodes ?? definition.nodes.length} 个节点`,
      detail: dependencyMissing ? '存在 P0 worker 尚未接入的节点类型' : '节点类型检查通过',
      tone: dependencyMissing ? 'danger' : 'success',
      icon: Code2,
    },
  ]
})

const blockers = computed(() => {
  const result: Array<{ key: string; label: string; message: string; blocking: boolean; path?: string }> =
    (readiness.value?.blockers ?? []).map((issue, index) => ({
      key: `${issue.code}-${index}`,
      label: issue.code,
      message: issue.message,
      blocking: true,
      path: issue.code.startsWith('MODEL_')
        ? '/models'
        : issue.code.startsWith('KNOWLEDGE_')
          ? '/knowledge'
          : issue.code.startsWith('MCP_')
            ? '/mcp'
            : undefined,
    }))
  if (version.value && !inputFields.value.length) {
    result.push({
      key: 'input-schema',
      label: '输入 Schema',
      message: '固定版本缺少可用的 start.inputSchema，无法生成可校验的运行输入。',
      blocking: true,
    })
  }
  return result
})
const warnings = computed(() => {
  const result: Array<{ key: string; label: string; message: string; blocking: boolean; path?: string }> =
    (readiness.value?.warnings ?? []).map((issue, index) => ({
      key: `${issue.code}-${index}`,
      label: issue.code,
      message: issue.message,
      blocking: false,
      path: issue.code.startsWith('MODEL_')
        ? '/models'
        : issue.code.startsWith('MCP_')
          ? '/mcp'
          : undefined,
    }))
  if (readinessItems.value.find((item) => item.key === 'mcp')?.tone === 'warning') {
    result.push({
      key: 'mcp-warning',
      label: 'MCP 副作用',
      message: '版本包含 MCP 工具调用，本次真实执行前需要显式确认。',
      blocking: false,
      path: '/mcp',
    })
  }
  if (version.value?.definition.nodes.some((node) => node.type === 'tool' && String(node.config.kind) === 'http')) {
    result.push({
      key: 'http-warning',
      label: 'HTTP 副作用',
      message: '版本包含 HTTP 工具，目标服务可能产生外部写入。',
      blocking: false,
    })
  }
  return result
})
const readinessReady = computed(
  () => Boolean(readiness.value?.ready) && blockers.value.length === 0,
)
const hasSideEffect = computed(() =>
  Boolean(version.value?.definition.nodes.some((node) => {
    if (node.type !== 'tool') return false
    return ['http', 'mcp'].includes(String(node.config.kind))
  })),
)
const isRunning = computed(
  () =>
    Boolean(activeRun.value) &&
    ['queued', 'pending', 'running', 'waiting'].includes(activeRun.value!.status),
)
const streamLabel = computed(() => ({
  idle: '已结束',
  live: 'SSE 实时',
  ended: '已结束',
})[streamState.value])
const completedNodeCount = computed(() =>
  activeRun.value?.nodeRuns.filter((node) => ['succeeded', 'failed', 'skipped', 'cancelled'].includes(node.status)).length ?? 0,
)
const nodeProgress = computed(() => {
  const total = activeRun.value?.nodeRuns.length ?? 0
  return total ? Math.round((completedNodeCount.value / total) * 100) : 0
})
const canRun = computed(() => {
  if (!readinessReady.value || isRunning.value) return false
  if (hasSideEffect.value && !sideEffectConfirmed.value) return false
  return true
})
const versionRuns = computed(() =>
  historyRuns.value.filter((run) => {
    if (run.versionId !== versionId.value) return false
    return allTriggers.value || run.trigger === 'manual_trial'
  }),
)

/**
 * 返回就绪项的语义颜色。
 * @param tone 就绪项状态。
 * @returns UnoCSS 文本颜色类。
 */
function readinessToneClass(tone: string) {
  return {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone] ?? 'text-subtle'
}

/**
 * 返回运行摘要的边框与背景状态。
 * @param status 运行状态。
 * @returns UnoCSS 边框和背景类。
 */
function runStripClass(status: RunRecord['status']) {
  if (status === 'failed') return 'border-[#efbfc1] bg-[#fff6f6]'
  if (status === 'cancelled') return 'border-line bg-surface-3'
  return 'border-[#b9e4d2] bg-[#f1fbf7]'
}

/**
 * 返回节点状态圆点的颜色与动画。
 * @param status 节点运行状态。
 * @returns UnoCSS 颜色和动画类。
 */
function nodeStatusDotClass(status: NodeRunStatus) {
  if (status === 'running') return 'animate-pulse bg-primary'
  if (status === 'succeeded') return 'bg-success'
  if (status === 'failed') return 'bg-danger'
  return 'bg-[#c7ccd6]'
}

/**
 * 返回节点状态文字的语义颜色。
 * @param status 节点运行状态。
 * @returns UnoCSS 文本颜色类。
 */
function nodeStatusLabelClass(status: NodeRunStatus) {
  if (status === 'running') return 'text-primary'
  if (status === 'succeeded') return 'text-success'
  if (status === 'failed') return 'text-danger'
  return 'text-subtle'
}

/** 根据开始节点 schema 初始化试运行输入。 */
function initializeInput() {
  Object.keys(inputData).forEach((key) => delete inputData[key])
  const defaults = inputSchema.value?.properties
  if (!defaults || typeof defaults !== 'object') {
    inputData.question = '如何申请企业版试用？需要哪些材料？'
  } else {
    Object.entries(defaults as Record<string, Record<string, unknown>>).forEach(([key, value]) => {
      if (value.default !== undefined) inputData[key] = clonePlain(value.default)
      else if (value.type === 'array') inputData[key] = []
      else if (value.type === 'number') inputData[key] = 0
      else if (value.type === 'boolean') inputData[key] = false
      else inputData[key] = ''
    })
  }
  jsonDraft.value = JSON.stringify(inputData, null, 2)
}

/**
 * 在表单与 JSON 输入模式间同步切换。
 * @param next 目标输入模式。
 */
function switchInputMode(next: 'form' | 'json') {
  if (next === inputMode.value) return
  if (next === 'json') {
    jsonDraft.value = JSON.stringify(inputData, null, 2)
    inputError.value = ''
    inputMode.value = next
    return
  }
  try {
    const parsed = JSON.parse(jsonDraft.value) as Record<string, unknown>
    Object.keys(inputData).forEach((key) => delete inputData[key])
    Object.assign(inputData, parsed)
    inputError.value = ''
    inputMode.value = next
  } catch {
    inputError.value = 'JSON 语法错误，修复后才能切回表单。'
  }
}

/** 将表单值同步为格式化 JSON 文本。 */
function syncJsonInput() {
  try {
    const parsed = JSON.parse(jsonDraft.value) as Record<string, unknown>
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('运行输入必须是 JSON object。')
    }
    Object.keys(inputData).forEach((key) => delete inputData[key])
    Object.assign(inputData, parsed)
    inputError.value = ''
  } catch (error) {
    inputError.value = error instanceof Error ? error.message : 'JSON 语法错误。'
  }
}

/** 格式化试运行输入 JSON。 */
function formatJson() {
  try {
    const parsed = JSON.parse(jsonDraft.value)
    jsonDraft.value = JSON.stringify(parsed, null, 2)
    inputError.value = ''
  } catch {
    inputError.value = '无法格式化无效 JSON。'
  }
}

/**
 * 返回复杂字段的 JSON 文本。
 * @param key 输入字段键。
 * @returns 两空格缩进的 JSON。
 */
function complexFieldText(key: string) {
  return JSON.stringify(inputData[key] ?? [], null, 2)
}

/**
 * 写入数值输入字段。
 * @param key 输入字段键。
 * @param value 输入控件返回的文本或数字。
 */
function setNumberField(key: string, value: string | number) {
  inputData[key] = typeof value === 'number' ? value : Number(value)
}

/**
 * 读取数值输入字段。
 * @param key 输入字段键。
 * @returns 数值或空字符串。
 */
function numberFieldValue(key: string): string | number {
  const current = inputData[key]
  return typeof current === 'number' ? current : ''
}

/**
 * 解析复杂字段 JSON 并写回输入模型。
 * @param key 输入字段键。
 * @param text 用户编辑的 JSON 文本。
 */
function updateComplexField(key: string, text: string) {
  try {
    inputData[key] = JSON.parse(text)
    delete fieldErrors[key]
  } catch {
    fieldErrors[key] = '请输入有效 JSON。'
  }
}

/**
 * 校验必填字段与 JSON 语法。
 * @returns 试运行输入是否可提交。
 */
function validateInput() {
  Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key])
  let parsed: Record<string, unknown>
  if (inputMode.value === 'json') {
    try {
      parsed = JSON.parse(jsonDraft.value) as Record<string, unknown>
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
    } catch {
      inputError.value = '运行输入必须是有效的 JSON object。'
      return null
    }
    Object.keys(inputData).forEach((key) => delete inputData[key])
    Object.assign(inputData, parsed)
  }
  inputError.value = ''
  for (const field of inputFields.value) {
    const raw = inputData[field.name]
    if (field.required && (raw === '' || raw === null || raw === undefined)) {
      fieldErrors[field.name] = '必填项不能为空。'
      continue
    }
    if (raw === undefined || raw === null || raw === '') continue
    if (field.type === 'string' && typeof raw !== 'string') fieldErrors[field.name] = '类型应为 string。'
    if (field.type === 'number' && typeof raw !== 'number') fieldErrors[field.name] = '类型应为 number。'
    if (field.type === 'boolean' && typeof raw !== 'boolean') fieldErrors[field.name] = '类型应为 boolean。'
    if (field.type === 'array' && !Array.isArray(raw)) fieldErrors[field.name] = '类型应为 array。'
    const properties = inputSchema.value?.properties
    const fieldSchema = properties && typeof properties === 'object'
      ? (properties as Record<string, Record<string, unknown>>)[field.name]
      : undefined
    if (typeof fieldSchema?.pattern === 'string') {
      try {
        if (!new RegExp(fieldSchema.pattern).test(String(raw))) {
          fieldErrors[field.name] = `值不符合正则 ${fieldSchema.pattern}。`
        }
      } catch {
        fieldErrors[field.name] = 'start.inputSchema 中的正则表达式无效。'
      }
    }
  }
  if (Object.keys(fieldErrors).length) {
    inputError.value = '输入未通过 start.inputSchema 校验。'
    return null
  }
  return clonePlain(inputData)
}

/** 校验输入后发起固定版本试运行。 */
async function startTrial() {
  if (!version.value || !readinessReady.value) return
  const input = validateInput()
  if (!input) return
  if (hasSideEffect.value && !sideEffectConfirmed.value) {
    inputError.value = '请先确认本次真实执行可能产生副作用。'
    return
  }
  try {
    await startRun(input)
  } catch (error) {
    inputError.value =
      error instanceof Error ? error.message : '创建固定版本试运行失败。'
  }
}

/**
 * 创建固定发布版本运行并订阅实时执行事件。
 * @param input 本次试运行输入快照。
 * @returns 运行创建并开始跟踪时结束。
 */
async function startRun(input: Record<string, unknown>) {
  if (!version.value) return
  stopStream()
  const created = await createProductionRun(
    workflowId.value,
    {
      workflowVersionId: versionId.value,
      trigger: 'manual_trial',
      input,
      options: { timeoutMs: 120_000 },
    },
    crypto.randomUUID(),
  )
  runEvents.value = []
  streamState.value = 'live'
  await attachRun(created.runId)
  await refreshHistory()
}

/**
 * 读取新运行快照并建立 SSE 订阅。
 *
 * @param runId 外部运行 ID。
 * @returns 订阅建立时结束。
 */
async function attachRun(runId: string) {
  activeRun.value = await getRun(runId)
  runStart = Date.now()
  elapsedLabel.value = '0.0s'
  elapsedTimer = window.setInterval(() => {
    elapsedLabel.value = `${((Date.now() - runStart) / 1000).toFixed(1)}s`
  }, 100)
  const afterSeq = runEvents.value.at(-1)?.seq ?? 0
  unsubscribe = subscribeRunEvents({
    runId,
    afterSeq,
    onEvent: async (event) => {
      if (!runEvents.value.some((item) => item.seq === event.seq)) {
        runEvents.value.push(event)
      }
      if (!event.type.startsWith('token')) {
        try {
          activeRun.value = await getRun(runId)
        } catch {
          // A transient detail read must not discard already persisted SSE events.
        }
      }
    },
    onError(error) {
      inputError.value = error.message
      streamState.value = 'ended'
    },
    async onEnd() {
      if (elapsedTimer) window.clearInterval(elapsedTimer)
      elapsedTimer = undefined
      streamState.value = 'ended'
      try {
        activeRun.value = await getRun(runId)
      } catch {
        // Keep the last persisted projection if the final refresh is interrupted.
      }
      await refreshHistory()
      unsubscribe = undefined
    },
  })
}

/**
 * 取消当前试运行并结束事件订阅。
 *
 * @returns 请求完成时结束。
 */
async function cancelTrial() {
  if (!activeRun.value) return
  if (!window.confirm('取消后已完成的节点输出会保留，确认取消当前真实执行？')) return
  await cancelRunRequest(activeRun.value.id)
  activeRun.value = await getRun(activeRun.value.id)
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  streamState.value = 'ended'
  await refreshHistory()
}

/**
 * 使用历史运行原定义快照重跑并切换跟踪新运行。
 * @param run 历史运行记录。
 * @returns 新运行开始跟踪时结束。
 */
async function replayHistoryRun(run: RunRecord) {
  stopStream()
  runEvents.value = []
  try {
    const next = await replayRunRequest(run.id)
    streamState.value = 'live'
    await attachRun(next.runId)
    await refreshHistory()
  } catch (error) {
    inputError.value =
      error instanceof Error ? error.message : '重放固定版本运行失败。'
  }
}

/** 清理当前 SSE 订阅。 */
function stopStream() {
  unsubscribe?.()
  unsubscribe = undefined
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  elapsedTimer = undefined
}

/**
 * 截短运行 ID。
 * @param runId 完整运行 ID。
 * @returns 用于列表展示的短 ID。
 */
function shortRunId(runId: string) {
  return runId.length > 14 ? `${runId.slice(0, 11)}…${runId.slice(-3)}` : runId
}

/**
 * 返回触发方式中文标签。
 * @param trigger 运行触发方式。
 * @returns 中文标签。
 */
function triggerLabel(trigger: RunRecord['trigger']) {
  return {
    manual_trial: '手动',
    manual_preview: '草稿预览',
    api: 'API',
    mcp: 'MCP',
    webhook: 'Webhook',
    schedule: '定时',
    event: '事件',
    replay: '重放',
  }[trigger]
}

/**
 * 将运行耗时与实时状态格式化为列表文本。
 *
 * @param run 运行记录。
 * @returns 排队中、运行中或格式化耗时。
 */
function formatRunDuration(run: RunRecord) {
  if (run.status === 'queued') return '排队中'
  if (['pending', 'running', 'waiting'].includes(run.status)) return '运行中'
  return formatDuration(run.durationMs)
}

/**
 * 返回节点执行状态中文标签。
 * @param status 节点运行状态。
 * @returns 中文标签。
 */
function nodeStatusLabel(status: NodeRunStatus) {
  return {
    pending: '待执行',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    skipped: '跳过',
    cancelled: '已取消',
    waiting: '等待',
  }[status]
}

/**
 * 格式化试运行时间。
 * @param value ISO 时间字符串。
 * @returns 本地时区时间文本。
 */
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/**
 * 复制指定数值或 JSON 区块。
 * @param id 页面内可复制区块 ID。
 */
async function copyText(id: string) {
  const text = document.getElementById(id)?.textContent ?? ''
  await navigator.clipboard?.writeText(text)
}

/**
 * 刷新当前固定版本的历史运行和活动运行快照。
 *
 * @returns 读取完成时结束。
 */
async function refreshHistory() {
  if (!versionId.value) return
  historyRuns.value = await listRuns({
    workflowId: workflowId.value,
    versionId: versionId.value,
    limit: 200,
  })
  if (activeRun.value) {
    try {
      activeRun.value = await getRun(activeRun.value.id)
    } catch {
      // The SSE subscription owns recovery for a transient detail read.
    }
  }
}

/**
 * 读取固定版本、工作流元数据、真实就绪状态与版本历史。
 *
 * @returns 页面数据加载完成时结束。
 */
async function loadData() {
  stopStream()
  activeRun.value = undefined
  runEvents.value = []
  streamState.value = 'idle'
  loadError.value = ''
  if (!versionId.value) {
    version.value = undefined
    draft.value = undefined
    historyRuns.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const [workflow, fixedVersion, readinessResult, runs] = await Promise.all([
      getWorkflow(workflowId.value),
      getWorkflowVersion(workflowId.value, versionId.value),
      getWorkflowReadiness(workflowId.value, versionId.value),
      listRuns({
        workflowId: workflowId.value,
        versionId: versionId.value,
        limit: 200,
      }),
    ])
    draft.value = workflow
    version.value = fixedVersion
    readiness.value = readinessResult
    historyRuns.value = runs
    initializeInput()
  } catch (error) {
    draft.value = undefined
    version.value = undefined
    readiness.value = undefined
    historyRuns.value = []
    loadError.value =
      error instanceof Error ? error.message : '无法读取固定版本试运行信息。'
  } finally {
    loading.value = false
  }
}

watch(
  () => [workflowId.value, versionId.value],
  () => void loadData(),
  { immediate: true },
)

onUnmounted(() => {
  stopStream()
})
</script>

