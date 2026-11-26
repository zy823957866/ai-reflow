<template>
  <WorkflowDesigner
    ref="designerRef"
    :workflow-id="workflowId"
    mode="edit"
    :port="openapiPort"
    :services="designerServices"
    :on-dirty-change="onDirtyChange"
    :on-saved="onSaved"
    :on-publish-requested="openTrialAfterPublish"
    :on-validation-change="onValidationChange"
    :on-node-selected="onNodeSelected"
    @leave="leaveEditor"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import WorkflowDesigner from '@/workflow/WorkflowDesigner.vue'
import { openapiPort } from '@/workflow/api/openapiPort'
import { apiGet } from '@/api/client'
import { uploadAttachment } from '@/services/reflowApi'
import type {
  DesignerServices,
  FileRef,
  PublishResult,
  SaveResult,
  SelectOption,
  ValidationResult,
  WorkflowDesignerHandle,
} from '@/shared/types'

interface ModelConnectionOption {
  id: string
  name: string
  provider: string
  enabled: boolean
}

interface KnowledgeBaseOption {
  id: string
  name: string
  documents: number
}

interface McpServerOption {
  id: string
  name: string
  status: string
  enabled?: boolean
}

interface McpToolOption {
  name: string
  title?: string
}

interface WorkflowOption {
  id: string
  name: string
}

const route = useRoute()
const router = useRouter()
const designerRef = ref<WorkflowDesignerHandle>()
const dirty = ref(false)
const validating = ref(false)
const workflowId = computed(() => String(route.params.id))

const designerServices: DesignerServices = {
  async loadModelOptions(): Promise<SelectOption[]> {
    const connections = await apiGet<ModelConnectionOption[]>('/api/model-connections')
    return connections
      .filter((item) => item.enabled)
      .map((item) => ({
        value: item.id,
        label: `${item.name} · ${item.provider}`,
      }))
  },
  async loadKnowledgeOptions(): Promise<SelectOption[]> {
    const knowledge = await apiGet<KnowledgeBaseOption[]>('/api/knowledge-bases')
    return knowledge.map((item) => ({
      value: item.id,
      label: item.name,
      description: `${item.documents} 个文档`,
    }))
  },
  async loadMcpServers(): Promise<SelectOption[]> {
    const servers = await apiGet<McpServerOption[]>('/api/mcp/servers')
    return servers
      .filter((server) => server.enabled !== false && server.status === 'healthy')
      .map((server) => ({ value: server.id, label: server.name }))
  },
  async loadMcpTools(serverId: string): Promise<SelectOption[]> {
    const tools = await apiGet<McpToolOption[]>(`/api/mcp/servers/${serverId}/tools`)
    return tools.map((tool) => ({
      value: tool.name,
      label: tool.title || tool.name,
    }))
  },
  async loadWorkflowOptions(): Promise<SelectOption[]> {
    const workflows = await apiGet<WorkflowOption[]>('/api/workflows', { limit: 200 })
    return workflows.map((workflow) => ({
      value: workflow.id,
      label: workflow.name,
    }))
  },
  async uploadFile(file, onProgress): Promise<FileRef> {
    return uploadAttachment(file, onProgress)
  },
  async confirm(message) {
    return window.confirm(message)
  },
  notify(level, message) {
    if (level === 'error') console.warn(message)
  },
}

/**
 * 同步设计器未保存状态。
 * @param next 是否存在未保存修改。
 */
function onDirtyChange(next: boolean) {
  dirty.value = next
}

/**
 * 处理设计器保存结果。
 * @param _result 保存结果，页面层当前仅用于状态边界。
 */
function onSaved(_result: SaveResult) {
  dirty.value = false
}

/**
 * 接收设计器实时校验结果。
 * @param _result 校验结果，页面层当前仅用于状态边界。
 */
function onValidationChange(_result: ValidationResult) {
  validating.value = false
}

/**
 * 接收画布节点选中事件。
 * @param _nodeId 当前节点 ID。
 */
function onNodeSelected(_nodeId: string | null) {
  // The shell remains intentionally thin; selection belongs to the designer.
}

/** 在未保存保护通过后返回工作流列表。 */
async function leaveEditor() {
  if (dirty.value) {
    const confirmed = window.confirm('当前草稿还有未保存修改，是否保存后离开？')
    if (!confirmed) return
    try {
      await designerRef.value?.flushSave()
    } catch {
      return
    }
  }
  router.push('/')
}

/**
 * 发布成功后使用服务端返回的固定版本打开试运行台。
 *
 * @param result 发布结果，包含真实外部版本 ID。
 */
function openTrialAfterPublish(result: PublishResult) {
  if (!result.versionId) return
  router.push({
    path: `/workflows/${workflowId.value}/trial`,
    query: { versionId: result.versionId },
  })
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  const confirmed = window.confirm('离开后仍有未保存修改。是否保存草稿后离开？')
  if (!confirmed) return false
  await designerRef.value?.flushSave()
  return true
})

onBeforeUnmount(() => {
  designerRef.value?.destroy()
})
</script>
