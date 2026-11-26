# 14 Agent 运行时、会话记忆与知识库

> 优先级：P0。
> 状态：设计待确认。
> 目标：用 TypeScript 实现一个可被工作流 `agent` 节点和独立问答界面共同调用的 Agent 运行时，支持 LangGraph 工具循环、知识库检索、多轮记忆、会话恢复、流式输出、取消、重试与知识库文档入库。
> 相关包：`@ai-reflow/core`、`@ai-reflow/capabilities`、`@ai-reflow/platform`、`@ai-reflow/engine`、`apps/server`、`apps/worker`、`apps/web`。

## 1. 背景与目标

现有系统已经具备：

- 自研 TypeScript DAG 引擎与节点执行器基类。
- PostgreSQL 运行队列、运行事件、取消和 worker 心跳。
- PostgreSQL 全文检索、知识库/文档/chunk 数据表。
- OpenAI 兼容模型连接与模型设置 UI。
- 工作流 `agent` 节点的配置占位，但尚无真实执行器。

当前缺口：

- 没有可执行的 LangGraph Agent Runtime。
- 没有 Agent Profile、Conversation、Message、Invocation 数据模型。
- 没有 LangGraph Postgres Checkpoint，不能可靠恢复中断的 Agent。
- 没有独立问答界面及流式会话 API。
- 知识库只有真实全文检索；上传、解析、分块、Ollama embedding、pgvector 检索和 ingest 重试尚未落地。
- 现有 worker 只顺序领取工作流运行，无法隔离高频问答、Agent 调用和长耗时文档入库。

本设计要交付两种形态：

1. 工作流中的 `agent` 节点：由流程引擎调用，输出最终答案、步骤、工具调用、引用和 usage。
2. 独立问答界面：同一 Agent Runtime 接收多轮消息，通过 SSE 流式显示回答和工具过程，并支持刷新、断线重连和会话恢复。

## 2. 已确认决策

### 2.1 方案 A：现有 worker 内实现并隔离队列

采用：

- 保留现有 TypeScript worker 和自研流程引擎。
- LangGraph 只负责 Agent 内部状态图，不替换工作流 DAG 引擎。
- 独立问答使用 `agent-invoke` 队列。
- 知识库文档处理使用 `knowledge-ingest` 队列。
- 工作流节点由 workflow worker 直接调用同一个 `AgentRuntime`，不嵌套入队，避免二次排队和死锁。
- 一个 worker 进程可按角色运行多个消费循环，也可用多个副本分别运行 `workflow`、`agent`、`ingest` 角色。

未采用：

- 独立 `apps/agent-service`：隔离性更强，但当前阶段增加部署、鉴权、通信和调试成本。
- Agent 放在 server 进程内：会混用控制面与长任务执行面，并绕过现有 worker 租约、取消和事件模型。

### 2.2 技术选型

- Agent 状态图：`@langchain/langgraph`。
- LangChain 基础协议：`@langchain/core`。
- 本地聊天与 embedding：`@langchain/ollama`。
- OpenAI 兼容聊天：`@langchain/openai`，DeepSeek 使用 OpenAI 兼容 `baseURL`。
- Checkpoint：`@langchain/langgraph-checkpoint-postgres` 的 `PostgresSaver`。
- 运行时、SQL、API、worker、前端全部使用 TypeScript。
- 不引入 Python 服务。

依赖安装时锁定同一兼容线：

```text
@langchain/core@^1.5.x
@langchain/langgraph@^1.7.x
@langchain/ollama@^1.3.x
@langchain/openai@^1.8.x
@langchain/langgraph-checkpoint@^1.2.x
@langchain/langgraph-checkpoint-postgres@^1.1.x
zod@^4.x
```

### 2.3 模型与 embedding 边界

- 聊天模型是会话级或节点级可配置能力。
- 本地默认走 Ollama；后续切换 DeepSeek 时只替换聊天 Provider，不改变 Agent 图。
- DeepSeek 不默认承担 embedding；embedding 继续使用 Ollama 或其他显式配置的 embedding Provider。
- P0 部署固定一个 embedding 模型与维度，创建知识库时记录 `provider/model/dimension`。
- P0 默认本地 embedding 为 `nomic-embed-text`，维度 768。
- 更换 embedding 模型或维度必须重建知识库索引，不能在原向量上混用。

## 3. 目标、非目标与失败条件

### 3.1 目标

- 流程节点与问答界面共用 `AgentRuntime`、Provider、知识检索与工具执行代码。
- 问答会话支持多轮消息、页面刷新恢复、SSE 断线续传和 worker 异常后的 Checkpoint 恢复。
- Agent 工具循环有最大步数、超时、取消、循环保护和 usage 记录。
- 知识库检索结果带可追溯引用，并注入 Agent 上下文。
- 文档入库支持上传、解析、分块、embedding、索引、失败原因、阶段重试与重建。
- 高频问答、工作流 Agent 节点和长耗时 ingest 互不阻塞。
- 本地 Ollama 可直接运行；后续 DeepSeek 通过配置切换。

### 3.2 非目标

- P0 不实现多 Agent 协作、Agent-to-Agent 协议或自主长期任务。
- P0 不实现 UI 内任意代码执行沙箱。
- P0 不实现跨 Agent 共享记忆。
- P0 不实现 OCR，扫描 PDF 只返回明确 unsupported/失败。
- P0 不实现旧 `.doc`/`.xls` 的完整转换，除非部署提供 LibreOffice；默认仅支持 `.docx`/`.xlsx`。
- P0 不实现向量数据库抽象层，继续使用 pgvector。
- P0 不把 LangGraph 状态当作唯一业务会话记录；业务消息仍以 PostgreSQL 明表为准。

### 3.3 反目标

- 问答和工作流维护两套 Prompt、工具或知识库调用逻辑。
- 因刷新页面丢失会话或重复计费。
- 因 worker 崩溃导致已开始的 Agent 无法恢复，或恢复后重复执行有副作用的工具。
- 无上限工具循环、无限上下文、无超时 embedding 调用。
- 将 API Key、完整系统 Prompt、内部 Chain-of-Thought 或向量明文写入普通事件。
- 对话中静默切换 Agent 配置导致同一会话行为漂移。

## 4. 总体架构

```text
apps/web
  ├─ Agent 列表 / 配置 / 问答页
  └─ Workflow Agent 节点 Inspector
          │
          ▼
apps/server
  ├─ Agent Profile / Conversation REST
  ├─ Agent Invocation 创建 / 取消 / 恢复
  └─ Agent SSE 事件转发
          │
          ▼
PostgreSQL queues
  ├─ runs                  workflow
  ├─ agent_invocations     问答/外部 Agent 调用
  └─ knowledge_ingest_jobs 文档入库
          │
          ▼
apps/worker
  ├─ workflow consumer
  │    └─ AgentExecutor → AgentRuntime
  ├─ agent-invoke consumer
  │    └─ AgentRuntime
  └─ knowledge-ingest consumer
       └─ parser → chunker → embedding → pgvector
          │
          ▼
packages/capabilities
  ├─ nodes/agent
  ├─ providers
  └─ knowledge
          │
          ▼
packages/platform
  ├─ Agent/Conversation/Invocation repositories
  ├─ Checkpoint adapter
  └─ Knowledge/Ingest repositories
```

职责边界：

- `engine` 只调度工作流节点。
- `AgentExecutor` 只把节点配置和上下文转换为 `AgentInvokeInput`，把结果转换为节点输出。
- `AgentRuntime` 负责 LangGraph、记忆、工具循环和最终回答。
- `AgentInvocationRepository` 负责队列、租约、事件和状态。
- `ConversationRepository` 负责用户可见消息与会话列表。
- `KnowledgeIngestRepository` 负责入库作业状态、阶段错误和重试。
- `KnowledgeService` 只暴露检索、引用和上下文端口，不把 SQL 细节泄漏给 Agent 图。

## 5. Agent Runtime

### 5.1 Agent 定义

P0 使用一个可序列化定义：

```ts
interface AgentDefinition {
  instructions: string
  inputExpression?: string
  modelConnectionId: string
  model?: string
  temperature?: number
  maxTokens?: number
  knowledge?: {
    knowledgeBaseIds: string[]
    topK: number
    scoreThreshold: number
    retrievalMode: 'vector' | 'keyword' | 'hybrid'
  }
  mcpTools?: Array<{
    serverId: string
    toolName: string
    description?: string
    parameters?: Record<string, unknown>
  }>
  maxSteps: number
  timeoutMs: number
  outputSchema?: Record<string, unknown>
  memory: {
    mode: 'none' | 'conversation' | 'run'
  }
}
```

约束：

- `maxSteps` 默认 8，范围 1-32。
- `timeoutMs` 默认 120000，范围 1000-3600000。
- `knowledge` 为空时不挂知识库工具。
- `mcpTools` 必须受 server allowlist 和 tool allowlist 约束。
- 结构化输出必须通过 `outputSchema`。
- Q&A 会话创建时保存 `agentRevision` 和 `agentSnapshot`；同一会话后续轮次继续使用该快照。
- 工作流节点使用发布版本内的 `node.config` 快照。
- 每次 invocation 同时保存 `definition_snapshot`，恢复时不得读取最新可变配置。

### 5.2 LangGraph 状态图

```text
START
  → prepare_input
  → retrieve_knowledge (可选)
  → call_model
      ├─ 有 tool_calls 且未超步数 → execute_tools → call_model
      └─ 无 tool_calls / 达到上限 → finalize
  → END
```

状态字段：

```ts
interface AgentGraphState {
  messages: BaseMessage[]
  input: Record<string, unknown>
  citations: KnowledgeCitation[]
  steps: AgentStep[]
  usage: Record<string, unknown>
  stepCount: number
  finishReason?: 'complete' | 'max_steps' | 'cancelled' | 'error'
}
```

要求：

- `messages` 使用追加 reducer，不能每轮重建全部历史。
- 知识库预检索使用最近一条用户消息。
- 模型绑定可用工具，使用 LangGraph 条件边形成工具循环。
- `execute_tools` 对每次工具调用记录开始、结束、参数摘要、结果摘要和可重试错误。
- 工具输出标记为不可信数据，不允许覆盖系统指令。
- 达到 `maxSteps` 时停止工具调用，输出明确 `finishReason=max_steps`。
- 取消通过 `AbortSignal` 传播到模型、工具和等待步骤。
- 最终输出包含 `text`、`messages`、`steps`、`toolCalls`、`citations`、`usage`、`finishReason`。

### 5.3 Provider 适配

```text
packages/capabilities/src/providers/
  index.ts
  ollama/
    chat.ts
    embeddings.ts
  openai-compatible/
    chat.ts
  registry.ts
```

聊天 Provider 输入：

```ts
interface ChatProviderInput {
  connection: {
    provider: string
    baseUrl?: string
    model: string
    secretRef?: string
    capabilities: string[]
  }
  messages: BaseMessage[]
  tools?: StructuredTool[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}
```

规则：

- `provider=ollama` 走 ChatOllama，不要求 API Key。
- `provider=deepseek`、`provider=openai` 或 `provider=custom` 走 ChatOpenAI。
- DeepSeek 默认 `baseUrl=https://api.deepseek.com/v1`。
- 服务端按 `credentialId` 解析密钥；P0 保留 `AI_REFLOW_MODEL_API_KEY` / `DEEPSEEK_API_KEY` 的环境变量回退。
- Provider 错误归一化为 `MODEL_RATE_LIMITED`、`MODEL_UNAVAILABLE`、`MODEL_AUTH_FAILED`、`MODEL_TIMEOUT` 等稳定错误码。

### 5.4 NodeRuntimeServices 扩展

新增端口：

```ts
agent?: {
  invoke(input: AgentInvokeInput): Promise<AgentInvokeResult>
  resume(input: AgentResumeInput): Promise<AgentInvokeResult>
  cancel(invocationId: string): Promise<void>
}
```

`AgentExecutor` 从 `context.services.agent` 调用。问答 consumer 从同一 worker 服务工厂构造同一 Runtime，禁止复制实现。

## 6. 多轮记忆与会话恢复

### 6.1 两层状态

1. 业务消息层：`agent_messages` 保存用户和助手可见消息，是会话列表、历史展示和审计的真实来源。
2. 图状态层：LangGraph Postgres Checkpoint 保存 `messages`、工具中间结果、citations、步骤和待恢复状态。

恢复时需要同时满足：

- 业务消息能重新渲染完整对话。
- Graph Checkpoint 能恢复未完成的工具循环。
- Invocation 保存原始 `definition_snapshot`，避免配置漂移。
- 同一次 invocation 的工具调用具有幂等键。

### 6.2 Thread 映射

- 独立问答：`thread_id = conversation:<conversationPublicId>`。
- 工作流 `memory.mode=run`：`thread_id = workflow:<runId>:<nodeId>`。
- 工作流 `memory.mode=conversation`：使用配置变量解析出的稳定 `conversationKey`。
- `memory.mode=none`：每次调用生成短生命周期 thread，不进入持久会话。

P0 工作流 Agent 节点默认 `memory.mode=run`；问答界面固定持久会话。

### 6.3 新消息

```text
校验会话归属与状态
  → 创建 invocation
  → 持久化用户消息
  → agent-invoke worker 领取
  → 加载 conversation + definition snapshot
  → 使用同一 thread_id 调用 LangGraph
  → Checkpoint 写图状态
  → 流式写入 invocation events
  → 完成后写助手消息与会话 last_message_at
```

### 6.4 刷新与断线恢复

- 前端先加载 conversation 和 messages。
- 订阅 `/api/agent-invocations/:id/events?after=N`。
- 服务端先补 invocation event backlog，再持续轮询新事件。
- SSE 使用 `Last-Event-ID` 和 `seq`。
- 页面刷新后继续挂载当前 queued/running invocation。

### 6.5 Worker 崩溃与中断恢复

- invocation 有 lease、heartbeat、cancel_requested_at。
- worker 崩溃后租约过期，恢复 consumer 将状态标为 `interrupted` 并重新领取。
- 若存在 Checkpoint，从最后一个成功步骤继续；若不存在，从用户消息重新开始。
- 每次 invocation 保存 `resume_checkpoint_id`。
- 有副作用工具写入 `tool_calls.idempotency_key`，恢复前先查已完成记录。
- 取消后不自动恢复；用户可发起“从本轮重新生成”，创建新的 invocation。

### 6.6 上下文窗口管理

- P0 读取模型 `context_window`，保留系统消息和最近 N 轮消息。
- 工具结果按字符/token预算截断，并标记截断。
- 超过预算时丢弃最旧的非系统消息；被丢弃的消息仍保留在业务记录中。
- P1 再增加摘要压缩，不在 P0 隐式调用额外模型。

## 7. 队列与 worker 角色

### 7.1 独立队列

```text
runs                 workflow 运行
agent_invocations    独立问答与外部 Agent 调用
knowledge_ingest_jobs 文档入库、重试与重建
```

工作流内部 Agent 节点不创建 `agent_invocations` 队列任务，因此不会出现：

```text
workflow run 等 agent job
agent job 等 workflow run
```

### 7.2 Worker 角色

新增配置：

```text
WORKER_ROLES=workflow,agent,ingest
WORKER_WORKFLOW_CONCURRENCY=2
WORKER_AGENT_CONCURRENCY=8
WORKER_INGEST_CONCURRENCY=2
```

默认开发环境运行全部角色；生产可启动三类 worker 副本：

```text
worker-workflow
worker-agent
worker-ingest
```

每个消费循环使用 PostgreSQL `FOR UPDATE SKIP LOCKED`、租约和退避轮询。

### 7.3 高频保护

- Q&A invocation 单会话同一时刻只允许一个 active invocation。
- 节点/Agent 最大步数与超时均可配置。
- 每个 workspace 有并发上限。
- Ollama/DeepSeek Provider 有超时与 429/5xx 退避。
- Token delta 可批量写事件；最终消息、工具状态和错误必须落库。
- 取消请求通过 heartbeat 或独立取消表检查，不依赖 HTTP 连接是否关闭。

## 8. 知识库设计

### 8.1 入库流水线

```text
upload
  → object storage
  → knowledge_ingest_job(queued)
  → parse
  → normalize
  → chunk
  → embedding
  → pgvector upsert
  → document ready
  → knowledge base ready
```

每个阶段可单独重试：

- `parse`：文件损坏、格式不支持、加密或超限。
- `chunk`：策略配置错误或切分超限。
- `embedding`：模型不可用、限流、维度不一致。
- `index`：数据库写入或向量索引失败。

`knowledge_ingest_jobs` 保存 `stage`、`attempt`、`max_attempts`、`next_retry_at`、`error_code`、`error_message`。

### 8.2 P0 格式

| 格式 | 解析实现 | P0 |
| --- | --- | --- |
| TXT | Node 文本解码 | 是 |
| Markdown | 文本解析 + 标题/段落结构 | 是 |
| HTML | `cheerio` 安全提取正文 | 是 |
| CSV | `csv-parse`，分块读取 | 是 |
| PDF | TypeScript PDF 文本解析器 | 是 |
| DOCX | `mammoth` 提取文本与结构 | 是 |
| XLSX | `xlsx` 逐 sheet/行范围读取 | 是 |
| 扫描 PDF / 图片 | OCR | 否，P1 |
| `.doc` / `.xls` | LibreOffice 外部转换 | 否，明确提示 unsupported |

### 8.3 分块

P0 使用结构感知分块：

- Markdown：标题层级、段落、列表、代码块不得被硬切断。
- 纯文本：段落优先，超长段落后按字符窗口切分。
- CSV/XLSX：按 sheet 与行区间成组。
- PDF/DOCX：尽量保留页码、标题路径。
- 默认 `chunkSize=800`，`overlap=120`，以配置为准。
- chunk 必须保存 `documentId`、`chunkIndex`、`content`、`tokenCount`、`metadata`。

### 8.4 Embedding 与 pgvector

- Embedding Provider 通过 `@langchain/ollama` 的 `OllamaEmbeddings`。
- 默认模型 `nomic-embed-text`，维度 768。
- 批量大小默认 32，可配置。
- 429、5xx、连接错误按指数退避重试；4xx 配置错误不重试。
- 写入前校验所有向量维度一致。
- P0 部署固定 768 维；当前 `vector(1536)` 需要新增迁移改为 768 维，并重建 HNSW cosine 索引。
- 已有非空 1536 维向量不能静默截断；迁移检测到数据时必须阻止并提示先导出/重建。
- 若后续需要多 embedding 配置，迁移到独立维度表或分区索引，不在 P0 混存不同维度。

### 8.5 检索

```ts
interface KnowledgeRetrieveInput {
  knowledgeBaseIds: string[]
  query: string
  topK: number
  scoreThreshold: number
  retrievalMode: 'vector' | 'keyword' | 'hybrid'
  signal?: AbortSignal
}
```

规则：

- 先按 workspace 和知识库过滤，再做相似度排序。
- P0 支持 `vector` 与 `keyword`；`hybrid` 先以加权合并实现，允许 P1 完善 rerank。
- 返回 `chunks`、`citations`、`context`、`total`、`warnings`。
- 每个 citation 带 chunkId、documentId、documentName、页码/sheet/行范围/标题。
- 上下文按 token 预算截断，并保留 citation 顺序。
- embedding 不可用时，若配置允许，明确降级为 keyword 并写入 warning；不能静默伪装向量检索。

### 8.6 对象存储与上传

- 增加 `ObjectStorage` 端口。
- 开发默认可使用本地目录适配器；Compose 环境使用 MinIO/S3。
- 原始文件只存 storage key，不写 DB 大字段。
- 上传校验 MIME、扩展名、大小和 sha256；同 KB 相同 sha256 幂等。
- P0 单文件上限默认 50 MB、单文档最大 chunk 数默认 5000。

## 9. 数据模型

新增迁移 `0011_agent_and_knowledge_ingest.sql`。

### 9.1 `agents`

```text
id uuid pk
public_id text
workspace_id uuid
name text
description text
config jsonb
revision integer
status text              draft | active | archived
created_at timestamptz
updated_at timestamptz
```

约束：

- `(workspace_id, public_id)` 唯一。
- `(workspace_id, name)` 唯一。
- 更新 `config` 时 `revision + 1`。

### 9.2 `agent_conversations`

```text
id uuid pk
public_id text
workspace_id uuid
agent_id uuid
agent_revision integer
agent_snapshot jsonb
thread_id text
title text
status text              active | archived
metadata jsonb
last_message_at timestamptz
created_at timestamptz
updated_at timestamptz
```

约束：

- `(workspace_id, public_id)` 唯一。
- `(workspace_id, thread_id)` 唯一。
- 同一会话的 `agentRevision + agentSnapshot` 固定。

### 9.3 `agent_messages`

```text
id uuid pk
public_id text
workspace_id uuid
conversation_id uuid
invocation_id uuid null
seq integer
role text                user | assistant | system
content jsonb
status text              pending | streaming | completed | failed | cancelled
citations jsonb
usage jsonb
error jsonb
created_at timestamptz
updated_at timestamptz
```

约束：

- `(conversation_id, seq)` 唯一。
- 用户在提交消息的同时写 `role=user,status=completed`。
- 助手消息在开始流式时写 `streaming`，结束时更新最终内容。

### 9.4 `agent_invocations`

```text
id uuid pk
public_id text
workspace_id uuid
agent_id uuid null
conversation_id uuid null
run_id uuid null
node_id text null
kind text                chat | workflow_node | external
status text              queued | running | waiting | succeeded | failed | cancelled | interrupted
definition_snapshot jsonb
request jsonb
result jsonb
error jsonb
thread_id text
resume_checkpoint_id text null
idempotency_key text null
cancel_requested_at timestamptz null
worker_id text null
lease_expires_at timestamptz null
started_at timestamptz null
finished_at timestamptz null
duration_ms integer null
created_at timestamptz
updated_at timestamptz
```

约束：

- 同 workspace `public_id` 唯一。
- 问答会话同一时间最多一个 queued/running invocation，由事务锁保证。
- `(workspace_id,idempotency_key)` 条件唯一。

### 9.5 `agent_invocation_events`

```text
id bigserial pk
workspace_id uuid
invocation_id uuid
seq integer
type text
payload jsonb
created_at timestamptz
```

事件类型：

```text
invocation.queued
invocation.started
message.delta
message.completed
tool.started
tool.output
tool.failed
model.completed
invocation.interrupted
invocation.resumed
invocation.completed
invocation.failed
invocation.cancelled
```

### 9.6 `knowledge_ingest_jobs`

```text
id uuid pk
public_id text
workspace_id uuid
document_id uuid
kind text                ingest | retry | reindex
status text              queued | running | succeeded | failed | cancelled
stage text               parse | normalize | chunk | embedding | index
attempt integer
max_attempts integer
next_retry_at timestamptz
error_code text
error_message text
worker_id text
lease_expires_at timestamptz
created_at timestamptz
updated_at timestamptz
```

### 9.7 LangGraph Checkpoint 表

由 `@langchain/langgraph-checkpoint-postgres` 创建：

```text
checkpoint_migrations
checkpoints
checkpoint_blobs
checkpoint_writes
```

Checkpoint `setup()` 只在 `db:migrate` 或受控部署步骤中运行，不在每个请求中自动执行。

## 10. API 契约

### 10.1 Agent Profile

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/agents` | Agent 列表 |
| `POST` | `/api/agents` | 创建 Agent |
| `GET` | `/api/agents/:id` | 详情 |
| `PATCH` | `/api/agents/:id` | 更新配置并递增 revision |
| `DELETE` | `/api/agents/:id` | 归档，不硬删历史会话 |
| `POST` | `/api/agents/:id/test` | 用当前配置创建一次性测试 invocation |

### 10.2 Conversation

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/agents/:id/conversations` | 会话列表 |
| `POST` | `/api/agents/:id/conversations` | 新建会话并固定 Agent 快照 |
| `GET` | `/api/agent-conversations/:id` | 会话详情 |
| `PATCH` | `/api/agent-conversations/:id` | 重命名/归档 |
| `GET` | `/api/agent-conversations/:id/messages` | 消息分页 |
| `POST` | `/api/agent-conversations/:id/messages` | 发送消息，创建 invocation |
| `POST` | `/api/agent-conversations/:id/messages/retry` | 从指定用户轮次重新生成 |

发送消息请求：

```json
{
  "content": "退款多久到账？",
  "attachments": [],
  "metadata": {}
}
```

响应：

```json
{
  "conversationId": "conv_refund",
  "userMessageId": "msg_user_03",
  "invocationId": "agi_chat_07",
  "status": "queued",
  "events": "/api/agent-invocations/agi_chat_07/events"
}
```

### 10.3 Invocation

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/agent-invocations/:id` | 执行详情 |
| `GET` | `/api/agent-invocations/:id/events/page` | 事件分页 |
| `GET` | `/api/agent-invocations/:id/events` | SSE |
| `POST` | `/api/agent-invocations/:id/cancel` | 取消 |
| `POST` | `/api/agent-invocations/:id/resume` | 从 Checkpoint 恢复 |

### 10.4 知识库

沿用现有 `/api/knowledge-bases`、documents、chunks、search API，并补齐：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/knowledge-bases/:id/documents` | multipart 上传并创建 ingest job |
| `POST` | `/api/documents/:id/retry` | 从失败阶段重试 |
| `POST` | `/api/documents/:id/reindex` | 清除向量并重建 |
| `GET` | `/api/knowledge-ingest-jobs/:id` | 作业状态与阶段错误 |
| `POST` | `/api/knowledge-ingest-jobs/:id/cancel` | 取消未完成作业 |

## 11. 前端设计

### 11.1 Agent 页面

新增 `/agents` 和 `/agents/:id`：

- 左侧：Agent 列表和新建入口。
- 中部：会话列表或对话主区域。
- 右侧可折叠设置区：模型、Prompt、知识库、MCP 工具、最大步数、超时。
- 对话区支持 Markdown、citation chips、工具步骤折叠、停止生成、重新生成。
- 刷新页面后保持当前 conversation 和 running invocation。
- 空态直接提供新建 Agent；不展示营销说明页。

### 11.2 流程 Agent 节点

现有 Inspector 补齐：

- Agent Profile 选择或内联配置。
- 模型、知识库、MCP 工具。
- 最大步数、超时、输出 schema。
- 记忆模式：P0 默认 run，支持 none；conversation 可配置但需稳定的 conversationKey。
- 输出预览至少包含 text、steps、citations、usage。

### 11.3 知识库页面

现有页面增加真实链路：

- 上传后显示 `queued → parsing → chunking → embedding → ready/failed`。
- 失败显示阶段、错误码和重试按钮。
- 检索测试返回真实引用。
- 当 embedding 不可用但 keyword 可检索时显示降级 warning。
- 对 `.doc`/`.xls`、扫描 PDF 显示明确 unsupported，不伪造处理成功。

## 12. 安全与可观测性

- 所有表与查询带 workspace 过滤。
- 仅服务端读取模型密钥；日志与事件统一脱敏。
- Agent 工具的参数和结果记录摘要，不记录完整敏感响应。
- MCP Tool 仍受 allowlist、参数 schema、超时和输出上限保护。
- 用户输入和工具结果不得拼接进系统指令的可信区域。
- 每个 invocation 记录 `agentId`、`conversationId`、`runId`、`nodeId`、model、耗时、步骤数、usage 和 checkpoint id。
- 每个 ingest job 记录 document、stage、attempt、provider、model、chunk 数、失败原因和耗时。
- SSE 不输出 Authorization、API Key、Cookie、secretRef 明文。
- Prompt 中的密钥占位符只能由服务端在调用 Provider 前解析，不能写入 event/message。

## 13. 测试与验收

### 13.1 单元测试

- AgentDefinition 校验与 maxSteps/timeout 边界。
- 工具循环：正常结束、达到最大步数、工具失败、取消。
- 多轮 reducer：第二轮保留第一轮消息。
- 会话快照：Agent 配置变化后旧会话仍使用旧 revision。
- Provider：Ollama、DeepSeek/OpenAI 兼容、429/5xx、超时。
- 分块：Markdown 标题/代码块、PDF 页码、CSV/XLSX 行范围。
- Embedding 重试：429 重试、400 不重试、维度不一致失败。
- 检索引用：workspace/KB 隔离、citation 顺序、降级 warning。

### 13.2 集成测试

- 创建 Agent → 新建会话 → 发送两轮消息 → 刷新后消息完整。
- SSE 中断后从 `Last-Event-ID` 恢复。
- worker 在工具循环中途退出，租约过期后从 Checkpoint 恢复。
- 有副作用工具恢复时不重复执行。
- 工作流 `agent` 节点完成并输出 text/steps/citations。
- 上传 TXT/Markdown → parse/chunk/embed → 向量检索命中。
- 文档 embedding 失败 → 重试成功 → HNSW 检索可用。
- 问答高频并发不会阻塞工作流运行；ingest 不阻塞问答。

### 13.3 浏览器验收

- `/agents` 桌面/移动视口无重叠，消息与引用可滚动。
- 发送消息显示流式内容、工具步骤和停止按钮。
- 刷新页面后仍在原会话和原 invocation。
- 模型或 embedding 不可用时显示可重试错误。
- 工作流 Agent 节点能从 Inspector 配置并试运行。

### 13.4 完成标准

- `pnpm typecheck`、`pnpm typecheck:server`、`pnpm typecheck:worker` 通过。
- 数据库迁移可从空库执行。
- Ollama 本地模型可完成 Agent 单轮、多轮和工具调用。
- DeepSeek 配置切换可用，且不改变 Agent 代码。
- 知识库真实入库与检索闭环可用。
- 刷新和 worker 中断恢复有自动化或可重复验证。

## 14. 实施切片

### M1 Agent 基础运行时与工作流节点

- 引入 LangChain/LangGraph 依赖和 Provider。
- 新增 `AgentRuntime`、`AgentExecutor`、MCP/Knowledge 工具。
- 扩展 worker runtime services 与 `agent` 节点。
- 增加单轮 Agent 测试。

### M2 会话、记忆、Checkpoint 与问答 API

- 新增 Agent、Conversation、Invocation、Message、Event 表。
- 接入 PostgresSaver，完成 `db:migrate` setup。
- 新增独立 `agent-invoke` consumer、SSE、取消和恢复。
- 完成多轮、刷新、断线和租约恢复测试。

### M3 独立问答 UI

- 新增 `/agents` 与 `/agents/:id`。
- 完成 Agent 配置、会话列表、流式消息、工具步骤、citation 和停止生成。
- 补齐 Agent 节点 Inspector。

### M4 知识库真实入库与向量检索

- 增加上传、对象存储、解析、分块、embedding 和 ingest job。
- 完成 pgvector 维度迁移、HNSW 检索和重试。
- 将真实检索接入 Agent。

### M5 验证与文档收口

- 运行全量 typecheck、API smoke、浏览器验收。
- 更新 `05-node-catalog`、`06-knowledge-base`、`08-models-and-skills`、`13-database-schema-and-relationships`。
- 增加对应测试用例。

## 15. 实施阶段由 builder 决定的事项

- PDF、DOCX、XLSX 解析库的具体选型和版本。
- P0 是否默认启用本地目录对象存储，还是强制部署 MinIO。
- 知识库 hybrid 合并分数与权重默认值。
- Token delta 批量写入间隔。
- Agent 页面的具体布局细节，但必须保持工作台型密度、可扫描、移动端不重叠。
- 前缀索引与 HNSW 参数，需依据实际数据量测试。

## 16. 设计风险

| 风险 | 处理 |
| --- | --- |
| Ollama 模型常驻与并发不足 | 限制并发、超时、明确 503 错误，不自动无限重试 |
| 多实例 Checkpoint 写入冲突 | 单 conversation 同一时间只允许一个 active invocation |
| 工具恢复重复副作用 | invocation + tool idempotency key，恢复前查完成记录 |
| embedding 维度与现有 1536 schema 不一致 | 在实现前执行受控迁移；P0 固定 768 维 |
| 大文档阻塞队列 | ingest 独立队列、按阶段重试、大小/chunk 限额 |
| SSE 丢事件 | 事件落 PostgreSQL，`seq` 单调，支持 `Last-Event-ID` |
| 配置漂移 | conversation 固定 agent snapshot，invocation 固定 definition snapshot |
| LangChain 版本 peer 冲突 | 安装前锁定兼容集合，CI 执行 typecheck 和依赖检查 |
