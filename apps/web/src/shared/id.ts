interface IdSource {
  randomUUID?: () => string
}

/**
 * 生成浏览器端临时 ID。
 *
 * randomUUID 只在安全上下文可用；局域网 HTTP 部署时回退到时间戳和随机数。
 *
 * @param prefix ID 前缀。
 * @param source 可注入的 crypto 实现。
 * @returns 带前缀的客户端 ID。
 */
export function createClientId(
  prefix: string,
  source: IdSource | undefined = globalThis.crypto,
) {
  let uuid: string | undefined
  try {
    uuid = source?.randomUUID?.()
  } catch {
    uuid = undefined
  }
  const suffix = uuid
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${suffix}`
}
