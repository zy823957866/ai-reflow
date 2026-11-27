import { toast } from 'vue-sonner'

export interface ErrorToastOptions {
  title: string
  description: string
  retry?: () => void
}

/**
 * 展示知识库录入等流程的持续提示。
 *
 * @param title 提示标题。
 * @param description 补充说明。
 */
export function notifyInfo(title: string, description: string) {
  toast.info(title, {
    description,
    duration: 8000,
    testId: 'app-toast',
  })
}

/**
 * 展示流程完成提示。
 *
 * @param title 完成标题。
 * @param description 补充说明。
 */
export function notifySuccess(title: string, description?: string) {
  toast.success(title, {
    description,
    duration: 4000,
    testId: 'app-toast',
  })
}

/**
 * 通过全局 Toast 展示知识库请求或文档处理错误。
 *
 * @param options 错误标题、详情和可选重试动作。
 */
export function notifyError(options: ErrorToastOptions) {
  toast.error(options.title, {
    description: options.description,
    duration: options.retry ? 9000 : 6000,
    testId: 'app-toast',
    action: options.retry
      ? {
          label: '重试',
          onClick: options.retry,
        }
      : undefined,
  })
}
