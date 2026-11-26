const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 把 ISO 时间转换为适合列表扫描的中文相对时间。
 *
 * @param value 可选 ISO 时间字符串。
 * @returns 中文相对时间；无效时间返回占位符。
 */
export function relativeTime(value?: string) {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '-'
  const diff = Math.max(0, Date.now() - timestamp)
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

/**
 * 使用客户端时区格式化日期和时间。
 *
 * @param value 可选 ISO 时间字符串。
 * @returns 月、日、时、分文本。
 */
export function formatDateTime(value?: string) {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 使用客户端时区格式化精确时间，供相对时间 tooltip 使用。
 *
 * @param value 可选 ISO 时间字符串。
 * @returns 完整本地时间文本。
 */
export function formatExactDateTime(value?: string) {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * 格式化执行耗时。
 *
 * @param durationMs 可选毫秒数。
 * @returns 毫秒、秒或占位符。
 */
export function formatDuration(durationMs?: number) {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return '-'
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * 截短长 ID，同时保留前缀和后缀以便调试定位。
 *
 * @param value 原始 ID。
 * @param size 保留字符总数。
 * @returns 带省略号的短 ID。
 */
export function shortId(value: string, size = 14) {
  if (value.length <= size) return value
  const head = Math.max(4, Math.ceil((size - 1) / 2))
  const tail = Math.max(3, size - head - 1)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/**
 * 把 0 到 1 的比例格式化为百分比。
 *
 * @param value 比例值。
 * @param digits 小数位数。
 * @returns 百分比文本。
 */
export function formatPercent(value: number, digits = 1) {
  if (!Number.isFinite(value)) return '-'
  return `${(value * 100).toFixed(digits)}%`
}
