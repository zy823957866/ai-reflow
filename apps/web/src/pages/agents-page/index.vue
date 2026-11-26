<template>
  <PageHeaderActions v-if="!agentId">
    <div class="flex items-center gap-2 max-md:flex-wrap">
      <span class="inline-flex h-[29px] items-center gap-1.5 rounded-[6px] bg-[var(--surface-3)] px-2.5 text-[12px] text-muted">
        <Bot :size="13" />
        {{ agents.length }} 个 Agent
      </span>
      <Button @click="openCreate">
        <Plus :size="14" /> 新建 Agent
      </Button>
    </div>
  </PageHeaderActions>

  <main v-if="!agentId" class="px-7 pb-16 pt-6 max-md:px-4">
    <section class="mb-4 flex items-end justify-between gap-5 max-md:flex-col max-md:items-start">
      <div>
        <h1 class="m-0 text-[27px] font-[730]">Agent 工作台</h1>
        <p class="mb-0 mt-1.5 text-[12px] leading-[1.55] text-subtle">
          创建可复用 Agent，按会话保存消息、工具步骤和知识引用。
        </p>
      </div>
      <Button variant="outline" @click="loadResources">
        <RefreshCw :size="13" :class="loadingAgents ? 'animate-spin' : ''" />
        刷新
      </Button>
    </section>

    <div
      v-if="pageError"
      class="mb-3 flex items-start gap-2 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-[12px] leading-[1.5] text-danger"
    >
      <CircleAlert :size="14" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">{{ pageError }}</span>
      <Button variant="link" size="xs" class="text-[12px]" @click="initialize">
        重试
      </Button>
    </div>

    <section
      v-if="agents.length"
      class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
    >
      <Button
        v-for="agent in agents"
        :key="agent.id"
        variant="unstyled"
        type="button"
        class="surface flex min-h-[154px] w-full min-w-0 flex-col items-stretch gap-0 border-0 p-0 text-left transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm"
        @click="router.push(`/agents/${agent.id}`)"
      >
        <span class="flex items-start gap-2.5 p-3.5 pb-2.5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary-soft text-primary">
            <Bot :size="18" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <strong class="truncate text-[13px]">{{ agent.name }}</strong>
            <span class="line-clamp-2 text-[12px] leading-[1.5] text-subtle">
              {{ agent.description || '未填写说明' }}
            </span>
          </span>
          <span class="shrink-0 rounded-[4px] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[12px] text-subtle">
            r{{ agent.revision }}
          </span>
        </span>
        <span class="mt-auto flex flex-wrap gap-1.5 border-t border-line bg-[var(--surface-2)] px-3.5 py-2">
          <span class="inline-flex h-5 items-center gap-1 rounded-[4px] border border-line bg-surface px-1.5 text-[12px] text-muted">
            <Cpu :size="10" />
            {{ modelLabel(agent.config.modelConnectionId) }}
          </span>
          <span class="inline-flex h-5 items-center gap-1 rounded-[4px] border border-line bg-surface px-1.5 text-[12px] text-muted">
            <BookOpen :size="10" />
            {{ agent.config.knowledge?.knowledgeBaseIds.length ?? 0 }}
          </span>
          <span class="inline-flex h-5 items-center gap-1 rounded-[4px] border border-line bg-surface px-1.5 text-[12px] text-muted">
            <Wrench :size="10" />
            {{ agent.config.mcpTools?.length ?? 0 }}
          </span>
          <span class="ml-auto text-[12px] text-subtle">{{ formatDate(agent.updatedAt) }}</span>
        </span>
      </Button>
    </section>

    <section
      v-else-if="!loadingAgents"
      class="surface flex min-h-[320px] flex-col items-center justify-center gap-3 px-5 text-center"
    >
      <span class="flex h-12 w-12 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
        <Bot :size="24" />
      </span>
      <div>
        <h2 class="m-0 text-[15px]">还没有 Agent</h2>
        <p class="mb-0 mt-1 text-[12px] text-subtle">
          从一个模型连接和系统指令开始。
        </p>
      </div>
      <Button @click="openCreate">
        <Plus :size="14" /> 新建 Agent
      </Button>
    </section>

    <section
      v-else
      class="surface flex min-h-[240px] items-center justify-center gap-2 text-[12px] text-subtle"
    >
      <LoaderCircle :size="15" class="animate-spin" />
      正在加载 Agent
    </section>
  </main>

  <main v-else class="h-[calc(100vh-62px)] min-h-[560px] overflow-hidden p-3 max-md:p-2.5">
    <div
      class="agent-workbench-grid h-full min-h-0 gap-3"
    >
      <aside class="surface flex h-full min-h-0 flex-col overflow-hidden">
        <div class="flex min-h-[54px] items-center gap-2 border-b border-line px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0"
            title="返回 Agent 列表"
            @click="router.push('/agents')"
          >
            <ChevronLeft :size="16" />
          </Button>
          <div class="min-w-0 flex-1">
            <span class="block text-[12px] text-subtle">Agent</span>
            <strong class="block truncate text-[12px]">{{ selectedAgent?.name ?? '加载中' }}</strong>
          </div>
          <Button
            size="icon-sm"
            title="新建 Agent"
            @click="openCreate"
          >
            <Plus :size="14" />
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
          <Button
            v-for="agent in agents"
            :key="agent.id"
            variant="unstyled"
            type="button"
            class="mb-1 flex w-full min-w-0 items-center gap-2 rounded-[6px] border-0 px-2 py-2 text-left"
            :class="agent.id === agentId
              ? 'bg-primary-soft text-primary'
              : 'bg-transparent text-muted hover:bg-[var(--surface-2)] hover:text-ink'"
            @click="openAgent(agent.id)"
          >
            <Bot :size="14" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate text-[12px]">{{ agent.name }}</span>
            <span class="shrink-0 font-mono text-[12px] text-subtle">r{{ agent.revision }}</span>
          </Button>
        </div>
        <div class="border-t border-line p-2">
          <Button
            variant="outline"
            class="agent-settings-shortcut h-8 w-full text-[12px]"
            @click="settingsOpen = true"
          >
            <Settings2 :size="13" /> Agent 配置
          </Button>
          <Button
            variant="ghost"
            class="mt-1 h-8 w-full text-[12px]"
            @click="router.push('/agents')"
          >
            <LayoutGrid :size="13" /> 全部 Agent
          </Button>
        </div>
      </aside>

      <ConversationList
        :conversations="conversations"
        :active-conversation-id="activeConversationId"
        :agent-name="selectedAgent?.name"
        :loading="loadingConversations"
        @select="selectConversation"
        @create="createConversation"
      />

      <AgentChatPanel
        :messages="messages"
        :tool-items="toolItems"
        :active-invocation="activeInvocation"
        :agent-name="selectedAgent?.name"
        :conversation-title="activeConversation?.title"
        :streaming="streaming"
        :cancelling="cancelling"
        :can-regenerate="canRegenerate"
        :disabled="loadingMessages || !selectedAgent"
        :error="chatError"
        @send="sendMessage"
        @stop="stopInvocation"
        @regenerate="regenerate"
      />

      <AgentSettingsPanel
        v-if="selectedAgent && wideSettings"
        :agent="selectedAgent"
        :models="models"
        :knowledge-bases="knowledgeBases"
        :saving="savingSettings"
        :error="settingsError"
        @save="saveAgent"
      />
    </div>

    <div class="flex h-full min-h-0 flex-col md:hidden">
      <div class="mb-2.5 grid shrink-0 grid-cols-4 rounded-[7px] border border-line bg-[var(--surface-2)] p-[3px]">
        <Button
          v-for="pane in mobilePanes"
          :key="pane.value"
          variant="unstyled"
          type="button"
          class="h-8 rounded-[5px] border-0 text-[12px]"
          :class="mobilePane === pane.value
            ? 'bg-ink text-white'
            : 'bg-transparent text-subtle'"
          @click="mobilePane = pane.value"
        >
          {{ pane.label }}
        </Button>
      </div>
      <div class="min-h-0 flex-1">
        <section
          v-if="mobilePane === 'agents'"
          class="surface flex h-full min-h-0 flex-col overflow-hidden"
        >
          <div class="flex min-h-[54px] items-center justify-between border-b border-line px-3">
            <strong class="text-[13px]">Agent</strong>
            <div class="flex gap-1.5">
              <Button size="icon-sm" title="新建 Agent" @click="openCreate">
                <Plus :size="14" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                title="返回 Agent 列表"
                @click="router.push('/agents')"
              >
                <LayoutGrid :size="14" />
              </Button>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <Button
              v-for="agent in agents"
              :key="agent.id"
              variant="unstyled"
              type="button"
              class="mb-1 flex w-full min-w-0 items-center gap-2 rounded-[6px] border-0 px-2.5 py-2.5 text-left"
              :class="agent.id === agentId
                ? 'bg-primary-soft text-primary'
                : 'bg-transparent text-muted'"
              @click="openAgent(agent.id, 'conversations')"
            >
              <Bot :size="15" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate text-[12px]">{{ agent.name }}</span>
            </Button>
          </div>
        </section>

        <ConversationList
          v-else-if="mobilePane === 'conversations'"
          :conversations="conversations"
          :active-conversation-id="activeConversationId"
          :agent-name="selectedAgent?.name"
          :loading="loadingConversations"
          @select="selectConversationMobile"
          @create="createConversation"
        />

        <AgentChatPanel
          v-else-if="mobilePane === 'chat'"
          :messages="messages"
          :tool-items="toolItems"
          :active-invocation="activeInvocation"
          :agent-name="selectedAgent?.name"
          :conversation-title="activeConversation?.title"
          :streaming="streaming"
          :cancelling="cancelling"
          :can-regenerate="canRegenerate"
          :disabled="loadingMessages || !selectedAgent"
          :error="chatError"
          @send="sendMessage"
          @stop="stopInvocation"
          @regenerate="regenerate"
        />

        <AgentSettingsPanel
          v-else-if="selectedAgent"
          :agent="selectedAgent"
          :models="models"
          :knowledge-bases="knowledgeBases"
          :saving="savingSettings"
          :error="settingsError"
          @save="saveAgent"
        />
      </div>
    </div>
  </main>

  <Transition
    enter-active-class="transition-opacity duration-150"
    leave-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="settingsOpen && selectedAgent && !wideSettings"
      class="fixed inset-0 z-45 bg-[rgba(10,12,18,0.24)]"
      @click="settingsOpen = false"
    />
  </Transition>
  <aside
    v-if="!wideSettings && selectedAgent"
    class="fixed inset-y-0 right-0 z-46 w-[min(360px,calc(100vw-20px))] border-l border-line bg-surface shadow-xl transition-transform duration-200"
    :class="settingsOpen ? 'translate-x-0' : 'translate-x-full'"
  >
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex min-h-[44px] items-center justify-between border-b border-line px-3">
        <strong class="text-[12px]">Agent 配置</strong>
        <Button variant="ghost" size="icon-sm" title="关闭配置" @click="settingsOpen = false">
          <X :size="15" />
        </Button>
      </div>
      <div class="min-h-0 flex-1">
        <AgentSettingsPanel
          :agent="selectedAgent"
          :models="models"
          :knowledge-bases="knowledgeBases"
          :saving="savingSettings"
          :error="settingsError"
          @save="saveAgent"
        />
      </div>
    </div>
  </aside>

  <Dialog v-model:open="createOpen">
    <DialogContent class="w-[min(620px,calc(100vw-28px))]">
      <DialogTitle class="m-0 text-[17px] font-700">新建 Agent</DialogTitle>
      <DialogDescription class="mb-3 mt-1.5 text-[12px] leading-[1.6] text-subtle">
        创建后会固定一份初始配置；后续修改只影响新会话。
      </DialogDescription>
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-2.5 max-[620px]:grid-cols-1">
          <div class="flex flex-col gap-1.5">
            <Label for="new-agent-name">名称</Label>
            <Input
              id="new-agent-name"
              v-model="createDraft.name"
              placeholder="例如：售后知识助手"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>模型连接</Label>
            <Select v-model="createDraft.modelConnectionId">
              <SelectTrigger aria-label="模型连接">
                <SelectValue placeholder="选择模型连接" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="model in models" :key="model.id" :value="model.id">
                  {{ model.name }} · {{ model.model }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="new-agent-description">说明</Label>
          <Textarea
            id="new-agent-description"
            v-model="createDraft.description"
            class="min-h-[58px] resize-y px-2.5 py-2 text-[12px]"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="new-agent-instructions">系统指令</Label>
          <Textarea
            id="new-agent-instructions"
            v-model="createDraft.instructions"
            class="min-h-[110px] resize-y px-2.5 py-2 text-[12px] leading-[1.6]"
            placeholder="规定角色、边界和回答方式。"
          />
        </div>
        <p
          v-if="createError"
          class="m-0 flex items-start gap-1.5 text-[12px] leading-[1.5] text-danger"
        >
          <CircleAlert :size="13" class="mt-0.5 shrink-0" />
          <span>{{ createError }}</span>
        </p>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="createOpen = false">取消</Button>
          <Button :disabled="creating || !models.length" @click="submitCreate">
            <LoaderCircle v-if="creating" :size="13" class="animate-spin" />
            <Plus v-else :size="13" />
            {{ creating ? '创建中' : '创建 Agent' }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
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
  BookOpen,
  Bot,
  ChevronLeft,
  CircleAlert,
  Cpu,
  LayoutGrid,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  Wrench,
  X,
} from 'lucide-vue-next'
import PageHeaderActions from '@/components/PageHeaderActions.vue'
import {
  cancelAgentInvocation,
  createAgent,
  createAgentConversation,
  getAgent,
  getAgentInvocation,
  listAgentConversations,
  listAgentMessages,
  listAgents,
  listKnowledgeBases,
  listModelConnections,
  retryAgentMessage,
  sendAgentMessage,
  subscribeAgentInvocationEvents,
  updateAgent,
  type AgentDto,
  type AgentInvocationDto,
  type AgentInvocationEventDto,
  type AgentMessageDto,
  type KnowledgeBaseDto,
  type ModelConnectionDto,
} from '@/services/reflowApi'
import type {
  AgentCreateDraft,
  AgentMobilePane,
  AgentSavedInput,
  ToolTimelineItem,
} from './types'
import AgentChatPanel from './AgentChatPanel.vue'
import AgentSettingsPanel from './AgentSettingsPanel.vue'
import ConversationList from './ConversationList.vue'

const route = useRoute()
const router = useRouter()
const agents = ref<AgentDto[]>([])
const selectedAgent = ref<AgentDto>()
const conversations = ref<Awaited<ReturnType<typeof listAgentConversations>>>([])
const messages = ref<AgentMessageDto[]>([])
const activeConversationId = ref('')
const activeInvocation = ref<AgentInvocationDto>()
const toolItems = ref<ToolTimelineItem[]>([])
const models = ref<ModelConnectionDto[]>([])
const knowledgeBases = ref<KnowledgeBaseDto[]>([])
const loadingAgents = ref(false)
const wideSettings = ref(false)
const loadingConversations = ref(false)
const loadingMessages = ref(false)
const savingSettings = ref(false)
const sending = ref(false)
const cancelling = ref(false)
const creating = ref(false)
const pageError = ref('')
const chatError = ref('')
const settingsError = ref('')
const createError = ref('')
const createOpen = ref(false)
const settingsOpen = ref(false)
const mobilePane = ref<AgentMobilePane>('chat')
const createDraft = reactive<AgentCreateDraft>({
  name: '',
  description: '',
  modelConnectionId: '',
  instructions: '',
})
let unsubscribeInvocation: (() => void) | undefined
let wideSettingsQuery: MediaQueryList | undefined
let terminalHandled = false
let resourcesLoaded = false

const agentId = computed(() =>
  typeof route.params.id === 'string' ? route.params.id : '',
)

const activeConversation = computed(() =>
  conversations.value.find((item) => item.id === activeConversationId.value),
)

const streaming = computed(() =>
  ['queued', 'running', 'waiting'].includes(
    activeInvocation.value?.status ?? '',
  ),
)

const lastUserMessage = computed(() =>
  [...messages.value].reverse().find((message) => message.role === 'user'),
)

const canRegenerate = computed(
  () => Boolean(lastUserMessage.value && activeConversationId.value),
)

const mobilePanes: Array<{ value: AgentMobilePane; label: string }> = [
  { value: 'agents', label: 'Agent' },
  { value: 'conversations', label: '会话' },
  { value: 'chat', label: '对话' },
  { value: 'settings', label: '配置' },
]

watch(
  () => route.params.id,
  () => {
    void initialize()
  },
  { immediate: true },
)

onMounted(() => {
  wideSettingsQuery = window.matchMedia('(min-width: 1540px)')
  syncWideSettings()
  wideSettingsQuery.addEventListener('change', syncWideSettings)
})

onUnmounted(() => {
  unsubscribeInvocation?.()
  wideSettingsQuery?.removeEventListener('change', syncWideSettings)
})

/**
 * 同步宽屏配置面板断点，并在切换时关闭抽屉。
 *
 * @param event 媒体查询变更事件。
 */
function syncWideSettings(event?: MediaQueryListEvent) {
  wideSettings.value = event
    ? event.matches
    : Boolean(wideSettingsQuery?.matches)
  if (wideSettings.value) settingsOpen.value = false
}

/**
 * 加载 Agent 列表、当前工作区和可选项。
 */
async function initialize() {
  unsubscribeInvocation?.()
  unsubscribeInvocation = undefined
  activeInvocation.value = undefined
  toolItems.value = []
  messages.value = []
  chatError.value = ''
  settingsError.value = ''
  pageError.value = ''
  settingsOpen.value = false
  terminalHandled = false

  await loadResources()
  if (!agentId.value) {
    selectedAgent.value = undefined
    conversations.value = []
    activeConversationId.value = ''
    return
  }
  await loadWorkspace(agentId.value)
}

/**
 * 加载 Agent、模型和知识库等共享选项。
 */
async function loadResources() {
  loadingAgents.value = true
  pageError.value = ''
  try {
    const [agentList, modelList, knowledgeList] = await Promise.all([
      listAgents(),
      resourcesLoaded ? Promise.resolve(models.value) : listModelConnections(),
      resourcesLoaded
        ? Promise.resolve(knowledgeBases.value)
        : listKnowledgeBases(),
    ])
    agents.value = agentList
    models.value = modelList
    knowledgeBases.value = knowledgeList
    resourcesLoaded = true
    if (!createDraft.modelConnectionId && modelList[0]) {
      createDraft.modelConnectionId = modelList[0].id
    }
  } catch (error) {
    pageError.value = requestError(error, 'Agent 列表加载失败。')
  } finally {
    loadingAgents.value = false
  }
}

/**
 * 加载指定 Agent 的会话并恢复路由中的会话与 invocation。
 *
 * @param id Agent ID。
 */
async function loadWorkspace(id: string) {
  loadingConversations.value = true
  try {
    const [agent, conversationList] = await Promise.all([
      getAgent(id),
      listAgentConversations(id),
    ])
    if (route.params.id !== id) return
    selectedAgent.value = agent
    conversations.value = conversationList
    const requestedConversation = queryValue(route.query.conversation)
    const requestedInvocation = queryValue(route.query.invocation)
    const targetConversation =
      conversationList.find((item) => item.id === requestedConversation)?.id ??
      conversationList[0]?.id ??
      ''
    activeConversationId.value = targetConversation
    if (targetConversation) {
      await loadMessages(targetConversation)
      if (requestedInvocation) {
        await restoreInvocation(requestedInvocation)
      }
      await replaceRoute(targetConversation, requestedInvocation)
    }
    mobilePane.value = targetConversation ? 'chat' : 'conversations'
  } catch (error) {
    pageError.value = requestError(error, 'Agent 工作区加载失败。')
  } finally {
    loadingConversations.value = false
  }
}

/**
 * 加载指定会话消息。
 *
 * @param conversationId 外部会话 ID。
 */
async function loadMessages(conversationId: string) {
  loadingMessages.value = true
  try {
    messages.value = await listAgentMessages(conversationId, {
      after: 0,
      limit: 500,
    })
  } catch (error) {
    chatError.value = requestError(error, '会话消息加载失败。')
  } finally {
    loadingMessages.value = false
  }
}

/**
 * 选择桌面会话。
 *
 * @param conversationId 外部会话 ID。
 */
async function selectConversation(conversationId: string) {
  if (conversationId === activeConversationId.value) return
  await openConversation(conversationId)
}

/**
 * 在移动端选择会话后切到对话面板。
 *
 * @param conversationId 外部会话 ID。
 */
async function selectConversationMobile(conversationId: string) {
  await selectConversation(conversationId)
  mobilePane.value = 'chat'
}

/**
 * 切换会话并清理上一轮流状态。
 *
 * @param conversationId 外部会话 ID。
 */
async function openConversation(conversationId: string) {
  unsubscribeInvocation?.()
  unsubscribeInvocation = undefined
  activeInvocation.value = undefined
  toolItems.value = []
  chatError.value = ''
  terminalHandled = false
  activeConversationId.value = conversationId
  await replaceRoute(conversationId)
  await loadMessages(conversationId)
}

/**
 * 创建新会话并打开。
 */
async function createConversation() {
  if (!selectedAgent.value) return
  chatError.value = ''
  try {
    const conversation = await createAgentConversation(selectedAgent.value.id)
    conversations.value = [
      conversation,
      ...conversations.value.filter((item) => item.id !== conversation.id),
    ]
    await openConversation(conversation.id)
    mobilePane.value = 'chat'
  } catch (error) {
    chatError.value = requestError(error, '创建会话失败。')
  }
}

/**
 * 发送用户消息并启动 SSE。
 *
 * @param content 用户消息正文。
 */
async function sendMessage(content: string) {
  if (!selectedAgent.value || sending.value) return
  chatError.value = ''
  sending.value = true
  try {
    let conversationId = activeConversationId.value
    if (!conversationId) {
      const conversation = await createAgentConversation(
        selectedAgent.value.id,
      )
      conversations.value = [conversation, ...conversations.value]
      conversationId = conversation.id
      activeConversationId.value = conversationId
    }
    const accepted = await sendAgentMessage(
      conversationId,
      { content },
      createIdempotencyKey(),
    )
    mergeMessages(accepted.messages)
    await refreshConversations()
    await beginInvocation(accepted.invocationId, conversationId)
  } catch (error) {
    chatError.value = requestError(error, '消息发送失败。')
  } finally {
    sending.value = false
  }
}

/**
 * 从本轮最后一个用户消息重新生成回答。
 */
async function regenerate() {
  if (
    !activeConversationId.value ||
    !lastUserMessage.value ||
    streaming.value
  ) {
    return
  }
  chatError.value = ''
  try {
    const accepted = await retryAgentMessage(
      activeConversationId.value,
      lastUserMessage.value.id,
    )
    mergeMessages(accepted.messages)
    await beginInvocation(
      accepted.invocationId,
      activeConversationId.value,
    )
  } catch (error) {
    chatError.value = requestError(error, '重新生成失败。')
  }
}

/**
 * 加载 invocation 并开始订阅事件。
 *
 * @param invocationId 外部 invocation ID。
 * @param conversationId 所属会话。
 */
async function beginInvocation(
  invocationId: string,
  conversationId: string,
) {
  const invocation = await getAgentInvocation(invocationId)
  activeInvocation.value = invocation
  toolItems.value = []
  terminalHandled = false
  await replaceRoute(conversationId, invocationId)
  if (isActiveStatus(invocation.status)) {
    clearAssistantPlaceholder(invocation)
    unsubscribeInvocation?.()
    unsubscribeInvocation = subscribeAgentInvocationEvents({
      invocationId,
      afterSeq: 0,
      onEvent: applyInvocationEvent,
      onError(error) {
        chatError.value = error.message
      },
      onEnd() {
        void finalizeInvocation()
      },
    })
  } else {
    restoreToolItemsFromResult(invocation)
  }
}

/**
 * 刷新后恢复 query 中的 invocation。
 *
 * @param invocationId 外部 invocation ID。
 */
async function restoreInvocation(invocationId: string) {
  try {
    const invocation = await getAgentInvocation(invocationId)
    if (
      invocation.conversationId &&
      invocation.conversationId !== activeConversationId.value
    ) {
      return
    }
    activeInvocation.value = invocation
    terminalHandled = false
    if (isActiveStatus(invocation.status)) {
      clearAssistantPlaceholder(invocation)
      toolItems.value = []
      unsubscribeInvocation?.()
      unsubscribeInvocation = subscribeAgentInvocationEvents({
        invocationId,
        onEvent: applyInvocationEvent,
        onError(error) {
          chatError.value = error.message
        },
        onEnd() {
          void finalizeInvocation()
        },
      })
    } else {
      restoreToolItemsFromResult(invocation)
    }
  } catch (error) {
    chatError.value = requestError(error, 'invocation 恢复失败。')
  }
}

/**
 * 应用单条 SSE 事件到可见消息与工具时间线。
 *
 * @param event Agent invocation 事件。
 */
function applyInvocationEvent(event: AgentInvocationEventDto) {
  const invocation = activeInvocation.value
  if (!invocation) return
  if (event.type === 'invocation.queued') {
    activeInvocation.value = { ...invocation, status: 'queued' }
    return
  }
  if (event.type === 'invocation.interrupted') {
    activeInvocation.value = { ...invocation, status: 'interrupted' }
    return
  }
  if (event.type === 'invocation.resumed') {
    activeInvocation.value = { ...invocation, status: 'queued' }
    return
  }
  if (event.type === 'message.delta') {
    const text = payloadString(event, 'text')
    if (text) appendAssistantText(invocation, text)
    if (activeInvocation.value?.status === 'queued') {
      activeInvocation.value = {
        ...activeInvocation.value,
        status: 'running',
      }
    }
    return
  }
  if (event.type === 'message.completed') {
    const text = payloadString(event, 'text')
    if (text !== undefined) replaceAssistantText(invocation, text)
    return
  }
  if (event.type === 'tool.started') {
    const id = payloadString(event, 'toolCallId') ?? `tool-${event.seq}`
    toolItems.value = [
      ...toolItems.value.filter((item) => item.id !== id),
      {
        id,
        name: payloadString(event, 'name') ?? 'tool',
        status: 'running',
        summary: payloadString(event, 'argumentsSummary') ?? '开始执行',
      },
    ]
    return
  }
  if (event.type === 'tool.output' || event.type === 'tool.failed') {
    const id = payloadString(event, 'toolCallId') ?? ''
    const status = event.type === 'tool.output' ? 'succeeded' : 'failed'
    const summary =
      event.type === 'tool.output'
        ? payloadString(event, 'resultSummary') ?? '执行成功'
        : payloadString(event, 'message') ?? '执行失败'
    toolItems.value = toolItems.value.map((item) =>
      item.id === id ? { ...item, status, summary } : item,
    )
    if (event.type === 'tool.failed') {
      chatError.value = summary
    }
    return
  }
  if (
    event.type === 'invocation.completed' ||
    event.type === 'invocation.failed' ||
    event.type === 'invocation.cancelled'
  ) {
    const status =
      event.type === 'invocation.completed'
        ? 'succeeded'
        : event.type === 'invocation.failed'
          ? 'failed'
          : 'cancelled'
    activeInvocation.value = { ...invocation, status }
    void finalizeInvocation()
  }
}

/**
 * 停止当前 invocation。
 */
async function stopInvocation() {
  if (!activeInvocation.value || cancelling.value) return
  cancelling.value = true
  try {
    const result = await cancelAgentInvocation(activeInvocation.value.id)
    activeInvocation.value = {
      ...activeInvocation.value,
      status: result.status,
    }
    if (!isActiveStatus(result.status)) {
      await finalizeInvocation()
    }
  } catch (error) {
    chatError.value = requestError(error, '停止生成失败。')
  } finally {
    cancelling.value = false
  }
}

/**
 * 终态后刷新消息、会话摘要和 invocation 结果。
 */
async function finalizeInvocation() {
  if (terminalHandled) return
  terminalHandled = true
  const invocationId = activeInvocation.value?.id
  const conversationId = activeConversationId.value
  unsubscribeInvocation?.()
  unsubscribeInvocation = undefined
  try {
    const tasks: Promise<unknown>[] = []
    if (conversationId) tasks.push(loadMessages(conversationId))
    tasks.push(refreshConversations())
    if (invocationId) {
      tasks.push(
        getAgentInvocation(invocationId).then((invocation) => {
          activeInvocation.value = invocation
          restoreToolItemsFromResult(invocation)
        }),
      )
    }
    await Promise.allSettled(tasks)
  } finally {
    cancelling.value = false
  }
}

/**
 * 刷新会话列表摘要。
 */
async function refreshConversations() {
  if (!selectedAgent.value) return
  try {
    conversations.value = await listAgentConversations(
      selectedAgent.value.id,
    )
  } catch {
    // Keep the current conversation list when a background refresh fails.
  }
}

/**
 * 合并发送响应中的消息，按 seq 去重排序。
 *
 * @param incoming 新消息。
 */
function mergeMessages(incoming: AgentMessageDto[]) {
  const byId = new Map(
    messages.value.map((message) => [message.id, message]),
  )
  incoming.forEach((message) => byId.set(message.id, message))
  messages.value = [...byId.values()].sort(
    (left, right) => left.seq - right.seq,
  )
}

/**
 * 清空助手占位，随后由 SSE backlog 重建流式文本。
 *
 * @param invocation 当前 invocation。
 */
function clearAssistantPlaceholder(invocation: AgentInvocationDto) {
  const assistantMessageId = invocationAssistantMessageId(invocation)
  if (!assistantMessageId) return
  messages.value = messages.value.map((message) =>
    message.id === assistantMessageId
      ? { ...message, content: '', status: 'pending' }
      : message,
  )
}

/**
 * 追加流式文本。
 *
 * @param invocation 当前 invocation。
 * @param text 增量文本。
 */
function appendAssistantText(invocation: AgentInvocationDto, text: string) {
  const assistantMessageId = invocationAssistantMessageId(invocation)
  if (!assistantMessageId) return
  messages.value = messages.value.map((message) =>
    message.id === assistantMessageId
      ? {
          ...message,
          content: `${message.content}${text}`,
          status: 'streaming',
        }
      : message,
  )
}

/**
 * 替换助手完整文本。
 *
 * @param invocation 当前 invocation。
 * @param text 完整文本。
 */
function replaceAssistantText(invocation: AgentInvocationDto, text: string) {
  const assistantMessageId = invocationAssistantMessageId(invocation)
  if (!assistantMessageId) return
  messages.value = messages.value.map((message) =>
    message.id === assistantMessageId
      ? {
          ...message,
          content: text,
          status: 'streaming',
        }
      : message,
  )
}

/**
 * 从 invocation request 读取助手占位 ID。
 *
 * @param invocation invocation DTO。
 * @returns 外部消息 ID。
 */
function invocationAssistantMessageId(invocation: AgentInvocationDto) {
  const value = invocation.request.assistantMessageId
  return typeof value === 'string' ? value : ''
}

/**
 * 从持久化结果恢复工具时间线。
 *
 * @param invocation invocation DTO。
 */
function restoreToolItemsFromResult(invocation: AgentInvocationDto) {
  const result = invocation.result as
    | { steps?: unknown; toolCalls?: unknown }
    | null
    | undefined
  const toolCalls = Array.isArray(result?.toolCalls)
    ? result.toolCalls
    : []
  toolItems.value = toolCalls
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `tool-${index}`,
      name: typeof item.name === 'string' ? item.name : 'tool',
      status:
        item.status === 'failed'
          ? 'failed'
          : item.status === 'succeeded'
            ? 'succeeded'
            : 'running',
      summary:
        item.status === 'failed' &&
        item.error &&
        typeof item.error === 'object' &&
        typeof (item.error as Record<string, unknown>).message === 'string'
          ? String((item.error as Record<string, unknown>).message)
          : item.status === 'succeeded'
            ? '执行成功'
            : '执行中',
    }))
}

/**
 * 打开新建 Agent 对话框。
 */
function openCreate() {
  createDraft.name = ''
  createDraft.description = ''
  createDraft.instructions = ''
  createDraft.modelConnectionId =
    createDraft.modelConnectionId || models.value[0]?.id || ''
  createError.value = ''
  createOpen.value = true
}

/**
 * 创建 Agent 并进入工作台。
 */
async function submitCreate() {
  createError.value = ''
  if (!createDraft.name.trim()) {
    createError.value = '名称不能为空。'
    return
  }
  if (!createDraft.modelConnectionId) {
    createError.value = '请选择模型连接。'
    return
  }
  if (!createDraft.instructions.trim()) {
    createError.value = '系统指令不能为空。'
    return
  }
  creating.value = true
  try {
    const agent = await createAgent({
      name: createDraft.name.trim(),
      description: createDraft.description.trim(),
      config: {
        instructions: createDraft.instructions.trim(),
        modelConnectionId: createDraft.modelConnectionId,
        mcpTools: [],
        maxSteps: 8,
        timeoutMs: 120_000,
        memory: { mode: 'run' },
      },
    })
    createOpen.value = false
    await router.push(`/agents/${agent.id}`)
  } catch (error) {
    createError.value = requestError(error, 'Agent 创建失败。')
  } finally {
    creating.value = false
  }
}

/**
 * 保存 Agent 配置并保持当前会话选中。
 *
 * @param input 名称、说明和完整定义。
 */
async function saveAgent(input: AgentSavedInput) {
  if (!selectedAgent.value) return
  savingSettings.value = true
  settingsError.value = ''
  try {
    const updated = await updateAgent(selectedAgent.value.id, input)
    selectedAgent.value = updated
    agents.value = agents.value.map((agent) =>
      agent.id === updated.id ? updated : agent,
    )
    settingsOpen.value = false
  } catch (error) {
    settingsError.value = requestError(error, 'Agent 配置保存失败。')
  } finally {
    savingSettings.value = false
  }
}

/**
 * 切换到另一个 Agent。
 *
 * @param id Agent ID。
 * @param pane 可选移动端目标面板。
 */
async function openAgent(id: string, pane?: AgentMobilePane) {
  await router.push(`/agents/${id}`)
  if (pane) mobilePane.value = pane
}

/**
 * 用当前会话和 invocation 更新路由 query。
 *
 * @param conversationId 外部会话 ID。
 * @param invocationId 可选 invocation ID。
 */
async function replaceRoute(
  conversationId: string,
  invocationId?: string,
) {
  if (!agentId.value) return
  const query: Record<string, string> = { conversation: conversationId }
  if (invocationId) query.invocation = invocationId
  await router.replace({
    path: `/agents/${agentId.value}`,
    query,
  })
}

/**
 * 读取 query 中的单值字符串。
 *
 * @param value Vue Router query 值。
 * @returns 字符串或 undefined。
 */
function queryValue(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * 判断 invocation 是否仍占用会话。
 *
 * @param status invocation 状态。
 * @returns 是否活动。
 */
function isActiveStatus(status: string) {
  return ['queued', 'running', 'waiting'].includes(status)
}

/**
 * 读取 SSE payload 中的字符串字段。
 *
 * @param event 事件。
 * @param key payload 字段。
 * @returns 字符串或 undefined。
 */
function payloadString(event: AgentInvocationEventDto, key: string) {
  const value = event.payload[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * 创建可选的请求幂等键。
 *
 * @returns UUID 或 undefined。
 */
function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.()
}

/**
 * 从 API 异常提取可读文案。
 *
 * @param error 未知异常。
 * @param fallback 默认文案。
 * @returns 错误文案。
 */
function requestError(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

/**
 * 查询模型展示名。
 *
 * @param connectionId 模型连接 ID。
 * @returns 模型名或连接 ID。
 */
function modelLabel(connectionId: string) {
  return (
    models.value.find((model) => model.id === connectionId)?.model ??
    connectionId
  )
}

/**
 * 格式化 Agent 更新日期。
 *
 * @param value ISO 时间。
 * @returns 月日标签。
 */
function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}
</script>

<style scoped>
.agent-workbench-grid {
  display: none;
}

@media (min-width: 768px) {
  .agent-workbench-grid {
    display: grid;
    grid-template-columns: 200px 230px minmax(0, 1fr);
  }
}

@media (min-width: 1540px) {
  .agent-workbench-grid {
    grid-template-columns: 210px 250px minmax(0, 1fr) 340px;
  }
}

@media (min-width: 1540px) {
  .agent-settings-shortcut {
    display: none;
  }
}
</style>
