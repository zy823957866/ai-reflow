import type {
  WorkflowDesignerPort,
} from '@/shared/types'
import {
  cancelMockRun,
  createMockRun,
  getWorkflowDraft,
  getWorkflowVersion,
  publishWorkflow,
  saveWorkflowDraft,
  subscribeMockRun,
  validateDefinition,
} from '@/services/mockData'

export class DesignerError extends Error {
  code: string
  retryable: boolean
  details?: unknown

  /**
   * 创建带错误码和重试语义的设计器错误。
   * @param input 错误详情。
   */
  constructor(input: {
    code: string
    message: string
    retryable?: boolean
    details?: unknown
  }) {
    super(input.message)
    this.name = 'DesignerError'
    this.code = input.code
    this.retryable = input.retryable ?? false
    this.details = input.details
  }
}

/**
 * 将未知异常归一化为 DesignerError。
 * @param error 原始异常。
 * @returns 不返回，始终抛出 DesignerError。
 */
function normalizeError(error: unknown): never {
  if (error instanceof DesignerError) throw error
  if (error && typeof error === 'object' && 'code' in error) {
    const raw = error as { code?: string; message?: string; retryable?: boolean; details?: unknown }
    throw new DesignerError({
      code: raw.code ?? 'UNKNOWN',
      message: raw.message ?? '请求失败。',
      retryable: raw.retryable,
      details: raw.details,
    })
  }
  throw new DesignerError({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : '请求失败。',
  })
}

/**
 * 工作流设计器的内存端口实现。
 */
export const mockPort: WorkflowDesignerPort = {
  async load({ workflowId, versionId }) {
    const draft = getWorkflowDraft(workflowId)
    if (!draft) {
      throw new DesignerError({
        code: 'WORKFLOW_NOT_FOUND',
        message: '工作流不存在或已被移除。',
      })
    }
    if (!versionId) return structuredClone(draft)
    const version = getWorkflowVersion(workflowId, versionId)
    if (!version) {
      throw new DesignerError({
        code: 'VERSION_NOT_FOUND',
        message: '找不到指定工作流版本。',
      })
    }
    return {
      ...structuredClone(draft),
      revision: 0,
      status: 'published',
      publishedVersion: version.version,
      publishedVersionId: version.id,
      savedAt: version.createdAt,
      definition: structuredClone(version.definition),
    }
  },

  async save({ workflowId, definition, revision, reason }) {
    try {
      return saveWorkflowDraft({ workflowId, definition, revision, reason })
    } catch (error) {
      normalizeError(error)
    }
  },

  async validate({ definition }) {
    return validateDefinition(definition)
  },

  async publish({ workflowId, revision, changelog }) {
    try {
      return publishWorkflow({ workflowId, revision, changelog })
    } catch (error) {
      normalizeError(error)
    }
  },

  async createPreviewRun({ workflowId, definition, input }) {
    const run = createMockRun({
      workflowId,
      workflowName: definition.name || getWorkflowDraft(workflowId)?.name || '未命名工作流',
      definition,
      input,
      runKind: 'preview',
      trigger: 'manual_preview',
    })
    return { runId: run.id }
  },

  subscribeRun(input) {
    return subscribeMockRun(input)
  },

  async cancelRun(runId) {
    return cancelMockRun(runId)
  },
}
