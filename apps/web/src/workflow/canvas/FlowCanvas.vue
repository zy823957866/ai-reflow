<template>
  <div ref="wrapper" class="flow-canvas" @dragover.prevent @drop="onDrop">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :fit-view-on-init="true"
      :min-zoom="0.25"
      :max-zoom="1.8"
      :default-viewport="{ x: 0, y: 0, zoom: 0.86 }"
      :default-edge-options="defaultEdgeOptions"
      :connection-line-style="{ stroke: '#5B4DF0', strokeWidth: 1.6 }"
      class="vue-flow"
      @connect="onConnect"
      @node-click="onNodeClick"
      @pane-click="$emit('pane-click')"
      @node-drag-start="onDragStart"
      @node-drag-stop="onDragStop"
      @selection-change="onSelectionChange"
    >
      <Background :gap="18" :size="1" color="#E3E6EB" />
      <MiniMap
        class="flow-minimap"
        :node-color="minimapColor"
        mask-color="rgba(245, 246, 248, 0.72)"
      />
      <Panel position="top-left" class="canvas-toolbar">
        <button class="icon-btn" title="撤销" :disabled="!canUndo" @click="$emit('undo')">
          <Undo2 :size="16" />
        </button>
        <button class="icon-btn" title="重做" :disabled="!canRedo" @click="$emit('redo')">
          <Redo2 :size="16" />
        </button>
        <span class="toolbar-separator" />
        <button class="icon-btn" title="缩小" @click="zoomOut"><Minus :size="15" /></button>
        <span class="zoom-value">{{ Math.round(viewportZoom * 100) }}%</span>
        <button class="icon-btn" title="放大" @click="zoomIn"><Plus :size="15" /></button>
        <button class="icon-btn" title="适应视图" @click="fitView"><Maximize2 :size="15" /></button>
        <span class="toolbar-separator" />
        <button class="tool-btn" @click="$emit('open-palette')"><Plus :size="14" /> 添加节点</button>
      </Panel>
      <Panel position="bottom-center" class="canvas-help">
        拖动画布平移 · 滚轮缩放 · 从节点端口拖出连线
      </Panel>
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, ref, watch } from 'vue'
import {
  Background,
  MiniMap,
  Panel,
  VueFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  setupVueFlow,
} from '@xyflow/vue'
import {
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-vue-next'
import { getEdgeRegistration, getNodeRegistration, getNodeRegistrations } from '@/shared/registry'
import type {
  NodeRunStatus,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@/shared/types'
import GenericNodeCard from './GenericNodeCard.vue'

const props = defineProps<{
  definition: WorkflowDefinition
  selectedNodeIds: string[]
  runStatuses?: Record<string, NodeRunStatus>
  validationErrors?: Array<{ nodeId?: string; edgeId?: string }>
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  'update:nodes': [nodes: Array<{ id: string; x: number; y: number }>]
  connect: [connection: { source: string; target: string; sourceHandle?: string; targetHandle?: string }]
  'node-select': [node: FlowNode | null]
  'selection-change': [nodes: FlowNode[]]
  'pane-click': []
  undo: []
  redo: []
  'open-palette': []
  'drop-node': [type: string, x: number, y: number]
}>()

const wrapper = ref<HTMLElement>()
const dragStartPositions = ref(new Map<string, { id: string; x: number; y: number }>())
const {
  fitView: flowFitView,
  zoomIn: flowZoomIn,
  zoomOut: flowZoomOut,
  setCenter: flowSetCenter,
  viewport,
} = setupVueFlow()
const viewportZoom = computed(() => viewport.value.zoom)

const nodeTypes = Object.fromEntries(
  getNodeRegistrations().map((registration) => [
    registration.manifest.type,
    markRaw(registration.component ?? GenericNodeCard),
  ]),
)

const defaultEdgeOptions = computed(() => {
  const registration = getEdgeRegistration()
  return {
    type: 'default',
    style: registration.style,
    labelStyle: { fill: '#7A8292', fontSize: 11.5, fontFamily: 'var(--font-mono)' },
    labelBgStyle: { fill: '#FFFFFF', stroke: '#E4E7EC' },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: registration.markerEnd ? { type: 'arrowclosed' as const, color: '#B8BFCD' } : undefined,
  }
})

const nodes = ref<FlowNode[]>(buildNodes())
const edges = ref<FlowEdge[]>(buildEdges())

/** 将当前工作流适配到可视区域。 */
function fitView() {
  flowFitView({ padding: 0.22, duration: 280 })
}

/** 放动画布视图。 */
function zoomIn() {
  flowZoomIn({ duration: 160 })
}

/** 缩动画布视图。 */
function zoomOut() {
  flowZoomOut({ duration: 160 })
}

/**
 * 将画布定位到指定节点。
 * @param nodeId 目标节点 ID
 */
function focusNode(nodeId: string) {
  const node = nodes.value.find((item) => String(item.id) === nodeId)
  if (!node) return
  flowSetCenter(node.position.x + 97, node.position.y + 48, { zoom: 1, duration: 260 })
}

/** 将工作流定义转换为 Vue Flow 节点模型。 */
function buildNodes(): FlowNode[] {
  return props.definition.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    data: {
      node,
      runStatus: props.runStatuses?.[node.id] ?? 'pending',
      hasError: props.validationErrors?.some((error) => error.nodeId === node.id),
    },
    selected: props.selectedNodeIds.includes(node.id),
  }))
}

/** 将工作流定义转换为 Vue Flow 边模型。 */
function buildEdges(): FlowEdge[] {
  return props.definition.edges.map((edge) => {
    const registration = getEdgeRegistration(edge.type)
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'default',
      label: edge.label,
      animated: registration.animated,
      style: registration.style,
      labelStyle: { fill: '#6E7687', fontSize: 11.5, fontFamily: 'var(--font-mono)' },
      labelBgStyle: { fill: '#FBFAFF', stroke: '#DAD5FF' },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 4,
      markerEnd: registration.markerEnd ? { type: 'arrowclosed', color: '#8F87D8' } : undefined,
    }
  })
}

/** 工作流定义变化时同步画布节点与连线。 */
function syncFromDefinition() {
  nodes.value = buildNodes()
  edges.value = buildEdges()
}

watch(
  () => props.definition,
  () => syncFromDefinition(),
  { deep: true },
)

watch(
  () => props.selectedNodeIds,
  (ids) => {
    nodes.value = nodes.value.map((node) => ({
      ...node,
      selected: ids.includes(String(node.id)),
    }))
  },
  { deep: true },
)

/**
 * 处理节点点击并抬升选中事件。
 * @param payload Vue Flow 节点事件载荷
 */
function onNodeClick(payload: { node: FlowNode }) {
  emit('node-select', payload.node)
}

/**
 * 将画布多选结果同步给设计器。
 * @param payload Vue Flow 选择事件载荷
 */
function onSelectionChange(payload: { nodes: FlowNode[] }) {
  emit('selection-change', payload.nodes)
}

/**
 * 校验端口后提交连线创建。
 * @param connection Vue Flow 连线结果
 */
function onConnect(connection: Connection) {
  const source = getNodeRegistration(
    props.definition.nodes.find((item) => item.id === connection.source)?.type ?? '',
  )?.manifest
  const target = getNodeRegistration(
    props.definition.nodes.find((item) => item.id === connection.target)?.type ?? '',
  )?.manifest
  if (!source || !target) return
  if (
    !source.outputs.some((handle) => handle.id === connection.sourceHandle) ||
    !target.inputs.some((handle) => handle.id === connection.targetHandle)
  ) {
    return
  }
  emit('connect', {
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
  })
}

/**
 * 记录拖动前的节点位置，供撤销栈生成移动命令。
 * @param payload Vue Flow 节点拖动开始载荷
 */
function onDragStart(payload: { node: FlowNode; nodes: FlowNode[] }) {
  const targets = payload.nodes?.length ? payload.nodes : [payload.node]
  dragStartPositions.value = new Map(
    targets.map((node) => [
      String(node.id),
      { id: String(node.id), x: node.position.x, y: node.position.y },
    ]),
  )
}

/**
 * 提交一次节点移动命令。
 * @param payload Vue Flow 节点拖动结束载荷
 */
function onDragStop(payload: { node: FlowNode; nodes: FlowNode[] }) {
  const targets = payload.nodes?.length ? payload.nodes : [payload.node]
  const before = targets
    .map((node) => dragStartPositions.value.get(String(node.id)))
    .filter(Boolean) as Array<{ id: string; x: number; y: number }>
  const after = targets.map((node) => ({
    id: String(node.id),
    x: node.position.x,
    y: node.position.y,
  }))
  if (before.some((position, index) => position.x !== after[index]?.x || position.y !== after[index]?.y)) {
    emit('update:nodes', after)
  }
}

/**
 * 将外部节点拖入画布并换算为流坐标。
 * @param event 浏览器拖放事件
 */
function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData('application/reflow-node')
  if (!type || !wrapper.value) return
  const rect = wrapper.value.getBoundingClientRect()
  const transform = viewport.value
  const x = (event.clientX - rect.left - transform.x) / transform.zoom
  const y = (event.clientY - rect.top - transform.y) / transform.zoom
  emit('drop-node', type, x, y)
}

/**
 * 返回缩略图节点颜色。
 * @param node Vue Flow 节点
 * @returns 注册表声明的节点颜色
 */
function minimapColor(node: FlowNode) {
  return getNodeRegistration(props.definition.nodes.find((item) => item.id === node.id)?.type ?? '')?.manifest.color ?? '#C6CBD4'
}

defineExpose({
  fitView,
  zoomIn,
  zoomOut,
  focusNode,
})
</script>

<style scoped>
.flow-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--canvas);
}

.vue-flow {
  background:
    radial-gradient(circle at 1px 1px, rgba(139, 147, 163, 0.18) 1px, transparent 0) 0 0 / 18px 18px,
    var(--canvas);
}

.canvas-toolbar {
  display: flex;
  height: 42px;
  align-items: center;
  gap: 2px;
  margin: 14px !important;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
}

.toolbar-separator {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--border);
}

.zoom-value {
  width: 38px;
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 11.5px;
  text-align: center;
}

.tool-btn {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: var(--ink);
  color: #fff;
  font-size: 10px;
}

.canvas-help {
  margin-bottom: 12px !important;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--ink-3);
  font-size: 11.5px;
  backdrop-filter: blur(8px);
}

.flow-minimap {
  right: 14px !important;
  bottom: 14px !important;
  width: 126px !important;
  height: 78px !important;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.9) !important;
  box-shadow: var(--shadow-sm);
}

:deep(.vue-flow__node) {
  font-family: var(--font-sans);
}

:deep(.vue-flow__edge-path) {
  stroke: #b8bfcd;
  stroke-width: 1.4;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: var(--primary);
  stroke-width: 2;
}

:deep(.vue-flow__attribution) {
  display: none;
}
</style>
