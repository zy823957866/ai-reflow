<template>
  <div
    class="relative w-[194px] min-h-[88px] rounded-[8px] border bg-surface px-[11px] pb-[9px] pt-2.5 shadow-[0_1px_3px_rgba(18,20,26,0.06)] transition-[border-color,box-shadow,opacity]"
    :class="nodeCardStateClass(data.runStatus, selected, data.hasError)"
    :style="{ '--node-accent': manifest?.color ?? '#8B93A3' }"
  >
    <Handle
      v-for="input in inputs"
      :id="input.id"
      :key="`input-${input.id}`"
      type="target"
      :position="Position.Left"
      :style="{ top: `${36 + Math.max(0, inputs.indexOf(input)) * 20}px` }"
      class="!h-[9px] !w-[9px] !border-2 !border-surface !bg-[#b4bac6] shadow-[0_0_0_1px_#b4bac6]"
      :class="selected ? '!bg-primary !shadow-[0_0_0_1px_var(--primary)]' : ''"
    />

    <div class="flex items-center gap-2">
      <div class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]" :style="{ background: `color-mix(in srgb, ${manifest?.color ?? '#8B93A3'}, white 91%)`, color: manifest?.color ?? '#8B93A3' }">
        <NodeGlyph :name="manifest?.icon" :size="16" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-[5px]">
          <span class="truncate text-[12px] font-650 leading-[1.35] text-ink">{{ data.node.title }}</span>
          <LoaderCircle v-if="data.runStatus === 'running'" class="shrink-0 animate-spin text-primary" :size="13" />
          <CheckCircle2 v-else-if="data.runStatus === 'succeeded'" class="shrink-0 text-success" :size="13" />
          <XCircle v-else-if="data.runStatus === 'failed'" class="shrink-0 text-danger" :size="13" />
          <CircleAlert v-else-if="data.hasError" class="shrink-0 text-warning" :size="13" />
        </div>
        <div class="mt-0.75 flex items-center gap-1.5 text-[12px] text-subtle">
          <span class="mono">{{ data.node.type }}</span>
          <span class="max-w-[70px] truncate">{{ modeSummary }}</span>
        </div>
      </div>
      <MoreHorizontal :size="14" class="shrink-0 self-start text-subtle" />
    </div>

    <div class="mt-[7px] truncate text-[12px] leading-[1.35] text-subtle">{{ summary }}</div>

    <div
      v-for="output in outputs"
      :key="`output-label-${output.id}`"
      class="pointer-events-none absolute right-[9px] z-1 max-w-[62px] overflow-hidden truncate font-mono text-[12px] leading-none text-subtle"
      :style="{ top: `${28 + outputs.indexOf(output) * 20}px` }"
    >
      {{ output.id }}
    </div>
    <Handle
      v-for="output in outputs"
      :id="output.id"
      :key="`output-${output.id}`"
      type="source"
      :position="Position.Right"
      :style="{ top: `${36 + Math.max(0, outputs.indexOf(output)) * 20}px` }"
      class="!h-[9px] !w-[9px] !border-2 !border-surface !bg-[#b4bac6] shadow-[0_0_0_1px_#b4bac6]"
      :class="selected ? '!bg-primary !shadow-[0_0_0_1px_var(--primary)]' : ''"
    />

    <div v-if="data.runStatus === 'running'" class="absolute inset-x-2 bottom-[5px] h-0.5 overflow-hidden rounded-full bg-primary-soft">
      <span class="block h-full w-[40%] animate-pulse rounded-full bg-primary" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@xyflow/vue'
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MoreHorizontal,
  XCircle,
} from 'lucide-vue-next'
import NodeGlyph from '@/components/NodeGlyph.vue'
import { getNodeRegistration } from '@/shared/registry'
import type { HandleDef, NodeRunStatus, WorkflowNode } from '@/shared/types'

const props = defineProps<{
  id?: string
  selected?: boolean
  data: {
    node: WorkflowNode
    runStatus?: NodeRunStatus
    hasError?: boolean
  }
}>()

const manifest = computed(() => getNodeRegistration(props.data.node.type)?.manifest)
const inputs = computed(() => manifest.value?.inputs ?? [])
const outputs = computed<HandleDef[]>(() => {
  const all = manifest.value?.outputs ?? []
  const config = props.data.node.config
  if (props.data.node.type === 'condition') {
    if (config.mode === 'switch') {
      const cases = Array.isArray(config.switchCases) ? config.switchCases : []
      return [
        ...cases.map((item) => {
          const record = item as Record<string, unknown>
          return {
            id: `case.${record.id ?? record.label ?? 'branch'}`,
            label: String(record.label ?? record.id ?? '分支'),
            kind: 'source' as const,
          }
        }),
        { id: 'default', label: 'Default', kind: 'source' as const },
      ]
    }
    return all.filter(
      (handle) => handle.id === 'true' || handle.id === 'false' || handle.id === 'default',
    )
  }
  if (props.data.node.type === 'quality-gate') {
    if (config.mode === 'guardrail') {
      return all.filter((handle) => handle.id === 'pass' || handle.id === 'block')
    }
    return all.filter((handle) => handle.id !== 'block')
  }
  return all
})

const modeSummary = computed(() => {
  const discriminator = manifest.value?.discriminator
  if (!discriminator) return manifest.value?.phase ?? ''
  const value = props.data.node.config[discriminator.key]
  return discriminator.options.find((option) => option.value === value)?.label ?? String(value ?? '')
})

const summary = computed(() => {
  const node = props.data.node
  const config = node.config
  if (node.type === 'llm') {
    return String(config.modelConnectionId ?? '选择模型')
  }
  if (node.type === 'knowledge') return `TopK ${config.topK ?? 5} · 阈值 ${config.scoreThreshold ?? 0.62}`
  if (node.type === 'tool') {
    return config.kind === 'mcp'
      ? `${config.serverId ?? 'MCP'} · ${config.toolName ?? '工具'}`
      : String(config.method ?? config.kind ?? 'HTTP')
  }
  if (node.type === 'condition') return `${modeSummary.value} · 判定路由`
  if (node.type === 'start') return config.entryMode === 'webhook' ? 'Webhook 入口' : '手动入口'
  if (node.type === 'output') return modeSummary.value
  return manifest.value?.description.slice(0, 24) ?? '未注册节点'
})

/**
 * 返回节点卡片的边框、阴影和透明度状态。
 * @param status 节点运行状态。
 * @param selected 是否选中。
 * @param hasError 是否存在配置错误。
 * @returns UnoCSS 状态类。
 */
function nodeCardStateClass(status: NodeRunStatus | undefined, selected = false, hasError = false) {
  if (selected) return 'border-primary shadow-[0_0_0_2px_rgba(91,77,240,0.13),0_5px_18px_rgba(91,77,240,0.12)]'
  if (hasError) return 'border-[#f1b95f]'
  if (status === 'running') return 'border-[#aaa2fa]'
  if (status === 'failed') return 'border-[#ef9ca0]'
  if (status === 'succeeded') return 'border-[#99d9c0]'
  if (status === 'skipped') return 'border-line opacity-66'
  return 'border-line'
}
</script>
