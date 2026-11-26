/**
 * 创建只包含 JSON 值的深拷贝。
 *
 * Vue 的深层响应式对象包含 Proxy，浏览器 `structuredClone` 无法直接克隆。
 * 工作流定义、运行事件和表单配置都要求可序列化，因此使用 JSON 往返可以
 * 同时去掉 Proxy 并保证持久化边界清晰。
 *
 * @param value 需要复制的 JSON 可序列化值。
 * @returns 与输入值结构相同、引用完全独立的新值。
 */
export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
