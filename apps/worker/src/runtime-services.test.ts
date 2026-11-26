import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapabilityRegistry } from '@ai-reflow/capabilities'
import type {
  AgentInvokeInput,
  AgentInvokeResult,
  NodeExecutionContext,
  NodeRuntimeServices,
  WorkflowDefinition,
} from '@ai-reflow/core'
import { compileWorkflow, executeWorkflow } from '@ai-reflow/engine'

test('workflow agent node invokes the shared runtime in-process', async () => {
  const definition: WorkflowDefinition = {
    schemaVersion: '1.0',
    name: 'Agent node test',
    nodes: [
      {
        id: 'start',
        type: 'start',
        title: 'Start',
        x: 0,
        y: 0,
        config: {
          inputSchema: {
            type: 'object',
            required: ['question'],
            properties: { question: { type: 'string' } },
          },
        },
      },
      {
        id: 'agent',
        type: 'agent',
        title: 'Agent',
        x: 200,
        y: 0,
        config: {
          instructions: '只根据事实回答。',
          inputExpression: '{{ $input.question }}',
          modelConnectionId: 'mc_local',
          mcpTools: [],
          maxSteps: 4,
          timeoutMs: 30_000,
          memory: { mode: 'run' },
        },
      },
      {
        id: 'output',
        type: 'output',
        title: 'Output',
        x: 400,
        y: 0,
        config: {
          content: '{{ $node.agent.output.text }}',
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'agent' },
      { id: 'e2', source: 'agent', target: 'output' },
    ],
  }
  const compiled = compileWorkflow(definition)
  assert.ok(compiled.plan)

  const captured: AgentInvokeInput[] = []
  const services: NodeRuntimeServices = {
    agent: {
      async invoke(input): Promise<AgentInvokeResult> {
        captured.push(input)
        return {
          text: '退款 7 天到账',
          messages: [],
          steps: [],
          toolCalls: [],
          citations: [],
          usage: {},
          finishReason: 'complete',
        }
      },
    },
  }
  const context: NodeExecutionContext = {
    runId: 'run_1',
    workspaceId: 'workspace_1',
    workflowId: 'workflow_1',
    runKind: 'preview',
    trigger: 'manual_preview',
    input: { question: '退款多久到账？' },
    variables: {},
    outputs: {},
    services,
    signal: new AbortController().signal,
    async emit() {},
  }

  const result = await executeWorkflow({
    plan: compiled.plan,
    context,
    executors: createCapabilityRegistry(),
  })

  assert.equal(result.status, 'succeeded')
  assert.equal(captured.length, 1)
  assert.equal(captured[0].kind, 'workflow_node')
  assert.equal(captured[0].runId, 'run_1')
  assert.equal(captured[0].nodeId, 'agent')
  assert.deepEqual(captured[0].input, { text: '退款多久到账？' })
})
