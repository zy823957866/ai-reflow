const sensitiveKeyPattern =
  /(authorization|proxy-authorization|cookie|set-cookie|api.?key|access.?token|refresh.?token|password|secret|credential|private.?key)/i

/**
 * 对任意可序列化数据执行递归脱敏。
 *
 * 该方法用于运行输入、输出、事件与审计的统一落库边界，
 * 不修改原对象。
 *
 * @param value 待脱敏数据。
 * @returns 脱敏后的独立数据。
 */
export function redact<T>(value: T): T {
  return redactValue(value) as T
}

/**
 * 递归脱敏内部实现。
 * @param value 任意值。
 * @returns 脱敏副本。
 */
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactValue(item)
  }
  return result
}

/**
 * 截断可能过大的事件值，只保留摘要。
 * @param value 任意值。
 * @param maxBytes 最大 UTF-8 字节数。
 * @returns 原值或带 artifact 提示的摘要。
 */
export function compactJsonValue(value: unknown, maxBytes = 1_048_576) {
  const serialized = JSON.stringify(value ?? null)
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return value
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(serialized, 'utf8'),
    preview: serialized.slice(0, 4096),
  }
}
