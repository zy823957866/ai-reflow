# 07 MCP 双向集成

> 优先级：客户端 P0，Workflow as MCP Tool P0，Resources/Prompts/OAuth P1。
> 用户目标：工作流能调用外部 MCP Server；外部 Claude/Codex/Cursor 能调用工作流。
> 相关包：`@ai-reflow/capabilities/mcp`（ClientManager）、`@ai-reflow/core`（工具 schema）、`apps/server` 的 MCP endpoint、`apps/worker` 的 MCP 调用执行。
> 判断口径：MCP 不能只记一个“有/无”列，必须分开判断 MCP 客户端、MCP Server、触发器/网关和设置粒度。

## 0. 竞品结论与设计基线

> 证据截至 2026-11-24，来自竞品官方文档与公开源码。标记为“高”的结论已看到核心配置或调用实现；标记为“中”的结论只看到部分界面、类型或未完成实现，不能按完整产品能力复用。

### 0.1 竞品能力矩阵

| 产品 | MCP 客户端 | MCP Server | MCP 网关/触发器 | 设置粒度 | 外部调用与运作方式 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| **Dify** | ✓ | ✓ | 无独立网关 | App 级 Server；Workspace 级客户端 | App Access Point 可开启 MCP Server，并生成可失效的凭证 URL；客户端支持 URL、名称、DCR、Client ID/Secret、headers、请求/SSE 超时 | 高 |
| **Coze Studio** | 有限，开源版未确认完整通用客户端 | 有限，MCP 扩展库只发布通过校验的 Workflow | MCP Extension Library | Workflow 级 | `selected_workflows` 选择暴露项；当前 `invocation_mcp.go` 明确未实现 MCP call，不能按完整闭环参考 | 中 |
| **Langflow** | ✓ | ✓ | 无独立网关 | Project 级 Server；组件级客户端 | 项目 MCP Server 暴露带 `Chat Output` 的 Flow；工具参数含 Flow、`toolName`、`description`、认证方式、工具超时 | 高 |
| **Flowise** | ✓ | ✓ | 无独立网关 | ChatFlow 级 | `POST /api/v1/mcp/:chatflowId`，`Authorization: Bearer <token>`；请求进入 ChatFlow 构建并返回文本 | 高 |
| **FastGPT** | ✓ | ✓ | 无独立网关 | Workspace/App 组级 | MCP Key 汇总多个 App；每个 App 单独配置 `toolName`、`description`，可选身份代理；外部走 `/api/mcp/app/<MCP_KEY>/mcp` | 高 |
| **Sim** | ✓ | ✓ | Workflow Server + API MCP | Workspace/Workflow 级 | 有 Sim API MCP、Workflow MCP deployment、外部 MCP Tool/Block；`/api/mcp/serve/[serverId]` 调用 active deployment 后执行 Workflow | 高 |
| **n8n** | ✓ | ✓ | Workflow MCP Server Trigger | 实例级和 Workflow 级 | 实例级可管理客户端、OAuth/API Key 和批量暴露；Workflow 可标记 `Available in MCP`，Trigger 提供 test/production URL、认证、Path、Instructions | 高 |
| **Activepieces** | ✓ | ✓ | MCP Trigger + MCP Client Piece | Project/Platform/Workflow 级 | 项目端点 `/mcp`、平台端点 `/mcp/platform`；Trigger 定义工具名、描述和参数字段；每次工具调用启动 Flow | 高 |
| **Windmill** | ✓ | ✓ | 无独立网关 | Workspace/Token Scope/资源级 | 客户端保存名称、URL、token、headers；Server token 可选择 favorites/all/folder/custom 及 scripts、flows、API endpoints，每类最多 100 个工具 | 高 |
| **Kestra** | ✓ | ✓ | Flow Trigger | Tenant/Flow 级 | Tenant MCP Server 配置描述、instructions、可见性和认证；Flow Trigger 暴露工具并绑定 MCP Server；每次调用创建 execution | 高 |
| **RAGFlow** | ✓ | ✓ | 内置 MCP 监听器 | 实例级 | `mcp.enabled`、host、port、launch_mode、host API key、SSE/Streamable HTTP；端点 `/api/v1/mcp`，可选 `/mcp`、legacy `/sse` 和 `/messages/` | 高 |

源码/官方文档定位：[Dify](https://github.com/langgenius/dify)、[Coze Studio](https://github.com/coze-dev/coze-studio)、[Langflow](https://github.com/langflow-ai/langflow)、[Flowise](https://github.com/FlowiseAI/Flowise)、[FastGPT](https://github.com/labring/FastGPT)、[Sim](https://github.com/simstudioai/sim)、[n8n](https://github.com/n8n-io/n8n)、[Activepieces](https://github.com/activepieces/activepieces)、[Windmill](https://github.com/windmill-labs/windmill)、[Kestra](https://github.com/kestra-io/kestra)、[RAGFlow](https://github.com/infiniflow/ragflow)。Coze Studio 的调用闭环仍需在实现版本变化后重新核验。

### 0.2 从竞品得到的关键判断

1. **MCP 要按双向能力设计。** 上述项目中大多数同时提供外部 MCP 客户端和入站 MCP Server；只写“客户端”或只写“服务端”会误判产品边界。
2. **MCP 设置不是只有“项目设置”。** 实际分散在 Workspace、Project、Workflow、App、Node、Token Scope 等层级，需要显式的 `scopeType + scopeId`。
3. **出站连接和入站暴露必须使用独立数据模型。** 前者描述如何访问别人的工具，后者描述如何把已发布工作流变成别人的工具；两者认证、生命周期和权限完全不同。
4. **入站能力必须绑定不可变发布版本或 active deployment。** 不能让外部调用悄悄执行草稿，否则无法复现、回滚和审计。
5. **外部调用应返回可追踪的 `runId`。** 竞品普遍把 MCP Tool 调用落到 Flow、Workflow execution 或 run 记录；同步返回结果之外，还要能查询状态和取消。
6. **认证覆盖多种部署形态。** 本地可用无认证或 API Key，托管环境至少支持 Bearer/API Key；OAuth、DCR、资源 scope 作为 P1 扩展。
7. **工具发现结果需要快照。** 保存工具名称、描述、inputSchema、annotations 和 `schemaHash`；发布后 schema 变化必须提示重新确认。
8. **Coze Studio 只能作为“有限入站发布”案例。** 它展示了 Workflow 选择器，但当前调用实现未完成，不能作为完整双向 MCP 的产品基线。

### 0.3 设置层级映射

| 层级 | 典型竞品 | 主要配置 | ai-reflow P0 落点 |
| --- | --- | --- | --- |
| 实例/平台 | n8n、RAGFlow、Kestra、Activepieces | MCP 总开关、监听地址、OAuth/API Key、客户端管理、平台级端点 | 环境变量、管理员策略、全局默认超时/并发 |
| Workspace | Windmill、FastGPT、Dify | Server 凭据、host allowlist、默认认证、可见范围 | `mcp_connections` 和 `mcp_tools` 按 workspace 隔离 |
| Project | Langflow、Activepieces | Project 级 Server、项目访问策略、项目 Token | 预留 `scope_type=project`；P0 单 workspace 可先不暴露 UI |
| Workflow | n8n、Kestra、Sim、Flowise | 是否暴露、工具名、描述、绑定版本、触发 Path | `workflow_mcp_exposures`，必须绑定 `workflow_version_id` |
| App/多 App 组 | Dify、FastGPT | App 选择、每个 App 的 toolName/description、身份代理 | P0 一个 Workflow 对应一个工具；P1 支持多 App 合并 |
| Node | Dify、Langflow、Flowise、FastGPT | Server、Tool、参数映射、超时、重试 | `tool.kind=mcp` 节点和 `toolSchemaHash` |
| Token/资源 Scope | Windmill、Kestra | favorites/folder/custom、scripts/flows、只读或破坏性权限 | P1 资源 scope；P0 工具 allowlist + 工作流级 token |

### 0.4 必须提取的参数模型

#### 0.4.1 出站 MCP 连接 `mcp_connections`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | UUID | 是 | 连接主键 |
| `workspaceId` / `projectId` | UUID | 是 | 隔离与授权边界 |
| `scopeType` / `scopeId` | enum / UUID | 否 | `workspace/project/workflow`，未来支持共享连接 |
| `name` / `slug` | string | 是 | 展示名与稳定内部标识；slug 在 scope 内唯一 |
| `description` | string | 否 | 管理页说明 |
| `transport` | `streamable-http/sse/stdio` | 是 | 托管环境默认禁用 `stdio` |
| `url` | string | 条件 | Remote MCP endpoint |
| `command` / `args` / `env` | string / string[] / object | 条件 | 仅本地自托管 `stdio`；敏感 env 用 `secretRef` |
| `authType` | `none/bearer/api-key/basic/custom-header/oauth2` | 是 | 默认 `none` |
| `secretRef` | string | 否 | token、API Key、password 的加密引用；不返回明文 |
| `headers` | object | 否 | 自定义 headers；敏感值必须是引用而非明文 |
| `oauthClientId` / `oauthScopes` | string / string[] | 否 | P1 OAuth；DCR 结果也要可保存 |
| `protocolVersion` | string | 否 | 协商结果或兼容提示 |
| `connectTimeoutMs` / `requestTimeoutMs` | number | 否 | 连接与单次调用超时 |
| `sseTimeoutMs` | number | 否 | SSE 空闲超时 |
| `retryPolicy` | object | 否 | `{maxAttempts, backoffMs, retryOn}`；非幂等工具不自动重试 |
| `maxConcurrency` | number | 否 | 每 Server/工具并发上限 |
| `allowedHosts` | string[] | 否 | SSRF 防护白名单；内网/回环默认拒绝 |
| `discoveryCacheTtlMs` | number | 否 | `tools/list` 缓存时间 |
| `toolAllowlist` | string[] | 否 | 只允许指定工具；空数组表示显式不启用 |
| `enabled` | boolean | 是 | 禁用后节点不可调用 |
| `healthStatus` / `lastCheckedAt` | enum / datetime | 否 | `healthy/degraded/offline` |

#### 0.4.2 工具缓存 `mcp_tools`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `serverId` | UUID | 所属连接 |
| `name` / `title` | string | 原始工具名与展示名 |
| `description` | string | 来自 `tools/list` |
| `inputSchema` / `outputSchema` | JSON Schema | 输入必存；输出仅在服务端提供时保存 |
| `annotations` | object | `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` |
| `schemaHash` | string | 发布时锁定，变化必须重新确认 |
| `enabled` | boolean | 配合 allowlist 控制节点可选范围 |
| `lastSeenAt` | datetime | 最近一次发现时间；消失工具不静默删除 |

#### 0.4.3 入站工作流暴露 `workflow_mcp_exposures`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | UUID | 是 | 暴露配置主键 |
| `workspaceId` / `workflowId` | UUID | 是 | 归属与隔离 |
| `workflowVersionId` | UUID | 是 | 必须绑定不可变发布版本，禁止指向草稿 |
| `enabled` | boolean | 是 | 关闭后工具从 `tools/list` 消失 |
| `toolName` / `title` | string | 是 | 默认 `run_<workflowSlug>`，冲突时拒绝保存 |
| `description` / `instructions` | string | 否 | 给外部客户端的调用说明 |
| `inputSchemaSource` | string | 是 | P0 固定 `start.inputSchema` |
| `inputSchemaProjection` | JSON Schema | 是 | 发布时生成并锁定；参数描述可覆盖 |
| `outputMode` | `text/structured` | 否 | 返回文本 JSON 或 `structuredContent` |
| `visibility` | `private/public` | 是 | P0 默认 private |
| `authMode` | `none/bearer/api-key/oauth2` | 是 | 本地可用 none；托管至少 API Key |
| `accessTokenRef` | string | 否 | 可轮换、失效旧 token 的加密引用 |
| `rateLimit` | object | 否 | 每分钟请求数、并发数 |
| `timeoutMs` | number | 否 | 单次 Workflow 调用超时 |
| `maxConcurrency` | number | 否 | 该工具同时运行的 run 上限 |
| `clientPresets` | object | 否 | 可生成的客户端配置模板，不返回 secret |
| `createdAt` / `updatedAt` | datetime | 是 | 审计 |

Workflow 公开设置还应从 Workflow 本身读取：`status`、`start.inputSchema`、`concurrency`、`timeoutMs`、`maxNodeAttempts`、`errorPolicy`、日志保留期。入站工具只读取发布版本快照，不在调用时重新读取草稿。

#### 0.4.4 节点调用 `tool.kind=mcp`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `serverId` | UUID | 已启用且健康的外部 MCP 连接 |
| `toolName` | string | 工具缓存中的原始名称 |
| `arguments` | object | 由 inputSchema 驱动的参数映射 |
| `argumentDescriptors` | object | 每个字段的描述、必填、示例、变量来源 |
| `toolSchemaHash` | string | 发布快照锁定 |
| `timeoutMs` / `maxOutputBytes` | number | 单节点超时和输出上限 |
| `retryPolicy` | object | 只对显式幂等工具生效 |
| `outputMode` / `outputMapping` | enum / object | 结果 envelope 或字段映射 |
| `approvalPolicy` | enum | 写工具可要求显式确认或人工节点 |

#### 0.4.5 运行与访问记录

| 对象 | 关键字段 | 说明 |
| --- | --- | --- |
| `runs` | `runKind=production`、`trigger=mcp`、`external_client_id`、`idempotency_key`、`workflow_version_id` | MCP 外部调用创建普通 run，复用现有运行链路 |
| `mcp_call_audit` | `server_id`、`tool_id`、`run_id`、`client_id`、`status`、`error_code`、`duration_ms` | 出站和入站均可复用；不记录明文密钥和完整大输出 |
| `credentials` | `id`、`workspace_id`、`name`、`ciphertext`、`key_version` | 连接 token、API Key、OAuth secret 统一加密 |

### 0.5 外部项目的调用链路

| 产品 | 外部入口 | 调用后的实际行为 |
| --- | --- | --- |
| Dify | App Access Point 生成的 MCP 凭证 URL | 连接后暴露 App 级 MCP；重新生成凭证会使旧 URL 失效 |
| Coze Studio | MCP 扩展库选择 Workflow | 配置只有 `selected_workflows`；当前调用实现未完成 |
| Langflow | 项目级 MCP endpoint | 工具调用进入指定 Flow，结果从 `Chat Output` 返回 |
| Flowise | `POST /api/v1/mcp/:chatflowId` | Bearer token 校验后构建并运行 ChatFlow，返回文本 |
| FastGPT | `/api/mcp/app/<MCP_KEY>/mcp` | MCP Key 定位 App 组，按工具名路由到 App；可选身份代理 |
| Sim | `/api/mcp/serve/[serverId]` | 解析 active deployment，再创建 Workflow 运行 |
| n8n | 实例 MCP endpoint 或 Workflow Trigger URL | 实例级与 Workflow 级各有认证和客户端管理；工具调用触发 Workflow execution |
| Activepieces | `/mcp` 或 `/mcp/platform` | MCP Trigger 接收参数并启动 Flow；平台端点跨项目聚合 |
| Windmill | Token 作用域内的 MCP endpoint | 只列出 token 允许的 scripts/flows/API endpoints；调用产生 Job/Run |
| Kestra | Tenant MCP Server | Flow Trigger 接收调用并创建带 MCP 来源元数据的 execution |
| RAGFlow | `/api/v1/mcp`、可选 `/mcp`、legacy `/sse` | 通过 Streamable HTTP/SSE 暴露 RAGFlow 工具；实例级 host API key |

统一协议链路：

```text
MCP client
  -> initialize
  -> tools/list
  -> tools/call(name, arguments)
  -> ai-reflow 创建 run（绑定 workflow_version_id）
  -> 同步返回 runId/status/output 或等待结果
  -> get_run(runId) / cancel_run(runId)
  -> 可选 SSE 事件查询
```

### 0.6 ai-reflow 的设计取舍

- P0 把出站连接与入站暴露做成两个独立资源；不复用同一个 `mcp_servers` 表承担双向语义。
- P0 入站先支持一个 Workflow 对应一个工具；P1 再支持一个 Server 聚合多个 Workflow/App。
- P0 默认只监听 `127.0.0.1`，允许无认证的本地开发；只要暴露到非回环地址，必须启用 API Key/Bearer。
- P0 工具调用返回 `runId`，并暴露 `get_run`/`cancel_run`；长任务可先返回运行中状态。
- P0 只实现 `tools/list` 与 `tools/call`；Resources、Prompts、OAuth/DCR、健康巡检放 P1。
- P0 的节点参数继续由统一 `SchemaForm` 渲染；不复制竞品的 MCP 专用表单。

## 1. 模块边界

包含：

- 外部 MCP Server 注册、连接测试、工具发现/缓存、健康状态。
- `tool.kind=mcp`：server/tool/arguments 配置、调用、错误与 schema 锁。
- Workflow as MCP Tool：`run_<workflowSlug>`、`get_run`、`cancel_run`。
- 出站连接、工具缓存、入站暴露、transport、权限、allowlist、stdio 限制、密钥引用。

不包含：

- P0 的 OAuth、Resources、Prompts、工具健康巡检（P1）。
- A2A/Agent Protocol（P2）。
- 外部 MCP Server 自身的安装与运维。

不变量：

- 使用官方 `@modelcontextprotocol/sdk`；传输优先级 `streamable-http > sse > stdio(仅本地)`。
- 工具命名 `mcp.<serverSlug>.<toolName>`，避免跨 server 冲突。
- MCP 输出视为不可信内容，不直接拼进 system prompt。
- 远程 MCP 禁止访问内网/回环；托管环境 `stdio` 默认禁用。
- 连接密钥走 `secret_ref`，不进入前端、事件、日志。
- 发布时保存 `toolSchemaHash`；schema 变化需重新确认。
- 出站 `mcp_connections` 与入站 `workflow_mcp_exposures` 使用独立数据模型和 API。
- Workflow 暴露只绑定不可变 `workflow_version_id`，不得直接运行草稿。
- 外部 MCP 调用创建普通 run，记录 `runKind=production`、`trigger=mcp`、客户端和 MCP 暴露元数据。
- 每个工具设置超时与输出大小上限；非幂等工具失败不自动重试。
- MCP 工具参数表单复用设计器统一 `SchemaForm` 与 `x-variable` 扩展，不另写一套 MCP 专用表单。
- MCP 调用纳入统一节点 trace：nodeId + attempt + 阶段（connect/call/parse）+ 耗时；不记录参数密钥。

## 2. 前端功能

### 2.1 出站 MCP 连接管理页

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MCP-F01` | MCP 导航入口 | 侧边栏“MCP 调用”；显示未连接/异常数量 |
| `MCP-F02` | Server 列表 | 名称、slug、transport、endpoint、状态、工具数、最近检查 |
| `MCP-F03` | 新增 Server | transport、endpoint/command、认证引用、超时、allowlist |
| `MCP-F04` | 编辑/禁用/删除 | 删除前提示被节点/工作流引用 |
| `MCP-F05` | 测试连接 | 显示延迟、错误、协议版本、工具数量 |
| `MCP-F06` | 健康状态 | healthy/degraded/offline；不只靠颜色 |
| `MCP-F07` | 工具缓存列表 | 工具名、描述、只读/写、调用次数、schema 摘要 |
| `MCP-F08` | 刷新 schema | 检测变化并显示 diff/需要重新确认 |
| `MCP-F09` | Schema 查看器 | 只读 JSON Schema；可复制 |
| `MCP-F10` | 调用控制台 | 选工具、填参数、执行、查看结果/错误/耗时 |
| `MCP-F11` | 测试调用标识 | 明确“测试调用，不写入工作流” |
| `MCP-F12` | 参数表单 | 由工具 inputSchema 驱动；支持变量与 JSON 模板 |
| `MCP-F13` | 结果展示 | result/structuredContent/isError/usage |
| `MCP-F14` | 错误码 | MCP_CONNECT_ERROR/TOOL_NOT_FOUND/SCHEMA_MISMATCH/TIMEOUT |
| `MCP-F15` | 权限摘要 | host allowlist、凭据引用、写操作策略、stdio 限制 |
| `MCP-F16` | 写操作徽标 | 写工具/副作用工具明显标记 |
| `MCP-F17` | 事件只读 | server/tool/attempt/duration；不显示参数密钥 |

### 2.2 节点 Inspector 中的 MCP 表单

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MCP-F18` | Server 选择器 | 只列健康/已启用 Server；显示 transport |
| `MCP-F19` | Tool 选择器 | 切换工具重新渲染参数表单 |
| `MCP-F20` | 参数映射 | inputSchema 驱动；允许 `$input/$node` 变量 |
| `MCP-F21` | 输出 fixture | result/structuredContent/isError 示例 |
| `MCP-F22` | 权限检查 | 调用前校验启用、权限、凭据、allowlist |
| `MCP-F23` | Schema 锁提示 | 发布时保存 hash；变化要求重新确认 |
| `MCP-F24` | 失败可诊断 | 显示 server/tool/attempt/错误码，不泄漏密钥 |
| `MCP-F25` | 超时/输出上限 | 可配置，超出明确失败或截断 |
| `MCP-F33` | 统一 SchemaForm | 工具 inputSchema 走同一 `SchemaForm`；支持 `x-variable` 插变量 |
| `MCP-F34` | 调用 trace | Inspector/运行详情展示 connect/call/parse 阶段、耗时、attempt |

### 2.3 Workflow as MCP Tool

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MCP-F26` | 暴露状态 | 每个工作流显示是否暴露、工具名、绑定版本 |
| `MCP-F27` | 工具名预览 | `run_<workflowSlug>`；冲突提示 |
| `MCP-F28` | 输入 schema | 来自 start.inputSchema；只读预览 |
| `MCP-F29` | 客户端配置片段 | 复制 endpoint/工具说明，不显示密钥 |
| `MCP-F30` | 调用状态 | 返回 runId/status；可跳转运行详情 |
| `MCP-F31` | 取消/查询 | 对应 get_run/cancel_run 工具说明 |
| `MCP-F32` | 绑定与认证 | P0 默认 127.0.0.1；非回环地址强制 API Key/Bearer |
| `MCP-F35` | 设置范围 | 出站连接显示 `workspace/project/workflow`；入站暴露固定为 workflow；P0 连接默认 workspace |
| `MCP-F36` | 入站认证配置 | 显示认证方式、token 掩码、轮换/失效入口；不展示明文 |
| `MCP-F37` | 工具注解 | 展示 readOnly/destructive/idempotent/openWorld；写工具需显式确认 |
| `MCP-F38` | 发布版本绑定 | 暴露配置只选择已发布版本；草稿修改不自动生效 |
| `MCP-F39` | 外部运行记录 | 列表显示 `trigger=mcp`、客户端、工具名、runId、状态和耗时 |
| `MCP-F40` | 客户端兼容提示 | 显示 transport、协议版本和 Claude/Codex/Cursor 配置片段 |

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-MCP-01` | Server CRUD | workspace 隔离；slug 唯一 |
| `B-MCP-02` | 连接管理 | ClientManager；transport 选择与超时 |
| `B-MCP-03` | 工具发现 | `tools/list`；缓存 name/description/inputSchema |
| `B-MCP-04` | schema hash | 保存 hash；发布时锁定 |
| `B-MCP-05` | 健康检查 | 连接/禁用/错误；最近检查时间 |
| `B-MCP-06` | 工具调用 | 参数校验、超时、输出上限、结果 envelope |
| `B-MCP-07` | 错误归一化 | 稳定错误码；保留 server/tool/attempt |
| `B-MCP-08` | 安全策略 | allowlist、内网/回环拦截、stdio 开关 |
| `B-MCP-09` | 凭据 | `secret_ref` 注入；不入日志/事件 |
| `B-MCP-10` | 幂等/重试 | 非幂等工具默认不自动重试 |
| `B-MCP-11` | 并发限制 | 每 server/工具并发与队列 |
| `B-MCP-12` | Workflow-as-Tool | 从 start inputSchema 生成 MCP tool schema |
| `B-MCP-13` | run/get/cancel | 外部调用创建 run；查询/取消 |
| `B-MCP-14` | MCP endpoint | Streamable HTTP；会话与请求 ID |
| `B-MCP-15` | 绑定与认证 | P0 默认 127.0.0.1；非回环地址必须 API Key/Bearer；OAuth P1 |
| `B-MCP-16` | 审计最小化 | 记录 server/tool/run，不记录参数密钥 |
| `B-MCP-17` | P1 扩展 | Resources、Prompts、OAuth、健康巡检 |
| `B-MCP-18` | 统一表单投影 | inputSchema → SchemaForm 描述；`x-variable` 保留；不返回密钥 |
| `B-MCP-19` | 调用 trace | 阶段耗时/attempt/错误码；写入 node_run 与事件 |
| `B-MCP-20` | 双向模型拆分 | 出站连接、工具缓存、入站暴露、访问凭证独立表/服务 |
| `B-MCP-21` | 入站版本绑定 | 只允许 `workflow_version_id`；发布新版本不自动切换 |
| `B-MCP-22` | 入站认证 | P0 Bearer/API Key；token 可轮换并使旧 token 失效 |
| `B-MCP-23` | 外部 run 来源 | 创建 `runKind=production`、`trigger=mcp` 的 run，保存 client、tool、exposure 与 idempotency key |
| `B-MCP-24` | 工具注解 | 保存 MCP annotations；写工具默认禁止自动重试 |
| `B-MCP-25` | Run 查询工具 | 暴露 `get_run`、`cancel_run`，权限按 access token scope 收敛 |
| `B-MCP-26` | 调用审计 | 出站/入站统一记录 server/tool/run/duration/error，不记录明文 |

### 3.1 API 与 MCP 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/POST` | `/api/mcp/servers` | 列表/新增 |
| `GET/PATCH/DELETE` | `/api/mcp/servers/:id` | 详情/编辑/删除 |
| `POST` | `/api/mcp/servers/:id/test` | 测试连接并刷新工具 |
| `GET` | `/api/mcp/servers/:id/tools` | 工具缓存 |
| `POST` | `/api/mcp/servers/:id/tools/:tool/test` | 控制台测试调用 |
| `POST` | `/api/mcp/servers/:id/disable` | 禁用 |
| `GET/POST` | `/api/workflows/:id/mcp-exposure` | 暴露状态/配置 |
| `POST` | `/api/workflows/:id/mcp-exposure/rotate-token` | 轮换并使旧 token 失效 |
| `GET/POST` | `/api/mcp/access-tokens` | 入站访问凭证元数据；不返回明文 |
| `GET` | `/api/mcp/calls` | 按 run/client/tool/status 查询调用审计 |
| `POST` | `/mcp` | MCP Streamable HTTP endpoint |

### 3.2 工具命名与结果

- 内部命名：`mcp.<serverSlug>.<toolName>`；UI 展示原始 tool 名 + server。
- 结果 envelope 保留 `result`、`structuredContent`、`isError`、`usage`。
- 输出超限：按 manifest 上限失败或写 artifact；不截断为看似成功。
- `stdio` 只允许本地自托管，且由 worker 拉起；浏览器/API 不能直接执行命令。

## 4. 示例

### 4.1 Server 配置

```json
{
  "name": "飞书文档",
  "slug": "feishu_docs",
  "transport": "streamable-http",
  "auth": { "type": "bearer", "secretRef": "cred_feishu" },
  "timeoutMs": 20000,
  "enabled": true
}
```

生产环境还需填写 endpoint 与 allowed host 白名单；此处省略具体地址。

### 4.2 节点调用

```json
{
  "kind": "mcp",
  "serverId": "mcp_feishu",
  "toolName": "search_docs",
  "arguments": { "query": "{{ $input.question }}" },
  "toolSchemaHash": "sha256:abc123"
}
```

### 4.3 MCP 工具定义

```json
{
  "name": "run_support_triage",
  "description": "运行已发布工作流 support-triage",
  "inputSchema": {
    "type": "object",
    "properties": { "question": { "type": "string" } },
    "required": ["question"]
  }
}
```

### 4.4 入站暴露配置

```json
{
  "workflowId": "wf_support",
  "workflowVersionId": "wfv_support_v12",
  "enabled": true,
  "toolName": "run_support_triage",
  "title": "支持工单分流",
  "description": "运行已发布的支持工单分流工作流",
  "inputSchemaSource": "start.inputSchema",
  "outputMode": "structured",
  "visibility": "private",
  "authMode": "api-key",
  "accessTokenRef": "secret://workspace/mcp_support",
  "timeoutMs": 60000,
  "maxConcurrency": 5
}
```

`workflowVersionId` 不允许指向草稿。修改 Workflow 后需要重新发布并显式切换暴露版本；旧版本仍可保留给历史 run 和回滚。

### 4.5 外部 MCP 调用示例

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "run_support_triage",
    "arguments": {
      "question": "登录后收不到验证码",
      "locale": "zh-CN"
    }
  }
}
```

工具结果至少包含 `runId`、`status`、`workflowVersionId`；若同步完成则附带输出，若运行中则提示客户端使用 `get_run` 查询。

### 4.6 外部客户端连接片段

支持 Remote MCP 的 JSON 客户端可使用以下结构。实际字段名以客户端版本为准；token 通过环境变量或客户端密钥管理注入，不写入仓库。

```json
{
  "mcpServers": {
    "ai-reflow": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer ${AI_REFLOW_MCP_TOKEN}"
      }
    }
  }
}
```

客户端先用 `initialize` 协商协议，再调用 `tools/list` 获取 `run_<workflowSlug>`、`get_run`、`cancel_run`。工具执行后会收到 `runId`；客户端可跳转 ai-reflow 运行详情，或继续调用 `get_run`/`cancel_run`。

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-MCP-01` | P0 | Server CRUD + slug 唯一 + workspace 隔离 | 跨 workspace 不可见 |
| `T-MCP-02` | P0 | 连接管理 + streamable-http/sse | 测试连接返回工具列表 |
| `T-MCP-03` | P0 | 工具缓存 + schema hash | 发布锁定 hash |
| `T-MCP-04` | P0 | tool.kind=mcp 执行 | 参数映射/超时/输出上限 |
| `T-MCP-05` | P0 | 错误码与脱敏 | 日志可定位 server/tool |
| `T-MCP-06` | P0 | MCP 管理页 + 调用控制台 | 测试调用不写工作流 |
| `T-MCP-07` | P0 | 节点 Inspector MCP 表单 | schema 驱动参数表单 |
| `T-MCP-08` | P0 | Workflow-as-MCP-Tool | 外部客户端可 run/get/cancel |
| `T-MCP-09` | P0 | 本地绑定 + allowlist + stdio 禁用 | 内网/回环被拒 |
| `T-MCP-10` | P1 | OAuth / Resources / Prompts | 权限与 scope 可见 |
| `T-MCP-11` | P1 | 工具健康巡检 | 异常可恢复/告警 |
| `T-MCP-12` | P1 | 独立 mcp-gateway 进程 | 只在需要独立部署时拆分 |
| `T-MCP-13` | P0 | MCP 参数表单复用统一 SchemaForm | 支持 `x-variable`；无重复表单实现 |
| `T-MCP-14` | P0 | MCP 调用 trace 接入 | connect/call/parse 阶段可查；无密钥 |
| `T-MCP-15` | P0 | 出站连接与入站暴露模型拆分 | 两类资源 API/权限/生命周期互不混用 |
| `T-MCP-16` | P0 | 入站暴露绑定发布版本 | 修改草稿不影响外部工具；切换版本需显式操作 |
| `T-MCP-17` | P0 | 入站 API Key 轮换 | 旧 token 立即失效；前端只显示掩码 |
| `T-MCP-18` | P0 | 外部 run 查询/取消 | `get_run`/`cancel_run` 闭环并校验 scope |
| `T-MCP-19` | P1 | 多 Workflow/App 聚合 Server | 一个 endpoint 暴露多个工具，冲突可检测 |
| `T-MCP-20` | P1 | OAuth/DCR 与资源 scope | 客户端授权、scope 和吊销可管理 |

## 6. 测试关注点

- 连接超时、工具不存在、schema 变更、输出超限、非幂等重试。
- 远程 MCP 访问本机/内网被拒；stdio 在托管环境禁用。
- 发布后 schema hash 变化阻止/提示重新确认。
- 外部客户端调用 workflow tool，run 创建/查询/取消闭环。
- 参数与凭据不出现在事件/日志/前端响应。
- MCP 工具表单与内置节点表单共用 SchemaForm；`x-variable` 可插入上游变量。
- 调用 trace 阶段完整；连接失败/解析失败/超时能定位阶段。
- 出站连接与入站暴露互不串用；一个禁用不影响另一个。
- 入站工具只运行绑定的发布版本；修改草稿后外部 listing/call 不变。
- API Key 轮换后旧 token 拒绝；非回环监听禁止无认证启动。
- 外部 `tools/call` 生成 `runKind=production`、`trigger=mcp` 的 run；`get_run/cancel_run` 受同一 token scope 约束。

## 7. 待决策

1. MCP 页面是否允许直接测试调用？建议允许，但明确不写工作流。
2. schema 变化是阻止发布还是提示确认？建议阻止运行，允许显式重新确认。
3. 写工具是否强制人工审批？P0 用徽标 + 显式确认；P1 可配合 human 节点。
4. MCP Gateway 是否独立部署？P0 并入 api；需要独立鉴权/扩缩时再拆。
5. 入站是否先做单 Workflow 单工具还是直接做多工具聚合？建议 P0 单工具，先跑通版本绑定、认证、run 查询闭环。
6. API Key 是 workspace 级还是 workflow 级？建议 P0 workflow 级，便于轮换和最小授权；P1 增加 workspace/项目级 token。
