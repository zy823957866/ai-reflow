import {
  getNodeRegistration,
  getNodeRegistrations,
} from '@/shared/registry'
import { registerBuiltinNodes } from '@/shared/nodes'
import type {
  NodeRun,
  RunEvent,
  RunRecord,
  ValidationIssue,
  ValidationResult,
  WorkflowCard,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowEdge,
  WorkflowNode,
  WorkflowStatus,
  WorkflowVersion,
} from '@/shared/types'

registerBuiltinNodes()

const STORAGE_KEY = 'reflow_demo_state_v1'
const HOUR = 60 * 60 * 1000
const now = Date.now()
const iso = (offset = 0) => new Date(now - offset).toISOString()

/**
 * 生成带前缀的演示 ID。
 * @param prefix ID 前缀。
 * @returns 随机短 ID。
 */
function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建带节点默认配置的演示节点。
 * @param type 节点类型。
 * @param id 节点 ID。
 * @param title 节点标题。
 * @param x 横坐标。
 * @param y 纵坐标。
 * @param config 覆盖默认值的配置。
 * @returns 工作流节点。
 */
function makeNode(
  type: string,
  id: string,
  title: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
): WorkflowNode {
  const registration = getNodeRegistration(type)
  const defaults: Record<string, unknown> = {}
  if (registration?.manifest.discriminator) {
    defaults[registration.manifest.discriminator.key] = registration.manifest.discriminator.default
  }
  registration?.manifest.configFields.forEach((field) => {
    if (field.defaultValue !== undefined) {
      defaults[field.key] = structuredClone(field.defaultValue)
    }
  })
  return {
    id,
    type,
    title,
    x,
    y,
    config: { ...defaults, ...config },
    manifestVersion: registration?.manifest.version ?? '1.0.0',
  }
}

/**
 * 创建演示连线。
 * @param id 连线 ID。
 * @param source 源节点 ID。
 * @param target 目标节点 ID。
 * @param sourceHandle 源端口。
 * @param label 连线标签。
 * @param type 连线类型。
 * @returns 工作流连线。
 */
function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle = 'out',
  label?: string,
  type = 'default',
): WorkflowEdge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle: 'in',
    label,
    type,
  }
}

const supportDefinition: WorkflowDefinition = {
  schemaVersion: '1.0',
  name: '客服知识问答',
  nodes: [
    makeNode('start', 'n_start', '开始', 46, 290, {
      entryMode: 'manual',
      inputSchema: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', title: '问题' },
          locale: { type: 'string', title: '语言', default: 'zh-CN' },
          files: { type: 'array', title: '附件' },
        },
      },
    }),
    makeNode('knowledge', 'n_kb', '知识库检索', 310, 110, {
      operation: 'retrieve',
      knowledgeBaseId: ['kb_product_docs'],
      query: '{{ $input.question }}',
      topK: 5,
      scoreThreshold: 0.62,
    }),
    makeNode('tool', 'n_tool', '订单查询', 310, 286, {
      kind: 'mcp',
      serverId: 'mcp_github',
      toolName: 'search_issues',
      arguments: { query: '{{ $input.question }}', limit: 10 },
    }),
    makeNode('llm', 'n_llm', '生成回答', 568, 216, {
      mode: 'generate',
      modelConnectionId: 'mc_openai_gpt4o',
      temperature: 0.7,
      maxTokens: 2048,
      systemPrompt: '你是 Acme 的资深客服，只依据资料回答用户。资料：{{ $node.n_kb.output.context }}',
      prompt: '{{ $input.question }}',
    }),
    makeNode('condition', 'n_condition', '置信度判断', 824, 216, {
      mode: 'binary',
      conditions: [
        {
          left: '{{ $node.n_llm.output.text }}',
          operator: 'contains',
          right: 'UNKNOWN',
        },
      ],
    }),
    makeNode('template', 'n_template', '回复模板', 560, 416, {
      template: '根据 {{ $node.n_kb.output.context }} 回答 {{ $input.question }}。',
      parser: 'text',
    }),
    makeNode('human', 'n_human', '转人工坐席', 824, 416, {
      mode: 'approval',
      title: '请补充缺失信息',
      description: '回答置信度不足，转人工继续处理。',
    }),
    makeNode('output', 'n_output', '回复用户', 1080, 210, {
      mode: 'chat_response',
      content: '{{ $node.n_llm.output.text }}',
    }),
    makeNode('variable', 'n_var', '更新客户上下文', 80, 490, {
      mode: 'assign',
      assignments: { customer_tier: 'standard' },
    }),
  ],
  edges: [
    makeEdge('e_start_kb', 'n_start', 'n_kb', 'out'),
    makeEdge('e_start_tool', 'n_start', 'n_tool', 'out'),
    makeEdge('e_kb_llm', 'n_kb', 'n_llm', 'out'),
    makeEdge('e_tool_llm', 'n_tool', 'n_llm', 'out'),
    makeEdge('e_llm_condition', 'n_llm', 'n_condition', 'out'),
    makeEdge('e_condition_template', 'n_condition', 'n_template', 'false', 'false', 'branch'),
    makeEdge('e_condition_output', 'n_condition', 'n_output', 'true', 'true', 'branch'),
    makeEdge('e_condition_human', 'n_condition', 'n_human', 'default', 'UNKNOWN', 'branch'),
    makeEdge('e_template_output', 'n_template', 'n_output', 'out'),
    makeEdge('e_human_output', 'n_human', 'n_output', 'approved', 'approved', 'branch'),
    makeEdge('e_start_var', 'n_start', 'n_var', 'out'),
  ],
}

const leadDefinition: WorkflowDefinition = {
  schemaVersion: '1.0',
  name: '销售线索评分',
  nodes: [
    makeNode('start', 'lead_start', '接收线索', 40, 150, {
      entryMode: 'webhook',
      webhookPath: 'leads/inbound',
    }),
    makeNode('tool', 'lead_tool', '拉取 CRM 信息', 300, 150, {
      kind: 'http',
      url: 'https://crm.example.com/api/leads',
      method: 'POST',
      headers: { Authorization: 'secret://crm' },
    }),
    makeNode('llm', 'lead_llm', 'BANT 维度评分', 560, 150, {
      mode: 'structured',
      modelConnectionId: 'mc_openai_gpt4o',
      prompt: '分析线索并输出 BANT 评分：{{ $node.lead_tool.output.result }}',
    }),
    makeNode('variable', 'lead_var', '写入评分', 820, 150, {
      mode: 'assign',
      assignments: { score: '{{ $node.lead_llm.output.structured.score }}' },
    }),
    makeNode('output', 'lead_out', '返回 CRM', 1060, 150, {
      mode: 'api_response',
    }),
  ],
  edges: [
    makeEdge('lead_e1', 'lead_start', 'lead_tool'),
    makeEdge('lead_e2', 'lead_tool', 'lead_llm'),
    makeEdge('lead_e3', 'lead_llm', 'lead_var'),
    makeEdge('lead_e4', 'lead_var', 'lead_out'),
  ],
}

const reportDefinition: WorkflowDefinition = {
  schemaVersion: '1.0',
  name: '周报生成流水线',
  nodes: [
    makeNode('start', 'report_start', '定时触发', 40, 180, { entryMode: 'manual' }),
    makeNode('parallel', 'report_parallel', '并发取数', 260, 180, {
      join: 'all',
      branches: [
        { id: 'jira', label: 'Jira' },
        { id: 'git', label: 'Git' },
      ],
    }),
    makeNode('tool', 'report_tool_a', '查询 Jira', 480, 90, {
      kind: 'http',
      url: 'https://jira.example.com/api',
    }),
    makeNode('tool', 'report_tool_b', '查询 Git', 480, 270, {
      kind: 'http',
      url: 'https://git.example.com/api',
    }),
    makeNode('llm', 'report_llm', '生成周报', 730, 180, {
      mode: 'generate',
      modelConnectionId: 'mc_openai_gpt4o',
      prompt: '根据 {{ $input.data }} 生成团队周报',
    }),
    makeNode('template', 'report_template', '排版', 960, 180),
    makeNode('output', 'report_out', '发送飞书', 1160, 180, {
      mode: 'workflow_output',
    }),
  ],
  edges: [
    makeEdge('report_e1', 'report_start', 'report_parallel'),
    makeEdge('report_e2', 'report_parallel', 'report_tool_a', 'join'),
    makeEdge('report_e3', 'report_parallel', 'report_tool_b', 'join'),
    makeEdge('report_e4', 'report_tool_a', 'report_llm'),
    makeEdge('report_e5', 'report_tool_b', 'report_llm'),
    makeEdge('report_e6', 'report_llm', 'report_template'),
    makeEdge('report_e7', 'report_template', 'report_out'),
  ],
}

/**
 * 按工作流 ID 选择种子定义并克隆。
 * @param workflowId 工作流 ID。
 * @param name 工作流名称。
 * @returns 独立的演示定义。
 */
function definitionFrom(workflowId: string, name: string): WorkflowDefinition {
  return {
    ...structuredClone(
      workflowId === 'wf_support' ? supportDefinition : workflowId === 'wf_lead_scoring' ? leadDefinition : reportDefinition,
    ),
    name,
  }
}

/**
 * 从定义生成卡片缩略图数据。
 * @param definition 工作流定义。
 * @returns 节点与相对连线索引。
 */
function previewGraph(definition: WorkflowDefinition) {
  const positions = definition.nodes.map((item) => ({ type: item.type, x: item.x, y: item.y }))
  const indexMap = new Map(definition.nodes.map((item, index) => [item.id, index]))
  return {
    nodes: positions,
    edges: definition.edges
      .filter((edge) => indexMap.has(edge.source) && indexMap.has(edge.target))
      .map((edge) => ({ from: indexMap.get(edge.source)!, to: indexMap.get(edge.target)! })),
  }
}

/**
 * 创建演示草稿。
 * @param id 工作流 ID。
 * @param name 名称。
 * @param description 描述。
 * @param status 状态。
 * @param tags 标签。
 * @param revision 修订号。
 * @param updatedOffset 更新时间偏移。
 * @param definition 工作流定义。
 * @param publishedVersion 当前发布版本。
 * @returns 工作流草稿。
 */
function makeDraft(
  id: string,
  name: string,
  description: string,
  status: WorkflowStatus,
  tags: string[],
  revision: number,
  updatedOffset: number,
  definition = definitionFrom(id, name),
  publishedVersion?: number,
): WorkflowDraft {
  return {
    workflowId: id,
    name,
    description,
    status,
    tags,
    revision,
    savedAt: iso(updatedOffset),
    publishedVersionId: publishedVersion ? `ver_${id.replace('wf_', '')}_${publishedVersion}` : undefined,
    publishedVersion,
    definition,
  }
}

type PersistedState = {
  drafts: WorkflowDraft[]
  versions: WorkflowVersion[]
  runs: RunRecord[]
  deletedWorkflows: string[]
}

/**
 * 生成覆盖成功、失败和运行中状态的演示运行。
 * @param drafts 演示草稿。
 * @returns 运行记录列表。
 */
function makeInitialRuns(drafts: WorkflowDraft[]): RunRecord[] {
  const baseStatuses: Array<RunRecord['status']> = ['succeeded', 'succeeded', 'failed', 'succeeded', 'running', 'succeeded']
  return baseStatuses.map((status, index) => {
    const draft = drafts[index % drafts.length]
    const nodeRuns = draft.definition.nodes.map((item, nodeIndex) => ({
      nodeId: item.id,
      title: item.title,
      type: item.type,
      status:
        status === 'failed' && nodeIndex === Math.min(4, draft.definition.nodes.length - 1)
          ? ('failed' as const)
          : status === 'running' && nodeIndex > 3
            ? ('pending' as const)
            : ('succeeded' as const),
      durationMs: 240 + nodeIndex * 310,
      error:
        status === 'failed' && nodeIndex === Math.min(4, draft.definition.nodes.length - 1)
          ? { code: 'LLM_TIMEOUT', message: '模型请求超过 30 秒。' }
          : undefined,
      attempts:
        status === 'failed' && nodeIndex === Math.min(4, draft.definition.nodes.length - 1)
          ? [
              {
                attempt: 1,
                status: 'failed' as const,
                durationMs: 30000,
                error: { code: 'LLM_TIMEOUT', message: '上游模型在 30 秒内未返回。' },
              },
              {
                attempt: 2,
                status: 'failed' as const,
                durationMs: 30400,
                error: { code: 'LLM_TIMEOUT', message: '重试后仍超过 30 秒。' },
              },
            ]
          : undefined,
    }))
    const version = draft.publishedVersion ?? 12
    return {
      id: `run_${Math.random().toString(16).slice(2, 10)}`,
      workflowId: draft.workflowId,
      workflowName: draft.name,
      versionId: `ver_${draft.workflowId.replace('wf_', '')}_${version}`,
      version,
      runKind: index % 4 === 0 ? 'preview' : 'production',
      trigger: index % 4 === 0 ? 'manual_preview' : index % 3 === 0 ? 'mcp' : 'manual_trial',
      status,
      createdAt: iso((index + 1) * 37 * 60 * 1000),
      startedAt: iso((index + 1) * 37 * 60 * 1000),
      finishedAt: status === 'running' ? undefined : iso((index + 1) * 37 * 60 * 1000 - 8000),
      durationMs: status === 'running' ? undefined : 8.2 + index,
      input: {
        question: index === 2 ? '如何申请企业版试用？' : '如何配置单点登录？',
      },
      output:
        status === 'succeeded'
          ? { text: '可在团队设置中配置 SAML SSO，并邀请成员加入。' }
          : undefined,
      error:
        status === 'failed'
          ? { code: 'LLM_TIMEOUT', message: '模型请求超时，已保留完成节点输出。', nodeId: nodeRuns[4]?.nodeId }
          : undefined,
      nodeRuns,
      metadata: {
        tokens: 2100 + index * 100,
        cost: 0.02,
        events: 26 + index * 6,
        actor: index % 2 ? '林一舟' : 'MCP · Claude',
      },
    }
  })
}

/**
 * 创建首次加载使用的持久化演示状态。
 * @returns 完整演示状态。
 */
function makeInitialState(): PersistedState {
  const drafts = [
    makeDraft(
      'wf_support',
      '客服知识问答',
      '基于产品文档的客服问答，含检索引用与低置信度转人工分支。',
      'published',
      ['P0', '知识库', 'MCP'],
      87,
      2 * 60 * 1000,
      supportDefinition,
      12,
    ),
    makeDraft(
      'wf_lead_scoring',
      '销售线索评分',
      '拉取 CRM 线索，抽取公司信息并按 BANT 维度输出评分。',
      'published',
      ['P0', 'HTTP'],
      42,
      3.4 * HOUR,
      leadDefinition,
      8,
    ),
    makeDraft(
      'wf_weekly_report',
      '周报生成流水线',
      '并行汇总多个数据源，模板渲染后推送至飞书与邮件。',
      'draft',
      ['P0', '并行', '定时'],
      16,
      26 * HOUR,
      reportDefinition,
    ),
    makeDraft(
      'wf_return_policy',
      '退货政策问答',
      '回答退货政策并生成标准工单回复。',
      'published',
      ['政策', '知识库'],
      31,
      2 * 24 * HOUR,
      supportDefinition,
      4,
    ),
    makeDraft(
      'wf_crm_sync',
      'CRM 客户信息同步',
      '清洗 CRM 客户信息并同步至内部数据库。',
      'reviewing',
      ['CRM', '数据库'],
      12,
      4 * 24 * HOUR,
      leadDefinition,
    ),
    makeDraft(
      'wf_campaign',
      '营销活动素材生成',
      '基于品牌上下文生成多版本活动文案。',
      'draft',
      ['AI', '模板'],
      5,
      5 * 24 * HOUR,
      reportDefinition,
    ),
  ]

  const versions: WorkflowVersion[] = []
  drafts.forEach((draft) => {
    if (draft.publishedVersion) {
      versions.push({
        id: draft.publishedVersionId!,
        workflowId: draft.workflowId,
        version: draft.publishedVersion,
        createdAt: iso((drafts.indexOf(draft) + 2) * 36 * HOUR),
        changelog: '优化低置信度转人工分支，补充模型超时提示。',
        schemaHash: `sha256:${draft.workflowId.slice(-6)}-${draft.publishedVersion}f2a`,
        nodeCount: draft.definition.nodes.length,
        definition: structuredClone(draft.definition),
        isCurrent: true,
      })
      if (draft.publishedVersion > 1) {
        versions.push({
          id: `ver_${draft.workflowId.replace('wf_', '')}_${draft.publishedVersion - 1}`,
          workflowId: draft.workflowId,
          version: draft.publishedVersion - 1,
          createdAt: iso((drafts.indexOf(draft) + 12) * 36 * HOUR),
          changelog: '首个可试运行版本。',
          schemaHash: `sha256:${draft.workflowId.slice(-6)}-${draft.publishedVersion - 1}a1b`,
          nodeCount: draft.definition.nodes.length,
          definition: structuredClone(draft.definition),
        })
      }
    }
  })

  return {
    drafts,
    versions,
    runs: makeInitialRuns(drafts),
    deletedWorkflows: [],
  }
}

/**
 * 从 localStorage 读取状态，损坏时恢复种子数据。
 * @returns 持久化状态。
 */
function readState(): PersistedState {
  if (typeof localStorage === 'undefined') return makeInitialState()
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initial = makeInitialState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
    return initial
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      drafts: parsed.drafts ?? makeInitialState().drafts,
      versions: parsed.versions ?? [],
      runs: parsed.runs ?? [],
      deletedWorkflows: parsed.deletedWorkflows ?? [],
    }
  } catch {
    const initial = makeInitialState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
    return initial
  }
}

/**
 * 写入状态并广播页面数据变化。
 * @param state 持久化状态。
 */
function writeState(state: PersistedState) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reflow:data-changed'))
  }
}

const runEvents = new Map<string, RunEvent[]>()
const runSubscribers = new Map<string, Set<(event: RunEvent) => void>>()
const runEndSubscribers = new Map<string, Set<() => void>>()
const activeTimers = new Map<string, number[]>()

/**
 * 追加运行事件并广播给 SSE 订阅者。
 * @param runId 运行 ID。
 * @param event 事件载荷。
 */
function emitRunEvent(runId: string, event: Omit<RunEvent, 'seq' | 'runId' | 'at'>) {
  const list = runEvents.get(runId) ?? []
  const next: RunEvent = {
    ...event,
    seq: list.length + 1,
    runId,
    at: new Date().toISOString(),
  }
  list.push(next)
  runEvents.set(runId, list)
  runSubscribers.get(runId)?.forEach((listener) => listener(next))
}

/**
 * 结束运行事件流并清理定时器。
 * @param runId 运行 ID。
 */
function finishRun(runId: string) {
  runEndSubscribers.get(runId)?.forEach((listener) => listener())
  runSubscribers.delete(runId)
  runEndSubscribers.delete(runId)
  activeTimers.get(runId)?.forEach((timer) => window.clearTimeout(timer))
  activeTimers.delete(runId)
}

/**
 * 持久化指定运行的部分字段。
 * @param runId 运行 ID。
 * @param patch 需要更新的字段。
 */
function persistRunPatch(runId: string, patch: Partial<RunRecord>) {
  const state = readState()
  const run = state.runs.find((item) => item.id === runId)
  if (!run) return
  Object.assign(run, patch)
  writeState(state)
}

/**
 * 按节点顺序模拟运行状态与事件流。
 * @param run 待运行记录。
 * @param shouldFail 是否在模型节点制造失败。
 */
function simulateRun(run: RunRecord, shouldFail = false) {
  persistRunPatch(run.id, { status: 'running', startedAt: new Date().toISOString() })
  emitRunEvent(run.id, { type: 'run.started', status: 'running' })
  const timers: number[] = []
  run.nodeRuns.forEach((nodeRun, index) => {
    timers.push(
      window.setTimeout(() => {
        nodeRun.status = 'running'
        persistRunPatch(run.id, { nodeRuns: [...run.nodeRuns] })
        emitRunEvent(run.id, {
          type: 'node.started',
          nodeId: nodeRun.nodeId,
          status: 'running',
          payload: { title: nodeRun.title, attempt: 1 },
        })
      }, index * 850 + 200),
    )
    timers.push(
      window.setTimeout(() => {
        const failed = shouldFail && index === Math.min(4, run.nodeRuns.length - 1)
        nodeRun.status = failed ? 'failed' : 'succeeded'
        nodeRun.durationMs = 640 + index * 170
        if (failed) {
          nodeRun.error = {
            code: 'LLM_TIMEOUT',
            message: '模型请求超过演示超时阈值。',
          }
          nodeRun.attempt = 2
          nodeRun.attempts = [
            {
              attempt: 1,
              status: 'failed',
              durationMs: 30000,
              error: { code: 'LLM_TIMEOUT', message: '首次请求超过演示超时阈值。' },
            },
            {
              attempt: 2,
              status: 'failed',
              durationMs: nodeRun.durationMs,
              error: nodeRun.error,
            },
          ]
        }
        emitRunEvent(run.id, {
          type: failed ? 'node.failed' : 'node.succeeded',
          nodeId: nodeRun.nodeId,
          status: failed ? 'failed' : 'succeeded',
          payload: {
            title: nodeRun.title,
            durationMs: nodeRun.durationMs,
            output:
              nodeRun.type === 'llm'
                ? { text: '根据产品文档，企业版支持 SAML SSO，可在团队设置中完成配置。' }
                : undefined,
            error: nodeRun.error,
          },
        })
        if (failed) {
          const error = {
            code: 'LLM_TIMEOUT',
            message: '运行在模型节点超时，请检查模型连接后重试。',
            nodeId: nodeRun.nodeId,
          }
          persistRunPatch(run.id, {
            status: 'failed',
            nodeRuns: [...run.nodeRuns],
            finishedAt: new Date().toISOString(),
            durationMs: 2.4,
            error,
          })
          emitRunEvent(run.id, { type: 'run.failed', status: 'failed', payload: { error } })
          finishRun(run.id)
        } else if (index === run.nodeRuns.length - 1) {
          persistRunPatch(run.id, {
            status: 'succeeded',
            nodeRuns: [...run.nodeRuns],
            finishedAt: new Date().toISOString(),
            durationMs: 8.2,
            output: { text: '根据产品文档，企业版支持 SAML SSO，可在团队设置中完成配置。' },
            metadata: { ...run.metadata, tokens: 2385, cost: 0.02 },
          })
          emitRunEvent(run.id, {
            type: 'run.completed',
            status: 'succeeded',
            payload: {
              output: { text: '根据产品文档，企业版支持 SAML SSO，可在团队设置中完成配置。' },
              tokens: 2385,
              cost: 0.02,
            },
          })
          finishRun(run.id)
        }
      }, index * 850 + 620),
    )
  })
  activeTimers.set(run.id, timers)
}

/**
 * 查询工作流卡片列表及聚合指标。
 * @returns 工作流卡片列表。
 */
export function getWorkflowList(): WorkflowCard[] {
  const state = readState()
  return state.drafts
    .filter((draft) => !state.deletedWorkflows.includes(draft.workflowId))
    .map((draft) => {
      const runs = state.runs.filter((run) => run.workflowId === draft.workflowId)
      const succeeded = runs.filter((run) => run.status === 'succeeded').length
      return {
        id: draft.workflowId,
        name: draft.name,
        description: draft.description,
        status: draft.status,
        tags: draft.tags,
        owner: { id: 'demo', name: '林一舟', initials: '林' },
        nodeCount: draft.definition.nodes.length,
        runCount: runs.length || Math.max(18, draft.revision),
        successRate: runs.length ? succeeded / Math.max(1, runs.length) : 0.96,
        updatedAt: draft.savedAt,
        publishedVersion: draft.publishedVersion,
        publishedVersionId: draft.publishedVersionId,
        lastRun: runs[0]
          ? { runId: runs[0].id, status: runs[0].status, at: runs[0].createdAt }
          : undefined,
        previewGraph: previewGraph(draft.definition),
      }
    })
}

/**
 * 查询指定工作流草稿。
 * @param workflowId 工作流 ID。
 * @returns 工作流草稿。
 */
export function getWorkflowDraft(workflowId: string): WorkflowDraft | undefined {
  const state = readState()
  return state.drafts.find((draft) => draft.workflowId === workflowId)
}

/**
 * 按修订号保存工作流草稿并处理并发冲突。
 * @param input 草稿快照与保存原因。
 * @returns 新修订号与保存时间。
 */
export function saveWorkflowDraft(input: {
  workflowId: string
  definition: WorkflowDefinition
  revision: number
  reason: 'autosave' | 'manual' | 'leave'
  name?: string
  description?: string
  tags?: string[]
}) {
  const state = readState()
  const draft = state.drafts.find((item) => item.workflowId === input.workflowId)
  if (!draft) {
    throw Object.assign(new Error('工作流不存在或已被移除。'), {
      code: 'WORKFLOW_NOT_FOUND',
      retryable: false,
    })
  }
  if (draft.revision !== input.revision) {
    throw Object.assign(new Error('当前工作流已被其他会话更新。'), {
      code: 'REVISION_CONFLICT',
      retryable: false,
      details: {
        currentRevision: draft.revision,
        currentDefinition: draft.definition,
      },
    })
  }
  draft.definition = structuredClone(input.definition)
  draft.name = input.name ?? input.definition.name ?? draft.name
  draft.description = input.description ?? draft.description
  draft.tags = input.tags ?? draft.tags
  draft.revision += 1
  draft.savedAt = new Date().toISOString()
  writeState(state)
  return { revision: draft.revision, savedAt: draft.savedAt }
}

/**
 * 更新工作流元信息。
 * @param workflowId 工作流 ID。
 * @param patch 元信息补丁。
 */
export function updateWorkflowMeta(
  workflowId: string,
  patch: Partial<Pick<WorkflowDraft, 'name' | 'description' | 'status' | 'tags' | 'forkOf'>>,
) {
  const state = readState()
  const draft = state.drafts.find((item) => item.workflowId === workflowId)
  if (!draft) return
  Object.assign(draft, patch)
  if (patch.name) draft.definition.name = patch.name
  draft.revision += 1
  draft.savedAt = new Date().toISOString()
  writeState(state)
}

/**
 * 创建包含开始与输出节点的空白工作流。
 * @param name 工作流名称。
 * @param description 工作流描述。
 * @returns 新建草稿。
 */
export function createWorkflow(name: string, description = ''): WorkflowDraft {
  const state = readState()
  const workflowId = uid('wf')
  const definition: WorkflowDefinition = {
    schemaVersion: '1.0',
    name,
    nodes: [makeNode('start', 'n_start', '开始', 180, 260), makeNode('output', 'n_output', '输出', 560, 260)],
    edges: [makeEdge('e_start_output', 'n_start', 'n_output')],
  }
  const draft = makeDraft(workflowId, name, description, 'draft', ['P0'], 1, 0, definition)
  state.drafts.unshift(draft)
  writeState(state)
  return draft
}

/**
 * 复制定义时重映射节点与连线 ID，确保重复克隆不会发生引用冲突。
 *
 * @param definition 模板携带的工作流定义。
 * @returns 使用全新 nodeId/edgeId 的独立定义。
 */
function remapDefinitionIds(definition: WorkflowDefinition): WorkflowDefinition {
  const suffix = uid('copy')
  const nodeMap = new Map<string, string>()
  const nodes = definition.nodes.map((node) => {
    const nextId = `${node.id}_${suffix}`
    nodeMap.set(node.id, nextId)
    return {
      ...structuredClone(node),
      id: nextId,
    }
  })
  const edges = definition.edges.map((edge) => ({
    ...structuredClone(edge),
    id: `${edge.id}_${suffix}`,
    source: nodeMap.get(edge.source) ?? edge.source,
    target: nodeMap.get(edge.target) ?? edge.target,
  }))
  return {
    ...structuredClone(definition),
    nodes,
    edges,
  }
}

/**
 * 从模板或外部包导入一个新的工作流草稿。
 *
 * 该操作只创建草稿，不安装依赖、不写入真实密钥，也不会覆盖现有工作流。
 *
 * @param input 模板来源、目标名称、标签和定义快照。
 * @returns 已持久化的新工作流草稿。
 */
export function importWorkflowDraft(input: {
  name: string
  description: string
  tags: string[]
  definition: WorkflowDefinition
  forkOf: NonNullable<WorkflowDraft['forkOf']>
}): WorkflowDraft {
  const state = readState()
  const activeDrafts = state.drafts.filter((draft) => !state.deletedWorkflows.includes(draft.workflowId))
  let targetName = input.name.trim() || input.forkOf.templateId
  if (activeDrafts.some((draft) => draft.name === targetName)) {
    let index = 2
    while (activeDrafts.some((draft) => draft.name === `${targetName} (${index})`)) index += 1
    targetName = `${targetName} (${index})`
  }
  const definition = remapDefinitionIds(input.definition)
  definition.name = targetName
  const draft = makeDraft(
    uid('wf'),
    targetName,
    input.description,
    'draft',
    input.tags,
    1,
    0,
    definition,
  )
  draft.forkOf = { ...input.forkOf }
  state.drafts.unshift(draft)
  writeState(state)
  return draft
}

/**
 * 复制工作流为独立草稿。
 * @param workflowId 源工作流 ID。
 * @returns 新工作流草稿。
 */
export function duplicateWorkflow(workflowId: string): WorkflowDraft | undefined {
  const source = getWorkflowDraft(workflowId)
  if (!source) return
  const state = readState()
  const draft: WorkflowDraft = {
    ...structuredClone(source),
    workflowId: uid('wf'),
    name: `${source.name} 副本`,
    status: 'draft',
    revision: 1,
    publishedVersion: undefined,
    publishedVersionId: undefined,
    savedAt: new Date().toISOString(),
  }
  draft.definition.name = draft.name
  state.drafts.unshift(draft)
  writeState(state)
  return draft
}

/**
 * 归档工作流并刷新数据事件。
 * @param workflowId 工作流 ID。
 */
export function archiveWorkflow(workflowId: string) {
  const state = readState()
  const draft = state.drafts.find((item) => item.workflowId === workflowId)
  if (!draft) return
  draft.status = 'archived'
  draft.savedAt = new Date().toISOString()
  writeState(state)
}

/**
 * 查询指定工作流的发布版本列表。
 * @param workflowId 工作流 ID。
 * @returns 按版本号倒序排列的版本。
 */
export function getWorkflowVersions(workflowId: string): WorkflowVersion[] {
  return readState().versions
    .filter((version) => version.workflowId === workflowId)
    .sort((a, b) => b.version - a.version)
}

/**
 * 查询指定工作流的固定版本快照。
 * @param workflowId 工作流 ID。
 * @param versionId 版本 ID。
 * @returns 发布版本。
 */
export function getWorkflowVersion(workflowId: string, versionId: string): WorkflowVersion | undefined {
  return getWorkflowVersions(workflowId).find((version) => version.id === versionId)
}

/**
 * 校验修订号并发布不可变版本快照。
 * @param input 工作流、修订号与变更说明。
 * @returns 新版本 ID 与版本号。
 */
export function publishWorkflow(input: {
  workflowId: string
  revision: number
  changelog?: string
}): { versionId: string; version: number; schemaHash: string } {
  const state = readState()
  const draft = state.drafts.find((item) => item.workflowId === input.workflowId)
  if (!draft) throw new Error('工作流不存在。')
  if (draft.revision !== input.revision) {
    throw Object.assign(new Error('发布前草稿已变化，请刷新后重试。'), {
      code: 'REVISION_CONFLICT',
    })
  }
  const previousVersions = state.versions.filter((version) => version.workflowId === input.workflowId)
  const version = Math.max(0, ...previousVersions.map((item) => item.version)) + 1
  const versionId = `ver_${input.workflowId.replace('wf_', '')}_${version}`
  const snapshot: WorkflowVersion = {
    id: versionId,
    workflowId: input.workflowId,
    version,
    createdAt: new Date().toISOString(),
    changelog: input.changelog?.trim() || '发布新版本',
    schemaHash: `sha256:${(input.workflowId + version).slice(-8)}`,
    nodeCount: draft.definition.nodes.length,
    definition: structuredClone(draft.definition),
    isCurrent: true,
  }
  previousVersions.forEach((item) => {
    item.isCurrent = false
  })
  state.versions.unshift(snapshot)
  draft.status = 'published'
  draft.publishedVersion = version
  draft.publishedVersionId = versionId
  draft.savedAt = new Date().toISOString()
  writeState(state)
  return { versionId, version, schemaHash: snapshot.schemaHash }
}

/**
 * 校验节点类型、端口、开始与输出节点。
 * @param definition 工作流定义。
 * @returns 校验错误与警告。
 */
export function validateDefinition(definition: WorkflowDefinition): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const nodeMap = new Map(definition.nodes.map((node) => [node.id, node]))
  const startNodes = definition.nodes.filter((node) => node.type === 'start')
  const terminalNodes = definition.nodes.filter((node) => node.type === 'output')
  if (startNodes.length !== 1) {
    errors.push({
      code: startNodes.length === 0 ? 'START_MISSING' : 'START_MULTIPLE',
      message:
        startNodes.length === 0
          ? '工作流必须有且只有一个开始节点。'
          : `工作流检测到 ${startNodes.length} 个开始节点，只允许一个。`,
      nodeId: startNodes[1]?.id,
    })
  }
  if (!terminalNodes.length) {
    errors.push({ code: 'TERMINAL_MISSING', message: '工作流至少需要一个输出节点。' })
  }
  definition.nodes.forEach((node) => {
    if (!getNodeRegistration(node.type)) {
      errors.push({
        code: 'NODE_TYPE_UNKNOWN',
        message: `找不到节点类型 ${node.type} 的 Manifest。`,
        nodeId: node.id,
      })
    }
  })
  definition.edges.forEach((edge) => {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) {
      errors.push({
        code: 'EDGE_TARGET_MISSING',
        message: '连线引用了不存在的节点。',
        edgeId: edge.id,
      })
      return
    }
    const sourceManifest = getNodeRegistration(source.type)?.manifest
    const targetManifest = getNodeRegistration(target.type)?.manifest
    if (
      edge.sourceHandle &&
      sourceManifest &&
      !sourceManifest.outputs.some((handle) => handle.id === edge.sourceHandle)
    ) {
      errors.push({
        code: 'EDGE_HANDLE_MISMATCH',
        message: `${source.title} 不存在输出端口 ${edge.sourceHandle}。`,
        edgeId: edge.id,
        nodeId: source.id,
        field: 'sourceHandle',
      })
    }
    if (
      edge.targetHandle &&
      targetManifest &&
      !targetManifest.inputs.some((handle) => handle.id === edge.targetHandle)
    ) {
      errors.push({
        code: 'EDGE_HANDLE_MISMATCH',
        message: `${target.title} 不存在输入端口 ${edge.targetHandle}。`,
        edgeId: edge.id,
        nodeId: target.id,
        field: 'targetHandle',
      })
    }
    if (source.type === 'start' && edge.sourceHandle === 'in') {
      errors.push({
        code: 'START_HAS_INPUT_EDGE',
        message: '开始节点不能有输入连线。',
        edgeId: edge.id,
      })
    }
  })
  const connectedIds = new Set<string>()
  definition.edges.forEach((edge) => {
    connectedIds.add(edge.source)
    connectedIds.add(edge.target)
  })
  if (definition.nodes.length > 2) {
    definition.nodes
      .filter((node) => !connectedIds.has(node.id))
      .forEach((node) => {
        warnings.push({
          code: 'ORPHAN_NODE',
          message: `${node.title} 尚未连接到主流程。`,
          nodeId: node.id,
          severity: 'warning',
        })
      })
  }
  return { valid: errors.length === 0, errors, warnings }
}

/**
 * 查询运行记录。
 * @param workflowId 可选工作流过滤。
 * @returns 按创建时间倒序排列的运行。
 */
export function getRuns(workflowId?: string): RunRecord[] {
  const state = readState()
  return (workflowId ? state.runs.filter((run) => run.workflowId === workflowId) : state.runs)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/**
 * 查询单次运行。
 * @param runId 运行 ID。
 * @returns 运行记录。
 */
export function getRun(runId: string): RunRecord | undefined {
  return readState().runs.find((run) => run.id === runId)
}

/**
 * 获取运行事件流，并补齐持久化快照事件。
 * @param runId 运行 ID。
 * @returns 运行事件列表。
 */
export function getRunEvents(runId: string): RunEvent[] {
  const live = runEvents.get(runId)
  if (live?.length) return structuredClone(live)
  const run = getRun(runId)
  if (!run) return []
  const started = Date.parse(run.startedAt ?? run.createdAt)
  const events: RunEvent[] = [
    {
      seq: 1,
      type: 'run.started',
      runId,
      status: 'running',
      at: run.startedAt ?? run.createdAt,
    },
  ]
  let seq = 2
  run.nodeRuns.forEach((nodeRun, index) => {
    const eventStarted = new Date(started + index * 850 + 100).toISOString()
    const eventFinished = new Date(started + index * 850 + 620 + (nodeRun.durationMs ?? 0)).toISOString()
    events.push({
      seq: seq++,
      type: nodeRun.status === 'pending' ? 'node.waiting' : 'node.started',
      runId,
      nodeId: nodeRun.nodeId,
      status: nodeRun.status === 'pending' ? 'pending' : 'running',
      at: eventStarted,
      payload: { title: nodeRun.title, attempt: nodeRun.attempt ?? 1 },
    })
    if (['succeeded', 'failed', 'skipped', 'cancelled'].includes(nodeRun.status)) {
      events.push({
        seq: seq++,
        type: `node.${nodeRun.status}`,
        runId,
        nodeId: nodeRun.nodeId,
        status: nodeRun.status,
        at: eventFinished,
        payload: {
          title: nodeRun.title,
          attempt: nodeRun.attempt ?? 1,
          durationMs: nodeRun.durationMs,
          output: nodeRun.output,
          error: nodeRun.error,
        },
      })
    }
  })
  const finalType =
    run.status === 'failed'
      ? 'run.failed'
      : run.status === 'cancelled'
        ? 'run.cancelled'
        : run.status === 'succeeded'
          ? 'run.completed'
          : 'run.waiting'
  events.push({
    seq: seq++,
    type: finalType,
    runId,
    status: run.status,
    at: run.finishedAt ?? new Date().toISOString(),
    payload: { output: run.output, error: run.error, usage: run.metadata },
  })
  return events
}

/**
 * 创建运行并异步启动演示执行。
 * @param input 工作流、定义、输入和固定版本上下文。
 * @returns 新运行记录。
 */
export function createMockRun(input: {
  workflowId: string
  workflowName: string
  definition: WorkflowDefinition
  input: Record<string, unknown>
  runKind: RunRecord['runKind']
  trigger: RunRecord['trigger']
  versionId?: string
  version?: number
}): RunRecord {
  const state = readState()
  const runId = `run_${Math.random().toString(16).slice(2, 10)}`
  const nodeRuns: NodeRun[] = input.definition.nodes.map((node) => ({
    nodeId: node.id,
    title: node.title,
    type: node.type,
    status: 'pending',
  }))
  const run: RunRecord = {
    id: runId,
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    versionId: input.versionId,
    version: input.version,
    runKind: input.runKind,
    trigger: input.trigger,
    status: 'pending',
    createdAt: new Date().toISOString(),
    input: structuredClone(input.input),
    nodeRuns,
    metadata: { events: 1, actor: '林一舟' },
  }
  state.runs.unshift(run)
  writeState(state)
  runEvents.set(runId, [])
  const shouldFail = String(input.input.question ?? input.input.content ?? '').includes('失败')
  window.setTimeout(() => simulateRun(run, shouldFail), 120)
  return run
}

/**
 * 订阅运行事件并支持断线后按序号补齐。
 * @param input 运行 ID、起始序号与回调。
 * @returns 取消订阅函数。
 */
export function subscribeMockRun(input: {
  runId: string
  afterSeq?: number
  onEvent: (event: RunEvent) => void
  onError: (error: Error) => void
  onEnd: () => void
}) {
  const currentRun = getRun(input.runId)
  if (!currentRun) {
    input.onError(new Error('运行不存在。'))
    return () => {}
  }
  const existing = runEvents.get(input.runId) ?? []
  existing
    .filter((event) => (input.afterSeq ?? 0) < event.seq)
    .forEach((event) => input.onEvent(event))
  if (['succeeded', 'failed', 'cancelled'].includes(currentRun.status)) {
    input.onEnd()
    return () => {}
  }
  let events = runSubscribers.get(input.runId)
  if (!events) {
    events = new Set()
    runSubscribers.set(input.runId, events)
  }
  let ends = runEndSubscribers.get(input.runId)
  if (!ends) {
    ends = new Set()
    runEndSubscribers.set(input.runId, ends)
  }
  events.add(input.onEvent)
  ends.add(input.onEnd)
  return () => {
    runSubscribers.get(input.runId)?.delete(input.onEvent)
    runEndSubscribers.get(input.runId)?.delete(input.onEnd)
  }
}

/**
 * 取消运行并广播终态事件。
 * @param runId 运行 ID。
 * @returns 完成后的 Promise。
 */
export function cancelMockRun(runId: string): Promise<void> {
  persistRunPatch(runId, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
    durationMs: 1.8,
  })
  emitRunEvent(runId, { type: 'run.cancelled', status: 'cancelled' })
  finishRun(runId)
  return Promise.resolve()
}

/**
 * 使用原定义与输入重放一次运行。
 * @param runId 原运行 ID。
 * @returns 新运行记录。
 */
export function replayRun(runId: string) {
  const run = getRun(runId)
  if (!run) return undefined
  return createMockRun({
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    definition:
      getWorkflowVersion(run.workflowId, run.versionId ?? '')?.definition ??
      getWorkflowDraft(run.workflowId)?.definition ?? { schemaVersion: '1.0', name: run.workflowName, nodes: [], edges: [] },
    input: run.input,
    runKind: run.runKind,
    trigger: run.trigger,
    versionId: run.versionId,
    version: run.version,
  })
}

export const knowledgeBases = [
  {
    id: 'kb_product_docs',
    name: '产品文档',
    description: 'Acme 产品帮助中心与版本说明',
    documents: 640,
    chunks: 2840,
    status: 'ready',
    updatedAt: iso(35 * 60 * 1000),
  },
  {
    id: 'kb_policies',
    name: '售后与政策',
    description: '退款、退货、服务等级与合规政策',
    documents: 48,
    chunks: 391,
    status: 'ready',
    updatedAt: iso(7 * HOUR),
  },
  {
    id: 'kb_sales',
    name: '销售赋能',
    description: '产品报价、竞品对比与销售话术',
    documents: 126,
    chunks: 882,
    status: 'indexing',
    updatedAt: iso(4 * HOUR),
  },
]

export const modelConnections = [
  {
    id: 'mc_openai_gpt4o',
    provider: 'OpenAI',
    name: 'GPT-4o',
    model: 'gpt-4o',
    status: 'ready',
    default: true,
    usage: 0.68,
    latencyMs: 820,
  },
  {
    id: 'mc_openai_mini',
    provider: 'OpenAI',
    name: 'GPT-4.1 mini',
    model: 'gpt-4.1-mini',
    status: 'ready',
    default: false,
    usage: 0.21,
    latencyMs: 430,
  },
  {
    id: 'mc_claude',
    provider: 'Anthropic',
    name: 'Claude Sonnet',
    model: 'claude-sonnet-4',
    status: 'ready',
    default: false,
    usage: 0.11,
    latencyMs: 960,
  },
]

export const mcpServers = [
  {
    id: 'mcp_github',
    name: 'GitHub',
    endpoint: 'https://mcp.github.com',
    status: 'online',
    tools: 9,
    calls: 1284,
    latencyMs: 74,
  },
  {
    id: 'mcp_notion',
    name: 'Notion',
    endpoint: 'stdio://notion-mcp',
    status: 'online',
    tools: 6,
    calls: 328,
    latencyMs: 112,
  },
  {
    id: 'mcp_filesystem',
    name: 'Filesystem',
    endpoint: 'stdio://filesystem',
    status: 'error',
    tools: 4,
    calls: 42,
    latencyMs: 0,
  },
]

export const workflowTools = [
  { id: 'tool_support', workflowId: 'wf_support', name: 'run_support_knowledge', description: '客服知识问答', serverId: 'mcp_reflow', tokens: 2 },
  { id: 'tool_lead', workflowId: 'wf_lead_scoring', name: 'run_lead_scoring', description: '销售线索评分', serverId: 'mcp_reflow', tokens: 1 },
]

export const templates = [
  { id: 'tpl_support', name: '客服知识问答', description: '文档检索、引用与低置信度转人工。', category: '客服', nodes: 9, installs: 1284, featured: true },
  { id: 'tpl_lead', name: '销售线索评分', description: 'HTTP 拉取 CRM 数据并通过 BANT 规则评分。', category: '销售', nodes: 5, installs: 866, featured: true },
  { id: 'tpl_report', name: '团队周报生成', description: '并行取数、汇总并生成结构化周报。', category: '运营', nodes: 8, installs: 521, featured: false },
  { id: 'tpl_ticket', name: '工单分类路由', description: '意图分类后路由到不同处理队列。', category: '客服', nodes: 7, installs: 704, featured: false },
]

export const plugins = [
  { id: 'plugin_jira', name: 'Jira Connector', author: 'Reflow Labs', description: '查询、创建与更新 Jira Issue。', category: '工具连接', nodes: 3, installed: true, version: '1.4.2' },
  { id: 'plugin_feishu', name: '飞书消息', author: 'Reflow Labs', description: '发送卡片、文档与多维表消息。', category: '通知', nodes: 2, installed: false, version: '1.2.0' },
  { id: 'plugin_presidio', name: 'PII Guard', author: 'Community', description: '识别并脱敏常见个人信息。', category: '安全', nodes: 1, installed: true, version: '0.9.8' },
  { id: 'plugin_sql', name: 'SQL Inspector', author: 'Reflow Labs', description: '只读 SQL 预览、风险与查询计划。', category: '数据', nodes: 2, installed: false, version: '1.1.5' },
]

export const recentRuns = getRuns
export const nodeCount = getNodeRegistrations().length

/** 清除浏览器中的演示数据并重新加载页面。 */
export function resetDemoData() {
  localStorage.removeItem(STORAGE_KEY)
  window.location.reload()
}

/**
 * 将 ISO 时间转换为相对时间。
 * @param value ISO 时间字符串。
 * @returns 中文相对时间。
 */
export function relativeTime(value: string) {
  const diff = Date.now() - Date.parse(value)
  if (diff < 60 * 1000) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} 小时前`
  return `${Math.floor(diff / (24 * HOUR))} 天前`
}

/**
 * 格式化短日期时间。
 * @param value 可选 ISO 时间字符串。
 * @returns 中文日期时间。
 */
export function formatDateTime(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
