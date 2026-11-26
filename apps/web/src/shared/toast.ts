import { toast } from 'vue-sonner'

export interface ErrorToastOptions {
  title: string
  description: string
  retry?: () => void
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
