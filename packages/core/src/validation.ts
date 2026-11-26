import { createHash } from 'node:crypto'
import type {
  ValidationIssue,
  ValidationResult,
  WorkflowDefinition,
} from './types'

/**
 * 当前工作流 schema 支持的 20 个内置节点类型。
 *
 * server 的模板依赖检查和设计器校验共用此清单，避免出现第二份节点目录。
 */
export const WORKFLOW_NODE_TYPES = new Set([
  'start',
  'output',
  'llm',
  'tool',
  'knowledge',
  'condition',
  'template',
  'variable',
  'data-transform',
  'document',
  'parallel',
  'agent',
  'loop',
  'subworkflow',
  'human',
  'wait',
  'code',
  'database',
  'quality-gate',
  'file',
])

const OUTPUT_HANDLES: Record<string, Set<string>> = {
  start: new Set(['out']),
  output: new Set(['out']),
  llm: new Set(['out']),
  tool: new Set(['out']),
  knowledge: new Set(['out']),
  condition: new Set(['true', 'false', 'default']),
  template: new Set(['out']),
  variable: new Set(['out']),
  'data-transform': new Set(['out']),
  document: new Set(['out']),
  parallel: new Set(['join', 'error']),
  agent: new Set(['out']),
  loop: new Set(['body', 'done']),
  subworkflow: new Set(['out', 'error']),
  human: new Set(['submitted', 'approved', 'rejected']),
  wait: new Set(['out']),
  code: new Set(['out']),
  database: new Set(['out']),
  'quality-gate': new Set(['pass', 'fail', 'block']),
  file: new Set(['out']),
}

/**
 * 校验工作流定义的结构、端口、可达性和有向无环约束。
 *
 * 本函数不依赖浏览器注册表，server、worker 与设计器可以复用同一套
 * 结构化错误码。
 *
 * @param definition 待校验工作流定义。
 * @returns 结构化错误与警告。
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const nodeIds = new Set<string>()
  const nodeMap = new Map(definition.nodes.map((node) => [node.id, node]))
  const edgeIds = new Set<string>()

  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({
        code: 'NODE_ID_DUPLICATE',
        message: `节点 ID ${node.id} 重复。`,
        nodeId: node.id,
        field: 'id',
      })
    }
    nodeIds.add(node.id)
    if (!WORKFLOW_NODE_TYPES.has(node.type)) {
      errors.push({
        code: 'NODE_TYPE_UNKNOWN',
        message: `找不到节点类型 ${node.type} 的 Manifest。`,
        nodeId: node.id,
        field: 'type',
      })
    }
    if (!node.title.trim()) {
      errors.push({
        code: 'NODE_TITLE_MISSING',
        message: '节点标题不能为空。',
        nodeId: node.id,
        field: 'title',
      })
    }
  }

  const startNodes = definition.nodes.filter((node) => node.type === 'start')
  const terminalNodes = definition.nodes.filter((node) => node.type === 'output')
  if (startNodes.length !== 1) {
    errors.push({
      code: startNodes.length ? 'START_MULTIPLE' : 'START_MISSING',
      message: startNodes.length
        ? `工作流检测到 ${startNodes.length} 个开始节点，只允许一个。`
        : '工作流必须有且只有一个开始节点。',
      nodeId: startNodes[1]?.id,
    })
  }
  if (!terminalNodes.length) {
    errors.push({
      code: 'TERMINAL_MISSING',
      message: '工作流至少需要一个输出节点。',
    })
  }

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({
        code: 'EDGE_ID_DUPLICATE',
        message: `连线 ID ${edge.id} 重复。`,
        edgeId: edge.id,
        field: 'id',
      })
    }
    edgeIds.add(edge.id)
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) {
      errors.push({
        code: 'EDGE_NODE_MISSING',
        message: '连线引用了不存在的节点。',
        edgeId: edge.id,
        field: !source ? 'source' : 'target',
      })
      continue
    }
    if (source.id === target.id) {
      errors.push({
        code: 'EDGE_SELF_LOOP',
        message: '节点不能直接连接到自身。',
        edgeId: edge.id,
        nodeId: source.id,
      })
    }
    if (edge.sourceHandle && !OUTPUT_HANDLES[source.type]?.has(edge.sourceHandle)) {
      errors.push({
        code: 'EDGE_HANDLE_MISMATCH',
        message: `${source.title} 不存在输出端口 ${edge.sourceHandle}。`,
        edgeId: edge.id,
        nodeId: source.id,
        field: 'sourceHandle',
      })
    }
    if (source.type === 'start') {
      const hasIncoming = definition.edges.some((candidate) => candidate.target === source.id)
      if (hasIncoming) {
        errors.push({
          code: 'START_HAS_INPUT_EDGE',
          message: '开始节点不能有输入连线。',
          nodeId: source.id,
        })
      }
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  }

  const cycle = findCycle(definition.nodes.map((node) => node.id), outgoing)
  if (cycle.length) {
    errors.push({
      code: 'WORKFLOW_CYCLE',
      message: `工作流包含环路：${cycle.join(' -> ')}。`,
      nodeId: cycle[0],
    })
  }

  if (startNodes.length === 1) {
    const reachable = walkFrom(startNodes[0].id, outgoing)
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        warnings.push({
          code: 'NODE_UNREACHABLE',
          message: `${node.title} 从开始节点不可达。`,
          nodeId: node.id,
          severity: 'warning',
        })
      }
      if (
        node.type !== 'output' &&
        node.type !== 'start' &&
        !outgoing.has(node.id)
      ) {
        warnings.push({
          code: 'NODE_NO_OUTGOING_EDGE',
          message: `${node.title} 没有后续节点。`,
          nodeId: node.id,
          severity: 'warning',
        })
      }
      if (node.type !== 'start' && !incoming.has(node.id)) {
        warnings.push({
          code: 'NODE_NO_INCOMING_EDGE',
          message: `${node.title} 没有上游节点。`,
          nodeId: node.id,
          severity: 'warning',
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 计算规范化工作流定义的 SHA-256。
 * @param definition 工作流定义。
 * @returns `sha256:` 前缀摘要。
 */
export function hashWorkflowDefinition(definition: WorkflowDefinition) {
  return `sha256:${createHash('sha256')
    .update(stableStringify(definition))
    .digest('hex')}`
}

/**
 * 递归生成键顺序稳定的 JSON 字符串。
 * @param value 任意 JSON 兼容值。
 * @returns 稳定序列化文本。
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 从指定节点搜索有向图环。
 * @param nodeIds 全部节点 ID。
 * @param outgoing 邻接表。
 * @returns 首个环路；无环时返回空数组。
 */
function findCycle(nodeIds: string[], outgoing: Map<string, string[]>) {
  const visited = new Set<string>()
  const active = new Set<string>()
  const stack: string[] = []

  /**
   * 深度优先遍历单个节点。
   * @param nodeId 当前节点。
   * @returns 是否发现环。
   */
  function visit(nodeId: string): boolean {
    if (active.has(nodeId)) {
      const start = stack.indexOf(nodeId)
      stack.slice(start).concat(nodeId).forEach((item, index, all) => {
        if (index === all.length - 1) stack.splice(start, stack.length - start)
      })
      return true
    }
    if (visited.has(nodeId)) return false
    visited.add(nodeId)
    active.add(nodeId)
    stack.push(nodeId)
    for (const target of outgoing.get(nodeId) ?? []) {
      if (visit(target)) return true
    }
    active.delete(nodeId)
    stack.pop()
    return false
  }

  for (const nodeId of nodeIds) {
    if (visit(nodeId)) return stack
  }
  return []
}

/**
 * 计算从起点可达的节点集合。
 * @param start 起点节点 ID。
 * @param outgoing 邻接表。
 * @returns 可达节点集合。
 */
function walkFrom(start: string, outgoing: Map<string, string[]>) {
  const reachable = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)
    queue.push(...(outgoing.get(current) ?? []))
  }
  return reachable
}
