export type NodePhase = 'P0' | 'P0.5' | 'P1'

export type FormWidget =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'json'
  | 'code'
  | 'file'
  | 'tags'
  | 'keyvalue'
  | 'conditions'
  | 'list'
  | 'schema'
  | 'model-picker'
  | 'mcp-server'
  | 'workflow-picker'
  | 'node-picker'

export interface HandleDef {
  id: string
  label: string
  kind: 'target' | 'source'
  description?: string
}

export interface SchemaField {
  name: string
  type: string
  required?: boolean
  description?: string
  format?: string
  itemsFormat?: string
}

export interface FileRef {
  id: string
  name: string
  mime: string
  size: number
  sha256?: string
}

export interface SelectOption {
  value: string
  label: string
  description?: string
}

export interface ManifestField {
  key: string
  label: string
  widget: FormWidget
  required?: boolean
  defaultValue?: unknown
  modes?: string[]
  group?: string
  help?: string
  sensitive?: boolean
  variable?: boolean
  options?: SelectOption[]
  placeholder?: string
  min?: number
  max?: number
  step?: number
  rows?: number
  language?: 'json' | 'sql' | 'javascript'
}

export interface NodeManifest {
  type: string
  version: string
  displayName: string
  description: string
  category: string
  icon: string
  color: string
  phase: NodePhase
  discriminator?: {
    key: 'mode' | 'kind' | 'operation' | 'entryMode'
    options: SelectOption[]
    default: string
  }
  inputs: HandleDef[]
  outputs: HandleDef[]
  outputFields: SchemaField[]
  configFields: ManifestField[]
  capabilities: Record<string, boolean>
  permissions: Record<string, unknown>
  examples: string[]
  runtime?: 'builtin' | 'declarative' | 'sandbox'
}

export interface NodeFormRegistration {
  kind: 'component' | 'schema' | 'fields'
  schema?: Record<string, unknown>
}

export interface NodeRegistration {
  manifest: NodeManifest
  form?: NodeFormRegistration
  component?: unknown
  examples?: Array<Record<string, unknown>>
}

export interface EdgeRegistration {
  type: string
  label: string
  animated?: boolean
  style?: Record<string, string | number>
  markerEnd?: boolean
}

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

export type WorkflowStatus = 'draft' | 'published' | 'reviewing' | 'archived' | 'error'

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
  forkOf?: {
    templateId: string
    version: string
  }
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

export type RunStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'waiting'

export type RunTrigger =
  | 'manual_preview'
  | 'manual_trial'
  | 'api'
  | 'mcp'
  | 'webhook'
  | 'schedule'
  | 'event'
  | 'replay'

export type NodeRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'waiting'

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
  runKind: 'preview' | 'production'
  trigger: RunTrigger
  status: RunStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: {
    code: string
    message: string
    nodeId?: string
  }
  definitionSnapshot?: WorkflowDefinition
  nodeRuns: NodeRun[]
  metadata: {
    tokens?: number
    cost?: number
    events?: number
    actor?: string
    [key: string]: unknown
  }
}

export interface RunEvent {
  seq: number
  type: string
  runId: string
  nodeId?: string
  attempt?: number
  status?: NodeRunStatus | RunStatus
  at: string
  payload?: Record<string, unknown>
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
  warnings?: ValidationIssue[]
}

export interface DesignerServices {
  loadModelOptions?: () => Promise<SelectOption[]>
  loadKnowledgeOptions?: () => Promise<SelectOption[]>
  loadMcpServers?: () => Promise<SelectOption[]>
  loadMcpTools?: (serverId: string) => Promise<SelectOption[]>
  loadWorkflowOptions?: () => Promise<SelectOption[]>
  uploadFile?: (file: File, onProgress?: (percent: number) => void) => Promise<FileRef>
  confirm?: (message: string) => Promise<boolean>
  notify?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface SaveResult {
  revision: number
  savedAt: string
}

export interface PublishResult {
  versionId: string
  version: number
  schemaHash?: string
}

export interface WorkflowDesignerPort {
  load(input: { workflowId: string; versionId?: string }): Promise<WorkflowDraft>
  save(input: {
    workflowId: string
    definition: WorkflowDefinition
    revision: number
    reason: 'autosave' | 'manual' | 'leave'
  }): Promise<SaveResult>
  validate(input: {
    workflowId: string
    definition: WorkflowDefinition
  }): Promise<ValidationResult>
  publish(input: {
    workflowId: string
    revision: number
    changelog?: string
  }): Promise<PublishResult>
  createPreviewRun(input: {
    workflowId: string
    definition: WorkflowDefinition
    input: Record<string, unknown>
  }): Promise<{ runId: string }>
  subscribeRun(input: {
    runId: string
    afterSeq?: number
    onEvent: (event: RunEvent) => void
    onError: (error: Error) => void
    onEnd: () => void
  }): () => void
  cancelRun?: (runId: string) => Promise<void>
}

export interface WorkflowDesignerProps {
  workflowId: string
  mode: 'edit' | 'preview' | 'readonly'
  port: WorkflowDesignerPort
  services?: DesignerServices
  initialVersionId?: string
  onDirtyChange?: (dirty: boolean) => void
  onSaved?: (result: SaveResult) => void
  onPublishRequested?: (result: PublishResult) => void
  onRunCreated?: (runId: string) => void
  onValidationChange?: (result: ValidationResult) => void
  onNodeSelected?: (nodeId: string | null) => void
}

export interface WorkflowDesignerHandle {
  flushSave(): Promise<void>
  undo(): void
  redo(): void
  fitView(): void
  focusNode(nodeId: string): void
  getDefinition(): WorkflowDefinition
  destroy(): void
}
