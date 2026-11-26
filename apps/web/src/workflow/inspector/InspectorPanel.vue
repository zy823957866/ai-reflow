<template>
  <aside class="inspector flex h-full w-372px flex-col border-l border-line bg-surface">
    <template v-if="selectedNodes.length > 1">
      <div class="inspector-header flex min-h-78px items-start gap-10px border-b border-line px-15px pb-12px pt-16px">
        <div>
          <span class="text-[11.5px] text-primary">多选摘要</span>
          <h2 class="mb-0 ml-0 mr-0 mt-4px text-16px">{{ selectedNodes.length }} 个节点</h2>
          <p class="m-0 text-[11.5px] text-subtle">{{ typeSummary }}</p>
        </div>
      </div>
      <div class="multi-summary p-14px">
        <div
          v-for="node in selectedNodes"
          :key="node.id"
          class="multi-node-row grid items-center gap-7px border-b border-dashed border-line py-8px text-[11.5px]"
          style="grid-template-columns: 24px minmax(0, 1fr) auto"
        >
          <span class="mini-icon flex h-24px w-24px items-center justify-center rounded-5px bg-surface-3 text-subtle"><NodeGlyph :name="getManifest(node.type)?.icon" :size="14" /></span>
          <span>{{ node.title }}</span>
          <span class="mono text-[10.5px] text-subtle">{{ node.type }}</span>
        </div>
        <p class="my-13px text-[11.5px] leading-1.55 text-subtle">多选时不提供批量配置写入，避免覆盖不同节点的模式字段。</p>
        <button class="btn btn-danger h-32px w-full text-10px" @click="$emit('delete-nodes', selectedNodes.map((node) => node.id))">
          <Trash2 :size="14" /> 删除所选节点
        </button>
      </div>
    </template>

    <template v-else-if="node && manifest">
      <div class="inspector-header flex min-h-78px items-start gap-10px border-b border-line px-15px pb-12px pt-16px">
        <div class="node-header-icon flex h-36px w-36px shrink-0 items-center justify-center rounded-8px" :style="{ color: manifest.color, background: `${manifest.color}14` }">
          <NodeGlyph :name="manifest.icon" :size="19" />
        </div>
        <div class="node-header-copy min-w-0 flex-1">
          <input
            class="title-input h-24px border-0 bg-transparent p-0 text-15px font-700 text-ink shadow-none focus:(border border-line bg-surface px-6px shadow-none)"
            :value="node.title"
            :disabled="disabled"
            @change="$emit('rename-node', node.id, ($event.target as HTMLInputElement).value)"
          />
          <div class="node-header-meta mt-3px flex items-center gap-7px text-[11.5px] text-subtle">
            <span class="mono">{{ manifest.type }}</span>
            <span class="phase-tag rounded-3px bg-primary-soft px-4px py-1px text-[10.5px] font-[650] text-primary">{{ manifest.phase }}</span>
            <span>v{{ manifest.version }}</span>
          </div>
        </div>
        <button class="icon-btn" title="关闭" @click="$emit('close')"><X :size="16" /></button>
      </div>

      <div v-if="manifest.discriminator" class="mode-row flex items-center gap-8px border-b border-line bg-surface-2 px-15px py-9px">
        <span class="font-mono text-[11.5px] text-subtle">{{ manifest.discriminator.key }}</span>
        <div class="mode-selector flex flex-1 gap-3px border border-line rounded-6px bg-surface p-2px">
          <button
            v-for="option in manifest.discriminator.options"
            :key="option.value"
            class="h-24px min-w-0 flex-1 overflow-hidden whitespace-nowrap border-0 rounded-4px bg-transparent px-5px text-[11.5px] text-subtle text-ellipsis"
            :class="modeValue === option.value ? 'bg-primary-soft font-600 text-primary' : ''"
            :disabled="disabled"
            @click="$emit('set-mode', node.id, manifest.discriminator!.key, option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="inspector-tabs flex h-42px items-end gap-16px border-b border-line px-16px">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex h-39px items-center gap-4px border-0 border-b-2 border-transparent bg-transparent px-1px text-11px text-subtle"
          :class="activeTab === tab.key ? 'border-b-primary font-600 text-ink' : ''"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span v-if="tab.count !== undefined" class="inline-flex h-16px min-w-17px items-center justify-center rounded-4px bg-surface-3 text-[10.5px] text-subtle">{{ tab.count }}</span>
        </button>
      </div>

      <div v-if="activeTab === 'input'" class="inspector-scroll flex-1 overflow-y-auto">
        <div
          class="validation-banner mx-15px my-12px flex items-start gap-7px rounded-6px px-9px py-8px text-[11.5px] leading-1.45"
          :class="errors.length ? 'bg-danger-soft text-danger' : validation.valid ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
        >
          <CheckCircle2 v-if="!errors.length && validation.valid" :size="14" />
          <TriangleAlert v-else :size="14" />
          <span>{{ errors.length ? errors[0].message : validation.valid ? '节点配置已通过本地校验' : '工作流存在待处理校验问题' }}</span>
        </div>

        <section class="runtime-input-section border-b border-line">
          <button class="section-toggle flex h-36px w-full items-center gap-5px border-0 bg-transparent px-15px text-left text-10px font-600 text-muted" type="button" @click="runtimeOpen = !runtimeOpen">
            <ChevronDown :size="13" class="transition-transform duration-150" :class="!runtimeOpen ? '-rotate-90' : ''" />
            <span>运行输入（端口）</span>
          </button>
          <div v-show="runtimeOpen" class="runtime-input-list px-15px pb-12px">
            <div v-for="input in manifest.inputs" :key="input.id" class="runtime-input-row flex h-30px items-center gap-7px border-b border-dashed border-line text-[11.5px] text-muted">
              <span class="runtime-port flex min-w-88px items-center gap-6px"><span class="h-7px w-7px border border-[#b8bfcd] rounded-full" />{{ input.label }}</span>
              <span class="mono text-[10.5px] text-subtle">{{ input.id }}</span>
              <span class="port-type ml-auto font-mono text-[10.5px] text-subtle">{{ node.type === 'start' ? '—' : 'object' }}</span>
            </div>
            <div v-if="!manifest.inputs.length" class="py-12px text-[11.5px] text-subtle">无运行输入</div>
          </div>
        </section>

        <section class="config-section border-b border-line">
          <div class="config-heading flex items-center justify-between px-16px pb-2px pt-13px text-10px font-600 text-muted">
            <span>配置输入</span>
            <small class="text-[10.5px] font-[450] text-subtle">{{ resolvedForm.kind === 'component' ? '自定义表单' : resolvedForm.kind === 'schema' ? 'JSON Schema' : resolvedForm.kind === 'fields' ? 'configFields' : '只读兜底' }}</small>
          </div>
          <SchemaForm
            :fields="visibleFields"
            :model-value="node.config"
            :manifest="manifest"
            :disabled="disabled"
            :services="services"
            :options="serviceOptions"
            :errors="errors"
            @update-field="onFieldUpdate"
            @update-mode="onFieldUpdate"
            @flush="$emit('flush')"
            @commit="onCommit"
          />
        </section>

        <section class="advanced-section border-b border-line">
          <button class="section-toggle flex h-36px w-full items-center gap-5px border-0 bg-transparent px-15px text-left text-10px font-600 text-muted" @click="advancedOpen = !advancedOpen">
            <ChevronDown :size="13" class="transition-transform duration-150" :class="!advancedOpen ? '-rotate-90' : ''" />
            <span>高级设置</span>
            <span class="advanced-count ml-auto text-[10.5px] text-subtle">9</span>
          </button>
          <div v-show="advancedOpen" class="advanced-grid grid gap-8px px-15px pb-13px pt-1px" style="grid-template-columns: 1fr 1fr">
            <label class="flex flex-col gap-5px text-[11.5px] text-subtle"><span>启用</span><input class="h-16px w-auto self-start" type="checkbox" checked disabled /></label>
            <label class="flex flex-col gap-5px text-[11.5px] text-subtle"><span>超时</span><input class="h-30px px-7px text-[11.5px] text-muted" value="30s" disabled /></label>
            <label class="flex flex-col gap-5px text-[11.5px] text-subtle"><span>重试</span><input class="h-30px px-7px text-[11.5px] text-muted" value="2 次" disabled /></label>
            <label class="flex flex-col gap-5px text-[11.5px] text-subtle"><span>错误策略</span><input class="h-30px px-7px text-[11.5px] text-muted" value="中止流程" disabled /></label>
            <label class="flex flex-col gap-5px text-[11.5px] text-subtle"><span>输出上限</span><input class="h-30px px-7px text-[11.5px] text-muted" value="1 MB" disabled /></label>
            <label class="flex flex-col gap-5px text-[11.5px] text-subtle"><span>日志级别</span><input class="h-30px px-7px text-[11.5px] text-muted" value="info" disabled /></label>
          </div>
        </section>
      </div>

      <div v-else-if="activeTab === 'output'" class="inspector-scroll flex-1 overflow-y-auto">
        <section class="output-section border-b border-line pb-9px">
          <div class="config-heading flex items-center justify-between px-16px pb-2px pt-13px text-10px font-600 text-muted">
            <span>输出 Handles</span>
            <small class="text-[10.5px] font-[450] text-subtle">{{ displayOutputs.length }} 条</small>
          </div>
          <div v-for="handle in displayOutputs" :key="handle.id" class="output-handle-row mx-15px flex h-31px items-center gap-7px border-b border-dashed border-line text-[11.5px] text-muted">
            <span class="output-dot h-7px w-7px rounded-full" :style="{ background: manifest.color }" />
            <span>{{ handle.label }}</span>
            <span class="mono ml-auto text-[10.5px] text-subtle">{{ handle.id }}</span>
          </div>
        </section>
        <section class="output-section border-b border-line pb-9px">
          <div class="config-heading flex items-center justify-between px-16px pb-2px pt-13px text-10px font-600 text-muted">
            <span>输出字段</span>
            <small class="text-[10.5px] font-[450] text-subtle">可被下游引用</small>
          </div>
          <div v-for="field in manifest.outputFields" :key="field.name" class="output-field-row mx-15px flex items-start justify-between gap-8px border-b border-dashed border-line py-9px">
            <div>
              <span class="field-name font-mono text-[11.5px] text-ink">{{ field.name }}</span>
              <span class="field-type ml-7px text-[10.5px] text-primary">{{ field.type }}</span>
              <span v-if="field.required" class="required-mark ml-5px rounded-3px bg-danger-soft px-3px py-1px text-[10px] text-danger">必填</span>
              <p class="mb-0 ml-0 mr-0 mt-3px text-[10.5px] text-subtle">{{ field.description }}</p>
            </div>
            <button class="icon-btn" title="复制引用" @click="copyReference(field.name)">
              <Copy :size="13" />
            </button>
          </div>
        </section>
        <section class="fixture-section border-b border-line pb-13px">
          <div class="config-heading flex items-center justify-between px-16px pb-2px pt-13px text-10px font-600 text-muted">
            <span>静态示例</span>
            <small class="text-[10.5px] font-[450] text-subtle">非真实运行结果</small>
          </div>
          <pre class="mb-0 ml-15px mr-15px mt-8px overflow-auto rounded-6px bg-surface-3 p-10px font-mono text-[11.5px] leading-1.55 text-muted">{{ fixtureJson }}</pre>
        </section>
      </div>

      <div v-else class="inspector-scroll flex-1 overflow-y-auto">
        <section class="run-tab p-15px">
          <template v-if="nodeRun">
            <div class="run-status-head flex items-center justify-between text-[11.5px] text-subtle">
              <StatusBadge :status="nodeRun.status" />
              <span>{{ nodeRun.durationMs ? `${nodeRun.durationMs} ms` : '执行中' }}</span>
            </div>
            <div class="run-kv my-12px grid gap-7px rounded-6px bg-surface-2 p-10px text-[11.5px]" style="grid-template-columns: 90px 1fr">
              <span>attempt</span><strong>{{ nodeRun.attempt ?? 1 }}</strong>
              <span>nodeId</span><strong class="mono">{{ node.id }}</strong>
              <span>manifest</span><strong>v{{ manifest.version }}</strong>
            </div>
            <div v-if="nodeRun.error" class="run-error rounded-6px bg-danger-soft p-10px text-danger">
              <strong class="font-mono text-10px">{{ nodeRun.error.code }}</strong>
              <p class="mb-0 ml-0 mr-0 mt-5px text-[11.5px]">{{ nodeRun.error.message }}</p>
            </div>
            <div class="run-json-block mt-12px">
              <span class="text-[11.5px] text-subtle">输入</span>
              <pre class="mb-0 ml-0 mr-0 mt-5px max-h-200px overflow-auto rounded-6px bg-surface-3 p-9px font-mono text-[11.5px] leading-1.55 text-muted">{{ pretty(nodeRun.input ?? runInput) }}</pre>
            </div>
            <div class="run-json-block mt-12px">
              <span class="text-[11.5px] text-subtle">输出</span>
              <pre class="mb-0 ml-0 mr-0 mt-5px max-h-200px overflow-auto rounded-6px bg-surface-3 p-9px font-mono text-[11.5px] leading-1.55 text-muted">{{ pretty(nodeRun.output) }}</pre>
            </div>
          </template>
          <div v-else class="no-run-state flex flex-col items-center gap-7px px-16px py-52px text-center text-subtle">
            <PlayCircle :size="22" />
            <strong class="text-11px text-muted">暂无节点运行记录</strong>
            <span class="text-[11.5px]">草稿预览或发布版本试运行后显示。</span>
          </div>
        </section>
      </div>

      <div class="inspector-footer flex min-h-61px items-center justify-between gap-10px border-t border-line bg-surface-2 px-15px py-10px">
        <div class="flex flex-col gap-2px">
          <span class="text-[11.5px] text-muted">{{ disabled ? '只读模式' : '自动保存已开启' }}</span>
          <small class="text-[10.5px] text-subtle">{{ disabled ? '发布版本不可修改' : '500ms 防抖 · 失焦立即保存' }}</small>
        </div>
        <button v-if="!disabled" class="btn btn-primary h-31px px-11px text-10px" @click="$emit('flush')">保存节点</button>
      </div>
    </template>

    <template v-else>
      <div class="overview-empty flex flex-col items-center px-24px pb-20px pt-48px text-center">
        <div class="overview-mark flex h-48px w-48px items-center justify-center rounded-8px bg-primary-soft text-primary"><Network :size="24" /></div>
        <h2 class="mb-0 ml-0 mr-0 mt-14px text-14px">工作流概览</h2>
        <p class="m-0 text-[11.5px] leading-1.6 text-subtle">点击画布中的节点查看配置、端口和运行记录。</p>
      </div>
      <div class="overview-sections mx-15px grid gap-1px overflow-hidden border border-line rounded-7px bg-line" style="grid-template-columns: repeat(3, 1fr)">
        <div class="overview-stat flex min-h-58px flex-col justify-center gap-4px bg-surface-2 p-9px"><span class="text-[10.5px] text-subtle">节点</span><strong class="text-14px">{{ definition.nodes.length }}</strong></div>
        <div class="overview-stat flex min-h-58px flex-col justify-center gap-4px bg-surface-2 p-9px"><span class="text-[10.5px] text-subtle">连线</span><strong class="text-14px">{{ definition.edges.length }}</strong></div>
        <div class="overview-stat flex min-h-58px flex-col justify-center gap-4px bg-surface-2 p-9px"><span class="text-[10.5px] text-subtle">校验</span><strong class="text-14px" :class="validation.valid ? 'text-success' : 'text-danger'">{{ validation.valid ? '通过' : `${validation.errors.length} 项` }}</strong></div>
      </div>
      <div class="overview-note mx-15px my-15px flex items-start gap-7px rounded-6px bg-surface-3 p-9px text-[11.5px] leading-1.55 text-subtle">
        <Info :size="14" />
        <span>运行态只叠加在节点上，不会写回节点配置。</span>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Info,
  Network,
  PlayCircle,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-vue-next'
import NodeGlyph from '@/components/NodeGlyph.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { getNodeRegistration } from '@/shared/registry'
import type {
  DesignerServices,
  NodeRun,
  NodeRunStatus,
  SelectOption,
  ValidationResult,
  WorkflowDefinition,
  WorkflowNode,
} from '@/shared/types'
import SchemaForm from '../forms/SchemaForm.vue'
import { fieldsFromJsonSchema } from '../forms/resolveNodeForm'

const props = defineProps<{
  node?: WorkflowNode | null
  selectedNodes: WorkflowNode[]
  definition: WorkflowDefinition
  disabled: boolean
  services?: DesignerServices
  validation: ValidationResult
  errors: Array<{ field?: string; message: string }>
  nodeRun?: NodeRun
  runInput?: Record<string, unknown>
}>()

const emit = defineEmits<{
  'update-config': [nodeId: string, config: Record<string, unknown>, fieldKey: string]
  'rename-node': [nodeId: string, title: string]
  'set-mode': [nodeId: string, key: string, value: string]
  'save-node': [nodeId: string, config: Record<string, unknown>]
  'delete-nodes': [nodeIds: string[]]
  'close': []
  flush: []
  notify: [level: 'info' | 'warn' | 'error', message: string]
}>()

const activeTab = ref<'input' | 'output' | 'run'>('input')
const runtimeOpen = ref(true)
const advancedOpen = ref(false)
const serviceOptions = reactive<Record<string, SelectOption[]>>({})

watch(
  () => props.node?.id,
  () => {
    activeTab.value = 'input'
  },
)

watch(
  () => [props.services, props.node?.type],
  async () => {
    if (!props.services || !props.node) return
    const options: Record<string, SelectOption[]> = {}
    if (props.services.loadModelOptions) options.modelConnectionId = await props.services.loadModelOptions()
    if (props.services.loadKnowledgeOptions) options.knowledgeBaseId = await props.services.loadKnowledgeOptions()
    if (props.services.loadMcpServers) options.serverId = await props.services.loadMcpServers()
    if (props.services.loadWorkflowOptions) options.workflowId = await props.services.loadWorkflowOptions()
    Object.assign(serviceOptions, options)
  },
  { immediate: true },
)

const manifest = computed(() => (props.node ? getNodeRegistration(props.node.type)?.manifest : undefined))
const resolvedForm = computed(() => {
  if (!props.node) return { kind: 'readonly' as const, type: '' }
  const registration = getNodeRegistration(props.node.type)
  if (!registration) return { kind: 'readonly' as const, type: props.node.type }
  if (registration.form?.kind === 'component') return { kind: 'component' as const, registration }
  if (registration.form?.kind === 'schema') return { kind: 'schema' as const, registration }
  if (registration.manifest.configFields.length) return { kind: 'fields' as const, registration }
  return { kind: 'readonly' as const, type: props.node.type }
})

const visibleFields = computed(() => {
  if (!props.node || !manifest.value) return []
  if (resolvedForm.value.kind === 'schema') {
    const schema = getNodeRegistration(props.node.type)?.form?.schema ?? {}
    return fieldsFromJsonSchema(schema)
  }
  const discriminator = manifest.value.discriminator
  const mode = discriminator ? String(props.node.config[discriminator.key] ?? '') : ''
  return manifest.value.configFields.filter(
    (field) => !field.modes?.length || field.modes.includes(mode),
  )
})

const modeValue = computed(() => {
  if (!props.node || !manifest.value?.discriminator) return ''
  return String(props.node.config[manifest.value.discriminator.key] ?? '')
})

const displayOutputs = computed(() => {
  if (!manifest.value || !props.node) return []
  if (manifest.value.type === 'condition' && props.node.config.mode === 'switch') {
    const rows = Array.isArray(props.node.config.switchCases) ? props.node.config.switchCases : []
    return [
      ...rows.map((row) => {
        const item = row as Record<string, unknown>
        return { id: `case.${item.id ?? 'branch'}`, label: String(item.label ?? '分支'), kind: 'source' as const }
      }),
      { id: 'default', label: 'Default', kind: 'source' as const },
    ]
  }
  return manifest.value.outputs
})

const tabs = computed(() => [
  { key: 'input' as const, label: '输入', count: visibleFields.value.length },
  { key: 'output' as const, label: '输出', count: displayOutputs.value.length },
  { key: 'run' as const, label: '运行记录' },
])

const typeSummary = computed(() => {
  const names = props.selectedNodes.map((node) => getManifest(node.type)?.displayName ?? node.type)
  return `${[...new Set(names)].join(' · ')}`
})

const fixtureJson = computed(() => {
  const values: Record<string, unknown> = {}
  manifest.value?.outputFields.forEach((field) => {
    values[field.name] = field.type === 'string'
      ? '示例文本'
      : field.type === 'number'
        ? 0.82
        : field.type === 'boolean'
          ? true
          : field.type === 'array'
            ? ['示例项']
            : { example: true }
  })
  return JSON.stringify(values, null, 2)
})

/**
 * 查询节点 Manifest。
 * @param type 节点类型。
 * @returns 节点 Manifest。
 */
function getManifest(type: string) {
  return getNodeRegistration(type)?.manifest
}

/**
 * 将单个字段更新写入节点配置。
 * @param key 字段键。
 * @param value 新值。
 */
function onFieldUpdate(key: string, value: unknown) {
  if (!props.node) return
  const config = { ...props.node.config, [key]: value }
  emit('update-config', props.node.id, config, key)
}

/**
 * 提交节点完整配置快照。
 * @param config 完整配置。
 */
function onCommit(config: Record<string, unknown>) {
  if (!props.node) return
  emit('update-config', props.node.id, config, '')
}

/**
 * 复制下游可引用的输出路径。
 * @param fieldName 输出字段名。
 */
async function copyReference(fieldName: string) {
  if (!props.node) return
  const reference = `\$node.${props.node.id}.output.${fieldName}`
  await navigator.clipboard?.writeText(reference)
  emit('notify', 'info', `已复制 {{ ${reference} }}`)
}

/**
 * 安全格式化运行输入输出。
 * @param value 任意运行数据。
 * @returns JSON 或字符串文本。
 */
function pretty(value: unknown) {
  if (value === undefined) return '暂无输出'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>
