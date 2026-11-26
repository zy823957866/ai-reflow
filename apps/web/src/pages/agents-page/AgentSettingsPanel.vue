<template>
  <section class="surface flex h-full min-h-0 flex-col overflow-hidden">
    <div class="flex min-h-[54px] items-center justify-between gap-2 border-b border-line px-3.5">
      <div class="min-w-0">
        <h2 class="m-0 text-[13px] font-650">Agent 配置</h2>
        <p class="mb-0 mt-0.5 truncate text-[12px] text-subtle">
          revision {{ agent?.revision ?? '—' }} · 会话固定创建时快照
        </p>
      </div>
      <Settings2 :size="16" class="shrink-0 text-subtle" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <section class="border-b border-line px-3.5 py-3">
        <div class="mb-3 text-[12px] font-650 uppercase tracking-[0.02em] text-subtle">
          Profile
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('profile-name')">名称</Label>
            <Input
              :id="fieldId('profile-name')"
              v-model="name"
              class="h-8 px-2.5 text-[12px]"
              placeholder="例如：售后知识助手"
              :disabled="saving"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('profile-description')">说明</Label>
            <Textarea
              :id="fieldId('profile-description')"
              v-model="description"
              class="min-h-[58px] resize-y px-2.5 py-2 text-[12px]"
              :disabled="saving"
            />
          </div>
        </div>
      </section>

      <section class="border-b border-line px-3.5 py-3">
        <div class="mb-3 text-[12px] font-650 uppercase tracking-[0.02em] text-subtle">
          模型与指令
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>模型连接</Label>
            <Select v-model="modelConnectionId" :disabled="saving">
              <SelectTrigger class="h-8 px-2.5 text-[12px]">
                <SelectValue placeholder="选择模型连接" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="model in models"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.name }} · {{ model.model }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('instructions')">系统指令</Label>
            <Textarea
              :id="fieldId('instructions')"
              v-model="instructions"
              class="min-h-[124px] resize-y px-2.5 py-2 text-[12px] leading-[1.6]"
              placeholder="规定 Agent 的角色、边界和回答方式。"
              :disabled="saving"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('input-expression')">输入表达式</Label>
            <Input
              :id="fieldId('input-expression')"
              v-model="inputExpression"
              class="h-8 px-2.5 font-mono text-[12px]"
              placeholder="{{ $input.question }}"
              :disabled="saving"
            />
          </div>
        </div>
      </section>

      <section class="border-b border-line px-3.5 py-3">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="text-[12px] font-650 uppercase tracking-[0.02em] text-subtle">
            知识检索
          </span>
          <span class="text-[12px] text-subtle">
            {{ selectedKnowledgeIds.length }} 个知识库
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Button
            v-for="knowledgeBase in knowledgeBases"
            :key="knowledgeBase.id"
            variant="outline"
            size="xs"
            type="button"
            class="h-7 rounded-[5px] px-2 text-[12px]"
            :class="selectedKnowledgeIds.includes(knowledgeBase.id)
              ? '!border-[#c3bdf9] !bg-primary-soft !text-primary'
              : ''"
            :disabled="saving"
            @click="toggleKnowledge(knowledgeBase.id)"
          >
            {{ knowledgeBase.name }}
          </Button>
        </div>
        <div
          v-if="!knowledgeBases.length"
          class="flex h-8 items-center justify-center border border-dashed border-border-strong rounded-[6px] text-[12px] text-subtle"
        >
          暂无可用知识库
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1.5">
            <Label>检索模式</Label>
            <Select v-model="retrievalMode" :disabled="saving">
              <SelectTrigger class="h-8 px-2 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid">混合</SelectItem>
                <SelectItem value="vector">向量</SelectItem>
                <SelectItem value="keyword">关键词</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('top-k')">召回数量</Label>
            <Input
              :id="fieldId('top-k')"
              v-model.number="topK"
              type="number"
              min="1"
              max="20"
              class="h-8 px-2 font-mono text-[12px]"
              :disabled="saving"
            />
          </div>
          <div class="col-span-2 flex flex-col gap-1.5">
            <Label :for="fieldId('score-threshold')">最低分数</Label>
            <Input
              :id="fieldId('score-threshold')"
              v-model.number="scoreThreshold"
              type="number"
              min="0"
              max="1"
              step="0.05"
              class="h-8 px-2 font-mono text-[12px]"
              :disabled="saving"
            />
          </div>
        </div>
      </section>

      <section class="border-b border-line px-3.5 py-3">
        <div class="mb-3 text-[12px] font-650 uppercase tracking-[0.02em] text-subtle">
          运行边界
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('max-steps')">最大步数</Label>
            <Input
              :id="fieldId('max-steps')"
              v-model.number="maxSteps"
              type="number"
              min="1"
              max="32"
              class="h-8 px-2 font-mono text-[12px]"
              :disabled="saving"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label :for="fieldId('timeout')">超时 ms</Label>
            <Input
              :id="fieldId('timeout')"
              v-model.number="timeoutMs"
              type="number"
              min="1000"
              max="3600000"
              step="1000"
              class="h-8 px-2 font-mono text-[12px]"
              :disabled="saving"
            />
          </div>
          <div class="col-span-2 flex flex-col gap-1.5">
            <Label>记忆模式</Label>
            <Select v-model="memoryMode" :disabled="saving">
              <SelectTrigger class="h-8 px-2 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="run">按运行（工作流）</SelectItem>
                <SelectItem value="conversation">按会话</SelectItem>
                <SelectItem value="none">不保留</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section class="border-b border-line px-3.5 py-3">
        <div class="mb-3 text-[12px] font-650 uppercase tracking-[0.02em] text-subtle">
          MCP 工具
        </div>
        <Textarea
          v-model="mcpToolsText"
          class="min-h-[96px] resize-y px-2.5 py-2 font-mono text-[12px] leading-[1.55]"
          spellcheck="false"
          :disabled="saving"
        />
        <p class="mb-0 mt-1.5 text-[12px] leading-[1.5] text-subtle">
          JSON 数组：serverId、toolName，可选 description。
        </p>
      </section>

      <section class="px-3.5 py-3">
        <div class="mb-3 text-[12px] font-650 uppercase tracking-[0.02em] text-subtle">
          输出 Schema
        </div>
        <Textarea
          v-model="outputSchemaText"
          class="min-h-[96px] resize-y px-2.5 py-2 font-mono text-[12px] leading-[1.55]"
          spellcheck="false"
          :disabled="saving"
        />
        <p class="mb-0 mt-1.5 text-[12px] leading-[1.5] text-subtle">
          留空表示纯文本输出。
        </p>
      </section>
    </div>

    <div class="border-t border-line bg-[var(--surface-2)] p-2.5">
      <p
        v-if="validationError || error"
        class="mb-2 mt-0 flex items-start gap-1.5 text-[12px] leading-[1.5] text-danger"
      >
        <CircleAlert :size="13" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ validationError || error }}</span>
      </p>
      <Button
        class="h-8 w-full text-[12px]"
        :disabled="saving || !agent"
        @click="submit"
      >
        <LoaderCircle v-if="saving" :size="13" class="animate-spin" />
        <Save v-else :size="13" />
        {{ saving ? '保存中' : '保存配置' }}
      </Button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@ai-reflow/ui'
import {
  CircleAlert,
  LoaderCircle,
  Save,
  Settings2,
} from 'lucide-vue-next'
import type {
  AgentDto,
  AgentMcpToolConfig,
  AgentMemoryMode,
  KnowledgeBaseDto,
  ModelConnectionDto,
} from '@/services/reflowApi'
import type { AgentSavedInput } from './types'

const props = defineProps<{
  agent?: AgentDto
  models: ModelConnectionDto[]
  knowledgeBases: KnowledgeBaseDto[]
  saving?: boolean
  error?: string
}>()

const emit = defineEmits<{
  save: [input: AgentSavedInput]
}>()

const settingsId = useId()
const name = ref('')
const description = ref('')
const instructions = ref('')
const inputExpression = ref('')
const modelConnectionId = ref('')
const selectedKnowledgeIds = ref<string[]>([])
const retrievalMode = ref<'vector' | 'keyword' | 'hybrid'>('hybrid')
const topK = ref(5)
const scoreThreshold = ref(0.3)
const maxSteps = ref(8)
const timeoutMs = ref(120_000)
const memoryMode = ref<AgentMemoryMode>('run')
const mcpToolsText = ref('[]')
const outputSchemaText = ref('')
const validationError = ref('')

/**
 * 生成当前设置面板实例内的稳定字段 ID。
 *
 * @param field 字段名。
 * @returns 供 Label 与控件关联的唯一 ID。
 */
function fieldId(field: string) {
  return `${settingsId}-${field}`
}

watch(
  () => props.agent,
  (agent) => {
    if (!agent) return
    name.value = agent.name
    description.value = agent.description
    instructions.value = agent.config.instructions
    inputExpression.value = agent.config.inputExpression ?? ''
    modelConnectionId.value = agent.config.modelConnectionId
    selectedKnowledgeIds.value = [
      ...(agent.config.knowledge?.knowledgeBaseIds ?? []),
    ]
    retrievalMode.value =
      agent.config.knowledge?.retrievalMode ?? 'hybrid'
    topK.value = agent.config.knowledge?.topK ?? 5
    scoreThreshold.value =
      agent.config.knowledge?.scoreThreshold ?? 0.3
    maxSteps.value = agent.config.maxSteps
    timeoutMs.value = agent.config.timeoutMs
    memoryMode.value = agent.config.memory.mode
    mcpToolsText.value = JSON.stringify(
      agent.config.mcpTools ?? [],
      null,
      2,
    )
    outputSchemaText.value = agent.config.outputSchema
      ? JSON.stringify(agent.config.outputSchema, null, 2)
      : ''
    validationError.value = ''
  },
  { immediate: true },
)

/**
 * 切换需要挂载的知识库。
 *
 * @param knowledgeBaseId 知识库 ID。
 */
function toggleKnowledge(knowledgeBaseId: string) {
  const index = selectedKnowledgeIds.value.indexOf(knowledgeBaseId)
  if (index >= 0) selectedKnowledgeIds.value.splice(index, 1)
  else selectedKnowledgeIds.value.push(knowledgeBaseId)
}

/**
 * 校验并提交可序列化 AgentDefinition。
 */
function submit() {
  validationError.value = ''
  if (!props.agent) return
  if (!name.value.trim()) {
    validationError.value = 'Agent 名称不能为空。'
    return
  }
  if (!modelConnectionId.value) {
    validationError.value = '请选择模型连接。'
    return
  }
  if (!instructions.value.trim()) {
    validationError.value = '系统指令不能为空。'
    return
  }
  const mcpTools = parseMcpTools(mcpToolsText.value)
  if (!mcpTools) return
  const outputSchema = parseOutputSchema(outputSchemaText.value)
  if (outputSchema === false) return
  const config = {
    ...props.agent.config,
    instructions: instructions.value.trim(),
    ...(inputExpression.value.trim()
      ? { inputExpression: inputExpression.value.trim() }
      : {}),
    modelConnectionId: modelConnectionId.value,
    ...(selectedKnowledgeIds.value.length
      ? {
          knowledge: {
            knowledgeBaseIds: [...selectedKnowledgeIds.value],
            topK: clamp(topK.value, 1, 20),
            scoreThreshold: clamp(scoreThreshold.value, 0, 1),
            retrievalMode: retrievalMode.value,
          },
        }
      : {}),
    mcpTools,
    maxSteps: clamp(maxSteps.value, 1, 32),
    timeoutMs: clamp(timeoutMs.value, 1000, 3_600_000),
    ...(outputSchema ? { outputSchema } : {}),
    memory: { mode: memoryMode.value },
  }
  if (!inputExpression.value.trim()) delete config.inputExpression
  if (!selectedKnowledgeIds.value.length) delete config.knowledge
  if (!outputSchema) delete config.outputSchema
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim(),
    config,
  })
}

/**
 * 解析 MCP 工具 JSON，并校验最小字段。
 *
 * @param source JSON 文本。
 * @returns 合法工具数组，失败时返回 null。
 */
function parseMcpTools(source: string): AgentMcpToolConfig[] | null {
  const trimmed = source.trim()
  if (!trimmed) return []
  try {
    const value = JSON.parse(trimmed) as unknown
    if (!Array.isArray(value)) {
      validationError.value = 'MCP 工具必须为 JSON 数组。'
      return null
    }
    const tools = value.filter(
      (item): item is AgentMcpToolConfig =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).serverId === 'string' &&
        typeof (item as Record<string, unknown>).toolName === 'string',
    )
    if (tools.length !== value.length) {
      validationError.value =
        '每个 MCP 工具都需要 serverId 与 toolName。'
      return null
    }
    return tools
  } catch {
    validationError.value = 'MCP 工具 JSON 无法解析。'
    return null
  }
}

/**
 * 解析可选输出 Schema。
 *
 * @param source JSON 文本。
 * @returns JSON 对象、undefined 或解析失败标记。
 */
function parseOutputSchema(
  source: string,
): Record<string, unknown> | undefined | false {
  const trimmed = source.trim()
  if (!trimmed) return undefined
  try {
    const value = JSON.parse(trimmed) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      validationError.value = '输出 Schema 必须为 JSON 对象。'
      return false
    }
    return value as Record<string, unknown>
  } catch {
    validationError.value = '输出 Schema JSON 无法解析。'
    return false
  }
}

/**
 * 把数值限制在允许范围内。
 *
 * @param value 原始值。
 * @param min 最小值。
 * @param max 最大值。
 * @returns 夹取后的有限数值。
 */
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
</script>
