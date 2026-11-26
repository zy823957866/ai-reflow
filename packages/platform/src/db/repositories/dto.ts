import type {
  NodeRun,
  NodeRunStatus,
  RunEvent,
  RunRecord,
  WorkflowCard,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowStatus,
  WorkflowVersion,
} from '@ai-reflow/core'

export interface WorkflowRow {
  id: string
  public_id: string
  workspace_id: string
  name: string
  slug: string
  description: string
  status: WorkflowStatus
  tags: string[]
  owner: WorkflowCard['owner']
  draft_definition: WorkflowDefinition
  revision: number
  published_version_id: string | null
  published_version_public_id?: string | null
  published_version: number | null
  created_at: Date
  updated_at: Date
}

export interface VersionRow {
  id: string
  public_id: string
  workspace_id: string
  workflow_id: string
  workflow_public_id?: string
  version: number
  definition: WorkflowDefinition
  schema_hash: string
  manifest_snapshot: Array<Record<string, unknown>>
  node_count: number
  changelog: string
  created_by: string
  created_at: Date
}

export interface RunRow {
  id: string
  public_id: string
  workspace_id: string
  workflow_id: string
  workflow_public_id: string
  workflow_name: string
  workflow_version_id: string | null
  version_public_id: string | null
  version: number | null
  definition_snapshot: WorkflowDefinition
  run_kind: RunRecord['runKind']
  trigger: RunRecord['trigger']
  status: RunRecord['status']
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: RunRecord['error'] | null
  metadata: RunRecord['metadata'] & Record<string, unknown>
  cancel_requested_at: Date | null
  started_at: Date | null
  finished_at: Date | null
  duration_ms: number | null
  worker_id: string | null
  lease_expires_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface NodeRunRow {
  id: string
  run_id: string
  node_id: string
  node_type: string
  title: string
  attempt: number
  status: NodeRunStatus
  input: unknown
  output: unknown
  error: NodeRun['error'] | null
  trace: Array<Record<string, unknown>>
  usage: Record<string, unknown>
  branch: string | null
  started_at: Date | null
  finished_at: Date | null
  duration_ms: number | null
}

export interface RunEventRow {
  run_public_id: string
  seq: number
  type: string
  node_id: string | null
  attempt: number | null
  status: RunEvent['status'] | null
  payload: Record<string, unknown>
  created_at: Date
}

/**
 * 将数据库时间转换为 API 使用的 ISO 字符串。
 * @param value 可空日期。
 * @returns ISO 时间或 undefined。
 */
export function iso(value: Date | string | null | undefined) {
  if (!value) return undefined
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

/**
 * 把草稿定义投影为首页缩略图。
 * @param definition 工作流定义。
 * @returns 只含节点类型、坐标和边索引的投影。
 */
export function previewGraph(definition: WorkflowDefinition) {
  const indexMap = new Map(definition.nodes.map((node, index) => [node.id, index]))
  return {
    nodes: definition.nodes.map((node) => ({ type: node.type, x: node.x, y: node.y })),
    edges: definition.edges
      .filter((edge) => indexMap.has(edge.source) && indexMap.has(edge.target))
      .map((edge) => ({
        from: indexMap.get(edge.source)!,
        to: indexMap.get(edge.target)!,
      })),
  }
}

/**
 * 将工作流数据库记录映射为编辑器草稿 DTO。
 * @param row 工作流记录。
 * @returns 前端草稿 DTO。
 */
export function toWorkflowDraft(row: WorkflowRow): WorkflowDraft {
  return {
    workflowId: row.public_id,
    name: row.name,
    description: row.description,
    status: row.status,
    tags: row.tags,
    revision: row.revision,
    savedAt: iso(row.updated_at)!,
    publishedVersionId: row.published_version_public_id ?? undefined,
    publishedVersion: row.published_version ?? undefined,
    definition: row.draft_definition,
  }
}

/**
 * 将发布版本数据库记录映射为前端 DTO。
 * @param row 版本记录。
 * @param currentVersionId 当前发布版本内部 ID。
 * @returns 不可变版本 DTO。
 */
export function toWorkflowVersion(
  row: VersionRow,
  currentVersionId?: string | null,
): WorkflowVersion {
  return {
    id: row.public_id,
    workflowId: row.workflow_public_id ?? row.workflow_id,
    version: row.version,
    createdAt: iso(row.created_at)!,
    changelog: row.changelog,
    schemaHash: row.schema_hash,
    nodeCount: row.node_count,
    definition: row.definition,
    isCurrent: row.id === currentVersionId,
  }
}

/**
 * 将节点运行记录映射为前端 DTO。
 * @param row 节点运行记录。
 * @returns 节点运行 DTO。
 */
export function toNodeRun(row: NodeRunRow): NodeRun {
  return {
    nodeId: row.node_id,
    title: row.title,
    type: row.node_type,
    status: row.status,
    attempt: row.attempt,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms ?? undefined,
    input: row.input,
    output: row.output,
    error: row.error
      ? { code: row.error.code, message: row.error.message }
      : undefined,
    trace: normalizeTrace(row.trace),
    usage: row.usage,
    branch: row.branch ?? undefined,
  }
}

/**
 * 将同一节点的多次执行记录聚合为单个节点 DTO。
 *
 * @param rows 同一节点按 attempt 升序排列的数据库记录。
 * @returns 包含全部 attempt 与最终 attempt 摘要的节点 DTO。
 */
export function toAggregatedNodeRun(rows: NodeRunRow[]): NodeRun {
  const attempts = rows.map((row) => ({
    attempt: row.attempt,
    status: row.status,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms ?? undefined,
    input: row.input,
    output: row.output,
    error: row.error
      ? { code: row.error.code, message: row.error.message }
      : undefined,
    trace: normalizeTrace(row.trace),
    usage: row.usage,
    branch: row.branch ?? undefined,
  }))
  const latest = rows.at(-1)
  if (!latest) {
    throw new Error('节点运行聚合至少需要一条记录。')
  }
  return {
    ...toNodeRun(latest),
    attempts,
  }
}

/**
 * 按 nodeId 聚合同次运行的全部 attempt。
 *
 * @param rows 节点运行数据库记录。
 * @returns 每个节点一条 DTO，并保持首次出现顺序。
 */
export function toNodeRuns(rows: NodeRunRow[]): NodeRun[] {
  const groups = new Map<string, NodeRunRow[]>()
  rows.forEach((row) => {
    const group = groups.get(row.node_id) ?? []
    group.push(row)
    groups.set(row.node_id, group)
  })
  return [...groups.values()].map((group) =>
    toAggregatedNodeRun(
      group.slice().sort((left, right) => left.attempt - right.attempt),
    ),
  )
}

/**
 * 将数据库 trace 条目转换为前端阶段结构。
 *
 * @param trace JSONB 中保存的阶段记录。
 * @returns 前端可渲染的阶段列表。
 */
function normalizeTrace(trace: Array<Record<string, unknown>>) {
  return trace.map((phase) => ({
    phase: String(phase.phase ?? 'execute'),
    status: String(phase.status ?? 'succeeded') as NodeRunStatus,
    startedAt: typeof phase.startedAt === 'string' ? phase.startedAt : undefined,
    finishedAt: typeof phase.finishedAt === 'string' ? phase.finishedAt : undefined,
    durationMs: typeof phase.durationMs === 'number' ? phase.durationMs : undefined,
    detail:
      phase.detail && typeof phase.detail === 'object'
        ? (phase.detail as Record<string, unknown>)
        : undefined,
  }))
}

/**
 * 将运行记录和节点明细映射为前端 DTO。
 * @param row 运行记录。
 * @param nodeRuns 节点记录。
 * @returns 运行 DTO。
 */
export function toRunRecord(row: RunRow, nodeRuns: NodeRunRow[]): RunRecord {
  return {
    id: row.public_id,
    workflowId: row.workflow_public_id,
    workflowName: row.workflow_name,
    versionId: row.version_public_id ?? undefined,
    version: row.version ?? undefined,
    runKind: row.run_kind,
    trigger: row.trigger,
    status: row.status,
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms ?? undefined,
    input: row.input,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    definitionSnapshot: row.definition_snapshot,
    nodeRuns: toNodeRuns(nodeRuns),
    metadata: row.metadata,
  }
}

/**
 * 将事件数据库记录映射为 SSE/分页 DTO。
 * @param row 事件记录。
 * @returns 运行事件 DTO。
 */
export function toRunEvent(row: RunEventRow): RunEvent {
  return {
    seq: row.seq,
    type: row.type,
    runId: row.run_public_id,
    nodeId: row.node_id ?? undefined,
    attempt: row.attempt ?? undefined,
    status: row.status ?? undefined,
    at: iso(row.created_at)!,
    payload: row.payload,
  }
}
