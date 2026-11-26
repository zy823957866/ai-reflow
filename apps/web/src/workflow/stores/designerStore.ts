import { computed, ref, shallowRef } from 'vue'
import type {
  ValidationResult,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@/shared/types'
import { clonePlain } from '@/shared/clone'

type CommandKind =
  | 'addNode'
  | 'removeNodes'
  | 'moveNodes'
  | 'updateNodeConfig'
  | 'updateNodeTitle'
  | 'addEdge'
  | 'removeEdge'
  | 'pasteSubgraph'
  | 'setNodeMode'

interface BaseCommand {
  kind: CommandKind
  label: string
  mergeKey?: string
  timestamp: number
}

type DesignerCommand =
  | (BaseCommand & { kind: 'addNode'; after: { node: WorkflowNode } })
  | (BaseCommand & {
      kind: 'removeNodes'
      before: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
    })
  | (BaseCommand & {
      kind: 'moveNodes'
      before: Array<{ id: string; x: number; y: number }>
      after: Array<{ id: string; x: number; y: number }>
    })
  | (BaseCommand & {
      kind: 'updateNodeConfig'
      before: { nodeId: string; config: Record<string, unknown> }
      after: { nodeId: string; config: Record<string, unknown> }
    })
  | (BaseCommand & {
      kind: 'updateNodeTitle'
      before: { nodeId: string; title: string }
      after: { nodeId: string; title: string }
    })
  | (BaseCommand & { kind: 'addEdge'; after: { edge: WorkflowEdge } })
  | (BaseCommand & { kind: 'removeEdge'; before: { edge: WorkflowEdge } })
  | (BaseCommand & {
      kind: 'pasteSubgraph'
      after: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
    })
  | (BaseCommand & {
      kind: 'setNodeMode'
      before: { nodeId: string; config: Record<string, unknown> }
      after: { nodeId: string; config: Record<string, unknown> }
    })

export type DesignerSaveState =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'failed'
  | 'conflict'
  | 'readonly'

/**
 * 创建支持撤销、重做、脏状态和定义快照的设计器状态。
 * @param initialDefinition 初始工作流定义。
 * @returns 设计器状态与方法。
 */
export function createDesignerStore(initialDefinition: WorkflowDefinition) {
  const definition = ref<WorkflowDefinition>(structuredClone(initialDefinition))
  const selectedNodeId = ref<string | null>(null)
  const selectedNodeIds = ref<string[]>([])
  const dirty = ref(false)
  const saveState = ref<DesignerSaveState>('saved')
  const revision = ref(1)
  const savedAt = ref<string | null>(null)
  const validation = shallowRef<ValidationResult>({ valid: true, errors: [] })
  const undoStack = ref<DesignerCommand[]>([])
  const redoStack = ref<DesignerCommand[]>([])
  const lastMerge = new Map<string, { timestamp: number; command: DesignerCommand }>()
  const selectedNode = computed(() =>
    definition.value.nodes.find((node) => node.id === selectedNodeId.value),
  )
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  let changeCallback: (() => void) | null = null

  /**
   * 注册画布定义变化回调。
   * @param listener 定义发生变化时调用的监听器。
   */
  function setOnChange(listener: () => void) {
    changeCallback = listener
  }

  /**
   * 克隆命令载荷，隔离撤销栈与当前响应式定义。
   * @param value 可序列化的命令数据。
   * @returns 独立的普通对象副本。
   */
  function clone<T>(value: T): T {
    return clonePlain(value)
  }

  /**
   * 删除节点及其关联连线。
   * @param nodeIds 待删除节点 ID。
   */
  function removeNodeAndEdges(nodeIds: string[]) {
    definition.value.nodes = definition.value.nodes.filter((node) => !nodeIds.includes(node.id))
    definition.value.edges = definition.value.edges.filter(
      (edge) => !nodeIds.includes(edge.source) && !nodeIds.includes(edge.target),
    )
  }

  /**
   * 正向应用命令。
   * @param command 设计器命令。
   */
  function applyAfter(command: DesignerCommand) {
    switch (command.kind) {
      case 'addNode':
        definition.value.nodes.push(clone(command.after.node))
        break
      case 'removeNodes':
        removeNodeAndEdges(command.before.nodes.map((node) => node.id))
        break
      case 'moveNodes':
        command.after.forEach((position) => {
          const node = definition.value.nodes.find((item) => item.id === position.id)
          if (node) {
            node.x = position.x
            node.y = position.y
          }
        })
        break
      case 'updateNodeConfig':
      case 'setNodeMode': {
        const node = definition.value.nodes.find((item) => item.id === command.after.nodeId)
        if (node) node.config = clone(command.after.config)
        break
      }
      case 'updateNodeTitle': {
        const node = definition.value.nodes.find((item) => item.id === command.after.nodeId)
        if (node) node.title = command.after.title
        break
      }
      case 'addEdge':
        if (!definition.value.edges.some((edge) => edge.id === command.after.edge.id)) {
          definition.value.edges.push(clone(command.after.edge))
        }
        break
      case 'removeEdge':
        definition.value.edges = definition.value.edges.filter(
          (edge) => edge.id !== command.before.edge.id,
        )
        break
      case 'pasteSubgraph':
        definition.value.nodes.push(...clone(command.after.nodes))
        definition.value.edges.push(...clone(command.after.edges))
        break
    }
  }

  /**
   * 反向应用命令。
   * @param command 设计器命令。
   */
  function applyBefore(command: DesignerCommand) {
    switch (command.kind) {
      case 'addNode':
        removeNodeAndEdges([command.after.node.id])
        break
      case 'removeNodes':
        definition.value.nodes.push(...clone(command.before.nodes))
        definition.value.edges.push(...clone(command.before.edges))
        break
      case 'moveNodes':
        command.before.forEach((position) => {
          const node = definition.value.nodes.find((item) => item.id === position.id)
          if (node) {
            node.x = position.x
            node.y = position.y
          }
        })
        break
      case 'updateNodeConfig':
      case 'setNodeMode': {
        const node = definition.value.nodes.find((item) => item.id === command.before.nodeId)
        if (node) node.config = clone(command.before.config)
        break
      }
      case 'updateNodeTitle': {
        const node = definition.value.nodes.find((item) => item.id === command.before.nodeId)
        if (node) node.title = command.before.title
        break
      }
      case 'addEdge':
        definition.value.edges = definition.value.edges.filter(
          (edge) => edge.id !== command.after.edge.id,
        )
        break
      case 'removeEdge':
        if (!definition.value.edges.some((edge) => edge.id === command.before.edge.id)) {
          definition.value.edges.push(clone(command.before.edge))
        }
        break
      case 'pasteSubgraph': {
        const nodeIds = command.after.nodes.map((node) => node.id)
        removeNodeAndEdges(nodeIds)
        break
      }
    }
  }

  /**
   * 合并短时间内的同类配置命令。
   * @param existing 已存在的命令。
   * @param incoming 新命令。
   * @returns 合并后的命令或 null。
   */
  function mergeCommand(
    existing: DesignerCommand,
    incoming: DesignerCommand,
  ): DesignerCommand | null {
    if (existing.kind === 'updateNodeConfig' && incoming.kind === 'updateNodeConfig') {
      return { ...existing, after: incoming.after, timestamp: incoming.timestamp }
    }
    if (existing.kind === 'updateNodeTitle' && incoming.kind === 'updateNodeTitle') {
      return { ...existing, after: incoming.after, timestamp: incoming.timestamp }
    }
    if (existing.kind === 'setNodeMode' && incoming.kind === 'setNodeMode') {
      return { ...existing, after: incoming.after, timestamp: incoming.timestamp }
    }
    return null
  }

  /**
   * 应用命令并维护撤销栈、重做栈与脏状态。
   * @param command 待执行命令。
   */
  function execute(command: DesignerCommand) {
    applyAfter(command)
    const mergeWindow = 700
    if (command.mergeKey) {
      const existing = lastMerge.get(command.mergeKey)
      if (existing && command.timestamp - existing.timestamp <= mergeWindow) {
        const merged = mergeCommand(existing.command, command)
        if (merged) {
          const index = undoStack.value.findIndex((item) => item === existing.command)
          if (index >= 0) undoStack.value[index] = merged
          lastMerge.set(command.mergeKey, { timestamp: command.timestamp, command: merged })
          dirty.value = true
          redoStack.value = []
          saveState.value = 'dirty'
          changeCallback?.()
          return
        }
      }
    }
    undoStack.value.push(command)
    if (command.mergeKey) {
      lastMerge.set(command.mergeKey, { timestamp: command.timestamp, command })
    }
    redoStack.value = []
    dirty.value = true
    saveState.value = 'dirty'
    changeCallback?.()
  }

  /** 撤销最近一次命令。 */
  function undo() {
    const command = undoStack.value.pop()
    if (!command) return
    applyBefore(command)
    redoStack.value.push(command)
    dirty.value = true
    saveState.value = 'dirty'
    changeCallback?.()
    lastMerge.clear()
  }

  /** 重做最近撤销的命令。 */
  function redo() {
    const command = redoStack.value.pop()
    if (!command) return
    applyAfter(command)
    undoStack.value.push(command)
    dirty.value = true
    saveState.value = 'dirty'
    changeCallback?.()
    lastMerge.clear()
  }

  /**
   * 添加节点命令。
   * @param node 新节点。
   */
  function addNode(node: WorkflowNode) {
    execute({ kind: 'addNode', label: `新增 ${node.title}`, timestamp: Date.now(), after: { node } })
  }

  /**
   * 删除节点及关联连线的命令。
   * @param nodeIds 节点 ID。
   */
  function removeNodes(nodeIds: string[]) {
    const nodes = definition.value.nodes.filter((node) => nodeIds.includes(node.id))
    if (!nodes.length) return
    const edges = definition.value.edges.filter(
      (edge) => nodeIds.includes(edge.source) || nodeIds.includes(edge.target),
    )
    execute({
      kind: 'removeNodes',
      label: `删除 ${nodes.length} 个节点`,
      timestamp: Date.now(),
      before: { nodes: clone(nodes), edges: clone(edges) },
    })
  }

  /**
   * 记录节点移动命令。
   * @param before 移动前位置。
   * @param after 移动后位置。
   */
  function moveNodes(
    before: Array<{ id: string; x: number; y: number }>,
    after: Array<{ id: string; x: number; y: number }>,
  ) {
    execute({ kind: 'moveNodes', label: '移动节点', timestamp: Date.now(), before, after })
  }

  /**
   * 更新节点配置命令。
   * @param nodeId 节点 ID。
   * @param config 新配置。
   * @param fieldKey 用于合并连续命令的字段键。
   */
  function updateNodeConfig(nodeId: string, config: Record<string, unknown>, fieldKey = '') {
    const node = definition.value.nodes.find((item) => item.id === nodeId)
    if (!node) return
    execute({
      kind: 'updateNodeConfig',
      label: '更新节点配置',
      mergeKey: `config:${nodeId}:${fieldKey}`,
      timestamp: Date.now(),
      before: { nodeId, config: clone(node.config) },
      after: { nodeId, config: clone(config) },
    })
  }

  /**
   * 重命名节点命令。
   * @param nodeId 节点 ID。
   * @param title 新标题。
   */
  function updateNodeTitle(nodeId: string, title: string) {
    const node = definition.value.nodes.find((item) => item.id === nodeId)
    if (!node || node.title === title) return
    execute({
      kind: 'updateNodeTitle',
      label: '重命名节点',
      mergeKey: `title:${nodeId}`,
      timestamp: Date.now(),
      before: { nodeId, title: node.title },
      after: { nodeId, title },
    })
  }

  /**
   * 切换节点判别器模式。
   * @param nodeId 节点 ID。
   * @param key 模式字段键。
   * @param value 新模式。
   */
  function setNodeMode(nodeId: string, key: string, value: string) {
    const node = definition.value.nodes.find((item) => item.id === nodeId)
    if (!node) return
    const after = { ...node.config, [key]: value }
    execute({
      kind: 'setNodeMode',
      label: `切换 ${key}`,
      timestamp: Date.now(),
      before: { nodeId, config: clone(node.config) },
      after: { nodeId, config: clone(after) },
    })
  }

  /**
   * 添加连线命令。
   * @param edge 新连线。
   */
  function addEdge(edge: WorkflowEdge) {
    execute({ kind: 'addEdge', label: '创建连线', timestamp: Date.now(), after: { edge } })
  }

  /**
   * 删除连线命令。
   * @param edgeId 连线 ID。
   */
  function removeEdge(edgeId: string) {
    const edge = definition.value.edges.find((item) => item.id === edgeId)
    if (!edge) return
    execute({
      kind: 'removeEdge',
      label: '删除连线',
      timestamp: Date.now(),
      before: { edge: clone(edge) },
    })
  }

  /**
   * 粘贴节点与连线子图。
   * @param nodes 新节点。
   * @param edges 新连线。
   */
  function pasteSubgraph(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    execute({
      kind: 'pasteSubgraph',
      label: '粘贴子图',
      timestamp: Date.now(),
      after: { nodes, edges },
    })
  }

  /**
   * 标记当前定义为已保存并清空历史栈。
   * @param nextRevision 新修订号。
   * @param nextSavedAt 保存时间。
   */
  function markSaved(nextRevision: number, nextSavedAt: string) {
    revision.value = nextRevision
    savedAt.value = nextSavedAt
    dirty.value = false
    saveState.value = 'saved'
    undoStack.value = []
    redoStack.value = []
    lastMerge.clear()
  }

  /**
   * 获取当前定义的纯对象快照。
   * @returns 可用于校验、保存或导出的独立定义。
   */
  function getDefinition() {
    return clone(definition.value)
  }

  return {
    definition,
    selectedNodeId,
    selectedNodeIds,
    selectedNode,
    dirty,
    saveState,
    revision,
    savedAt,
    validation,
    canUndo,
    canRedo,
    setOnChange,
    addNode,
    removeNodes,
    moveNodes,
    updateNodeConfig,
    updateNodeTitle,
    setNodeMode,
    addEdge,
    removeEdge,
    pasteSubgraph,
    undo,
    redo,
    markSaved,
    getDefinition,
  }
}
