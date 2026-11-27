import { ApiError } from '@/api/client'

/**
 * 将未知错误转换为可展示的中文文案。
 *
 * ApiError 会拼接错误码与消息，其余取 Error.message，兜底返回通用文案。
 *
 * @param error 捕获到的未知错误。
 * @returns 可直接展示的错误文案。
 */
export function apiErrorText(error: unknown) {
  if (error instanceof ApiError) {
    return [error.code, error.message].filter(Boolean).join('：')
  }
  return error instanceof Error ? error.message : '请求失败。'
}
