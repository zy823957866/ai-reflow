import { z } from 'zod'

export type AgentMemoryMode = 'none' | 'conversation' | 'run'

export interface AgentKnowledgeConfig {
  knowledgeBaseIds: string[]
  topK: number
  scoreThreshold: number
  retrievalMode: 'vector' | 'keyword' | 'hybrid'
}

export interface AgentMcpToolConfig {
  serverId: string
  toolName: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface AgentDefinition {
  instructions: string
  inputExpression?: string
  modelConnectionId: string
  model?: string
  temperature?: number
  maxTokens?: number
  knowledge?: AgentKnowledgeConfig
  mcpTools: AgentMcpToolConfig[]
  maxSteps: number
  timeoutMs: number
  outputSchema?: Record<string, unknown>
  memory: {
    mode: AgentMemoryMode
  }
}

export interface AgentConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: AgentCitation[]
  createdAt?: string
}

export interface AgentCitation {
  id?: string
  chunkId?: string
  documentId: string
  documentName: string
  chunkIndex?: number
  location?: string
  score?: number
  [key: string]: unknown
}

export type AgentFinishReason =
  | 'complete'
  | 'max_steps'
  | 'cancelled'
  | 'error'

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'started' | 'succeeded' | 'failed'
  idempotencyKey?: string
  result?: unknown
  error?: {
    code: string
    message: string
    retryable?: boolean
  }
  startedAt?: string
  finishedAt?: string
}

export interface AgentStep {
  index: number
  type: 'model' | 'tool' | 'knowledge' | 'finalize'
  status: 'started' | 'succeeded' | 'failed' | 'skipped'
  summary?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  usage?: Record<string, unknown>
  detail?: Record<string, unknown>
}

export interface AgentRuntimeEvent {
  type:
    | 'message.delta'
    | 'message.completed'
    | 'tool.started'
    | 'tool.output'
    | 'tool.failed'
    | 'model.completed'
    | 'invocation.interrupted'
    | 'invocation.resumed'
    | 'invocation.completed'
    | 'invocation.failed'
    | 'invocation.cancelled'
  payload: Record<string, unknown>
}

export interface AgentInvokeInput {
  invocationId: string
  workspaceId: string
  runId?: string
  nodeId?: string
  conversationId?: string
  kind: 'chat' | 'workflow_node' | 'external'
  threadId: string
  definition: AgentDefinition
  input: Record<string, unknown>
  history?: AgentConversationMessage[]
  resumeCheckpointId?: string
  signal: AbortSignal
  emit?: (event: AgentRuntimeEvent) => Promise<void>
}

export interface AgentInvokeResult {
  text: string
  messages: AgentConversationMessage[]
  steps: AgentStep[]
  toolCalls: AgentToolCall[]
  citations: AgentCitation[]
  usage: Record<string, unknown>
  finishReason: AgentFinishReason
  structured?: Record<string, unknown>
  resumeCheckpointId?: string
}

export interface AgentResumeInput extends AgentInvokeInput {
  checkpointId?: string
}

export interface AgentRuntimePort {
  invoke(input: AgentInvokeInput): Promise<AgentInvokeResult>
  resume?(input: AgentResumeInput): Promise<AgentInvokeResult>
  cancel?(invocationId: string): Promise<void>
}

const agentMemoryModeSchema = z.enum(['none', 'conversation', 'run'])

const agentKnowledgeSchema = z.object({
  knowledgeBaseIds: z.array(z.string().trim().min(1)).min(1).max(20),
  topK: z.number().int().min(1).max(20).default(5),
  scoreThreshold: z.number().min(0).max(1).default(0.3),
  retrievalMode: z
    .enum(['vector', 'keyword', 'hybrid'])
    .default('hybrid'),
})

const agentMcpToolSchema = z.object({
  serverId: z.string().trim().min(1).max(200),
  toolName: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
})

export const agentDefinitionSchema = z.object({
  instructions: z.string().trim().min(1).max(20_000),
  inputExpression: z.string().trim().max(5000).optional(),
  modelConnectionId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  knowledge: agentKnowledgeSchema.optional(),
  mcpTools: z.array(agentMcpToolSchema).max(20).optional().default([]),
  maxSteps: z.number().int().min(1).max(32).default(8),
  timeoutMs: z.number().int().min(1000).max(3_600_000).default(120_000),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  memory: z
    .object({
      mode: agentMemoryModeSchema.default('run'),
    })
    .optional()
    .default({ mode: 'run' }),
})
