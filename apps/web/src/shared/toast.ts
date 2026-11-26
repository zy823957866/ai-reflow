import { createToastManager } from 'reka-ui'

export const toastManager = createToastManager()

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
  let toastId = ''
  toastId = toastManager.add({
    title: options.title,
    description: options.description,
    status: 'error',
    type: 'foreground',
    duration: options.retry ? 9000 : 6000,
    actionProps: options.retry
      ? {
          label: '重试',
          altText: `重试：${options.title}`,
          onClick: () => {
            toastManager.close(toastId)
            options.retry?.()
          },
        }
      : undefined,
  })
}
