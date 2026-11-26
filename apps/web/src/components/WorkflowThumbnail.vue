<template>
  <svg class="h-full w-full" viewBox="0 0 120 52" aria-hidden="true">
    <line
      v-for="(edge, index) in scaledEdges"
      :key="`edge-${index}`"
      :x1="edge.x1"
      :y1="edge.y1"
      :x2="edge.x2"
      :y2="edge.y2"
      stroke="#D5DAE3"
      stroke-width="1"
    />
    <g
      v-for="node in scaledNodes"
      :key="node.key"
      :transform="`translate(${node.x} ${node.y})`"
    >
      <rect width="11" height="7" rx="1.5" :fill="node.color" opacity="0.12" />
      <rect width="11" height="7" rx="1.5" fill="none" :stroke="node.color" stroke-width="0.7" opacity="0.45" />
      <circle cx="5.5" cy="3.5" r="1.3" :fill="node.color" opacity="0.8" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getNodeRegistration } from '@/shared/registry'
import type { WorkflowCard } from '@/shared/types'

const props = defineProps<{
  graph: WorkflowCard['previewGraph']
}>()

const normalized = computed(() => {
  if (!props.graph.nodes.length) return { nodes: [], edges: [] }
  const minX = Math.min(...props.graph.nodes.map((node) => node.x))
  const maxX = Math.max(...props.graph.nodes.map((node) => node.x))
  const minY = Math.min(...props.graph.nodes.map((node) => node.y))
  const maxY = Math.max(...props.graph.nodes.map((node) => node.y))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const nodes = props.graph.nodes.map((node, index) => {
    const nx = 6 + ((node.x - minX) / width) * 96
    const ny = 6 + ((node.y - minY) / height) * 36
    return {
      key: `${node.type}-${index}`,
      x: nx,
      y: ny,
      color: getNodeRegistration(node.type)?.manifest.color ?? '#8B93A3',
    }
  })
  const edges = props.graph.edges
    .filter((edge) => nodes[edge.from] && nodes[edge.to])
    .map((edge) => ({
      x1: nodes[edge.from].x + 5.5,
      y1: nodes[edge.from].y + 3.5,
      x2: nodes[edge.to].x + 5.5,
      y2: nodes[edge.to].y + 3.5,
    }))
  return { nodes, edges }
})

const scaledNodes = computed(() => normalized.value.nodes)
const scaledEdges = computed(() => normalized.value.edges)
</script>
