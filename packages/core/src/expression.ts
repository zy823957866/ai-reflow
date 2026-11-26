/**
 * 从对象中按点路径读取值，支持数组索引。
 * @param source 路径根对象。
 * @param path `a.b.0.c` 形式的路径。
 * @returns 命中的值；路径不存在时返回 `undefined`。
 */
export function getPath(source: unknown, path: string): unknown {
  if (!path) return source
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      current = Number.isInteger(index) ? current[index] : undefined
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * 将点路径写入一个新的不可变对象副本。
 * @param source 原对象。
 * @param path 写入路径。
 * @param value 新值。
 * @returns 完成写入的深拷贝对象。
 */
export function setPath(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const next = structuredClone(source)
  const segments = path.split('.').filter(Boolean)
  if (!segments.length) return next
  let current: Record<string, unknown> = next
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment]
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments.at(-1)!] = value
  return next
}

/**
 * 解析单个 `{{ $input.question }}` 形式的表达式。
 * @param expression 表达式文本。
 * @param scope 变量作用域。
 * @returns 命中值；未知表达式返回 `undefined`。
 */
export function resolveExpression(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  const trimmed = expression.trim()
  const match = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(trimmed)
  if (match) return resolveReference(match[1], scope)
  if (trimmed.startsWith('$')) return resolveReference(trimmed, scope)
  return undefined
}

/**
 * 解析无花括号的变量引用。
 * @param reference `$input`、`$node`、`$vars` 或 `$run` 引用。
 * @param scope 变量作用域。
 * @returns 命中值。
 */
export function resolveReference(reference: string, scope: Record<string, unknown>) {
  const match = /^\$(input|node|vars|run|workflow)(?:\.(.+))?$/.exec(reference.trim())
  if (!match) return undefined
  return getPath(scope[match[1]], match[2] ?? '')
}

/**
 * 深度解析字符串、数组和对象中的变量引用。
 *
 * 若字符串只包含一个引用，则保留引用指向的原始类型；混合文本会执行
 * `String(value)` 插值。
 *
 * @param value 待解析值。
 * @param scope 变量作用域。
 * @param options 缺失值处理策略。
 * @returns 完成变量替换的新值。
 */
export function resolveVariables<T>(
  value: T,
  scope: Record<string, unknown>,
  options: {
    missingStrategy?: 'error' | 'empty' | 'keep'
    sourceLabel?: string
  } = {},
): T {
  if (typeof value === 'string') {
    const exact = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value.trim())
    if (exact) {
      const resolved = resolveReference(exact[1], scope)
      if (resolved !== undefined) return resolved as T
      return handleMissing(value, options) as T
    }
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, reference: string) => {
      const resolved = resolveReference(reference, scope)
      if (resolved === undefined) return String(handleMissing(_token, options))
      if (resolved === null) return ''
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved)
    }) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveVariables(item, scope, options)) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveVariables(item, scope, options),
      ]),
    ) as T
  }
  return value
}

/**
 * 按策略处理缺失变量。
 * @param token 原始引用文本。
 * @param options 缺失策略与来源说明。
 * @returns 插值结果。
 */
function handleMissing(
  token: string,
  options: { missingStrategy?: 'error' | 'empty' | 'keep'; sourceLabel?: string },
) {
  const strategy = options.missingStrategy ?? 'error'
  if (strategy === 'empty') return ''
  if (strategy === 'keep') return token
  throw new Error(`${options.sourceLabel ?? '变量'}不存在：${token}`)
}
