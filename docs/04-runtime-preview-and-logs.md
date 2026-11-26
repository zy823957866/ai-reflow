# 04 运行、预览与日志

> 优先级：P0。日志与错误可见性属于 P0，不允许上线后靠猜。
> 用户目标：未发布草稿可安全预览；发布后可对固定版本试运行；运行中能看到每个节点状态；失败后能定位 nodeId + attempt + 错误码。
> 相关包：`@ai-reflow/engine`、`@ai-reflow/platform`、`@ai-reflow/core/events`、`@ai-reflow/core/node`（执行器基类日志契约）；设计器运行态见 12。

## 1. 模块边界

包含：

- 预览台：start `inputSchema` 自动表单、运行、取消、节点状态、输出抽屉。
- 发布后试运行台：固定发布版本、真实依赖检查、输入执行、结果与当前版本运行历史。
- SSE 事件流、断线重连、token 批量渲染、事件补齐。
- 运行列表/详情、时间线、节点执行表、错误详情、原始 JSON、artifact 下载。
- 管理员概览：运行数、失败率、P95、队列积压、存储用量。

不包含：

- 画布编辑与发布（见 02）。
- 节点执行器实现（见 05）。
- 账单/计费与多租户配额（P2）。

不变量：

- 预览与正式运行使用同一引擎，只区分 `runKind`。
- 草稿预览使用 `runKind=preview`；发布后试运行与外部正式调用使用 `runKind=production`，并必须固定 `workflow_version_id`。
- 发布后试运行的 `trigger=manual_trial`，不得读取最新草稿，也不得隐式切到最新发布版本。
- 发布后试运行是真实执行，不是模拟器；可能产生模型费用、HTTP 副作用或 MCP 工具副作用，界面必须明确提示。
- 每次运行保存 `definition_snapshot`；历史重放不使用最新草稿。
- 生命周期与最终输出落 PostgreSQL；`token.delta` 可只走 Redis。
- SSE `id` = 事件 `seq`；重连先补齐再实时。
- 事件 payload 统一脱敏；大输出落 `artifacts`。
- 节点失败不能让 API 请求挂起；运行创建是异步的。
- 节点日志由 `BaseNodeExecutor.execute()` 统一产出：阶段（validate/resolve/execute/output）、耗时、attempt、错误码；`doExecute()` 不自定义日志格式。
- 测试运行与运行详情复用同一套展示组件；设计器运行态只叠加，不回写节点配置。

## 2. 前端功能

### 2.1 预览台

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F01` | 从编辑器打开预览 | 侧栏/抽屉；不离开画布 |
| `RUN-F02` | 输入表单 | 由 start `inputSchema` 生成；text/number/boolean/file/json |
| `RUN-F03` | 必填校验 | 缺失/类型/正则错误阻止运行并定位字段 |
| `RUN-F04` | 文件输入 | 上传到对象存储；表单只拿 FileRef |
| `RUN-F05` | 运行按钮 | 创建 preview run；按钮进入 running 不可重复提交 |
| `RUN-F06` | 取消运行 | 二次确认；状态转 cancelled |
| `RUN-F07` | 运行状态 | queued/running/succeeded/failed/cancelled；带 runId |
| `RUN-F08` | 节点状态叠加 | 画布节点显示 running/succeeded/failed/skipped |
| `RUN-F09` | 点击节点定位 | 预览节点点击 → 打开输出抽屉并定位画布 |
| `RUN-F10` | 输出抽屉 | 输入/输出/错误/耗时/attempt/usage/artifacts |
| `RUN-F11` | 错误展示 | code/message/retryable/是否重试耗尽 |
| `RUN-F12` | 复制 runId | 一键复制；显示短 ID + tooltip |
| `RUN-F13` | 原始 JSON | 服务端已脱敏；大对象显示 artifact 摘要 |
| `RUN-F14` | 运行结束摘要 | 总耗时、节点成功/失败/跳过数、token/费用 |
| `RUN-F15` | 预览重跑 | 复用原输入重新创建 run；不覆盖历史 |
| `RUN-F16` | 失败节点重试（P1） | 复用 snapshot；只重跑失败节点/分支 |

### 2.2 SSE 与实时状态

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F17` | EventSource 封装 | 统一连接、错误、关闭、重连 |
| `RUN-F18` | Last-Event-ID | 刷新/断网后从最后 seq 补齐 |
| `RUN-F19` | token 批量渲染 | 高频 delta 合并渲染，不逐 token setState |
| `RUN-F20` | 事件乱序防御 | 只接受 seq 递增；重复事件幂等 |
| `RUN-F21` | 连接状态 | 实时/重连中/已结束；不能静默卡死 |
| `RUN-F22` | 结束收尾 | 收到 run.completed/failed/cancelled 后关闭流 |
| `RUN-F23` | 运行中离开 | 提示是否保持后台运行；返回后可追踪 |

### 2.3 运行列表

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F24` | 列表入口 | 侧边栏“运行记录”；可按 workflow 过滤 |
| `RUN-F25` | 过滤 | workflow/version/status/kind/trigger/时间/错误码 |
| `RUN-F26` | 列 | runId、workflow、kind、状态、开始时间、耗时、触发方式 |
| `RUN-F27` | Cursor 分页 | 大数据量滚动加载；保留筛选 |
| `RUN-F28` | 状态筛选快捷 | 运行中/失败/全部 |
| `RUN-F29` | 空/错/加载态 | 明确原因与重试 |
| `RUN-F30` | 深链 | 列表/卡片/通知可直达 `/runs/:id` |

### 2.4 运行详情与日志

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F31` | 详情头部 | runId、workflow/version、kind、trigger、状态、耗时、取消 |
| `RUN-F32` | 时间线 | run/node 事件按时间顺序；可过滤 type |
| `RUN-F33` | 节点执行表 | node、attempt、status、started、duration、error |
| `RUN-F34` | 虚拟滚动 | 1 万事件/节点行下滚动可用 |
| `RUN-F35` | 节点抽屉 | 输入/输出/错误/元数据/usage/artifacts |
| `RUN-F36` | attempt 切换 | 查看首次与重试 attempt，不能只看最后一次 |
| `RUN-F37` | 分支信息 | 条件命中 branch、未选分支 skipped |
| `RUN-F38` | usage 与成本 | tokens/cost 按节点与 run 汇总 |
| `RUN-F39` | artifact 下载 | 文件名/mime/size/sha256；权限校验 |
| `RUN-F40` | 原始 JSON | 事件/节点输出按服务端脱敏版本展示 |
| `RUN-F41` | 复制诊断包 | 复制 runId + 节点 + 错误码 + 时间（P1） |
| `RUN-F42` | 重放 | P0 原样重跑；P1 从失败节点/分支重跑 |

### 2.5 监控概览

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `RUN-F43` | 运行指标 | 今日运行数、成功率、失败率、P95 |
| `RUN-F44` | 队列指标 | waiting/active/failed/delayed |
| `RUN-F45` | 存储指标 | artifact、知识库文档、事件保留占用 |
| `RUN-F46` | 异常入口 | 按错误码/节点类型聚合，点击联动列表 |

### 2.6 测试运行与执行详情复用

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F47` | 测试运行四 Tab | 输入 / 输出 / 错误 / 元数据；切换不丢状态 |
| `RUN-F48` | 执行详情复用 | 设计器输出抽屉与 `/runs/:id` 使用同一组件与字段 |
| `RUN-F49` | 节点 trace | 展示 validate/resolve/execute/output 阶段、耗时、attempt |
| `RUN-F50` | 执行 logger | 结构化日志；nodeId + attempt + 阶段；统一脱敏 |
| `RUN-F51` | 设计器断线恢复 | 重连后按 `seq` 补齐节点状态与输出 |
| `RUN-F52` | 运行对比（P1） | 同一 snapshot 两次运行按节点对比输入/输出/耗时 |

### 2.7 应用发布与 API Key（P1）

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F53` | 应用发布 | 把已发布工作流暴露为可调用应用；固定版本 |
| `RUN-F54` | API Key 管理 | 生成/吊销/掩码/最近使用；不显示明文 |
| `RUN-F55` | 应用监控 | 调用量、成功率、P95、错误码；固定窗口 |
| `RUN-F56` | 外部调用日志 | 外部调用关联 runId；不记录密钥与完整敏感入参 |

> P1 应用发布不改变 P0 运行模型：仍走同一引擎、同一 `definition_snapshot`、同一事件表。

### 2.8 发布后试运行台（P0）

定位：这是从“已发布工作流”进入的固定版本体验与验证页。它不是编辑器里的草稿预览，也不是外部正式调用；它用于验证“这一发布版本在当前模型、知识库、MCP 与密钥配置下能否跑通”。

推荐页面结构：

```text
顶部：工作流名称 | 固定版本号 | 发布时间 | schemaHash | 就绪状态
左侧：输入区（表单 / JSON 双模式，由 start.inputSchema 生成）
右侧：执行区（运行/取消、实时节点状态、输入/输出/错误/元数据）
底部：当前版本的试运行历史（默认 trigger=manual_trial，可切换同版本全部运行）
```

关键行为：

- 从发布成功提示、版本列表或已发布工作流快捷动作进入 `/workflows/:id/trial?versionId=...`。
- 页面始终展示固定版本和 `schemaHash`；版本号来自 URL/后端返回值，不提供“自动最新版本”的隐式行为。
- 表单与 JSON 是同一份输入数据的两个视图；切换不丢值，JSON 语法或 schema 错误必须阻止运行。
- 运行前检查模型连接、知识库、MCP 工具、密钥和节点依赖。必需依赖缺失时阻止运行并给出配置入口；非阻断项显示警告。
- 运行按钮明确标记“真实执行”；对带 `destructiveHint` 的 MCP 工具或可能产生副作用的 HTTP 工具显示二次确认。
- 执行结果复用 `RUN-F47` 四 Tab 和运行详情组件；实时节点状态、输出、错误、trace、usage 与 `/runs/:id` 一致。
- 试运行产生的 run 进入运行记录，并带 `trigger=manual_trial`；不能与外部 API/MCP 调用混淆。
- 页面只读展示发布版本配置，不提供修改草稿、覆盖节点配置或编辑 Prompt 的入口。

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `RUN-F57` | 试运行入口 | 发布成功、版本列表、已发布工作流快捷动作均可进入；草稿只进入编辑器预览 |
| `RUN-F58` | 固定版本上下文 | 顶部显示 workflow/version/publishedAt/schemaHash；URL 带 `versionId`；不隐式使用 latest |
| `RUN-F59` | 输入双模式 | 表单 / JSON 共享同一数据；必填、类型、正则和 JSON 解析错误阻止运行并定位 |
| `RUN-F60` | 发布就绪检查 | 展示模型、知识库、MCP、密钥、节点依赖状态；阻断项与警告分级；提供配置入口 |
| `RUN-F61` | 真实执行提示 | 明示会使用真实配置并可能产生费用/副作用；写工具按 annotation 二次确认 |
| `RUN-F62` | 实时执行区 | 运行、取消、排队、流式输出、节点 running/succeeded/failed/skipped 可视 |
| `RUN-F63` | 结果复用 | 复用输入/输出/错误/元数据四 Tab、节点抽屉、trace、usage 与 artifact |
| `RUN-F64` | 当前版本历史 | 默认按 workflow + version + `trigger=manual_trial` 过滤；可切换全部 trigger；可打开 `/runs/:id` 或原样重跑 |
| `RUN-F65` | 调用信息 | 展示该版本可用的 HTTP/MCP 入口与客户端配置摘要；密钥只显示掩码或引用 |
| `RUN-F66` | 空/错/不可运行态 | 无输入 schema、依赖缺失、版本不存在、无权限均有明确原因和恢复动作 |

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-RUN-01` | 创建预览 run | 校验草稿、固化 snapshot、幂等 |
| `B-RUN-02` | 创建正式 run | 使用指定发布版本；pin version |
| `B-RUN-03` | 运行入队 | BullMQ enqueue；返回 runId，不阻塞 |
| `B-RUN-04` | 编译执行计划 | engine/graph 校验 + 生成可执行计划 |
| `B-RUN-05` | 调度 | 就绪集合、并发上限、分支、跳过 |
| `B-RUN-06` | 节点执行 | 执行器、输入解析、输出 schema 校验 |
| `B-RUN-07` | 重试 | 节点级 attempt；记录输入/输出/错误 |
| `B-RUN-08` | 超时 | 节点/run 级 AbortController |
| `B-RUN-09` | 取消 | 写 cancel flag；排队任务移除 |
| `B-RUN-10` | 事件持久化 | 先写 `run_events`，再 XADD |
| `B-RUN-11` | SSE bridge | XREAD BLOCK + DB backlog；支持 Last-Event-ID |
| `B-RUN-12` | 事件脱敏 | Authorization/Cookie/API Key 统一 redaction |
| `B-RUN-13` | 大输出 | 超阈值写 artifact；事件只带摘要 |
| `B-RUN-14` | run 查询 | 列表/详情/节点明细/事件分页 |
| `B-RUN-15` | 统计 | 成功率/P95/token/费用；固定窗口 |
| `B-RUN-16` | 保留策略 | 正式默认 30 天；预览 24h；可配置 |
| `B-RUN-17` | 历史重放 | 使用 `definition_snapshot`；P1 节点重跑 |
| `B-RUN-18` | 并发控制 | run/worker 双上限；超时释放槽位 |
| `B-RUN-19` | 健康与指标 | liveness/readiness；队列/运行指标 |
| `B-RUN-20` | 执行器日志契约 | 基类输出阶段日志；节点不重复实现；统一脱敏 |
| `B-RUN-21` | 节点 trace | 保存阶段耗时/attempt/错误；可按 nodeId 查询 |
| `B-RUN-22` | 应用发布（P1） | 应用记录、固定版本、API Key、调用配额 |
| `B-RUN-23` | 外部调用监控（P1） | 调用量/成功率/P95；关联 run 与错误码 |
| `B-RUN-24` | 发布版本试运行 | `workflowVersionId` 必填；`runKind=production`、`trigger=manual_trial`；使用固定 snapshot |
| `B-RUN-25` | 发布就绪检查 | 聚合模型/知识库/MCP/密钥/节点依赖状态；返回阻断项、警告与配置定位 |
| `B-RUN-26` | Webhook 入口（P0） | 发布版本启用 `start.entryMode=webhook` 后创建路由；校验签名、重放窗口和 `start.inputSchema`；创建 `trigger=webhook` 的异步 run |
| `B-RUN-27` | Schedule/event 入口（P1） | scheduler 按发布版本创建 repeatable job；event 通过事件总线匹配 `eventType` 与 `filter`；幂等、失败隔离和补跑策略可配置 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/workflows/:id/preview` | 创建预览 |
| `POST` | `/api/workflows/:id/runs` | 创建发布版本运行；`workflowVersionId` 必填，`trigger=manual_trial/api/mcp/webhook/...` |
| `POST` | `/api/hooks/:workflowId/:path` | P0 webhook 入口；匹配发布版本中 `start.entryMode=webhook` 的路径；返回 runId，不阻塞执行 |
| `GET` | `/api/workflows/:id/versions/:versionId/readiness` | 发布后试运行就绪检查 |
| `GET` | `/api/runs` | 列表过滤 workflow/version/status/kind/trigger/时间/错误码；cursor |
| `GET` | `/api/runs/:id` | 详情 |
| `GET` | `/api/runs/:id/node-runs` | 节点明细 |
| `GET` | `/api/runs/:id/events` | SSE；`Last-Event-ID`/`after` |
| `GET` | `/api/runs/:id/events/page` | 历史事件分页（非流式） |
| `POST` | `/api/runs/:id/cancel` | 取消 |
| `POST` | `/api/runs/:id/replay` | P0 原样重跑 |
| `POST` | `/api/runs/:id/retry-node` | P1 节点/分支重跑 |
| `GET` | `/api/admin/overview` | 监控概览 |
| `POST` | `/api/workflows/:id/apps` | P1：发布为应用 |
| `GET` | `/api/apps/:id/api-keys` | P1：API Key 列表（掩码） |
| `POST` | `/api/apps/:id/api-keys` | P1：生成 Key |
| `DELETE` | `/api/apps/:id/api-keys/:keyId` | P1：吊销 Key |

### 3.2 事件与状态

```text
run: queued -> running -> succeeded | failed | cancelled | waiting(P1)
node: pending -> running -> succeeded | failed | skipped | cancelled | waiting(P1)
```

事件必须包含：`seq`、`runId`、`type`、`nodeId?`、`attempt?`、`at`、已脱敏 `payload`。生命周期事件必须落库；token 流可短保留。

## 4. 示例

### 4.1 预览请求

```json
{
  "input": {
    "question": "如何申请退款？",
    "files": []
  },
  "options": { "timeoutMs": 120000 }
}
```

### 4.2 SSE 片段

```text
id: 1
event: node.started
data: {"seq":1,"runId":"run_01","type":"node.started","nodeId":"n_llm","attempt":1,"at":"2026-11-20T09:20:01Z","payload":{}}

id: 2
event: token.delta
data: {"seq":2,"runId":"run_01","type":"token.delta","nodeId":"n_llm","payload":{"text":"退款"}}

id: 3
event: run.completed
data: {"seq":3,"runId":"run_01","type":"run.completed","payload":{"output":{"text":"..."},"usage":{"totalTokens":812}}}
```

### 4.3 失败节点

```json
{
  "nodeId": "n_tool",
  "attempt": 2,
  "status": "failed",
  "error": {
    "code": "HTTP_TIMEOUT",
    "message": "请求超时（15000ms）",
    "retryable": true,
    "details": { "host": "api.example.com", "status": null }
  }
}
```

### 4.4 发布版本试运行请求

```json
{
  "workflowVersionId": "wfv_01",
  "trigger": "manual_trial",
  "input": {
    "question": "如何申请退款？",
    "files": []
  },
  "options": { "timeoutMs": 120000 }
}
```

```json
{
  "runId": "run_02",
  "workflowVersionId": "wfv_01",
  "runKind": "production",
  "trigger": "manual_trial",
  "status": "queued",
  "links": {
    "detail": "/runs/run_02",
    "events": "/api/runs/run_02/events"
  }
}
```

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-RUN-01` | P0 | run/node_run/run_event 表与迁移 | 空库可执行；唯一约束生效 |
| `T-RUN-02` | P0 | 创建预览/正式 run + 幂等 + snapshot | 重复提交不产生两个 run |
| `T-RUN-03` | P0 | BullMQ 入队 + worker 消费 + 编译 | 线性工作流可执行 |
| `T-RUN-04` | P0 | 调度/分支/并行/跳过 | 未选分支 skipped，下游不执行 |
| `T-RUN-05` | P0 | 重试/超时/取消 | attempt 完整；取消释放槽位 |
| `T-RUN-06` | P0 | 事件落库 + Redis + SSE bridge | 刷新/断网补齐最终状态 |
| `T-RUN-07` | P0 | 预览台输入表单 | 由 inputSchema 自动生成 |
| `T-RUN-08` | P0 | 画布节点状态 + 输出抽屉 | 点击节点可看 I/O/错误/耗时 |
| `T-RUN-09` | P0 | 运行列表/详情/时间线 | 过滤可组合，深链可直达 |
| `T-RUN-10` | P0 | 1 万事件虚拟滚动 | 滚动可用，不卡死 |
| `T-RUN-11` | P0 | 日志脱敏与 artifact | 无密钥；大输出不塞事件 |
| `T-RUN-12` | P0 | 原样重跑 | 使用原 snapshot，不受草稿影响 |
| `T-RUN-13` | P1 | 失败节点/分支重跑 | 不重复执行已完成节点 |
| `T-RUN-14` | P1 | 运行对比与版本 diff | 可定位差异节点与输出 |
| `T-RUN-15` | P1 | 监控概览 | 指标与队列状态可用 |
| `T-RUN-16` | P0 | 测试运行四 Tab + 执行详情复用 | 设计器与运行详情字段一致 |
| `T-RUN-17` | P0 | 基类日志契约与节点 trace | 阶段/耗时/attempt 可查；无重复日志格式 |
| `T-RUN-18` | P1 | 应用发布 + API Key | 固定版本；Key 只显示掩码；可吊销 |
| `T-RUN-19` | P1 | 外部调用监控 | 调用量/成功率/P95 可查 |
| `T-RUN-20` | P0 | 发布后试运行台 | 固定版本、输入双模式、实时执行、四 Tab、当前版本历史完整 |
| `T-RUN-21` | P0 | 发布就绪检查 | 缺模型/知识库/MCP/密钥/节点依赖时阻断或警告，并可定位配置 |

## 6. 测试关注点

- 预览与正式运行结果一致性；同一 snapshot 重放一致。
- 断网 30s、刷新页面、重复事件、seq 跳跃/重复。
- 节点超时、run 超时、手动取消、排队中取消。
- 第一次失败第二次成功的 attempt 记录。
- 含 Authorization / Cookie / apiKey 的 HTTP 节点日志脱敏。
- 大输出（>1MB）、二进制 artifact、下载权限。
- 基类阶段日志完整（validate/resolve/execute/output）；节点未重复实现日志。
- 设计器测试运行四 Tab 与运行详情字段一致；断线后节点状态可补齐。
- 发布后试运行固定 `workflow_version_id`；修改草稿或发布新版本不影响当前页面和当前输入。
- 试运行页面显示真实执行提示；带副作用的工具需要明确确认。
- 模型、知识库、MCP、密钥或节点依赖缺失时，就绪检查必须给出阻断项与配置定位。
- P1 应用发布后固定版本；API Key 只显示掩码，吊销后调用失败。

## 7. 待决策

1. 运行中离开编辑器是否保持后台运行？建议保持，并可从运行列表恢复。
2. `token.delta` 是否展示完整流式文本？建议批量展示，原始事件仍可查。
3. P0 是否提供“从失败节点重跑”？建议 P1；P0 只保证原样重跑。
4. 运行列表默认保留多久？建议正式 30 天、预览 24h，可配置。
5. 试运行是否使用生产凭证？建议使用，并明确“真实执行”；写工具依赖 `destructiveHint` 二次确认。若未来提供模拟模式，必须是独立能力，不能把普通试运行伪装成 dry-run。

