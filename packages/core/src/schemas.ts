import { z } from 'zod'
import { agentDefinitionSchema } from './agent'

const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  config: z.record(z.string(), z.unknown()),
  manifestVersion: z.string().optional(),
})

const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  type: z.string().optional(),
})

export const workflowDefinitionSchema = z.object({
  schemaVersion: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
})

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
  templateId: z.string().optional(),
})

export const updateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  definition: workflowDefinitionSchema.optional(),
  revision: z.number().int().positive().optional(),
})

export const publishWorkflowSchema = z.object({
  revision: z.number().int().positive(),
  changelog: z.string().max(500).optional().default(''),
})

export const runOptionsSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
})

export const previewRunSchema = z.object({
  definition: workflowDefinitionSchema,
  input: z.record(z.string(), z.unknown()).default({}),
  options: runOptionsSchema.optional(),
})

export const productionRunSchema = z.object({
  workflowVersionId: z.string().min(1),
  trigger: z.enum(['manual_trial', 'api', 'mcp', 'webhook', 'schedule', 'event']).default('manual_trial'),
  input: z.record(z.string(), z.unknown()).default({}),
  options: runOptionsSchema.optional(),
})

const modelCapabilitySchema = z.enum([
  'text',
  'vision',
  'tools',
  'structured',
  'embedding',
  'rerank',
])

const secretRefSchema = z
  .string()
  .min(1)
  .regex(/^secret:\/\/[a-zA-Z0-9._/-]+$/, '凭据必须使用 secret:// 引用。')

export const createModelConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().nullable().optional(),
  defaultModel: z.string().trim().min(1).max(200),
  contextWindow: z.number().int().min(0).max(10_000_000).optional().default(0),
  capabilities: z.array(modelCapabilitySchema).max(12).optional().default([]),
  fallbackOrder: z.array(z.string().trim().min(1)).max(20).optional().default([]),
  secretRef: secretRefSchema.optional(),
  isDefault: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
})

export const updateModelConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  provider: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().url().nullable().optional(),
  defaultModel: z.string().trim().min(1).max(200).optional(),
  contextWindow: z.number().int().min(0).max(10_000_000).optional(),
  capabilities: z.array(modelCapabilitySchema).max(12).optional(),
  fallbackOrder: z.array(z.string().trim().min(1)).max(20).optional(),
  secretRef: secretRefSchema.optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

export const createKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  embeddingProvider: z.string().trim().min(1).max(80).optional(),
  embeddingModel: z.string().trim().min(1).max(200).optional(),
  embeddingDimension: z.number().int().min(1).max(8192).optional(),
  chunkSize: z.number().int().min(40).max(4000).optional(),
  overlapSize: z.number().int().min(0).max(3999).optional(),
  separator: z.string().max(64).optional(),
})

export const updateKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  chunkSize: z.number().int().min(40).max(4000).optional(),
  overlapSize: z.number().int().min(0).max(3999).optional(),
  separator: z.string().max(64).optional(),
})

export const knowledgeSearchSchema = z.object({
  query: z.string().trim().min(1).max(5000),
  topK: z.number().int().min(1).max(20).optional().default(5),
  scoreThreshold: z.number().min(0).max(1).optional().default(0),
  retrievalMode: z.enum(['vector', 'keyword', 'hybrid']).optional().default('keyword'),
  rerank: z.object({ enabled: z.boolean() }).optional(),
})

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  config: agentDefinitionSchema,
})

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  config: agentDefinitionSchema.optional(),
})

export const createAgentConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
})

export const updateAgentConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
})

export const sendAgentMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  attachments: z.array(z.record(z.string(), z.unknown())).max(10).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export const testAgentSchema = z.object({
  content: z.string().trim().min(1).max(20_000).default('你好，请介绍一下你的能力。'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export const retryAgentMessageSchema = z.object({
  userMessageId: z.string().trim().min(1).max(200),
})

const mcpTransportSchema = z.enum(['streamable-http', 'sse', 'stdio'])
const mcpAuthTypeSchema = z.enum([
  'none',
  'bearer',
  'api-key',
  'basic',
  'custom-header',
  'oauth2',
])

export const createMcpServerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug 只能包含小写字母、数字、下划线和短横线。'),
    description: z.string().max(2000).optional().default(''),
    transport: mcpTransportSchema,
    endpoint: z.string().trim().url().max(2000).optional(),
    command: z.string().trim().min(1).max(2000).optional(),
    args: z.array(z.string().max(500)).max(100).optional().default([]),
    authType: mcpAuthTypeSchema.optional().default('none'),
    secretRef: secretRefSchema.optional(),
    allowlist: z.array(z.string().trim().min(1).max(255)).max(50).optional().default([]),
    toolAllowlist: z.array(z.string().trim().min(1).max(200)).max(200).optional().default([]),
    timeouts: z
      .object({
        connectMs: z.number().int().min(1000).max(120_000).optional(),
        requestMs: z.number().int().min(1000).max(300_000).optional(),
        sseMs: z.number().int().min(1000).max(600_000).optional(),
      })
      .optional()
      .default({}),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((value, context) => {
    if (value.transport === 'stdio' && !value.command) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'stdio 连接必须提供 command。',
      })
    }
    if (value.transport !== 'stdio' && !value.endpoint) {
      context.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: '远程 MCP 连接必须提供 endpoint。',
      })
    }
  })

export const updateMcpServerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  description: z.string().max(2000).optional(),
  transport: mcpTransportSchema.optional(),
  endpoint: z.string().trim().url().max(2000).nullable().optional(),
  command: z.string().trim().min(1).max(2000).nullable().optional(),
  args: z.array(z.string().max(500)).max(100).optional(),
  authType: mcpAuthTypeSchema.optional(),
  secretRef: secretRefSchema.nullable().optional(),
  allowlist: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  toolAllowlist: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  timeouts: z
    .object({
      connectMs: z.number().int().min(1000).max(120_000).optional(),
      requestMs: z.number().int().min(1000).max(300_000).optional(),
      sseMs: z.number().int().min(1000).max(600_000).optional(),
    })
    .optional(),
  enabled: z.boolean().optional(),
})

export const mcpToolCallSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
})

const mcpInboundAuthSchema = z.enum(['none', 'bearer', 'api-key'])
const mcpInboundScopeSchema = z.enum([
  'workflow:run',
  'run:read',
  'run:cancel',
])

export const workflowMcpExposureSchema = z
  .object({
    workflowVersionId: z.string().trim().min(1),
    enabled: z.boolean().optional().default(true),
    toolName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
        '工具名只能包含字母、数字、下划线和短横线。',
      ),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional().default(''),
    instructions: z.string().max(4000).nullable().optional(),
    outputMode: z.enum(['text', 'structured']).optional().default('structured'),
    visibility: z.enum(['private', 'public']).optional().default('private'),
    authMode: mcpInboundAuthSchema.optional().default('api-key'),
    accessToken: z.string().min(24).max(4096).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional().default(60_000),
    maxConcurrency: z.number().int().min(1).max(100).optional().default(5),
  })
  .superRefine((value, context) => {
    if (value.authMode === 'none' && value.accessToken) {
      context.addIssue({
        code: 'custom',
        path: ['accessToken'],
        message: '未启用认证时不接受访问令牌。',
      })
    }
  })

export const workflowMcpTokenRotationSchema = z.object({
  token: z.string().min(24).max(4096),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.array(mcpInboundScopeSchema).max(3).optional().default([
    'workflow:run',
    'run:read',
    'run:cancel',
  ]),
})

export const mcpAccessTokenCreateSchema = z.object({
  exposureId: z.string().trim().min(1),
  token: z.string().min(24).max(4096),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.array(mcpInboundScopeSchema).max(3).optional().default([
    'workflow:run',
    'run:read',
    'run:cancel',
  ]),
})

export const templateClonePlanSchema = z.object({
  targetName: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(80).optional(),
})

export const templateCloneSchema = z.object({
  planId: z.string().trim().min(1),
  targetName: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(80),
})

export const pluginInstallPlanSchema = z.object({
  entryId: z.string().trim().min(1),
  action: z.enum(['install', 'upgrade', 'rollback']),
  version: z.string().trim().min(1).max(80),
})

export const pluginInstallSchema = z.object({
  planId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  highRiskConfirmed: z.boolean().optional().default(false),
})

export const pluginInstallUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  credentials: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(120),
        secretRef: secretRefSchema,
        authType: z.enum(['api-key', 'oauth', 'bearer']).optional(),
      }),
    )
    .max(30)
    .optional(),
})

export const pluginLifecycleSchema = z.object({
  planId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  highRiskConfirmed: z.boolean().optional().default(false),
})
