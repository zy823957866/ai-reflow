<template>
  <div v-if="loading" class="designer-loading flex h-100vh w-full items-center justify-center bg-canvas">
    <div class="loading-card flex w-280px flex-col items-center gap-9px border border-line rounded-8px bg-surface p-28px text-center shadow-[var(--shadow-md)]">
      <BrandMark />
      <div class="spinner" />
      <strong class="mt-1 text-13px">正在加载工作流</strong>
      <span class="m-0 text-[12px] leading-1.55 text-subtle">读取 Manifest、草稿与固定版本...</span>
    </div>
  </div>

  <div v-else-if="loadError" class="designer-error flex h-100vh w-full items-center justify-center bg-canvas">
    <div class="error-card flex w-280px flex-col items-center gap-9px border border-line rounded-8px bg-surface p-28px text-center shadow-[var(--shadow-md)]">
      <CircleAlert :size="25" class="text-danger" />
      <strong class="mt-1 text-13px">{{ loadError.code }}</strong>
      <p class="m-0 text-[12px] leading-1.55 text-subtle">{{ loadError.message }}</p>
      <Button @click="initialize">重新加载</Button>
    </div>
  </div>

  <div v-else class="workflow-designer flex h-100vh w-full flex-col overflow-hidden bg-canvas">
    <header class="designer-header z-8 flex h-62px items-center justify-between gap-16px border-b border-line bg-surface px-15px">
      <div class="header-left flex min-w-0 items-center gap-8px">
        <Button variant="ghost" size="icon-sm" class="back-button !h-30px !w-30px" title="返回工作流列表" @click="$emit('leave')">
          <ArrowLeft :size="18" />
        </Button>
        <div class="breadcrumb flex min-w-0 items-center gap-7px">
          <span class="text-[12px] text-muted">工作流</span>
          <ChevronRight :size="12" class="text-subtle" />
          <h1 class="m-0 overflow-hidden whitespace-nowrap text-12px font-600 text-ellipsis">{{ draft?.name }}</h1>
          <span
            class="version-chip rounded-4px px-5px py-3px text-[12px] font-600"
            :class="readonlyMode ? 'bg-primary-soft text-primary' : 'bg-warning-soft text-warning'"
          >
            {{ readonlyMode ? `固定版本 v${draft?.publishedVersion}` : `草稿 v${draft?.revision}` }}
          </span>
          <span
            class="save-state inline-flex items-center gap-4px text-[12px]"
            :class="{
              'text-danger': saveState === 'failed' || saveState === 'conflict',
              'text-primary': saveState === 'saving',
              'text-subtle': saveState === 'saved' || saveState === 'dirty' || saveState === 'readonly',
            }"
          >
            <LoaderCircle v-if="saveState === 'saving'" :size="12" class="animate-spin" />
            <CloudOff v-else-if="saveState === 'failed'" :size="12" />
            <TriangleAlert v-else-if="saveState === 'conflict'" :size="12" />
            <Check v-else-if="saveState === 'saved'" :size="12" />
            <Pencil v-else :size="12" />
            {{ saveStateLabel }}
          </span>
        </div>
      </div>

      <div class="header-right flex items-center gap-5px">
        <div class="collaborators mr-4px flex items-center" aria-label="协作者">
          <span class="inline-flex h-22px w-22px items-center justify-center -ml-5px border-2 border-surface rounded-full text-[12px] font-600 text-white" style="background: #b74890">林</span>
          <span class="inline-flex h-22px w-22px items-center justify-center -ml-5px border-2 border-surface rounded-full text-[12px] font-600 text-white" style="background: #2d6cdf">周</span>
          <span class="inline-flex h-22px w-22px items-center justify-center -ml-5px border-2 border-surface rounded-full text-[12px] font-600 text-white" style="background: #0e9f6e">陈</span>
        </div>
        <Button variant="ghost" size="icon-sm" title="撤销 Ctrl+Z" :disabled="!canUndo" @click="undo">
          <Undo2 :size="16" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="重做 Ctrl+Shift+Z" :disabled="!canRedo" @click="redo">
          <Redo2 :size="16" />
        </Button>
        <span class="header-divider mx-4px h-22px w-1px bg-line" />
        <Button
          variant="ghost"
          class="validation-chip h-32px rounded-6px px-9px text-[12px]"
          :class="validation.valid ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'"
          @click="validateNow"
        >
          <CheckCircle2 v-if="validation.valid" :size="14" />
          <TriangleAlert v-else :size="14" />
          {{ validation.valid ? `校验通过 · ${definition.nodes.length} 节点` : `${validation.errors.length} 项校验错误` }}
        </Button>
        <Button variant="outline" class="draft-preview-button h-32px px-11px text-[12px]" :disabled="readonlyMode || activeRun?.status === 'running'" @click="openPreviewDialog">
          <Play :size="14" />
          草稿预览
        </Button>
        <Button class="h-32px px-11px text-[12px]" :disabled="readonlyMode" @click="requestPublish">
          <Send :size="14" />
          发布
        </Button>
      </div>
    </header>

    <div class="designer-body relative flex min-h-0 flex-1">
      <nav class="tool-rail z-6 flex w-62px shrink-0 flex-col items-center border-r border-line bg-surface">
        <div class="rail-mark flex h-60px items-center justify-center">
          <BrandMark />
        </div>
        <div class="rail-items flex w-full flex-col items-center gap-4px px-7px pt-5px">
          <Button variant="unstyled" type="button"
            class="rail-item flex h-46px w-46px flex-col items-center justify-center gap-3px border-0 rounded-7px bg-transparent text-subtle transition-colors hover:(bg-surface-3 text-muted)"
            :class="paletteOpen || rightPanelOpen && rightMode === 'inspector' ? 'bg-primary-soft text-primary' : ''"
            title="节点与 Inspector"
            @click="toggleNodePanel"
          >
            <LayoutGrid :size="18" />
            <span class="text-[12px]">节点</span>
          </Button>
          <Button variant="unstyled" type="button" class="rail-item flex h-46px w-46px flex-col items-center justify-center gap-3px border-0 rounded-7px bg-transparent text-subtle transition-colors hover:(bg-surface-3 text-muted)" title="变量" @click="openPalette">
            <Variable :size="18" />
            <span class="text-[12px]">变量</span>
          </Button>
          <Button variant="unstyled" type="button" class="rail-item flex h-46px w-46px flex-col items-center justify-center gap-3px border-0 rounded-7px bg-transparent text-subtle transition-colors hover:(bg-surface-3 text-muted)" title="知识库" @click="openPalette">
            <BookOpen :size="18" />
            <span class="text-[12px]">知识</span>
          </Button>
          <Button variant="unstyled" type="button" class="rail-item flex h-46px w-46px flex-col items-center justify-center gap-3px border-0 rounded-7px bg-transparent text-subtle transition-colors hover:(bg-surface-3 text-muted)" title="工具" @click="openPalette">
            <Wrench :size="18" />
            <span class="text-[12px]">工具</span>
          </Button>
          <Button variant="unstyled" type="button" class="rail-item flex h-46px w-46px flex-col items-center justify-center gap-3px border-0 rounded-7px bg-transparent text-subtle transition-colors hover:(bg-surface-3 text-muted)" title="运行历史" @click="rightMode = 'run'; rightPanelOpen = true">
            <History :size="18" />
            <span class="text-[12px]">历史</span>
          </Button>
        </div>
        <div class="rail-bottom mt-auto flex flex-col items-center gap-7px py-14px">
          <Button variant="unstyled" type="button" class="rail-icon flex h-32px w-32px items-center justify-center border-0 rounded-6px bg-transparent text-subtle hover:bg-surface-3" title="帮助"><CircleHelp :size="18" /></Button>
          <Button variant="unstyled" type="button" class="rail-icon flex h-32px w-32px items-center justify-center border-0 rounded-6px bg-transparent text-subtle hover:bg-surface-3" title="设计器设置"><Settings :size="18" /></Button>
        </div>
      </nav>

      <Transition name="palette">
        <NodePalette
          v-if="paletteOpen"
          @add="addNodeAtCenter"
          @close="paletteOpen = false"
        />
      </Transition>

      <section class="canvas-region relative min-w-0 flex-1">
        <FlowCanvas
          ref="canvasRef"
          :definition="definition"
          :selected-node-ids="selectedNodeIds"
          :run-statuses="nodeRunStatuses"
          :validation-errors="validation.errors"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @node-select="handleNodeSelect"
          @selection-change="handleSelectionChange"
          @pane-click="clearSelection"
          @connect="createEdge"
          @update:nodes="handleNodeMove"
          @undo="undo"
          @redo="redo"
          @open-palette="openPalette"
          @drop-node="addNodeAt"
        />
        <div v-if="saveState === 'conflict'" class="conflict-banner absolute bottom-16px left-16px right-16px z-4 flex items-center gap-9px border border-[#f0c27b] rounded-8px bg-[#fff8ec] px-12px py-10px text-warning shadow-[var(--shadow-md)]">
          <TriangleAlert :size="16" />
          <div class="flex min-w-0 flex-1 flex-col gap-2px">
            <strong class="text-[12px]">草稿已在其他会话更新</strong>
            <span class="text-[12px] text-muted">本地修改仍保留。可导出本地草稿，或重新加载服务端摘要。</span>
          </div>
          <Button variant="outline" class="h-28px px-8px text-[12px]" @click="exportLocalDraft">导出本地草稿</Button>
          <Button variant="outline" class="h-28px px-8px text-[12px]" @click="reloadFromServer">重新加载</Button>
        </div>
        <div
          v-if="notification"
          class="designer-toast absolute left-1/2 top-68px z-10 flex max-w-560px w-[calc(100%-32px)] -translate-x-1/2 items-center gap-7px border border-line rounded-7px bg-surface px-10px py-8px text-[12px] shadow-[var(--shadow-md)]"
          :class="notification.level === 'error' ? 'border-[#f0b8ba] text-danger' : ''"
        >
          <Info :size="14" />
          <span>{{ notification.message }}</span>
          <Button variant="ghost" size="icon-sm" class="ml-5px !h-5 !w-5" @click="notification = null"><X :size="13" /></Button>
        </div>
      </section>

      <Transition name="inspector">
        <div v-if="rightPanelOpen" class="right-panel flex min-h-0 w-372px shrink-0 flex-col">
          <template v-if="rightMode === 'inspector'">
            <InspectorPanel
              :node="selectedNode"
              :selected-nodes="selectedNodes"
              :definition="definition"
              :disabled="readonlyMode"
              :services="services"
              :validation="validation"
              :errors="selectedNodeErrors"
              :node-run="selectedNodeRun"
              :run-input="activeRun?.input"
              @update-config="handleConfigUpdate"
              @rename-node="handleNodeRename"
              @set-mode="handleModeUpdate"
              @save-node="handleNodeSave"
              @delete-nodes="deleteNodes"
              @close="closeInspector"
              @flush="flushSave('manual')"
              @notify="notify"
            />
          </template>
          <template v-else>
            <div class="run-panel flex min-h-0 flex-1 flex-col border-l border-line bg-surface">
              <div class="run-panel-head flex min-h-72px items-start justify-between border-b border-line px-14px pb-12px pt-15px">
                <div>
                  <span class="eyebrow text-[12px] font-[650] text-primary">草稿预览</span>
                  <h2 class="mb-0 ml-0 mr-0 mt-4px text-14px">{{ activeRun ? `运行 ${activeRun.id.slice(-8)}` : '运行控制台' }}</h2>
                  <p class="mb-0 ml-0 mr-0 mt-3px text-[12px] text-subtle">草稿预览不绑定发布版本</p>
                </div>
                <Button variant="ghost" size="icon-sm" @click="rightMode = 'inspector'; rightPanelOpen = false"><X :size="16" /></Button>
              </div>
              <div v-if="activeRun" class="run-strip mx-13px mt-12px overflow-hidden border border-line rounded-7px">
                <div class="run-strip-head flex h-38px items-center gap-8px border-b border-line bg-primary-soft px-10px text-[12px] text-muted">
                  <StatusBadge :status="activeRun.status" />
                  <span class="ml-auto">{{ nodeRunStatusesCount.succeeded }}/{{ definition.nodes.length }} 节点 · {{ elapsedLabel }}</span>
                  <Button v-if="activeRun.status === 'running'" variant="link" size="xs" class="text-danger" @click="cancelPreview">取消</Button>
                </div>
                <div class="node-run-list max-h-160px overflow-y-auto px-10px py-6px">
                  <div
                    v-for="node in definition.nodes"
                    :key="node.id"
                    class="node-run-row grid h-29px items-center gap-7px border-b border-dashed border-line text-[12px] text-muted"
                    style="grid-template-columns: 9px minmax(0, 1fr) 78px auto"
                  >
                    <span
                      class="status-dot h-6px w-6px rounded-full"
                      :class="{
                        'bg-[#c4c9d2]': nodeRunStatuses[node.id] === 'pending' || !nodeRunStatuses[node.id],
                        'animate-pulse bg-primary': nodeRunStatuses[node.id] === 'running',
                        'bg-success': nodeRunStatuses[node.id] === 'succeeded',
                        'bg-danger': nodeRunStatuses[node.id] === 'failed',
                        'bg-[#b8bfcd]': nodeRunStatuses[node.id] === 'skipped' || nodeRunStatuses[node.id] === 'cancelled',
                      }"
                    />
                    <span>{{ node.title }}</span>
                    <span class="mono text-[12px] text-subtle">{{ node.type }}</span>
                    <span
                      :class="{
                        'text-success': nodeRunStatuses[node.id] === 'succeeded',
                        'text-primary': nodeRunStatuses[node.id] === 'running',
                        'text-danger': nodeRunStatuses[node.id] === 'failed',
                        'text-subtle': !nodeRunStatuses[node.id] || nodeRunStatuses[node.id] === 'pending',
                      }"
                    >
                      {{ nodeStatusLabel(nodeRunStatuses[node.id] ?? 'pending') }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="run-empty m-auto flex flex-col items-center gap-8px px-22px text-center text-subtle">
                <PlayCircle :size="28" />
                <strong class="text-12px text-muted">尚未运行草稿</strong>
                <span class="text-[12px] leading-1.55">输入运行参数后，节点状态会实时叠加到画布，不覆盖配置。</span>
                <Button class="mt-5px h-32px text-[12px]" @click="openPreviewDialog"><Play :size="14" /> 开始预览</Button>
              </div>
              <ExecutionTabs
                v-if="activeRun"
                :run="activeRun"
                :input="activeRun.input"
                :input-fields="startInputFields"
                :events="runEvents"
                readonly
              />
              <div v-if="activeRun" class="run-actions flex justify-between gap-8px border-t border-line px-13px py-9px">
                <Button variant="outline" class="h-31px text-[12px]" :disabled="activeRun.status === 'running'" @click="runAgain">
                  <RefreshCw :size="14" /> 原样重跑
                </Button>
                <Button variant="ghost" class="h-31px text-[12px]" @click="rightMode = 'inspector'; rightPanelOpen = true">
                  查看节点配置
                </Button>
              </div>
            </div>
          </template>
        </div>
      </Transition>
    </div>

    <Dialog v-model:open="previewDialogOpen">
        <DialogContent class="w-[min(460px,calc(100vw-32px))]">
          <DialogTitle class="dialog-title m-0 text-17px font-700">草稿预览输入</DialogTitle>
          <DialogDescription class="dialog-description mb-15px ml-0 mr-0 mt-6px text-[12px] leading-1.6 text-subtle">
            预览使用当前草稿定义，不生成发布版本。表单与 JSON 使用同一份输入。
          </DialogDescription>
          <div class="dialog-field mt-13px flex flex-col gap-6px">
            <Label>输入 JSON</Label>
            <Textarea v-model="previewInputJson" class="preview-input-json min-h-170px font-mono text-[12px]" spellcheck="false" />
            <div v-if="previewInputError" class="field-error">{{ previewInputError }}</div>
          </div>
          <DialogFooter class="mt-20px">
            <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
            <Button @click="startPreview"><Play :size="14" /> 运行草稿</Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>

    <Dialog v-model:open="publishDialogOpen">
        <DialogContent class="w-[min(520px,calc(100vw-32px))]">
          <DialogTitle class="dialog-title m-0 text-17px font-700">发布不可变版本</DialogTitle>
          <DialogDescription class="dialog-description mb-15px ml-0 mr-0 mt-6px text-[12px] leading-1.6 text-subtle">
            发布前会完成服务端编译校验，并把当前 Manifest 版本与定义固化为快照。
          </DialogDescription>
          <div class="publish-readiness grid gap-1px overflow-hidden border border-line rounded-7px bg-line" style="grid-template-columns: repeat(3, 1fr)">
            <div class="flex min-h-66px flex-col gap-4px bg-surface-2 p-10px"><CheckCircle2 :size="15" class="text-success" /><span class="text-[12px] text-subtle">草稿 revision</span><strong class="text-[12px]">r{{ draft?.revision }}</strong></div>
            <div class="flex min-h-66px flex-col gap-4px bg-surface-2 p-10px"><CheckCircle2 :size="15" class="text-success" /><span class="text-[12px] text-subtle">节点与端口</span><strong class="text-[12px]">{{ definition.nodes.length }} / {{ definition.edges.length }}</strong></div>
            <div class="flex min-h-66px flex-col gap-4px bg-surface-2 p-10px"><CheckCircle2 :size="15" class="text-success" /><span class="text-[12px] text-subtle">校验结果</span><strong class="text-[12px]">{{ validation.valid ? '通过' : `${validation.errors.length} 项错误` }}</strong></div>
          </div>
          <div class="dialog-field mt-13px flex flex-col gap-6px">
            <Label>版本说明</Label>
            <Textarea v-model="changelog" rows="4" placeholder="说明本次发布的变化，例如：优化低置信度转人工分支。" class="px-10px py-9px leading-1.55" />
          </div>
          <DialogFooter class="mt-20px">
            <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
            <Button :disabled="publishing || !validation.valid" @click="confirmPublish">
              <LoaderCircle v-if="publishing" :size="14" class="animate-spin" />
              <Send v-else :size="14" />
              {{ publishing ? '发布中...' : '确认发布' }}
            </Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>

    <Dialog v-model:open="publishSuccessOpen">
        <DialogContent class="w-[min(520px,calc(100vw-32px))] text-center">
          <div class="success-icon mx-auto mb-12px flex h-54px w-54px items-center justify-center rounded-full bg-success-soft text-success"><CheckCircle2 :size="26" /></div>
          <DialogTitle class="dialog-title m-0 text-17px font-700">版本 v{{ publishedVersion }} 已发布</DialogTitle>
          <DialogDescription class="dialog-description mb-15px ml-0 mr-0 mt-6px text-[12px] leading-1.6 text-subtle">
            发布版本不可修改，试运行将始终使用该固定 snapshot。
          </DialogDescription>
          <div class="success-meta flex flex-col items-center gap-5px rounded-7px bg-surface-3 p-10px text-[12px] text-subtle">
            <span class="mono text-[12px] text-muted">{{ publishedVersionId }}</span>
            <span>schemaHash {{ publishedSchemaHash }}</span>
          </div>
          <DialogFooter class="mt-20px justify-center">
            <DialogClose as-child><Button variant="outline">留在编辑器</Button></DialogClose>
            <Button @click="goToTrial">打开固定版本试运行</Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Label,
  Textarea,
} from '@ai-reflow/ui'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CloudOff,
  History,
  Info,
  LayoutGrid,
  LoaderCircle,
  Pencil,
  Play,
  PlayCircle,
  RefreshCw,
  Redo2,
  Send,
  Settings,
  TriangleAlert,
  Undo2,
  Variable,
  Wrench,
  X,
} from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { getNodeRegistration, getDefaultNodeConfig } from '@/shared/registry'
import { clonePlain } from '@/shared/clone'
import type {
  NodeRun,
  NodeRunStatus,
  RunEvent,
  RunRecord,
  SchemaField,
  WorkflowDefinition,
  WorkflowDesignerProps,
  WorkflowDraft,
  WorkflowEdge,
  WorkflowNode,
} from '@/shared/types'
import FlowCanvas from './canvas/FlowCanvas.vue'
import NodePalette from './palette/NodePalette.vue'
import InspectorPanel from './inspector/InspectorPanel.vue'
import { createDesignerStore, type DesignerSaveState } from './stores/designerStore'
import ExecutionTabs from './shared/ExecutionTabs.vue'

const props = defineProps<WorkflowDesignerProps>()
const emit = defineEmits<{
  leave: []
}>()

const loading = ref(true)
const loadError = ref<{ code: string; message: string } | null>(null)
const draft = ref<WorkflowDraft>()
const designerStore = shallowRef<ReturnType<typeof createDesignerStore> | null>(null)
const canvasRef = ref<InstanceType<typeof FlowCanvas>>()
const paletteOpen = ref(false)
const rightPanelOpen = ref(true)
const rightMode = ref<'inspector' | 'run'>('inspector')
const saveTimer = ref<number>()
const validationTimer = ref<number>()
const saveInFlight = ref(false)
const lastSavedJson = ref('')
const notification = ref<{ level: 'info' | 'warn' | 'error'; message: string } | null>(null)
const previewDialogOpen = ref(false)
const publishDialogOpen = ref(false)
const publishSuccessOpen = ref(false)
const previewInputJson = ref('{"question":"如何申请企业版试用？需要哪些材料？"}')
const previewInputError = ref('')
const changelog = ref('')
const publishing = ref(false)
const publishedVersion = ref(0)
const publishedVersionId = ref('')
const publishedSchemaHash = ref('')
const activeRun = ref<RunRecord>()
const runEvents = ref<RunEvent[]>([])
const nodeRunStatuses = ref<Record<string, NodeRunStatus>>({})
const unsubscribeRun = ref<() => void>()
const clipboard = ref<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }>()
let notificationTimer: number | undefined
let runStart = 0
let elapsedTimer: number | undefined
const elapsedLabel = ref('0.0s')

const readonlyMode = computed(() => props.mode !== 'edit')
const services = computed(() => props.services)
const definition = computed<WorkflowDefinition>(
  () =>
    designerStore.value?.definition.value ?? {
      schemaVersion: '1.0',
      name: '',
      nodes: [],
      edges: [],
    },
)
const validation = computed(() => designerStore.value?.validation.value ?? { valid: true, errors: [] })
const selectedNodeId = computed(() => designerStore.value?.selectedNodeId.value ?? null)
const selectedNode = computed(() => designerStore.value?.selectedNode.value ?? null)
const selectedNodes = computed(() => {
  const ids = selectedNodeIds.value
  return definition.value.nodes.filter((node) => ids.includes(node.id))
})
const selectedNodeIds = computed(() => designerStore.value?.selectedNodeIds.value ?? [])
const canUndo = computed(() => designerStore.value?.canUndo.value ?? false)
const canRedo = computed(() => designerStore.value?.canRedo.value ?? false)
const saveState = computed<DesignerSaveState>(() => {
  if (readonlyMode.value) return 'readonly'
  return designerStore.value?.saveState.value ?? 'saved'
})
const saveStateLabel = computed(
  () =>
    ({
      saved: '已保存',
      dirty: '未保存',
      saving: '保存中',
      failed: '保存失败',
      conflict: '版本冲突',
      readonly: '只读',
    })[saveState.value],
)
const selectedNodeErrors = computed(() => {
  const node = selectedNode.value
  if (!node) return []
  const registration = getNodeRegistration(node.type)
  if (!registration) {
    return [{ message: `未注册节点类型 ${node.type}， Inspector 无法生成表单。` }]
  }
  const mode = registration.manifest.discriminator
    ? String(node.config[registration.manifest.discriminator.key] ?? '')
    : ''
  const missingFields = registration.manifest.configFields
    .filter((field) => field.required && (!field.modes?.length || field.modes.includes(mode)))
    .filter((field) => {
      const value = node.config[field.key]
      return value === undefined || value === null || value === ''
    })
    .map((field) => ({ field: field.key, message: `字段「${field.label}」为必填项。` }))
  const graphErrors = validation.value.errors
    .filter((error) => error.nodeId === node.id)
    .map((error) => ({ field: error.field, message: error.message }))
  return [...missingFields, ...graphErrors]
})
const selectedNodeRun = computed(() => {
  if (!activeRun.value || !selectedNodeId.value) return undefined
  return activeRun.value.nodeRuns.find((nodeRun) => nodeRun.nodeId === selectedNodeId.value)
})
const nodeRunStatusesCount = computed(() => {
  const counts = {
    succeeded: 0,
    failed: 0,
    running: 0,
    pending: 0,
  }
  definition.value.nodes.forEach((node) => {
    const status = nodeRunStatuses.value[node.id] ?? 'pending'
    if (status === 'succeeded') counts.succeeded += 1
    else if (status === 'failed') counts.failed += 1
    else if (status === 'running') counts.running += 1
    else counts.pending += 1
  })
  return counts
})
const startInputFields = computed<SchemaField[]>(() => {
  const start = definition.value.nodes.find((node) => node.type === 'start')
  const schema = start?.config.inputSchema
  if (!schema || typeof schema !== 'object') {
    return [{ name: 'input', type: 'object', required: true, description: '运行输入' }]
  }
  const record = schema as Record<string, unknown>
  const properties = (record.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (record.required ?? []) as string[]
  return Object.entries(properties).map(([name, field]) => ({
    name,
    type: String(field.type ?? 'string'),
    required: required.includes(name),
    description: field.description ? String(field.description) : undefined,
  }))
})

/** 加载工作流并初始化设计器状态。 */
function initialize() {
  loading.value = true
  loadError.value = null
  cleanupRun()
  props.port
    .load({
      workflowId: props.workflowId,
      versionId: props.initialVersionId,
    })
    .then(async (loaded) => {
      draft.value = loaded
      const store = createDesignerStore(loaded.definition)
      store.revision.value = loaded.revision
      store.savedAt.value = loaded.savedAt
      store.saveState.value = props.mode === 'edit' ? 'saved' : 'readonly'
      store.setOnChange(onGraphChanged)
      designerStore.value = store
      lastSavedJson.value = JSON.stringify(loaded.definition)
      previewInputJson.value = JSON.stringify(buildPreviewInput(), null, 2)
      await validateNow()
      loading.value = false
    })
    .catch((error: Error & { code?: string }) => {
      loadError.value = {
        code: error.code ?? 'LOAD_FAILED',
        message: error.message || '设计器加载失败。',
      }
      loading.value = false
    })
}

/**
 * 显示并转发设计器通知。
 * @param level 通知级别。
 * @param message 通知文案。
 */
function notify(level: 'info' | 'warn' | 'error', message: string) {
  notification.value = { level, message }
  props.services?.notify?.(level, message)
  if (notificationTimer) window.clearTimeout(notificationTimer)
  notificationTimer = window.setTimeout(() => {
    notification.value = null
  }, 3200)
}

/** 响应定义变化并调度校验与自动保存。 */
function onGraphChanged() {
  props.onDirtyChange?.(true)
  scheduleValidation()
  scheduleSave()
}

/** 防抖调度工作流校验。 */
function scheduleValidation() {
  if (validationTimer.value) window.clearTimeout(validationTimer.value)
  validationTimer.value = window.setTimeout(() => validateNow(), 300)
}

/**
 * 立即调用后端校验工作流定义。
 * @returns 是否通过校验。
 */
async function validateNow() {
  if (!designerStore.value) return false
  try {
    const result = await props.port.validate({
      workflowId: props.workflowId,
      definition: designerStore.value.getDefinition(),
    })
    designerStore.value.validation.value = result
    props.onValidationChange?.(result)
    return result.valid
  } catch (error) {
    notify('error', `校验失败：${(error as Error).message}`)
    return false
  }
}

/** 在编辑停止后调度自动保存。 */
function scheduleSave() {
  if (readonlyMode.value || saveInFlight.value) return
  if (saveTimer.value) window.clearTimeout(saveTimer.value)
  saveTimer.value = window.setTimeout(() => {
    flushSave('autosave')
  }, 500)
}

/**
 * 立即保存未持久化的定义快照。
 * @param reason 保存触发原因。
 */
async function flushSave(reason: 'autosave' | 'manual' | 'leave' = 'manual') {
  if (!designerStore.value || readonlyMode.value || saveInFlight.value) return
  if (saveTimer.value) {
    window.clearTimeout(saveTimer.value)
    saveTimer.value = undefined
  }
  const currentDefinition = designerStore.value.getDefinition()
  const serialized = JSON.stringify(currentDefinition)
  if (serialized === lastSavedJson.value) {
    if (designerStore.value.dirty.value) {
      designerStore.value.dirty.value = false
      designerStore.value.saveState.value = 'saved'
    }
    return
  }
  saveInFlight.value = true
  designerStore.value.saveState.value = 'saving'
  try {
    const result = await props.port.save({
      workflowId: props.workflowId,
      definition: currentDefinition,
      revision: designerStore.value.revision.value,
      reason,
    })
    lastSavedJson.value = serialized
    designerStore.value.markSaved(result.revision, result.savedAt)
    props.onDirtyChange?.(false)
    props.onSaved?.(result)
    if (draft.value) {
      draft.value.revision = result.revision
      draft.value.savedAt = result.savedAt
      draft.value.definition = currentDefinition
    }
  } catch (error) {
    const normalized = error as Error & { code?: string; details?: unknown }
    if (normalized.code === 'REVISION_CONFLICT') {
      designerStore.value.saveState.value = 'conflict'
    } else {
      designerStore.value.saveState.value = 'failed'
      notify('error', `保存失败：${normalized.message}`)
    }
  } finally {
    saveInFlight.value = false
  }
}

/** 撤销最近一次画布命令。 */
function undo() {
  if (readonlyMode.value) return
  designerStore.value?.undo()
}

/** 重做最近撤销的画布命令。 */
function redo() {
  if (readonlyMode.value) return
  designerStore.value?.redo()
}

/** 打开节点面板并收起右侧面板。 */
function openPalette() {
  if (readonlyMode.value) return
  paletteOpen.value = true
  rightPanelOpen.value = false
}

/** 切换节点面板与右侧面板可见性。 */
function toggleNodePanel() {
  paletteOpen.value = !paletteOpen.value
  if (!paletteOpen.value) rightPanelOpen.value = true
}

/**
 * 在画布常用位置添加节点。
 * @param type 节点类型。
 */
function addNodeAtCenter(type: string) {
  const index = definition.value.nodes.length
  addNodeAt(type, 260 + (index % 3) * 34, 180 + (index % 4) * 62)
  paletteOpen.value = false
  rightPanelOpen.value = true
}

/**
 * 在指定坐标添加节点。
 * @param type 节点类型。
 * @param x 横坐标。
 * @param y 纵坐标。
 */
function addNodeAt(type: string, x: number, y: number) {
  if (readonlyMode.value || !designerStore.value) return
  const manifest = getNodeRegistration(type)?.manifest
  if (!manifest) {
    notify('error', `未注册节点类型 ${type}，无法添加到画布。`)
    return
  }
  const id = `n_${type.replace(/[^a-z0-9]/gi, '_')}_${Math.random().toString(36).slice(2, 6)}`
  const node: WorkflowNode = {
    id,
    type,
    title: manifest.displayName,
    x: Math.round(x),
    y: Math.round(y),
    config: getDefaultNodeConfig(type),
    manifestVersion: manifest.version,
  }
  designerStore.value.addNode(node)
  designerStore.value.selectedNodeId.value = id
  designerStore.value.selectedNodeIds.value = [id]
  props.onNodeSelected?.(id)
  notify('info', `已添加「${manifest.displayName}」`)
}

/**
 * 提交多节点移动命令。
 * @param after 移动后的节点坐标。
 */
function handleNodeMove(after: Array<{ id: string; x: number; y: number }>) {
  if (readonlyMode.value || !designerStore.value) return
  const before = definition.value.nodes
    .filter((node) => after.some((position) => position.id === node.id))
    .map((node) => ({ id: node.id, x: node.x, y: node.y }))
  designerStore.value.moveNodes(before, after)
}

/**
 * 根据画布连线创建工作流边。
 * @param connection 端口连接。
 */
function createEdge(connection: {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}) {
  if (readonlyMode.value || !designerStore.value) return
  const edge: WorkflowEdge = {
    id: `e_${connection.source}_${connection.target}_${Math.random().toString(36).slice(2, 5)}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: connection.sourceHandle && connection.sourceHandle !== 'out' ? 'branch' : 'default',
  }
  designerStore.value.addEdge(edge)
  notify('info', '连线已创建')
}

/**
 * 同步画布单节点选择到设计器状态。
 * @param node 选中的节点。
 */
function handleNodeSelect(node: { id: string | number } | null) {
  if (!designerStore.value) return
  const id = node ? String(node.id) : null
  if (id && id !== designerStore.value.selectedNodeId.value && designerStore.value.dirty.value) {
    flushSave('leave')
  }
  designerStore.value.selectedNodeId.value = id
  designerStore.value.selectedNodeIds.value = id ? [id] : []
  rightMode.value = 'inspector'
  rightPanelOpen.value = true
  props.onNodeSelected?.(id)
}

/**
 * 同步画布多选结果到设计器状态。
 * @param nodes 选中节点列表。
 */
function handleSelectionChange(nodes: Array<{ id: string | number }>) {
  if (!designerStore.value) return
  const ids = nodes.map((node) => String(node.id))
  designerStore.value.selectedNodeIds.value = ids
  designerStore.value.selectedNodeId.value = ids.length === 1 ? ids[0] : null
  if (ids.length === 1) props.onNodeSelected?.(ids[0])
  if (!ids.length) props.onNodeSelected?.(null)
  if (ids.length) {
    rightMode.value = 'inspector'
    rightPanelOpen.value = true
  }
}

/** 清空画布选择。 */
function clearSelection() {
  if (!designerStore.value) return
  designerStore.value.selectedNodeId.value = null
  designerStore.value.selectedNodeIds.value = []
  props.onNodeSelected?.(null)
}

/**
 * 将字段更新写入节点配置。
 * @param nodeId 节点 ID。
 * @param config 新配置。
 * @param fieldKey 变更字段键。
 */
function handleConfigUpdate(nodeId: string, config: Record<string, unknown>, fieldKey: string) {
  if (readonlyMode.value) return
  designerStore.value?.updateNodeConfig(nodeId, config, fieldKey)
}

/**
 * 切换节点模式并调度校验。
 * @param nodeId 节点 ID。
 * @param key 模式字段键。
 * @param value 新模式。
 */
function handleModeUpdate(nodeId: string, key: string, value: string) {
  if (readonlyMode.value) return
  designerStore.value?.setNodeMode(nodeId, key, value)
  scheduleValidation()
}

/**
 * 确认后删除节点及关联连线。
 * @param nodeIds 待删除节点 ID。
 */
async function deleteNodes(nodeIds: string[]) {
  if (readonlyMode.value || !designerStore.value || !nodeIds.length) return
  if (props.services?.confirm) {
    const confirmed = await props.services.confirm(
      `删除 ${nodeIds.length} 个节点会同时移除关联连线，是否继续？`,
    )
    if (!confirmed) return
  }
  designerStore.value.removeNodes(nodeIds)
  clearSelection()
  notify('info', `已删除 ${nodeIds.length} 个节点`)
}

/**
 * 根据开始节点 Schema 生成草稿预览输入。
 * @returns 默认输入对象。
 */
function buildPreviewInput() {
  const start = definition.value.nodes.find((node) => node.type === 'start')
  const schema = start?.config.inputSchema as Record<string, unknown> | undefined
  const properties = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>
  const result: Record<string, unknown> = {}
  Object.entries(properties).forEach(([key, field]) => {
    if (field.default !== undefined) result[key] = field.default
    else if (key === 'question') result[key] = '如何申请企业版试用？需要哪些材料？'
    else if (field.type === 'array') result[key] = []
    else if (field.type === 'number') result[key] = 0
    else if (field.type === 'boolean') result[key] = false
    else result[key] = ''
  })
  if (!Object.keys(result).length) result.question = '如何申请企业版试用？需要哪些材料？'
  return result
}

/** 打开草稿预览输入弹窗。 */
function openPreviewDialog() {
  if (activeRun.value?.status === 'running') return
  previewInputJson.value = JSON.stringify(activeRun.value?.input ?? buildPreviewInput(), null, 2)
  previewInputError.value = ''
  previewDialogOpen.value = true
}

/** 解析预览输入 JSON 并启动运行。 */
function startPreview() {
  try {
    const input = JSON.parse(previewInputJson.value) as Record<string, unknown>
    previewInputError.value = ''
    previewDialogOpen.value = false
    void executePreview(input)
  } catch {
    previewInputError.value = '请输入有效 JSON。'
  }
}

/**
 * 创建草稿预览运行并订阅事件流。
 * @param input 本次预览输入。
 */
async function executePreview(input: Record<string, unknown>) {
  if (!designerStore.value) return
  cleanupRun()
  runStart = Date.now()
  elapsedLabel.value = '0.0s'
  elapsedTimer = window.setInterval(() => {
    elapsedLabel.value = `${((Date.now() - runStart) / 1000).toFixed(1)}s`
  }, 100)
  nodeRunStatuses.value = Object.fromEntries(definition.value.nodes.map((node) => [node.id, 'pending']))
  const created = await props.port.createPreviewRun({
    workflowId: props.workflowId,
    definition: designerStore.value.getDefinition(),
    input,
  })
  const run: RunRecord = {
    id: created.runId,
    workflowId: props.workflowId,
    workflowName: draft.value?.name ?? definition.value.name,
    runKind: 'preview',
    trigger: 'manual_preview',
    status: 'pending',
    createdAt: new Date().toISOString(),
    input,
    nodeRuns: definition.value.nodes.map((node) => ({
      nodeId: node.id,
      title: node.title,
      type: node.type,
      status: 'pending',
    })),
    metadata: { events: 0, actor: '林一舟' },
  }
  activeRun.value = run
  rightMode.value = 'run'
  rightPanelOpen.value = true
  runEvents.value = []
  unsubscribeRun.value = props.port.subscribeRun({
    runId: created.runId,
    onEvent(event) {
      runEvents.value.push(event)
      if (event.nodeId && event.status) {
        const nodeStatus = event.status === 'queued' ? 'pending' : event.status
        nodeRunStatuses.value[event.nodeId] = nodeStatus as NodeRunStatus
        const nodeRun = activeRun.value?.nodeRuns.find((item) => item.nodeId === event.nodeId)
        if (nodeRun) {
          nodeRun.status = nodeStatus as NodeRunStatus
          nodeRun.output = event.payload?.output
          nodeRun.error = event.payload?.error as NodeRun['error']
          nodeRun.durationMs = event.payload?.durationMs as number | undefined
        }
      }
      if (event.status && ['running', 'succeeded', 'failed', 'cancelled'].includes(event.status)) {
        activeRun.value!.status = event.status as RunRecord['status']
      }
      activeRun.value!.metadata.events = event.seq
      if (event.type === 'run.completed' || event.type === 'run.succeeded') {
        activeRun.value!.output = event.payload?.output as Record<string, unknown>
      }
      if (event.type === 'run.failed') {
        activeRun.value!.error = event.payload?.error as RunRecord['error']
      }
    },
    onError(error) {
      notify('error', error.message)
    },
    onEnd() {
      if (elapsedTimer) window.clearInterval(elapsedTimer)
      props.onRunCreated?.(created.runId)
      scheduleValidation()
    },
  })
}

/** 使用上次输入重新执行草稿预览。 */
function runAgain() {
  if (!activeRun.value) return
  void executePreview(activeRun.value.input)
}

/** 取消当前草稿预览运行。 */
async function cancelPreview() {
  if (!activeRun.value || !props.port.cancelRun) return
  await props.port.cancelRun(activeRun.value.id)
  activeRun.value.status = 'cancelled'
}

/**
 * 重命名指定节点。
 * @param nodeId 节点 ID。
 * @param title 新标题。
 */
function handleNodeRename(nodeId: string, title: string) {
  const nextTitle = title.trim()
  if (!nextTitle) return
  designerStore.value?.updateNodeTitle(nodeId, nextTitle)
}

/**
 * 保存节点配置并触发手动保存。
 * @param nodeId 节点 ID。
 * @param config 完整节点配置。
 */
function handleNodeSave(nodeId: string, config: Record<string, unknown>) {
  if (nodeId && selectedNode.value) {
    designerStore.value?.updateNodeConfig(nodeId, config)
  }
  void flushSave('manual')
}

/** 关闭右侧检查器面板。 */
function closeInspector() {
  rightPanelOpen.value = false
  rightMode.value = 'inspector'
}

/** 清理运行订阅与计时器。 */
function cleanupRun() {
  unsubscribeRun.value?.()
  unsubscribeRun.value = undefined
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  elapsedTimer = undefined
}

/** 校验通过后打开发布弹窗。 */
async function requestPublish() {
  if (readonlyMode.value) return
  const valid = await validateNow()
  if (!valid) {
    notify('error', '存在校验错误，发布已阻断。')
    rightMode.value = 'inspector'
    rightPanelOpen.value = true
    return
  }
  changelog.value = ''
  publishDialogOpen.value = true
}

/** 保存当前草稿并发布不可变版本。 */
async function confirmPublish() {
  if (!designerStore.value) return
  publishing.value = true
  try {
    if (designerStore.value.dirty.value) {
      await flushSave('manual')
    }
    if (designerStore.value.saveState.value === 'conflict' || designerStore.value.saveState.value === 'failed') {
      throw new Error('草稿尚未保存，无法发布。')
    }
    const result = await props.port.publish({
      workflowId: props.workflowId,
      revision: designerStore.value.revision.value,
      changelog: changelog.value,
    })
    publishedVersion.value = result.version
    publishedVersionId.value = result.versionId
    publishedSchemaHash.value = result.schemaHash ?? ''
    publishDialogOpen.value = false
    publishSuccessOpen.value = true
    notify('info', `版本 v${result.version} 已发布`)
  } catch (error) {
    notify('error', `发布失败：${(error as Error).message}`)
  } finally {
    publishing.value = false
  }
}

/** 关闭发布成功弹窗并跳转固定版本试运行。 */
function goToTrial() {
  publishSuccessOpen.value = false
  props.onPublishRequested?.({
    versionId: publishedVersionId.value,
    version: publishedVersion.value,
    schemaHash: publishedSchemaHash.value,
  })
}

/** 确认后从服务端重新加载设计器。 */
async function reloadFromServer() {
  const confirmed = props.services?.confirm
    ? await props.services.confirm('重新加载会丢弃当前本地草稿，是否继续？')
    : true
  if (!confirmed) return
  initialize()
}

/** 将当前定义导出为本地 JSON 文件。 */
function exportLocalDraft() {
  if (!designerStore.value) return
  const blob = new Blob([JSON.stringify(designerStore.value.getDefinition(), null, 2)], {
    type: 'application/json',
  })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${draft.value?.name ?? 'workflow'}-local-draft.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

/**
 * 返回节点状态中文标签。
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
    cancelled: '取消',
    waiting: '等待',
  }[status]
}

/**
 * 处理保存、撤销、复制、粘贴和删除快捷键。
 * @param event 键盘事件。
 */
function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.matches('input, textarea, [contenteditable="true"], select')) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      flushSave('manual')
    }
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    flushSave('manual')
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    copySelection()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
    pasteSelection()
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedNodeIds.value.length) {
      event.preventDefault()
      deleteNodes(selectedNodeIds.value)
    }
  } else if (event.key === 'Escape') {
    clearSelection()
  }
}

/** 复制当前选中的节点及内部连线。 */
function copySelection() {
  const nodeIds = selectedNodeIds.value
  if (!nodeIds.length) return
  clipboard.value = {
    nodes: clonePlain(definition.value.nodes.filter((node) => nodeIds.includes(node.id))),
    edges: clonePlain(
      definition.value.edges.filter(
        (edge) => nodeIds.includes(edge.source) && nodeIds.includes(edge.target),
      ),
    ),
  }
  notify('info', `已复制 ${nodeIds.length} 个节点`)
}

/** 粘贴复制的子图并生成新 ID。 */
function pasteSelection() {
  if (readonlyMode.value || !designerStore.value || !clipboard.value) return
  const idMap = new Map<string, string>()
  const nodes = clipboard.value.nodes.map((node, index) => {
    const nextId = `${node.id}_copy_${Math.random().toString(36).slice(2, 5)}`
    idMap.set(node.id, nextId)
    return {
      ...clonePlain(node),
      id: nextId,
      x: node.x + 36 + index * 3,
      y: node.y + 42 + index * 3,
    }
  })
  const edges = clipboard.value.edges.map((edge) => ({
    ...clonePlain(edge),
    id: `e_paste_${Math.random().toString(36).slice(2, 8)}`,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
  }))
  designerStore.value.pasteSubgraph(nodes, edges)
  designerStore.value.selectedNodeIds.value = nodes.map((node) => node.id)
  designerStore.value.selectedNodeId.value = nodes.length === 1 ? nodes[0].id : null
  notify('info', `已粘贴 ${nodes.length} 个节点`)
}

/**
 * 在存在未保存修改时阻止页面意外离开。
 * @param event beforeunload 事件。
 */
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (designerStore.value?.dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}

watch(
  () => selectedNodeId.value,
  (next, previous) => {
    if (next && previous && next !== previous && designerStore.value?.dirty.value) {
      flushSave('leave')
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('beforeunload', onBeforeUnload)
  initialize()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (saveTimer.value) window.clearTimeout(saveTimer.value)
  if (validationTimer.value) window.clearTimeout(validationTimer.value)
  if (notificationTimer) window.clearTimeout(notificationTimer)
  cleanupRun()
})

defineExpose({
  flushSave,
  undo,
  redo,
  fitView: () => canvasRef.value?.fitView(),
  focusNode: (nodeId: string) => {
    handleNodeSelect({ id: nodeId })
    canvasRef.value?.focusNode(nodeId)
  },
  getDefinition: () => designerStore.value?.getDefinition(),
  destroy: () => {
    cleanupRun()
  },
})
</script>

<style scoped>
.palette-enter-active,
.palette-leave-active,
.inspector-enter-active,
.inspector-leave-active {
  transition: width 0.2s ease, opacity 0.16s ease, transform 0.2s ease;
}

.palette-enter-from,
.palette-leave-to {
  width: 0 !important;
  opacity: 0;
}

.inspector-enter-from,
.inspector-leave-to {
  width: 0 !important;
  opacity: 0;
  transform: translateX(16px);
}

@media (max-width: 1180px) {
  .header-right .validation-chip {
    display: none;
  }

  .right-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 12;
    width: 360px;
    box-shadow: -18px 0 40px rgba(18, 20, 26, 0.12);
  }

  .designer-body {
    position: relative;
  }
}

@media (max-width: 820px) {
  .designer-header {
    height: auto;
    min-height: 58px;
    flex-wrap: wrap;
    padding: 8px 10px;
  }

  .breadcrumb > span:first-child,
  .breadcrumb > svg,
  .collaborators,
  .header-divider,
  .save-state,
  .version-chip {
    display: none;
  }

  .header-right {
    margin-left: auto;
  }

  .header-right > .ui-button--icon-sm,
  .header-right > .draft-preview-button {
    display: none;
  }

  .tool-rail {
    width: 52px;
  }

  .rail-items {
    padding: 5px 3px 0;
  }

  .rail-item {
    width: 42px;
  }

  .right-panel {
    width: min(100%, 372px);
  }

  .node-palette {
    position: absolute;
    inset: 0 auto 0 52px;
    z-index: 7;
    width: min(264px, calc(100vw - 52px));
    box-shadow: 12px 0 30px rgba(18, 20, 26, 0.1);
  }
}
</style>
