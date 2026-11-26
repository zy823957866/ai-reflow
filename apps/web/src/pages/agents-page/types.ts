import type {
  AgentConversationDto,
  AgentDefinitionDto,
  AgentDto,
  AgentInvocationDto,
  AgentInvocationEventDto,
  AgentMessageDto,
} from '@/services/reflowApi'

export type AgentMobilePane = 'agents' | 'conversations' | 'chat' | 'settings'

export interface AgentCreateDraft {
  name: string
  description: string
  modelConnectionId: string
  instructions: string
}

export interface AgentSavedInput {
  name: string
  description: string
  config: AgentDefinitionDto
}

export interface AgentWorkspaceState {
  agents: AgentDto[]
  activeAgent?: AgentDto
  conversations: AgentConversationDto[]
  activeConversation?: AgentConversationDto
  messages: AgentMessageDto[]
  invocation?: AgentInvocationDto
  invocationEvents: AgentInvocationEventDto[]
}

export interface ToolTimelineItem {
  id: string
  name: string
  status: 'running' | 'succeeded' | 'failed'
  summary: string
}
