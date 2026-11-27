import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import { AgentConversationRepository } from '@ai-reflow/platform'
import {
  AgentApiOperations,
  initialEventSeq,
  orderEventBacklog,
  readAllInvocationEvents,
  sseFrame,
  validateKnowledgeUpload,
} from '../../apps/server/src/agent-api'

test('agent create rejects an invalid definition before touching repositories', async () => {
  let created = 0
  const operations = makeOperations({
    agents: {
      async create() {
        created += 1
        return {}
      },
    } as never,
  })

  await assert.rejects(
    () =>
      operations.createAgent({
        name: '售后助手',
        config: { instructions: '' },
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'REQUEST_INVALID' &&
      error.status === 400,
  )
  assert.equal(created, 0)
})

test('conversation creation stores an immutable agent snapshot', async () => {
  const agentConfig = {
    instructions: '版本一的系统指令。',
    modelConnectionId: 'mc_local',
    mcpTools: [],
    maxSteps: 4,
    timeoutMs: 30_000,
    memory: { mode: 'conversation' as const },
  }
  let capturedSnapshot = ''
  const sql = createSnapshotSql(agentConfig, (snapshot) => {
    capturedSnapshot = snapshot
  })
  const repository = new AgentConversationRepository(
    sql as never,
    '018f0000-0000-7000-8000-000000000001',
  )

  const conversation = await repository.create('agent_1')
  agentConfig.instructions = '创建后被修改的版本二。'

  assert.match(capturedSnapshot, /版本一的系统指令/)
  assert.equal(conversation.revision, 1)
})

test('duplicate active sends surface CONVERSATION_BUSY', async () => {
  const operations = makeOperations({
    conversations: {
      async sendMessage() {
        throw new AppError({
          code: 'CONVERSATION_BUSY',
          message: '当前会话已有正在执行的回答。',
          status: 409,
        })
      },
    } as never,
  })

  await assert.rejects(
    operations.sendMessage(
      'conv_1',
      { content: '第二轮问题', attachments: [], metadata: {} },
      'idem_2',
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'CONVERSATION_BUSY',
  )
})

test('invocation cancel is idempotent at the API boundary', async () => {
  let calls = 0
  const operations = makeOperations({
    invocations: {
      async cancel() {
        calls += 1
        return { invocationId: 'agi_1', status: 'cancelled' }
      },
    } as never,
  })

  assert.deepEqual(await operations.cancelInvocation('agi_1'), {
    invocationId: 'agi_1',
    status: 'cancelled',
  })
  assert.deepEqual(await operations.cancelInvocation('agi_1'), {
    invocationId: 'agi_1',
    status: 'cancelled',
  })
  assert.equal(calls, 2)
})

test('SSE backlog is filtered by cursor and ordered by seq', () => {
  const backlog = orderEventBacklog(
    [{ seq: 4 }, { seq: 2 }, { seq: 3 }, { seq: 1 }],
    1,
  )

  assert.deepEqual(backlog.map((event) => event.seq), [2, 3, 4])
  assert.equal(
    sseFrame({ seq: 2, type: 'message.delta', invocationId: 'agi_1' }),
    'id: 2\nevent: message.delta\ndata: {"seq":2,"type":"message.delta","invocationId":"agi_1"}\n\n',
  )
})

test('SSE cursor prefers Last-Event-ID over the query cursor', () => {
  assert.equal(
    initialEventSeq(
      { 'last-event-id': '12' },
      { after: '4' },
    ),
    12,
  )
  assert.equal(initialEventSeq({}, { after: '7' }), 7)
})

test('SSE drains every backlog page before terminal handling', async () => {
  const source = Array.from({ length: 450 }, (_, index) => ({
    seq: index + 1,
  }))
  const events = await readAllInvocationEvents(async (after, limit) => {
    return source
      .filter((event) => event.seq > after)
      .slice(0, limit)
  }, 0)

  assert.equal(events.length, 450)
  assert.equal(events[0].seq, 1)
  assert.equal(events.at(-1)?.seq, 450)
})

test('upload validation rejects oversized and legacy office files', () => {
  assert.throws(
    () =>
      validateKnowledgeUpload({
        filename: 'large.pdf',
        mime: 'application/pdf',
        bytes: Buffer.from('%PDF-1.7'),
        declaredSize: 51 * 1024 * 1024,
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'KNOWLEDGE_FILE_TOO_LARGE' &&
      error.status === 413,
  )
  assert.throws(
    () =>
      validateKnowledgeUpload({
        filename: 'legacy.doc',
        mime: 'application/msword',
        bytes: Buffer.from('legacy'),
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'KNOWLEDGE_LEGACY_OFFICE_UNSUPPORTED' &&
      error.status === 415,
  )
})

test('upload validation accepts supported files and computes sha256', () => {
  const result = validateKnowledgeUpload({
    filename: '退款政策.pdf',
    mime: 'application/pdf',
    bytes: Buffer.from('pdf-bytes'),
  })

  assert.equal(result.extension, 'pdf')
  assert.equal(result.name, '退款政策.pdf')
  assert.equal(result.sizeBytes, 9)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
})

test('upload validation repairs UTF-8 filenames decoded as latin1', () => {
  const name = '退款政策.pdf'
  const mojibake = Buffer.from(name, 'utf8').toString('latin1')
  const result = validateKnowledgeUpload({
    filename: mojibake,
    mime: 'application/pdf',
    bytes: Buffer.from('pdf-bytes'),
  })

  assert.equal(result.name, name)
})

function makeOperations(overrides: Record<string, unknown>) {
  return new AgentApiOperations({
    agents: {} as never,
    conversations: {} as never,
    invocations: {} as never,
    knowledge: {} as never,
    ingestJobs: {} as never,
    ...overrides,
  } as never)
}

function createSnapshotSql(
  config: Record<string, unknown>,
  capture: (snapshot: string) => void,
) {
  const workspaceId = '018f0000-0000-7000-8000-000000000001'
  const agentRow = {
    id: '018f0000-0000-7000-8000-000000000002',
    public_id: 'agent_1',
    workspace_id: workspaceId,
    name: '售后助手',
    description: '',
    config,
    revision: 1,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }
  let snapshot = ''
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?')
    if (query.includes('::jsonb')) {
      return { json: values[0] }
    }
    if (query.includes('from agents')) {
      return [agentRow]
    }
    if (query.includes('insert into agent_conversations')) {
      const jsonb = values.find(
        (value) =>
          value &&
          typeof value === 'object' &&
          'json' in value,
      ) as { json: string } | undefined
      snapshot = jsonb?.json ?? ''
      capture(snapshot)
      return []
    }
    if (query.includes('select c.*')) {
      return [{
        id: agentRow.id,
        public_id: 'conv_1',
        workspace_id: workspaceId,
        agent_id: agentRow.id,
        agent_revision: 1,
        agent_snapshot: JSON.parse(snapshot),
        thread_id: 'conversation:conv_1',
        title: '新会话',
        status: 'active',
        metadata: {},
        last_message_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        agent_name: agentRow.name,
      }]
    }
    return []
  }
  return tag
}
