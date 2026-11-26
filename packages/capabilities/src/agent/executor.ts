import {
  BaseNodeExecutor,
  NodeExecutionError,
  agentDefinitionSchema,
  resolveVariables,
  type AgentDefinition,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from '@ai-reflow/core'
import { ZodError } from 'zod'

type NodeConfig = Record<string, unknown>

/**
 * 使用可序列化 AgentDefinition 调用共享运行时。
 */
export class AgentExecutor extends BaseNodeExecutor<NodeConfig> {
  readonly type = 'agent'

  /**
   * 解析工作流配置并在当前流程内执行 Agent。
   * @param context 节点运行上下文。
   * @param config Agent 节点配置。
   * @returns 最终回答、步骤、工具调用、引用和 usage。
   */
  protected async doExecute(
    context: NodeExecutionContext,
    config: NodeConfig,
  ): Promise<NodeExecutionResult> {
    if (!context.services?.agent) {
      throw new NodeExecutionError({
        code: 'AGENT_RUNTIME_NOT_CONFIGURED',
        message: 'Agent 运行时未配置，无法执行智能体节点。',
        nodeType: this.type,
      })
    }
    const nodeId = context.currentNodeId ?? 'agent'
    const definition = this.parseDefinition(context, config)
    const rawInput = resolveVariables(
      config.inputExpression ?? config.input,
      {
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
      },
      { missingStrategy: 'keep' },
    )
    const input = normalizeInput(rawInput, context.input)
    const threadId = this.threadId(definition, context, nodeId, input)
    try {
      const result = await context.services.agent.invoke({
        invocationId: `workflow:${context.runId}:${nodeId}`,
        workspaceId: context.workspaceId,
        runId: context.runId,
        nodeId,
        kind: 'workflow_node',
        threadId,
        definition,
        input,
        signal: context.signal,
        emit: async (event) => {
          await context.emit({
            type: event.type,
            nodeId,
            attempt: context.attempt ?? 1,
            payload: event.payload,
          })
        },
      })
      return {
        output: {
          text: result.text,
          messages: result.messages,
          steps: result.steps,
          toolCalls: result.toolCalls,
          citations: result.citations,
          usage: result.usage,
          finishReason: result.finishReason,
          structured: result.structured,
        },
      }
    } catch (error) {
      if (error instanceof NodeExecutionError) throw error
      throw new NodeExecutionError({
        code: context.signal.aborted ? 'AGENT_CANCELLED' : 'AGENT_RUNTIME_FAILED',
        message:
          error instanceof Error ? error.message : 'Agent 运行时执行失败。',
        nodeType: this.type,
        retryable: !context.signal.aborted,
      })
    }
  }

  /**
   * 校验并填充 Agent 定义默认值。
   * @param context 运行上下文。
   * @param config 节点配置。
   * @returns 可序列化 Agent 定义。
   */
  private parseDefinition(
    context: NodeExecutionContext,
    config: NodeConfig,
  ): AgentDefinition {
    const resolved = resolveVariables(config, {
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
    }, { missingStrategy: 'keep' })
    try {
      return agentDefinitionSchema.parse(resolved) as AgentDefinition
    } catch (error) {
      const detail =
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join('；')
          : 'Agent 配置格式不合法。'
      throw new NodeExecutionError({
        code: 'AGENT_CONFIG_INVALID',
        message: `智能体节点配置不合法：${detail}`,
        nodeType: this.type,
        retryable: false,
      })
    }
  }

  /**
   * 根据记忆模式解析 LangGraph thread。
   * @param definition Agent 定义。
   * @param context 运行上下文。
   * @param nodeId 当前节点 ID。
   * @param input 已解析输入。
   * @returns 稳定或短生命周期 thread ID。
   */
  private threadId(
    definition: AgentDefinition,
    context: NodeExecutionContext,
    nodeId: string,
    input: Record<string, unknown>,
  ) {
    if (definition.memory.mode === 'conversation') {
      const key =
        typeof input.conversationKey === 'string'
          ? input.conversationKey
          : typeof context.variables.conversationKey === 'string'
            ? context.variables.conversationKey
            : undefined
      if (!key) {
        throw new NodeExecutionError({
          code: 'AGENT_CONVERSATION_KEY_REQUIRED',
          message: 'conversation 记忆模式需要稳定的 conversationKey。',
          nodeType: this.type,
        })
      }
      return `conversation:${key}`
    }
    if (definition.memory.mode === 'none') {
      return `ephemeral:${context.runId}:${nodeId}:${Date.now()}`
    }
    return `workflow:${context.runId}:${nodeId}`
  }
}

/**
 * 将表达式结果归一化为 Agent 输入对象。
 * @param value 已解析输入表达式。
 * @param fallback 工作流原始输入。
 * @returns Agent 运行输入。
 */
function normalizeInput(
  value: unknown,
  fallback: Record<string, unknown>,
) {
  if (typeof value === 'string') return { text: value }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return structuredClone(fallback)
}
