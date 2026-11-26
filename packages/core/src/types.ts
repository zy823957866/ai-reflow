import type { AgentRuntimePort } from './agent'

export type WorkflowStatus = 'draft' | 'published' | 'reviewing' | 'archived' | 'error'

export type RunKind = 'preview' | 'production'

export type RunTrigger =
  | 'manual_preview'
  | 'manual_trial'
  | 'api'
  | 'mcp'
  | 'webhook'
  | 'schedule'
  | 'event'
  | 'replay'

export type RunStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'waiting'

export type NodeRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'waiting'

export interface WorkflowNode {
  id: string
  type: string
  title: string
  x: number
  y: number
  config: Record<string, unknown>
  manifestVersion?: string
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  type?: string
}

export interface WorkflowDefinition {
  schemaVersion: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowDraft {
  workflowId: string
  name: string
  description: string
  status: WorkflowStatus
  tags: string[]
  revision: number
  savedAt: string
  publishedVersionId?: string
  publishedVersion?: number
  definition: WorkflowDefinition
}

export interface WorkflowCard {
  id: string
  name: string
  description: string
  status: WorkflowStatus
  tags: string[]
  owner: { id: string; name: string; initials: string }
  nodeCount: number
  runCount: number
  successRate: number
  updatedAt: string
  publishedVersion?: number
  publishedVersionId?: string
  lastRun?: {
    runId: string
    status: RunStatus
    at: string
  }
  previewGraph: {
    nodes: Array<{ type: string; x: number; y: number }>
    edges: Array<{ from: number; to: number }>
  }
}

export interface WorkflowVersion {
  id: string
  workflowId: string
  version: number
  createdAt: string
  changelog: string
  schemaHash: string
  nodeCount: number
  definition: WorkflowDefinition
  isCurrent?: boolean
}

export interface TracePhase {
  phase: string
  status: NodeRunStatus
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  detail?: Record<string, unknown>
}

export interface NodeRunAttempt {
  attempt: number
  status: NodeRunStatus
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  input?: unknown
  output?: unknown
  error?: {
    code: string
    message: string
  }
  trace?: TracePhase[]
  usage?: Record<string, unknown>
  branch?: string
}

export interface NodeRun {
  nodeId: string
  title: string
  type: string
  status: NodeRunStatus
  attempt?: number
  attempts?: NodeRunAttempt[]
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  input?: unknown
  output?: unknown
  error?: {
    code: string
    message: string
  }
  trace?: TracePhase[]
  usage?: Record<string, unknown>
  branch?: string
}

export interface RunRecord {
  id: string
  workflowId: string
  workflowName: string
  versionId?: string
  version?: number
  runKind: RunKind
  trigger: Exclude<RunTrigger, 'replay'> | 'replay'
  status: RunStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: RunError
  definitionSnapshot?: WorkflowDefinition
  nodeRuns: NodeRun[]
  metadata: Record<string, unknown>
}

export interface ValidationIssue {
  code: string
  message: string
  nodeId?: string
  edgeId?: string
  field?: string
  severity?: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface RunError {
  code: string
  message: string
  nodeId?: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface RunEvent {
  seq: number
  type: string
  runId: string
  nodeId?: string
  attempt?: number
  status?: NodeRunStatus | RunStatus
  at: string
  payload: Record<string, unknown>
}

export interface NodeExecutionContext {
  currentNodeId?: string
  runId: string
  attempt?: number
  workspaceId: string
  workflowId: string
  workflowVersionId?: string
  runKind: RunKind
  trigger: RunTrigger
  input: Record<string, unknown>
  variables: Record<string, unknown>
  outputs: Record<string, unknown>
  services?: NodeRuntimeServices
  signal: AbortSignal
  emit: (event: Omit<RunEvent, 'seq' | 'runId' | 'at'>) => Promise<void>
}

export interface KnowledgeContextChunk {
  id: string
  documentId: string
  documentName: string
  chunkIndex: number
  text: string
  metadata: Record<string, unknown>
  score: number
  citationId?: string
  location?: string
  knowledgeBaseId?: string
  fulltextScore?: number
  vectorScore?: number
}

export interface KnowledgeContextCitation {
  id: string
  chunkId: string
  documentId: string
  documentName: string
  chunkIndex: number
  location: string
  score: number
}

export interface NodeRuntimeServices {
  llm?: {
    generate(input: {
      connectionId: string
      model?: string
      systemPrompt?: string
      prompt: string
      temperature?: number
      maxTokens?: number
      responseFormat?: 'text' | 'json_object'
      signal?: AbortSignal
    }): Promise<{
      text: string
      structured?: Record<string, unknown>
      usage?: Record<string, unknown>
      model?: string
    }>
  }
  mcp?: {
    call(input: {
      serverId: string
      toolName: string
      arguments: Record<string, unknown>
      timeoutMs?: number
      signal?: AbortSignal
    }): Promise<Record<string, unknown>>
  }
  knowledge?: {
    retrieve(input: {
      knowledgeBaseIds: string[]
      query: string
      topK: number
      scoreThreshold: number
      retrievalMode?: 'vector' | 'keyword' | 'hybrid'
      signal?: AbortSignal
    }): Promise<{
      chunks: KnowledgeContextChunk[]
      citations: KnowledgeContextCitation[]
      context: string
      total: number
      warnings?: string[]
    }>
  }
  agent?: AgentRuntimePort
}

export interface NodeExecutionResult {
  output: Record<string, unknown>
  handle?: string
}

export interface WorkflowRunResult {
  status: 'succeeded' | 'failed' | 'cancelled'
  output?: Record<string, unknown>
  error?: RunError
  nodeOutputs: Record<string, unknown>
  usage?: Record<string, unknown>
}
