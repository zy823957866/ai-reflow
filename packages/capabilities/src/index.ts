import {
  BaseNodeExecutor,
  NodeExecutionError,
  resolveReference,
  resolveVariables,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from '@ai-reflow/core'
import { AgentExecutor } from './agent'

export * from './agent'

type NodeConfig = Record<string, unknown>

/**
 * 返回当前运行上下文的变量作用域。
 * @param context 节点运行上下文。
 * @returns `$input/$node/$vars/$run/$workflow` 根对象。
 */
function scopeOf(context: NodeExecutionContext): Record<string, unknown> {
  return {
    input: context.input,
    node: context.outputs,
    vars: context.variables,
    run: {
      id: context.runId,
      kind: context.runKind,
      trigger: context.trigger,
    },
    workflow: {
      id: context.workflowId,
      version: context.workflowVersionId,
    },
  }
}

/**
 * 将配置字段中的变量引用替换为运行期值。
 * @param context 节点运行上下文。
 * @param value 待解析配置。
 * @returns 已解析配置。
 */
function resolveConfig<T>(context: NodeExecutionContext, value: T): T {
  return resolveVariables(value, scopeOf(context), { missingStrategy: 'keep' })
}

/**
 * 读取必填字符串配置。
 * @param config 节点配置。
 * @param key 字段名。
 * @param nodeType 节点类型，用于错误码。
 * @returns 非空字符串。
 */
function requiredString(
  config: NodeConfig,
  key: string,
  nodeType: string,
) {
  const value = config[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new NodeExecutionError({
      code: 'NODE_CONFIG_INVALID',
      message: `${nodeType}.${key} 必须是非空字符串。`,
      nodeType,
    })
  }
  return value
}

/**
 * P0 开始节点执行器。
 */
export class StartExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'start'

  /**
   * 校验并输出运行输入。
   * @param context 运行上下文。
   * @param config 开始节点配置。
   * @returns 输入、附件和运行上下文。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    validateInputSchema(context.input, config.inputSchema)
    return {
      output: {
        input: structuredClone(context.input),
        files: Array.isArray(context.input.files) ? structuredClone(context.input.files) : [],
        run: {
          id: context.runId,
          kind: context.runKind,
          trigger: context.trigger,
        },
      },
    }
  }
}

/**
 * P0 输出节点执行器。
 */
export class OutputExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'output'

  /**
   * 根据输出模式生成最终响应。
   * @param context 运行上下文。
   * @param config 输出节点配置。
   * @returns 统一输出结果。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    const resolved = resolveConfig(context, config)
    const mapping =
      resolved.outputMapping && typeof resolved.outputMapping === 'object'
        ? resolved.outputMapping
        : undefined
    const content =
      typeof resolved.content === 'string' ? resolved.content : undefined
    const result = mapping
      ? structuredClone(mapping)
      : {
          body: content ?? null,
          statusCode: Number(resolved.statusCode ?? 200),
        }
    return {
      output: {
        result,
        text: content ?? (typeof result === 'object' && result ? JSON.stringify(result) : String(result ?? '')),
      },
    }
  }
}

/**
 * P0 大模型节点执行器。
 */
export class LlmExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'llm'

  /**
   * 调用已配置的模型服务。
   * @param context 运行上下文。
   * @param config LLM 节点配置。
   * @returns 文本、结构化结果和 usage。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    const provider = context.services?.llm
    if (!provider) {
      throw new NodeExecutionError({
        code: 'MODEL_PROVIDER_NOT_CONFIGURED',
        message: '模型服务未配置，请设置模型连接凭据后重试。',
        nodeType: this.type,
      })
    }
    const resolved = resolveConfig(context, config)
    const connectionId = requiredString(resolved, 'modelConnectionId', this.type)
    const prompt = String(resolved.prompt ?? '')
    if (!prompt) {
      throw new NodeExecutionError({
        code: 'NODE_CONFIG_INVALID',
        message: 'llm.prompt 不能为空。',
        nodeType: this.type,
      })
    }
    const mode = String(resolved.mode ?? 'generate')
    const response = await provider.generate({
      connectionId,
      model: typeof resolved.model === 'string' ? resolved.model : undefined,
      systemPrompt:
        typeof resolved.systemPrompt === 'string' ? resolved.systemPrompt : undefined,
      prompt,
      temperature:
        typeof resolved.temperature === 'number' ? resolved.temperature : undefined,
      maxTokens:
        typeof resolved.maxTokens === 'number' ? resolved.maxTokens : undefined,
      responseFormat:
        mode === 'structured' || mode === 'extract' ? 'json_object' : 'text',
      signal: context.signal,
    })
    const structured =
      response.structured ??
      (mode === 'structured' || mode === 'extract'
        ? parseStructuredOutput(response.text)
        : undefined)
    return {
      output: {
        text: response.text,
        structured,
        usage: response.usage ?? {},
        model: response.model,
      },
    }
  }
}

/**
 * P0 工具节点执行器。
 */
export class ToolExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'tool'

  /**
   * 调用 HTTP 或 MCP 工具。
   * @param context 运行上下文。
   * @param config 工具节点配置。
   * @returns 统一工具输出。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    const resolved = resolveConfig(context, config)
    const kind = String(resolved.kind ?? 'http')
    if (kind === 'mcp') return this.callMcp(context, resolved)
    if (kind === 'http') return this.callHttp(context, resolved)
    throw new NodeExecutionError({
      code: 'TOOL_KIND_NOT_SUPPORTED',
      message: `工具类型 ${kind} 尚未接入运行时。`,
      nodeType: this.type,
      retryable: false,
    })
  }

  /**
   * 执行真实 HTTP 请求。
   * @param context 运行上下文。
   * @param config 已解析配置。
   * @returns HTTP 响应封装。
   */
  private async callHttp(context: NodeExecutionContext, config: NodeConfig) {
    const rawUrl = requiredString(config, 'url', this.type)
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new NodeExecutionError({
        code: 'HTTP_PROTOCOL_INVALID',
        message: 'HTTP 工具仅允许 http/https 协议。',
        nodeType: this.type,
      })
    }
    if (!config.allowPrivate && isPrivateHost(url.hostname)) {
      throw new NodeExecutionError({
        code: 'HTTP_PRIVATE_HOST_BLOCKED',
        message: `HTTP 工具默认禁止访问私有地址：${url.hostname}`,
        nodeType: this.type,
      })
    }
    const method = String(config.method ?? 'GET').toUpperCase()
    const headers = normalizeHeaders(config.headers)
    const body =
      method === 'GET' || method === 'HEAD' || config.body === undefined
        ? undefined
        : JSON.stringify(config.body)
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: context.signal,
      redirect: config.followRedirects === true ? 'follow' : 'manual',
    })
    const contentType = response.headers.get('content-type') ?? ''
    const result = contentType.includes('application/json')
      ? await response.json()
      : await response.text()
    if (!response.ok) {
      throw new NodeExecutionError({
        code: `HTTP_${response.status}`,
        message: `HTTP 请求失败（${response.status}）。`,
        nodeType: this.type,
        retryable: response.status >= 500 || response.status === 429,
        details: { status: response.status, host: url.host, body: result },
      })
    }
    return {
      output: {
        result,
        structuredContent:
          result && typeof result === 'object' ? result : undefined,
        isError: false,
        kind: 'http',
        source: url.host,
      },
    }
  }

  /**
   * 通过 worker 注入的 MCP 客户端调用工具。
   * @param context 运行上下文。
   * @param config 已解析配置。
   * @returns MCP 工具结果。
   */
  private async callMcp(context: NodeExecutionContext, config: NodeConfig) {
    if (!context.services?.mcp) {
      throw new NodeExecutionError({
        code: 'MCP_SERVICE_NOT_CONFIGURED',
        message: 'MCP 客户端服务未启用。',
        nodeType: this.type,
      })
    }
    const serverId = requiredString(config, 'serverId', this.type)
    const toolName = requiredString(config, 'toolName', this.type)
    const args =
      config.arguments && typeof config.arguments === 'object'
        ? (config.arguments as Record<string, unknown>)
        : {}
    const result = await context.services.mcp.call({
      serverId,
      toolName,
      arguments: args,
      timeoutMs:
        typeof config.timeoutMs === 'number' ? config.timeoutMs : undefined,
      signal: context.signal,
    })
    return {
      output: {
        result,
        structuredContent:
          result.structuredContent && typeof result.structuredContent === 'object'
            ? result.structuredContent
            : result,
        isError: result.isError === true,
        kind: 'mcp',
        source: serverId,
      },
    }
  }
}

/**
 * P0 知识库节点执行器。
 */
export class KnowledgeExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'knowledge'

  /**
   * 执行知识库检索。
   * @param context 运行上下文。
   * @param config 知识库节点配置。
   * @returns chunks、citations 与拼接上下文。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    if (!context.services?.knowledge) {
      throw new NodeExecutionError({
        code: 'KNOWLEDGE_SERVICE_NOT_CONFIGURED',
        message: '知识库检索服务未启用。',
        nodeType: this.type,
      })
    }
    const resolved = resolveConfig(context, config)
    const knowledgeBaseIds = normalizeStringArray(
      resolved.knowledgeBaseId ?? resolved.knowledgeBaseIds,
    )
    if (!knowledgeBaseIds.length) {
      throw new NodeExecutionError({
        code: 'NODE_CONFIG_INVALID',
        message: 'knowledge.knowledgeBaseId 至少需要一个知识库。',
        nodeType: this.type,
      })
    }
    const result = await context.services.knowledge.retrieve({
      knowledgeBaseIds,
      query: requiredString(resolved, 'query', this.type),
      topK: Math.max(1, Number(resolved.topK ?? 5)),
      scoreThreshold: Math.max(0, Number(resolved.scoreThreshold ?? 0.3)),
      retrievalMode:
        resolved.retrievalMode === 'keyword' || resolved.retrievalMode === 'hybrid'
          ? resolved.retrievalMode
          : 'vector',
      signal: context.signal,
    })
    return {
      output: {
        chunks: result.chunks,
        citations: result.citations,
        context: result.context,
        total: result.total,
        warnings: result.warnings ?? [],
      },
    }
  }
}

/**
 * P0 条件节点执行器。
 */
export class ConditionExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'condition'

  /**
   * 评估二元条件并返回命中的分支 handle。
   * @param context 运行上下文。
   * @param config 条件节点配置。
   * @returns `matched/branch/results` 与分支 handle。
   */
  protected async doExecute(
    context: NodeExecutionContext,
    config: NodeConfig,
  ): Promise<NodeExecutionResult> {
    const resolved = resolveConfig(context, config)
    if (resolved.mode === 'switch') {
      const cases = Array.isArray(resolved.switchCases)
        ? (resolved.switchCases as Array<Record<string, unknown>>)
        : []
      const match = cases.find((item) => matchesExpression(item.when, resolved))
      const branch = match ? `case.${String(match.id)}` : 'default'
      return {
        output: {
          matched: Boolean(match),
          branch,
          results: cases.map((item) => ({
            id: item.id,
            matched: item === match,
          })),
        },
        handle: branch,
      }
    }
    const conditions = Array.isArray(resolved.conditions)
      ? (resolved.conditions as Array<Record<string, unknown>>)
      : []
    const results = conditions.map((condition) => evaluateCondition(condition, resolved))
    const matched =
      resolved.combinator === 'any'
        ? results.some((item) => item.matched)
        : results.every((item) => item.matched)
    const branch = matched ? 'true' : 'false'
    return {
      output: { matched, branch, results },
      handle: branch,
    }
  }
}

/**
 * P0 模板节点执行器。
 */
export class TemplateExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'template'

  /**
   * 渲染 Mustache 风格模板。
   * @param context 运行上下文。
   * @param config 模板节点配置。
   * @returns 文本与可选 JSON。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    const template = requiredString(config, 'template', this.type)
    const text = renderTemplate(template, scopeOf(context), {
      missingStrategy:
        config.missingStrategy === 'empty' || config.missingStrategy === 'keep'
          ? config.missingStrategy
          : 'error',
      sourceLabel: 'template',
    })
    const parser = String(config.parser ?? config.outputType ?? 'text')
    return {
      output: {
        text,
        json: parser === 'json' ? parseJsonOutput(text) : undefined,
        length: text.length,
      },
    }
  }
}

/**
 * P0 变量节点执行器。
 */
export class VariableExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'variable'

  /**
   * 写入运行变量或聚合多个来源。
   * @param context 运行上下文。
   * @param config 变量节点配置。
   * @returns 写入变量后的快照。
   */
  protected async doExecute(context: NodeExecutionContext, config: NodeConfig) {
    const resolved = resolveConfig(context, config)
    if (resolved.mode === 'aggregate') {
      const sources = Array.isArray(resolved.sources) ? resolved.sources : []
      const items = sources.map((item) => resolveConfig(context, item))
      const value =
        String(resolved.strategy ?? 'array') === 'concat'
          ? items.map(String).join('')
          : items
      if (typeof resolved.target === 'string' && resolved.target) {
        context.variables[resolved.target] = value
      }
      return {
        output: {
          value,
          items,
          count: items.length,
          vars: structuredClone(context.variables),
        },
      }
    }
    const assignments = normalizeAssignments(resolved.assignments)
    const changed: string[] = []
    for (const [key, value] of Object.entries(assignments)) {
      context.variables[key] = value
      changed.push(key)
    }
    return {
      output: {
        vars: structuredClone(context.variables),
        changed,
      },
    }
  }
}

/**
 * 创建 worker 可用的内置节点执行器注册表。
 * @returns 以节点类型为键的执行器映射。
 */
export function createCapabilityRegistry() {
  const executors = [
    new StartExecutor(),
    new OutputExecutor(),
    new LlmExecutor(),
    new ToolExecutor(),
    new KnowledgeExecutor(),
    new AgentExecutor(),
    new ConditionExecutor(),
    new TemplateExecutor(),
    new VariableExecutor(),
  ]
  return new Map(executors.map((executor) => [executor.type, executor]))
}

/**
 * 校验开始节点声明的 JSON Schema。
 * @param input 运行输入。
 * @param rawSchema 开始节点 inputSchema。
 */
function validateInputSchema(
  input: Record<string, unknown>,
  rawSchema: unknown,
) {
  if (!rawSchema || typeof rawSchema !== 'object') return
  const schema = rawSchema as Record<string, unknown>
  const required = Array.isArray(schema.required)
    ? schema.required.map(String)
    : []
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {}
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      throw new NodeExecutionError({
        code: 'INPUT_VALIDATION_FAILED',
        message: `缺少必填输入字段 ${key}。`,
        nodeType: 'start',
        details: { field: key },
      })
    }
  }
  for (const [key, definition] of Object.entries(properties)) {
    const value = input[key]
    if (value === undefined || value === null || definition.type === undefined) continue
    const expected = String(definition.type)
    const actual = Array.isArray(value) ? 'array' : typeof value
    if (expected === 'object' && actual === 'object') continue
    if (expected === 'integer' && Number.isInteger(value)) continue
    if (expected !== actual) {
      throw new NodeExecutionError({
        code: 'INPUT_VALIDATION_FAILED',
        message: `输入字段 ${key} 类型应为 ${expected}，实际为 ${actual}。`,
        nodeType: 'start',
        details: { field: key, expected, actual },
      })
    }
    if (
      typeof definition.pattern === 'string' &&
      !new RegExp(definition.pattern).test(String(value))
    ) {
      throw new NodeExecutionError({
        code: 'INPUT_VALIDATION_FAILED',
        message: `输入字段 ${key} 不匹配 ${definition.pattern}。`,
        nodeType: 'start',
        details: { field: key },
      })
    }
  }
}

/**
 * 将结构化模型文本解析为对象。
 * @param text 模型文本。
 * @returns JSON 对象。
 */
function parseStructuredOutput(text: string) {
  try {
    const value = parseJsonOutput(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {
    // The normalized node error below carries the stable error code.
  }
  throw new NodeExecutionError({
    code: 'MODEL_STRUCTURED_OUTPUT_INVALID',
    message: '模型返回内容不是合法 JSON object。',
    nodeType: 'llm',
    retryable: true,
  })
}

/**
 * 解析 JSON 文本并保留可读错误。
 * @param text JSON 文本。
 * @returns 解析结果。
 */
function parseJsonOutput(text: string) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new NodeExecutionError({
      code: 'JSON_PARSE_FAILED',
      message: error instanceof Error ? error.message : 'JSON 解析失败。',
      nodeType: 'template',
      retryable: false,
    })
  }
}

/**
 * 使用受限变量语法渲染模板。
 * @param template 模板文本。
 * @param scope 变量作用域。
 * @param options 缺失值处理选项。
 * @returns 渲染后文本。
 */
function renderTemplate(
  template: string,
  scope: Record<string, unknown>,
  options: { missingStrategy: 'error' | 'empty' | 'keep'; sourceLabel: string },
) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, reference: string) => {
    const value = resolveReference(reference, scope)
    if (value !== undefined) {
      if (value === null) return ''
      return typeof value === 'string' ? value : JSON.stringify(value)
    }
    if (options.missingStrategy === 'empty') return ''
    if (options.missingStrategy === 'keep') return token
    throw new NodeExecutionError({
      code: 'TEMPLATE_VARIABLE_MISSING',
      message: `${options.sourceLabel} 变量不存在：${token}`,
      nodeType: 'template',
    })
  })
}

/**
 * 评估结构化条件。
 * @param condition 条件定义。
 * @param config 条件节点配置。
 * @returns 条件结果。
 */
function evaluateCondition(
  condition: Record<string, unknown>,
  config: NodeConfig,
) {
  const left = resolveConditionValue(condition.left, config)
  const right = resolveConditionValue(condition.right, config)
  const operator = String(condition.operator ?? 'eq')
  const caseSensitive = condition.caseSensitive ?? config.caseSensitive ?? true
  const normalize = (value: unknown) =>
    typeof value === 'string' && caseSensitive === false ? value.toLowerCase() : value
  const a = normalize(left)
  const b = normalize(right)
  let matched = false
  switch (operator) {
    case 'eq':
      matched = a === b
      break
    case 'neq':
      matched = a !== b
      break
    case 'gt':
      matched = Number(a) > Number(b)
      break
    case 'gte':
      matched = Number(a) >= Number(b)
      break
    case 'lt':
      matched = Number(a) < Number(b)
      break
    case 'lte':
      matched = Number(a) <= Number(b)
      break
    case 'contains':
      matched = String(a ?? '').includes(String(b ?? ''))
      break
    case 'not_contains':
      matched = !String(a ?? '').includes(String(b ?? ''))
      break
    case 'starts_with':
      matched = String(a ?? '').startsWith(String(b ?? ''))
      break
    case 'ends_with':
      matched = String(a ?? '').endsWith(String(b ?? ''))
      break
    case 'regex':
      matched = new RegExp(String(b ?? ''), caseSensitive === false ? 'i' : '').test(
        String(a ?? ''),
      )
      break
    case 'in':
      matched = Array.isArray(b) && b.includes(a)
      break
    case 'not_in':
      matched = Array.isArray(b) && !b.includes(a)
      break
    case 'is_empty':
      matched = a === '' || a === null || a === undefined
      break
    case 'is_not_empty':
      matched = a !== '' && a !== null && a !== undefined
      break
    case 'between':
      matched =
        Array.isArray(b) &&
        Number(a) >= Number(b[0]) &&
        Number(a) <= Number(b[1])
      break
    case 'length_eq':
      matched = (Array.isArray(a) || typeof a === 'string' ? a.length : 0) === Number(b)
      break
    case 'length_gt':
      matched = (Array.isArray(a) || typeof a === 'string' ? a.length : 0) > Number(b)
      break
    default:
      throw new NodeExecutionError({
        code: 'CONDITION_OPERATOR_UNSUPPORTED',
        message: `不支持的条件操作符 ${operator}。`,
        nodeType: 'condition',
      })
  }
  return { id: condition.id, operator, left: a, right: b, matched }
}

/**
 * 对尚未解析的条件值执行有限变量替换。
 * @param value 条件值。
 * @param config 条件节点配置。
 * @returns 解析值。
 */
function resolveConditionValue(value: unknown, config: NodeConfig) {
  return value
}

/**
 * 评估 switch 表达式中的受限比较语法。
 * @param expression 表达式。
 * @param values 已解析值集合。
 * @returns 是否命中。
 */
function matchesExpression(expression: unknown, values: NodeConfig) {
  if (typeof expression !== 'string') return false
  const match = /^\s*([\w.]+)\s*(==|>=|<=|>|<|!=)\s*(.*?)\s*$/.exec(expression)
  if (!match) return Boolean(expression)
  const current = lookupResolvedPath(values, match[1])
  const expected = match[3]
  const numeric = Number(expected)
  const target = Number.isFinite(numeric) ? numeric : expected.replace(/^['"]|['"]$/g, '')
  if (match[2] === '==') return String(current) === String(target)
  if (match[2] === '!=') return String(current) !== String(target)
  if (match[2] === '>') return Number(current) > Number(target)
  if (match[2] === '>=') return Number(current) >= Number(target)
  if (match[2] === '<') return Number(current) < Number(target)
  return Number(current) <= Number(target)
}

/**
 * 读取条件配置中的点路径值。
 * @param source 配置对象。
 * @param path 点路径。
 * @returns 命中值。
 */
function lookupResolvedPath(source: Record<string, unknown>, path: string) {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * 将 keyvalue 配置归一化为普通对象。
 * @param value 配置值。
 * @returns 变量赋值映射。
 */
function normalizeAssignments(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const row = item as Record<string, unknown>
          return [String(row.key ?? ''), row.value]
        })
        .filter(([key]) => key),
    )
  }
  return value && typeof value === 'object'
    ? structuredClone(value as Record<string, unknown>)
    : {}
}

/**
 * 将字符串或字符串数组归一化。
 * @param value 配置值。
 * @returns 字符串数组。
 */
function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value) return [value]
  return []
}

/**
 * 将 keyvalue 请求头归一化为 HeadersInit。
 * @param value 请求头配置。
 * @returns 字符串字典。
 */
function normalizeHeaders(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.map((item) => {
        const row = item as Record<string, unknown>
        return [String(row.key ?? ''), String(row.value ?? '')]
      }),
    )
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, String(item)]),
    )
  }
  return {}
}

/**
 * 判断主机名是否指向回环或私有网段。
 * @param hostname URL 主机名。
 * @returns 是否为私有地址。
 */
function isPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.endsWith('.local')
  ) {
    return true
  }
  const octets = normalized.split('.').map(Number)
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item))) return false
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}
