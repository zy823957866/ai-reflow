import { apiGet, apiPatch, apiPost, ApiError, subscribeRunEvents } from '@/api/client'
import type {
  PublishResult,
  SaveResult,
  ValidationResult,
  WorkflowDefinition,
  WorkflowDesignerPort,
  WorkflowDraft,
  WorkflowVersion,
} from '@/shared/types'

interface RunCreated {
  runId: string
  workflowVersionId?: string
  runKind: 'preview' | 'production'
  trigger: string
  status: string
  links: {
    detail: string
    events: string
  }
}

/**
 * 将未知异常归一化为保留稳定错误码的 Error。
 *
 * @param error 原始异常。
 * @returns 可被设计器错误边界识别的异常。
 */
function toDesignerError(error: unknown) {
  if (error instanceof ApiError) {
    const normalized = new Error(error.message) as Error & {
      code: string
      details?: unknown
      status: number
    }
    normalized.name = 'DesignerError'
    normalized.code = error.code
    normalized.details = error.details
    normalized.status = error.status
    return normalized
  }
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * 执行可能失败的 API 调用并保持设计器错误契约。
 *
 * @param action 实际 API 操作。
 * @returns 操作结果。
 */
async function request<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw toDesignerError(error)
  }
}

/**
 * 基于真实 REST 与 SSE 的工作流设计器端口。
 */
export const openapiPort: WorkflowDesignerPort = {
  load: ({ workflowId, versionId }) =>
    request(async () => {
      const draft = await apiGet<WorkflowDraft>(`/api/workflows/${workflowId}`)
      if (!versionId) return draft
      const version = await apiGet<WorkflowVersion>(
        `/api/workflows/${workflowId}/versions/${versionId}`,
      )
      return {
        ...draft,
        revision: 0,
        status: 'published',
        savedAt: version.createdAt,
        publishedVersion: version.version,
        publishedVersionId: version.id,
        definition: structuredClone(version.definition),
      }
    }),

  save: ({ workflowId, definition, revision, reason }) =>
    request(async () => {
      const updated = await apiPatch<WorkflowDraft>(`/api/workflows/${workflowId}`, {
        definition,
        revision,
        reason,
      })
      return {
        revision: updated.revision,
        savedAt: updated.savedAt,
      } satisfies SaveResult
    }),

  validate: ({ workflowId, definition }) =>
    request(() =>
      apiPost<ValidationResult>(`/api/workflows/${workflowId}/validate`, { definition }),
    ),

  publish: ({ workflowId, revision, changelog }) =>
    request(() =>
      apiPost<PublishResult>(`/api/workflows/${workflowId}/publish`, {
        revision,
        changelog,
      }),
    ),

  createPreviewRun: ({ workflowId, definition, input }) =>
    request(async () => {
      const created = await apiPost<RunCreated>(`/api/workflows/${workflowId}/preview`, {
        definition: definition as WorkflowDefinition,
        input,
      })
      return { runId: created.runId }
    }),

  subscribeRun: (input) => subscribeRunEvents(input),

  cancelRun: (runId) =>
    request(async () => {
      await apiPost(`/api/runs/${runId}/cancel`)
    }),
}
