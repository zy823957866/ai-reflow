<template>
  <section class="surface flex h-full min-h-0 flex-col overflow-hidden">
    <div class="flex min-h-[54px] items-center gap-2 border-b border-line px-3.5">
      <div class="min-w-0 flex-1">
        <h2 class="m-0 truncate text-[13px] font-650">
          {{ conversationTitle || '选择会话' }}
        </h2>
        <p class="mb-0 mt-0.5 truncate text-[12px] text-subtle">
          {{ agentName || 'Agent' }}
          <span v-if="activeInvocation"> · {{ invocationStatusLabel }}</span>
        </p>
      </div>
      <Button
        v-if="canRegenerate"
        variant="ghost"
        size="xs"
        class="gap-1 text-[12px]"
        :disabled="streaming || !conversationTitle"
        @click="$emit('regenerate')"
      >
        <RotateCcw :size="12" />
        重新生成
      </Button>
      <Button
        v-if="streaming"
        variant="outline"
        size="xs"
        class="gap-1 border-danger/30 text-[12px] text-danger"
        :disabled="cancelling"
        @click="$emit('stop')"
      >
        <LoaderCircle v-if="cancelling" :size="12" class="animate-spin" />
        <Square v-else :size="11" />
        {{ cancelling ? '停止中' : '停止' }}
      </Button>
    </div>

    <div
      v-if="error"
      class="mx-3 mt-2.5 flex items-start gap-1.5 rounded-[6px] border border-[#efbfc1] bg-danger-soft px-2.5 py-2 text-[12px] leading-[1.5] text-danger"
    >
      <CircleAlert :size="13" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">{{ error }}</span>
    </div>

    <div ref="scrollContainer" class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
      <div
        v-if="!messages.length"
        class="flex h-full min-h-[240px] flex-col items-center justify-center gap-2.5 px-5 text-center text-subtle"
      >
        <span class="flex h-11 w-11 items-center justify-center rounded-[9px] bg-primary-soft text-primary">
          <Bot :size="22" />
        </span>
        <strong class="text-[13px] text-muted">
          {{ conversationTitle ? '开始这轮对话' : '先新建一个会话' }}
        </strong>
        <span class="max-w-[320px] text-[12px] leading-[1.55]">
          消息、工具步骤和引用会随 invocation 持久化，刷新后可继续。
        </span>
      </div>

      <article
        v-for="message in messages"
        :key="message.id"
        class="mb-3 flex min-w-0 gap-2"
        :class="message.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <span
          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[12px]"
          :class="message.role === 'user'
            ? 'bg-[var(--surface-3)] text-muted'
            : 'bg-primary-soft text-primary'"
        >
          <UserRound v-if="message.role === 'user'" :size="14" />
          <Bot v-else :size="14" />
        </span>
        <div
          class="min-w-0 max-w-[min(760px,88%)]"
          :class="message.role === 'user' ? 'items-end text-right' : ''"
        >
          <div
            class="inline-block max-w-full rounded-[7px] border px-3 py-2 text-left text-[12px] leading-[1.6]"
            :class="message.role === 'user'
              ? 'border-line bg-[var(--surface-2)] text-ink'
              : 'border-line bg-surface text-ink'"
          >
            <p
              v-if="message.role === 'user'"
              class="m-0 whitespace-pre-wrap break-words"
            >
              {{ message.content }}
            </p>
            <div
              v-else
              class="agent-markdown min-w-0 break-words"
              v-html="renderAgentMarkdown(message.content)"
            />
            <span
              v-if="
                message.role === 'assistant' &&
                (message.status === 'pending' || message.status === 'streaming') &&
                !message.content
              "
              class="inline-flex items-center gap-1 text-subtle"
            >
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              正在生成
            </span>
            <span
              v-else-if="
                message.role === 'assistant' &&
                message.status === 'cancelled' &&
                !message.content
              "
              class="text-subtle"
            >
              已停止生成
            </span>
            <span
              v-else-if="
                message.role === 'assistant' &&
                message.status === 'failed' &&
                !message.content
              "
              class="text-danger"
            >
              本轮执行失败
            </span>
            <span
              v-else-if="
                message.role === 'assistant' &&
                message.status === 'completed' &&
                !message.content
              "
              class="text-subtle"
            >
              无文本输出
            </span>
          </div>

          <div
            v-if="message.citations?.length"
            class="mt-1.5 flex flex-wrap gap-1"
          >
            <Button
              v-for="citation in message.citations"
              :key="citation.chunkId ?? `${citation.documentId}:${citation.chunkIndex ?? 0}`"
              variant="outline"
              size="xs"
              class="h-6 max-w-full gap-1 rounded-[4px] px-1.5 text-[12px] text-subtle"
              :title="citation.location"
            >
              <BookOpen :size="10" class="shrink-0" />
              <span class="truncate">{{ citation.documentName }}</span>
              <span v-if="citation.location" class="shrink-0 font-mono text-[12px]">
                {{ citation.location }}
              </span>
            </Button>
          </div>

          <p
            v-if="message.error"
            class="mb-0 mt-1 text-[12px] text-danger"
          >
            {{ messageError(message.error) }}
          </p>
          <p class="mb-0 mt-1 text-[12px] text-subtle">
            {{ formatTime(message.createdAt) }}
          </p>
        </div>
      </article>

      <div
        v-if="toolItems.length"
        class="mb-2 border border-line rounded-[7px] bg-[var(--surface-2)]"
      >
        <Button
          variant="unstyled"
          type="button"
          class="flex w-full items-center gap-1.5 border-0 bg-transparent px-2.5 py-2 text-left text-[12px] text-muted"
          @click="toolsOpen = !toolsOpen"
        >
          <ChevronDown
            :size="13"
            class="transition-transform"
            :class="toolsOpen ? '' : '-rotate-90'"
          />
          <Wrench :size="12" />
          工具步骤
          <span class="rounded-[3px] bg-surface-3 px-1.5 py-px text-[12px] text-subtle">
            {{ toolItems.length }}
          </span>
        </Button>
        <div v-show="toolsOpen" class="border-t border-line px-2.5 py-1.5">
          <div
            v-for="tool in toolItems"
            :key="tool.id"
            class="flex min-h-7 items-center gap-2 border-b border-dashed border-line text-[12px] last:border-b-0"
          >
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              :class="tool.status === 'running'
                ? 'animate-pulse bg-warning'
                : tool.status === 'succeeded'
                  ? 'bg-success'
                  : 'bg-danger'"
            />
            <span class="min-w-0 flex-1 truncate font-mono text-muted">{{ tool.name }}</span>
            <span class="max-w-[52%] truncate text-subtle">{{ tool.summary }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-line bg-[var(--surface-2)] p-2.5">
      <div class="flex items-end gap-2">
        <Textarea
          v-model="composer"
          class="min-h-[58px] resize-none px-2.5 py-2 text-[12px] leading-[1.55]"
          :placeholder="streaming ? '等待当前回答完成' : '输入消息，Enter 发送'"
          :disabled="disabled || streaming"
          @keydown.enter.exact.prevent="submit"
        />
        <Button
          class="h-9 w-9 shrink-0 p-0"
          :disabled="disabled || streaming || !composer.trim()"
          title="发送消息"
          @click="submit"
        >
          <Send :size="15" />
        </Button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button, Textarea } from '@ai-reflow/ui'
import {
  BookOpen,
  Bot,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Send,
  Square,
  UserRound,
  Wrench,
} from 'lucide-vue-next'
import type {
  AgentInvocationDto,
  AgentMessageDto,
} from '@/services/reflowApi'
import { renderAgentMarkdown } from './markdown'
import type { ToolTimelineItem } from './types'

const props = defineProps<{
  messages: AgentMessageDto[]
  toolItems: ToolTimelineItem[]
  activeInvocation?: AgentInvocationDto
  agentName?: string
  conversationTitle?: string
  streaming?: boolean
  cancelling?: boolean
  canRegenerate?: boolean
  disabled?: boolean
  error?: string
}>()

const emit = defineEmits<{
  send: [content: string]
  stop: []
  regenerate: []
}>()

const composer = ref('')
const scrollContainer = ref<HTMLElement>()
const toolsOpen = ref(true)

const invocationStatusLabel = computed(() => {
  const status = props.activeInvocation?.status
  if (!status) return ''
  return (
    {
      queued: '排队中',
      running: '生成中',
      waiting: '等待恢复',
      succeeded: '已完成',
      failed: '失败',
      cancelled: '已取消',
      interrupted: '已中断',
    }[status] ?? status
  )
})

watch(
  () => [props.messages.length, props.messages.at(-1)?.content, props.toolItems.length],
  async () => {
    await nextTick()
    const element = scrollContainer.value
    if (element) element.scrollTop = element.scrollHeight
  },
)

/**
 * 提交消息并清空输入框。
 */
function submit() {
  const content = composer.value.trim()
  if (!content || props.disabled || props.streaming) return
  emit('send', content)
  composer.value = ''
}

/**
 * 格式化消息时间。
 *
 * @param value ISO 时间。
 * @returns 本地时间。
 */
function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 把持久化错误对象转为可读文本。
 *
 * @param error 错误记录。
 * @returns 错误文案。
 */
function messageError(error: Record<string, unknown>) {
  return typeof error.message === 'string'
    ? error.message
    : '本轮执行失败。'
}
</script>

<style scoped>
.agent-markdown :deep(p) {
  margin: 0 0 0.55rem;
}

.agent-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.agent-markdown :deep(pre) {
  margin: 0.6rem 0;
  overflow-x: auto;
  border-radius: 6px;
  background: var(--surface-3);
  padding: 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.agent-markdown :deep(code) {
  border-radius: 3px;
  background: var(--surface-3);
  padding: 0.1rem 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.agent-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.agent-markdown :deep(ul),
.agent-markdown :deep(ol) {
  margin: 0.4rem 0;
  padding-left: 1.15rem;
}

.agent-markdown :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}

.agent-markdown :deep(blockquote) {
  margin: 0.5rem 0;
  border-left: 2px solid #e1e5ec;
  padding-left: 0.7rem;
  color: #7b8495;
}
</style>
