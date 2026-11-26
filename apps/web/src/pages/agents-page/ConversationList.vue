<template>
  <section class="surface flex h-full min-h-0 flex-col overflow-hidden">
    <div class="flex min-h-[54px] items-center justify-between gap-2 border-b border-line px-3">
      <div class="min-w-0">
        <h2 class="m-0 truncate text-[13px] font-650">
          {{ agentName || '会话' }}
        </h2>
        <p class="mb-0 mt-0.5 text-[12px] text-subtle">
          {{ conversations.length }} 个会话
        </p>
      </div>
      <Button
        size="icon-sm"
        title="新建会话"
        :disabled="loading || !agentName"
        @click="$emit('create')"
      >
        <Plus :size="15" />
      </Button>
    </div>

    <div class="border-b border-line p-2">
      <Input
        v-model="query"
        class="h-8 px-2.5 text-[12px]"
        placeholder="筛选会话"
        aria-label="筛选会话"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
      <Button
        v-for="conversation in filteredConversations"
        :key="conversation.id"
        variant="unstyled"
        type="button"
        class="mb-1 flex w-full min-w-0 flex-col items-stretch gap-1 rounded-[6px] border-0 px-2.5 py-2 text-left"
        :class="conversation.id === activeConversationId
          ? 'bg-primary-soft text-ink'
          : 'bg-transparent text-muted hover:bg-[var(--surface-2)] hover:text-ink'"
        @click="$emit('select', conversation.id)"
      >
        <span class="flex min-w-0 items-center gap-1.5">
          <MessageSquare
            :size="13"
            class="shrink-0"
            :class="conversation.id === activeConversationId ? 'text-primary' : 'text-subtle'"
          />
          <strong class="min-w-0 flex-1 truncate text-[12px] font-600">
            {{ conversation.title }}
          </strong>
          <span class="shrink-0 text-[12px] text-subtle">
            {{ conversation.messageCount }}
          </span>
        </span>
        <span class="block truncate pl-[19px] text-[12px] text-subtle">
          {{
            conversation.preview ||
            (conversation.messageCount ? '等待回复' : '尚未发送消息')
          }}
        </span>
        <span class="block pl-[19px] text-[12px] text-subtle">
          {{ formatTime(conversation.lastMessageAt ?? conversation.updatedAt) }}
        </span>
      </Button>

      <div
        v-if="!loading && !filteredConversations.length"
        class="flex min-h-[160px] flex-col items-center justify-center gap-2 px-3 text-center text-[12px] text-subtle"
      >
        <MessageSquare :size="20" />
        <span>{{ query ? '没有匹配的会话' : '新建会话开始对话' }}</span>
        <Button
          v-if="!query && agentName"
          variant="outline"
          size="xs"
          @click="$emit('create')"
        >
          <Plus :size="12" /> 新建会话
        </Button>
      </div>

      <div
        v-if="loading"
        class="flex min-h-[120px] items-center justify-center gap-2 text-[12px] text-subtle"
      >
        <LoaderCircle :size="14" class="animate-spin" />
        正在加载会话
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Input } from '@ai-reflow/ui'
import {
  LoaderCircle,
  MessageSquare,
  Plus,
} from 'lucide-vue-next'
import type { AgentConversationDto } from '@/services/reflowApi'

const props = defineProps<{
  conversations: AgentConversationDto[]
  activeConversationId?: string
  agentName?: string
  loading?: boolean
}>()

defineEmits<{
  select: [conversationId: string]
  create: []
}>()

const query = ref('')
const filteredConversations = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return props.conversations
  return props.conversations.filter((conversation) =>
    `${conversation.title} ${conversation.preview}`
      .toLowerCase()
      .includes(keyword),
  )
})

/**
 * 返回会话列表中的紧凑时间标签。
 *
 * @param value ISO 时间。
 * @returns 本地时间或日期。
 */
function formatTime(value?: string) {
  if (!value) return '暂无活动'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无活动'
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return sameDay
    ? date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
      })
}
</script>
