import type {
  EdgeRegistration,
  NodeRegistration,
  ValidationIssue,
} from './types'

const nodeRegistry = new Map<string, NodeRegistration>()
const edgeRegistry = new Map<string, EdgeRegistration>()
const nodeListeners = new Set<() => void>()
const edgeListeners = new Set<() => void>()

/**
 * 输出注册覆盖告警并保留结构化错误上下文。
 * @param kind 注册类别。
 * @param type 节点或连线类型。
 */
function warnOverwrite(kind: 'node' | 'edge', type: string) {
  console.warn(`[REGISTRY_OVERWRITE] ${kind} "${type}" has already been registered.`, {
    code: 'REGISTRY_OVERWRITE',
    category: 'registry',
    level: 'warning',
  })
}

/**
 * 注册节点 Manifest、表单与组件，并阻止默认覆盖行为。
 * @param registration 节点注册项。
 * @param options 是否允许覆盖。
 * @returns 注册过程中产生的警告。
 */
export function registerNode(
  registration: NodeRegistration,
  options: { allowOverwrite?: boolean } = {},
): ValidationIssue[] {
  const type = registration.manifest.type
  const current = nodeRegistry.get(type)
  const warnings: ValidationIssue[] = []
  if (current) {
    if (current.form && registration.form && !options.allowOverwrite) {
      warnings.push({
        code: 'REGISTRY_OVERWRITE',
        message: `节点 ${type} 的 form 已注册，本次注册已阻止覆盖。`,
        severity: 'warning',
      })
      warnOverwrite('node', type)
      registration = { ...registration, form: current.form }
    }
    if (current.component && registration.component && !options.allowOverwrite) {
      warnings.push({
        code: 'REGISTRY_OVERWRITE',
        message: `节点 ${type} 的渲染组件已注册，本次注册已阻止覆盖。`,
        severity: 'warning',
      })
      warnOverwrite('node', type)
      registration = { ...registration, component: current.component }
    }
  }
  nodeRegistry.set(type, {
    ...current,
    ...registration,
    manifest: {
      ...current?.manifest,
      ...registration.manifest,
    },
  })
  nodeListeners.forEach((listener) => listener())
  return warnings
}

/**
 * 注销指定节点类型。
 * @param type 节点类型。
 */
export function unregisterNode(type: string): void {
  nodeRegistry.delete(type)
  nodeListeners.forEach((listener) => listener())
}

/**
 * 查询节点注册项。
 * @param type 节点类型。
 * @returns 节点注册项。
 */
export function getNodeRegistration(type: string): NodeRegistration | undefined {
  return nodeRegistry.get(type)
}

/**
 * 返回全部节点注册项。
 * @returns 节点注册项列表。
 */
export function getNodeRegistrations(): NodeRegistration[] {
  return [...nodeRegistry.values()]
}

/**
 * 订阅节点注册表变化。
 * @param listener 变化回调。
 * @returns 取消订阅函数。
 */
export function onNodeRegistryChange(listener: () => void): () => void {
  nodeListeners.add(listener)
  return () => nodeListeners.delete(listener)
}

/**
 * 注册连线类型并通知订阅者。
 * @param registration 连线注册项。
 * @param options 是否允许覆盖。
 */
export function registerEdge(
  registration: EdgeRegistration,
  options: { allowOverwrite?: boolean } = {},
): void {
  if (edgeRegistry.has(registration.type) && !options.allowOverwrite) {
    warnOverwrite('edge', registration.type)
  }
  edgeRegistry.set(registration.type, registration)
  edgeListeners.forEach((listener) => listener())
}

/**
 * 返回全部连线注册项。
 * @returns 连线注册项列表。
 */
export function getEdgeRegistrations(): EdgeRegistration[] {
  return [...edgeRegistry.values()]
}

/**
 * 查询连线注册项并提供默认连线兜底。
 * @param type 连线类型。
 * @returns 连线注册项。
 */
export function getEdgeRegistration(type = 'default'): EdgeRegistration {
  return edgeRegistry.get(type) ?? edgeRegistry.get('default') ?? {
    type,
    label: '默认连线',
  }
}

/**
 * 订阅连线注册表变化。
 * @param listener 变化回调。
 * @returns 取消订阅函数。
 */
export function onEdgeRegistryChange(listener: () => void): () => void {
  edgeListeners.add(listener)
  return () => edgeListeners.delete(listener)
}

/**
 * 根据 Manifest 生成节点默认配置。
 * @param type 节点类型。
 * @returns 默认配置。
 */
export function getDefaultNodeConfig(type: string): Record<string, unknown> {
  const registration = getNodeRegistration(type)
  if (!registration) return {}
  const config: Record<string, unknown> = {}
  const manifest = registration.manifest
  if (manifest.discriminator) {
    config[manifest.discriminator.key] = manifest.discriminator.default
  }
  for (const field of manifest.configFields) {
    if (field.defaultValue !== undefined) {
      config[field.key] = structuredClone(field.defaultValue)
    }
  }
  return config
}

/**
 * 解析节点应使用的表单模式。
 * @param type 节点类型。
 * @returns 表单解析结果。
 */
export function resolveNodeForm(type: string):
  | { kind: 'component'; registration: NodeRegistration }
  | { kind: 'schema'; registration: NodeRegistration; schema: Record<string, unknown> }
  | { kind: 'fields'; registration: NodeRegistration }
  | { kind: 'readonly'; type: string } {
  const registration = getNodeRegistration(type)
  if (!registration) return { kind: 'readonly', type }
  if (registration.form?.kind === 'component') {
    return { kind: 'component', registration }
  }
  if (registration.form?.kind === 'schema') {
    return {
      kind: 'schema',
      registration,
      schema: registration.form.schema ?? {},
    }
  }
  if (registration.form?.kind === 'fields' || registration.manifest.configFields.length > 0) {
    return { kind: 'fields', registration }
  }
  return { kind: 'readonly', type }
}

/**
 * 按节点判别器模式过滤配置字段。
 * @param fields 配置字段。
 * @param config 节点配置。
 * @param discriminatorKey 模式字段键。
 * @returns 当前模式可见字段。
 */
export function filterFieldsByMode(
  fields: NodeRegistration['manifest']['configFields'],
  config: Record<string, unknown>,
  discriminatorKey?: string,
) {
  const mode = discriminatorKey ? String(config[discriminatorKey] ?? '') : ''
  return fields.filter((field) => !field.modes?.length || field.modes.includes(mode))
}

/**
 * 返回节点 Manifest 声明的输入输出端口。
 * @param type 节点类型。
 * @param config 节点配置。
 * @returns 输入输出端口。
 */
export function getActiveHandles(type: string, config: Record<string, unknown>) {
  const manifest = getNodeRegistration(type)?.manifest
  if (!manifest) return { inputs: [], outputs: [] }
  return {
    inputs: manifest.inputs,
    outputs: manifest.outputs,
  }
}
