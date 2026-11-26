<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex gap-[18px] border-b border-line px-3.5">
      <Button variant="unstyled" type="button"
        v-for="tab in tabs"
        :key="tab.key"
        class="flex h-[38px] items-center gap-[5px] border-0 border-b-2 border-transparent bg-transparent px-px text-[12px]"
        :class="activeTab === tab.key ? 'border-b-primary font-600 text-ink' : 'text-subtle'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.badge !== undefined" class="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-surface-3 text-[12px]">{{ tab.badge }}</span>
      </Button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
      <template v-if="activeTab === 'input'">
        <div class="mb-3 flex items-start gap-1.5 rounded-[6px] bg-info-soft p-2 text-[12px] leading-[1.45] text-info">
          <Info :size="13" />
          <span>由 <strong>start.inputSchema</strong> 生成，表单与 JSON 使用同一份数据。</span>
        </div>
        <div class="flex flex-col gap-3">
          <label v-for="field in inputFields" :key="field.name" class="flex flex-col gap-1.5">
            <span class="flex items-center gap-1.5 text-[12px] font-550 text-muted">
              {{ field.name }}
              <i class="font-mono text-[12px] not-italic text-primary">{{ field.type }}</i>
              <em v-if="field.required" class="rounded-[3px] bg-warning-soft px-1 py-0.25 text-[12px] not-italic text-warning">必填</em>
            </span>
            <Input
              v-if="field.type === 'string'"
              class="min-h-[35px] rounded-[8px] px-2.5 py-2 text-[12px]"
              :model-value="String(input[field.name] ?? '')"
              :disabled="readonly"
              @update:model-value="updateInput(field.name, String($event))"
            />
            <Textarea
              v-else
              class="min-h-[76px] resize-y rounded-[8px] px-2.5 py-2 font-mono text-[12px]"
              :model-value="formatValue(input[field.name])"
              :disabled="readonly"
              @update:model-value="updateJsonInput(field.name, String($event))"
            />
          </label>
          <div v-if="!inputFields.length" class="flex min-h-[90px] flex-col items-center justify-center gap-[7px] rounded-[7px] border border-dashed border-line text-[12px] text-subtle">当前运行没有输入字段。</div>
        </div>
      </template>
      <template v-else-if="activeTab === 'output'">
        <pre v-if="run?.output" class="m-0 overflow-auto rounded-[7px] bg-[var(--code-bg)] p-[11px] font-mono text-[12px] leading-[1.6] text-[#d8dbe5]">{{ pretty(run.output) }}</pre>
        <div v-else class="flex min-h-[90px] flex-col items-center justify-center gap-[7px] rounded-[7px] border border-dashed border-line text-[12px] text-subtle">
          <LoaderCircle v-if="running" :size="17" class="animate-spin text-primary" />
          <span>{{ running ? '运行中，等待最终输出。' : '暂无输出。' }}</span>
        </div>
      </template>
      <template v-else-if="activeTab === 'error'">
        <div v-if="run?.error" class="rounded-[7px] border border-[#f0c0c2] bg-danger-soft p-[11px] text-danger">
          <strong class="mono">{{ run.error.code }}</strong>
          <p>{{ run.error.message }}</p>
          <span v-if="run.error.nodeId">nodeId: {{ run.error.nodeId }}</span>
        </div>
        <div v-else class="flex min-h-[90px] flex-col items-center justify-center gap-[7px] rounded-[7px] border border-dashed border-line text-[12px] text-success">
          <CheckCircle2 :size="17" />
          <span>本次运行没有错误。</span>
        </div>
      </template>
      <template v-else>
        <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[7px] border border-line bg-line">
          <div class="flex min-h-[50px] flex-col gap-1 bg-surface-2 p-[9px]"><span class="text-[12px] text-subtle">运行 ID</span><strong class="mono truncate text-[12px] text-muted">{{ run?.id ?? '-' }}</strong></div>
          <div class="flex min-h-[50px] flex-col gap-1 bg-surface-2 p-[9px]"><span class="text-[12px] text-subtle">固定版本</span><strong class="truncate text-[12px] text-muted">{{ run?.version ? `v${run.version}` : '草稿预览' }}</strong></div>
          <div class="flex min-h-[50px] flex-col gap-1 bg-surface-2 p-[9px]"><span class="text-[12px] text-subtle">runKind</span><strong class="mono truncate text-[12px] text-muted">{{ run?.runKind ?? 'preview' }}</strong></div>
          <div class="flex min-h-[50px] flex-col gap-1 bg-surface-2 p-[9px]"><span class="text-[12px] text-subtle">trigger</span><strong class="mono truncate text-[12px] text-muted">{{ run?.trigger ?? 'manual_preview' }}</strong></div>
          <div class="flex min-h-[50px] flex-col gap-1 bg-surface-2 p-[9px]"><span class="text-[12px] text-subtle">Token</span><strong class="truncate text-[12px] text-muted">{{ run?.metadata.tokens ?? '-' }}</strong></div>
          <div class="flex min-h-[50px] flex-col gap-1 bg-surface-2 p-[9px]"><span class="text-[12px] text-subtle">费用</span><strong class="truncate text-[12px] text-muted">{{ run?.metadata.cost !== undefined ? `¥${run.metadata.cost.toFixed(2)}` : '-' }}</strong></div>
        </div>
        <div class="mt-[13px]">
          <span class="text-[12px] text-subtle">事件</span>
          <div v-for="event in events.slice(-6)" :key="event.seq" class="grid grid-cols-[22px_1fr_auto] items-center gap-1.5 border-b border-dashed border-line py-1.5 text-[12px] text-muted">
            <i class="not-italic text-subtle">{{ event.seq }}</i>
            <span class="mono">{{ event.type }}</span>
            <time class="font-mono text-[12px] text-subtle">{{ formatTime(event.at) }}</time>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCircle2, Info, LoaderCircle } from 'lucide-vue-next'
import { Button, Input, Textarea } from '@ai-reflow/ui'
import type { RunEvent, RunRecord, SchemaField } from '@/shared/types'

const props = withDefaults(
  defineProps<{
    run?: RunRecord
    input: Record<string, unknown>
    inputFields?: SchemaField[]
    events?: RunEvent[]
    readonly?: boolean
  }>(),
  {
    inputFields: () => [],
    events: () => [],
    readonly: false,
  },
)

const emit = defineEmits<{
  'update:input': [input: Record<string, unknown>]
}>()

const activeTab = ref<'input' | 'output' | 'error' | 'metadata'>('input')
const tabs = computed(() => [
  { key: 'input' as const, label: '输入', badge: props.inputFields.length },
  { key: 'output' as const, label: '输出' },
  { key: 'error' as const, label: '错误', badge: props.run?.error ? 1 : undefined },
  { key: 'metadata' as const, label: '元数据' },
])
const running = computed(() => props.run?.status === 'running' || props.run?.status === 'pending')

/**
 * 发出输入字段更新。
 * @param key 字段键。
 * @param value 更新后的值。
 */
function updateInput(key: string, value: unknown) {
  emit('update:input', { ...props.input, [key]: value })
}

/**
 * 解析 JSON 文本，失败时保留原始字符串。
 * @param key 字段键。
 * @param value 用户输入文本。
 */
function updateJsonInput(key: string, value: string) {
  try {
    updateInput(key, JSON.parse(value))
  } catch {
    updateInput(key, value)
  }
}

/**
 * 将任意值转换为可编辑文本。
 * @param value 待格式化值。
 * @returns 可直接显示的文本。
 */
function formatValue(value: unknown) {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? null, null, 2)
}

/**
 * 格式化运行输出。
 * @param value 输出对象。
 * @returns 两空格缩进的 JSON。
 */
function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

/**
 * 格式化事件发生时间。
 * @param value ISO 时间字符串。
 * @returns 本地时分秒文本。
 */
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

