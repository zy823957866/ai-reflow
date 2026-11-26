import {
  AppError,
  compactJsonValue,
  redact,
  toRunError,
  type NodeRunStatus,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type WorkflowDefinition,
} from '@ai-reflow/core'
import type { DatabaseClient } from '../client'
import {
  iso,
  toNodeRuns,
  toRunEvent,
  toRunRecord,
  type NodeRunRow,
  type RunEventRow,
  type RunRow,
} from './dto'
import { jsonb, notFound, publicId, type Transaction } from './helpers'

export interface RunListQuery {
  workflowId?: string
  versionId?: string
  status?: string
  kind?: string
  trigger?: string
  search?: string
  limit?: number
}

export interface ClaimedRun {
  id: string
  publicId: string
  workspaceId: string
  workflowPublicId: string
  workflowVersionId: string | null
  definition: WorkflowDefinition
  runKind: RunRecord['runKind']
  trigger: RunRecord['trigger']
  input: Record<string, unknown>
  metadata: Record<string, unknown>
}

/**
 * 运行、节点、事件、取消和 worker 领取的数据访问层。
 */
export class RunRepository {
  /**
   * 创建使用当前 workspace 的运行仓库。
   * @param sql PostgreSQL 连接。
   * @param workspaceId 当前 workspace 内部 ID。
   */
  constructor(
    private readonly sql: DatabaseClient,
    private readonly workspaceId: string,
  ) {}

  /**
   * 查询运行列表。
   * @param query 工作流、版本、状态、类型和关键词筛选。
   * @returns 按创建时间倒序的运行 DTO。
   */
  async list(query: RunListQuery = {}): Promise<RunRecord[]> {
    const rows = await this.sql<RunRow[]>`
      select
        r.*, w.public_id as workflow_public_id, w.name as workflow_name,
        v.public_id as version_public_id, v.version
      from runs r
      join workflows w on w.id = r.workflow_id
      left join workflow_versions v on v.id = r.workflow_version_id
      where r.workspace_id = ${this.workspaceId}
      order by r.created_at desc
      limit ${Math.min(500, Math.max(1, query.limit ?? 200))}
    `
    const searchText = query.search?.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (query.workflowId && row.workflow_public_id !== query.workflowId) return false
      if (query.versionId && row.version_public_id !== query.versionId) return false
      if (query.status && row.status !== query.status) return false
      if (query.kind && row.run_kind !== query.kind) return false
      if (query.trigger && row.trigger !== query.trigger) return false
      if (!searchText) return true
      return (
        row.public_id.toLowerCase().includes(searchText) ||
        row.workflow_name.toLowerCase().includes(searchText) ||
        String(row.error?.code ?? '').toLowerCase().includes(searchText)
      )
    })
    if (!filtered.length) return []
    const nodeRows = await this.nodeRowsForRuns(filtered.map((row) => row.id))
    return filtered.map((row) =>
      toRunRecord(row, nodeRows.filter((node) => node.run_id === row.id)),
    )
  }

  /**
   * 读取单次运行与节点明细。
   * @param runId 外部运行 ID。
   * @returns 运行 DTO。
   */
  async get(runId: string): Promise<RunRecord> {
    const row = await this.requireRunRow(runId)
    const nodeRows = await this.sql<NodeRunRow[]>`
      select * from node_runs
      where workspace_id = ${this.workspaceId} and run_id = ${row.id}
      order by created_at, node_id, attempt
    `
    return toRunRecord(row, nodeRows)
  }

  /**
   * 查询单次运行的节点执行记录。
   * @param runId 外部运行 ID。
   * @returns 节点运行 DTO 列表。
   */
  async nodeRuns(runId: string) {
    const run = await this.requireRunRow(runId)
    const rows = await this.sql<NodeRunRow[]>`
      select * from node_runs
      where workspace_id = ${this.workspaceId} and run_id = ${run.id}
      order by created_at, node_id, attempt
    `
    return toNodeRuns(rows)
  }

  /**
   * 分页读取已落库的运行事件。
   * @param runId 外部运行 ID。
   * @param afterSeq 只返回大于该序号的事件。
   * @param limit 最大返回条数。
   * @returns 有序事件列表。
   */
  async eventsPage(runId: string, afterSeq = 0, limit = 200): Promise<RunEvent[]> {
    const run = await this.requireRunRow(runId)
    const rows = await this.sql<RunEventRow[]>`
      select
        e.seq, e.type, e.node_id, e.attempt, e.status, e.payload, e.created_at,
        ${runId}::text as run_public_id
      from run_events e
      where e.workspace_id = ${this.workspaceId}
        and e.run_id = ${run.id}
        and e.seq > ${afterSeq}
      order by e.seq
      limit ${Math.min(1000, Math.max(1, limit))}
    `
    return rows.map(toRunEvent)
  }

  /**
   * 取消排队中或运行中的任务。
   * @param runId 外部运行 ID。
   * @returns 更新后的跨运行状态。
   */
  async cancel(runId: string): Promise<{ runId: string; status: RunStatus }> {
    return this.sql.begin(async (transaction) => {
      const [run] = await transaction<RunRow[]>`
        select
          r.*, w.public_id as workflow_public_id, w.name as workflow_name,
          v.public_id as version_public_id, v.version
        from runs r
        join workflows w on w.id = r.workflow_id
        left join workflow_versions v on v.id = r.workflow_version_id
        where r.workspace_id = ${this.workspaceId}
          and r.public_id = ${runId}
        for update of r
      `
      if (!run) throw notFound('运行')
      if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        return { runId, status: run.status }
      }
      const status: RunStatus =
        run.status === 'queued' ? 'cancelled' : run.status
      await transaction`
        update runs
        set
          status = ${status},
          cancel_requested_at = now(),
          finished_at = case when ${status} = 'cancelled' then now() else finished_at end,
          duration_ms = case when ${status} = 'cancelled'
            then greatest(0, floor(extract(epoch from (now() - created_at)) * 1000))::int
            else duration_ms end,
          updated_at = now()
        where id = ${run.id}
      `
      if (status === 'cancelled') {
        await this.appendEventInTransaction(transaction, run.id, runId, {
          type: 'run.cancelled',
          status: 'cancelled',
          payload: { code: 'RUN_CANCELLED', message: '运行已取消。' },
        })
        await transaction`
          update node_runs
          set status = 'cancelled', finished_at = now(), updated_at = now()
          where run_id = ${run.id}
            and status in ('pending', 'running', 'waiting')
        `
      }
      return { runId, status }
    })
  }

  /**
   * 使用原定义快照和输入创建重放运行。
   * @param runId 原运行 ID。
   * @returns 新运行摘要。
   */
  async replay(runId: string) {
    const original = await this.requireRunRow(runId)
    const [created] = await this.sql<{ public_id: string }[]>`
      insert into runs (
        public_id, workspace_id, workflow_id, workflow_version_id,
        definition_snapshot, run_kind, trigger, status, input, metadata
      )
      values (
        ${publicId('run')}, ${this.workspaceId}, ${original.workflow_id},
        ${original.workflow_version_id}, ${jsonb(this.sql, original.definition_snapshot)},
        ${original.run_kind}, 'replay', 'queued', ${jsonb(this.sql, original.input)},
        ${jsonb(this.sql, {
          ...original.metadata,
          replayedFrom: original.public_id,
          frozenAt: new Date().toISOString(),
        })}
      )
      returning public_id
    `
    return {
      runId: created.public_id,
      workflowVersionId: original.version_public_id ?? undefined,
      runKind: original.run_kind,
      trigger: 'replay' as const,
      status: 'queued' as const,
      links: {
        detail: `/runs/${created.public_id}`,
        events: `/api/runs/${created.public_id}/events`,
      },
    }
  }

  /**
   * worker 使用 SKIP LOCKED 原子领取最早的排队运行。
   * @param workerId worker 实例标识。
   * @param leaseMs 租约毫秒数。
   * @returns 已领取运行或 null。
   */
  async claimNext(workerId: string, leaseMs = 60_000): Promise<ClaimedRun | null> {
    return this.sql.begin(async (transaction) => {
      const [locked] = await transaction<Array<{ id: string }>>`
        select id
        from runs
        where workspace_id = ${this.workspaceId}
          and status = 'queued'
        order by created_at
        for update skip locked
        limit 1
      `
      if (!locked) return null
      const [run] = await transaction<RunRow[]>`
        select
          r.*, w.public_id as workflow_public_id, w.name as workflow_name,
          v.public_id as version_public_id, v.version
        from runs r
        join workflows w on w.id = r.workflow_id
        left join workflow_versions v on v.id = r.workflow_version_id
        where r.workspace_id = ${this.workspaceId}
          and r.id = ${locked.id}
        limit 1
      `
      if (!run) return null
      await transaction`
        update runs
        set
          status = 'running',
          started_at = coalesce(started_at, now()),
          worker_id = ${workerId},
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          updated_at = now()
        where id = ${run.id}
      `
      return {
        id: run.id,
        publicId: run.public_id,
        workspaceId: this.workspaceId,
        workflowPublicId: run.workflow_public_id,
        workflowVersionId: run.version_public_id,
        definition: run.definition_snapshot,
        runKind: run.run_kind,
        trigger: run.trigger,
        input: run.input,
        metadata: run.metadata,
      }
    })
  }

  /**
   * 初始化运行中的节点记录与运行开始事件。
   * @param run 已领取运行。
   * @returns 开始事件。
   */
  async startClaimedRun(run: ClaimedRun) {
    for (const node of run.definition.nodes) {
      await this.sql`
        insert into node_runs (
          workspace_id, run_id, node_id, node_type, title, attempt, status
        )
        values (
          ${this.workspaceId}, ${run.id}, ${node.id}, ${node.type},
          ${node.title}, ${1}, 'pending'
        )
        on conflict (run_id, node_id, attempt) do nothing
      `
    }
    return this.appendEvent(run.publicId, {
      type: 'run.started',
      status: 'running',
      payload: { workerId: run.metadata.workerId ?? undefined },
    })
  }

  /**
   * 更新 worker 心跳租约并检查是否收到取消请求。
   * @param runId 运行内部 ID。
   * @param workerId worker 标识。
   * @returns 是否应中止执行。
   */
  async heartbeat(runId: string, workerId: string): Promise<boolean> {
    const [row] = await this.sql<Array<{ cancel_requested_at: Date | null }>>`
      update runs
      set
        lease_expires_at = now() + interval '60 seconds',
        updated_at = now()
      where id = ${runId}
        and status = 'running'
        and worker_id = ${workerId}
      returning cancel_requested_at
    `
    return Boolean(row?.cancel_requested_at)
  }

  /**
   * 追加运行事件、更新节点投影并做统一脱敏。
   * @param runPublicId 外部运行 ID。
   * @param event 事件数据。
   * @returns 已落库事件。
   */
  async appendEvent(
    runPublicId: string,
    event: Omit<RunEvent, 'seq' | 'runId' | 'at'>,
  ): Promise<RunEvent> {
    return this.sql.begin(async (transaction) => {
      const [run] = await transaction<Array<{ id: string; workspace_id: string }>>`
        select id, workspace_id
        from runs
        where workspace_id = ${this.workspaceId} and public_id = ${runPublicId}
        for update
      `
      if (!run) throw notFound('运行')
      const row = await this.appendEventInTransaction(
        transaction,
        run.id,
        runPublicId,
        event,
      )
      await this.updateNodeProjection(transaction, run.id, event)
      return row
    })
  }

  /**
   * 在已有事务中分配序号并写入事件。
   * @param transaction 当前事务。
   * @param runInternalId 运行内部 UUID。
   * @param runPublicId 外部运行 ID。
   * @param event 事件数据。
   * @returns 已落库事件。
   */
  private async appendEventInTransaction(
    transaction: Transaction,
    runInternalId: string,
    runPublicId: string,
    event: Omit<RunEvent, 'seq' | 'runId' | 'at'>,
  ): Promise<RunEvent> {
    const [latest] = await transaction<{ seq: number }[]>`
      select coalesce(max(seq), 0)::int as seq
      from run_events
      where run_id = ${runInternalId}
    `
    const seq = latest.seq + 1
    const payload = redact(compactJsonValue(event.payload))
    const [row] = await transaction<RunEventRow[]>`
      insert into run_events (
        workspace_id, run_id, seq, type, node_id, attempt, status, payload
      )
      values (
        ${this.workspaceId}, ${runInternalId}, ${seq}, ${event.type},
        ${event.nodeId ?? null}, ${event.attempt ?? null},
        ${event.status ?? null}, ${jsonb(transaction, payload)}
      )
      returning seq, type, node_id, attempt, status, payload, created_at
    `
    return toRunEvent({ ...row, run_public_id: runPublicId })
  }

  /**
   * 按节点事件同步 node_runs 状态、输出、trace 和错误。
   * @param transaction 当前事务。
   * @param runId 运行内部 UUID。
   * @param event 节点事件。
   */
  private async updateNodeProjection(
    transaction: Transaction,
    runId: string,
    event: Omit<RunEvent, 'seq' | 'runId' | 'at'>,
  ) {
    if (!event.nodeId) return
    const nodeId = event.nodeId
    const attempt = event.attempt ?? 1
    const payload = event.payload
    const execution = payload.output && typeof payload.output === 'object'
      ? payload.output as Record<string, unknown>
      : {}
    const output = execution.output
    const branch = typeof execution.handle === 'string' ? execution.handle : null
    const trace = Array.isArray(payload.trace) ? payload.trace : []
    const error = payload.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
      : null
    if (event.type === 'node.started') {
      await transaction`
        insert into node_runs (
          workspace_id, run_id, node_id, node_type, title, attempt, status,
          started_at, updated_at
        )
        values (
          ${this.workspaceId}, ${runId}, ${nodeId}, ${String(payload.type ?? 'unknown')},
          ${String(payload.title ?? nodeId)}, ${attempt}, 'running', now(), now()
        )
        on conflict (run_id, node_id, attempt) do update
        set status = 'running', started_at = coalesce(node_runs.started_at, now()),
          updated_at = now()
      `
      return
    }
    const terminal = ['node.succeeded', 'node.failed', 'node.skipped', 'node.cancelled']
    if (!terminal.includes(event.type)) return
    await transaction`
      update node_runs
      set
        status = ${event.status ?? 'failed'},
        output = ${output === undefined ? transaction`output` : jsonb(transaction, output)},
        error = ${error ? jsonb(transaction, error) : transaction`error`},
        trace = ${jsonb(transaction, trace)},
        usage = ${jsonb(transaction, payload.usage ?? execution.usage ?? {})},
        branch = ${branch},
        finished_at = now(),
        duration_ms = ${typeof payload.durationMs === 'number' ? payload.durationMs : null},
        updated_at = now()
      where run_id = ${runId}
        and node_id = ${nodeId}
        and attempt = ${attempt}
    `
  }

  /**
   * 完成运行并持久化终态、输出、错误和 usage。
   * @param runId 运行内部 ID。
   * @param result 引擎返回结果。
   */
  async completeRun(
    runId: string,
    result: {
      status: 'succeeded' | 'failed' | 'cancelled'
      output?: Record<string, unknown>
      error?: unknown
      usage?: Record<string, unknown>
    },
  ) {
    const error = result.error ? toRunError(result.error) : null
    await this.sql`
      update runs
      set
        status = ${result.status},
        output = ${result.output ? jsonb(this.sql, redact(result.output)) : null},
        error = ${error ? jsonb(this.sql, redact(error)) : null},
        metadata = metadata || ${jsonb(this.sql, { usage: result.usage ?? {} })},
        finished_at = now(),
        duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000))::int,
        lease_expires_at = null,
        updated_at = now()
      where id = ${runId}
    `
  }

  /**
   * 标记运行引擎异常并释放租约。
   * @param runId 运行内部 ID。
   * @param error 原始异常。
   */
  async failClaimedRun(runId: string, error: unknown) {
    const normalized = toRunError(error)
    await this.sql`
      update runs
      set
        status = 'failed',
        error = ${jsonb(this.sql, normalized)},
        finished_at = now(),
        duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at)) * 1000))::int,
        lease_expires_at = null,
        updated_at = now()
      where id = ${runId}
        and status = 'running'
    `
  }

  /**
   * 批量查询多次运行的节点记录。
   * @param runIds 运行内部 UUID 列表。
   * @returns 节点记录。
   */
  private async nodeRowsForRuns(runIds: string[]) {
    return this.sql<NodeRunRow[]>`
      select * from node_runs
      where workspace_id = ${this.workspaceId}
        and run_id = any(${runIds}::uuid[])
      order by created_at, node_id, attempt
    `
  }

  /**
   * 通过外部 ID 读取运行及工作流/版本投影。
   * @param publicId 外部运行 ID。
   * @returns 运行数据库记录。
   */
  async requireRunRow(publicId: string): Promise<RunRow> {
    const [row] = await this.sql<RunRow[]>`
      select
        r.*, w.public_id as workflow_public_id, w.name as workflow_name,
        v.public_id as version_public_id, v.version
      from runs r
      join workflows w on w.id = r.workflow_id
      left join workflow_versions v on v.id = r.workflow_version_id
      where r.workspace_id = ${this.workspaceId}
        and r.public_id = ${publicId}
      limit 1
    `
    if (!row) throw notFound('运行')
    return row
  }
}
