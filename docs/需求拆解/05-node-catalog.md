# 05 节点目录与 20 个默认节点

> 优先级：P0 8 个、P0.5 3 个、P1 9 个。
> 原则：P0/P1 默认面板保留 20 个节点类型；被合并能力通过 `mode/kind/operation/entryMode` 表达。20 是当前交付基线，不是永久冻结上限。
> 相关包：`@ai-reflow/core`（Manifest/注册表）、`@ai-reflow/capabilities`（executor/provider）、`@ai-reflow/engine`（调度）；设计器注册表与表单投影见 12。

## 1. 模块边界

包含：

- 20 个节点的产品语义、判据、运行输入、输出 handles/字段、关键配置。
- 合并节点的 mode/kind/operation 规则与上限。
- 节点开发流程：Manifest、schema、executor、Inspector、fixture、单测、文档。
- 节点错误码与事件 payload 要求。

不包含：

- Inspector 控件细节（见 03）。
- 运行时调度/日志（见 04）。
- 插件市场安装（见 09）。

不变量：

- 一个工作流有且只有一个 `start`；`start` 不能有输入边。
- 输出 handle 被边引用时不能删除。
- 每个 mode 是 discriminated union；必须有独立 fixture、错误码、UI 表单、文档段落。
- `capabilities.sideEffect=true` 默认不自动重试。
- 节点输出必须通过 `outputSchema`；大输出落 artifact。
- P2 的 `media-generation`、`a2a`、`notification`、`browser`、`plugin-trigger` 不进入默认面板。

### 1.1 节点开发模型

一个节点 = 一个 `defineNode()` 注册对象；`registerNode()` 是唯一注册入口：

```ts
// packages/core/src/node/registration.ts
export interface NodeRegistration<TConfig = unknown> {
  manifest: NodeManifest<TConfig>;
  executor?: NodeExecutorFactory<TConfig>; // worker 注册
  form?: NodeFormRegistration;             // web 注册
  component?: unknown;                     // 可选节点渲染器
  examples?: NodeExample[];
}

// packages/capabilities/src/nodes/llm/index.ts
export const llmNode = defineNode({
  manifest: llmManifest,
  executor: () => new LlmExecutor(),
  form: { kind: 'schema', schema: llmConfigJsonSchema },
  examples: [llmGenerateExample, llmClassifyExample],
});
```

执行器统一继承 `BaseNodeExecutor`，只实现业务：

```ts
export class LlmExecutor extends BaseNodeExecutor<LlmConfig> {
  readonly manifest = llmManifest;

  protected async doExecute(ctx: NodeExecutionContext, config: LlmConfig, input: NodeInput) {
    const result = await ctx.providers.llm.generate({ ...config, input });
    return { text: result.text, usage: result.usage, model: result.model };
  }
}
```

- `execute()`（基类）：config 校验、变量解析、超时/取消、阶段日志、输出校验、错误归一化、上下文写入。
- `doExecute()`（每个节点）：只写业务逻辑并返回 `NodeOutput`；不自行重试、不自定义日志格式、不吞错。
- 重试/attempt 由调度器负责；`sideEffect=true` 的节点默认不自动重试。
- 表单随 `registerNode()` 自动注册；解析优先级为自定义组件 > JSON Schema（含 `x-*`）> `configFields` > 只读兜底。详见 03/12。

进程投影（同一份定义，不同进程只注册需要的部分）：

| 进程                   | manifest    | form | executor    | component | 用途                        |
| -------------------- | ----------- | ---- | ----------- | --------- | ------------------------- |
| `apps/web`           | 是           | 是    | 否           | 是         | Palette、Inspector、校验、节点渲染 |
| `apps/worker`        | 是           | 否    | 是           | 否         | 执行与输出校验                   |
| `apps/server`        | 是           | 否    | 否           | 否         | Manifest 投影、导入校验          |
| `apps/plugin-runner` | 插件 manifest | 否    | 插件 executor | 否         | 隔离执行第三方代码                 |

注册表语义：

- 按 `manifest.type` 合并；后注册字段覆盖先注册字段。
- 重复注册 `executor`/`form` 输出 `REGISTRY_OVERWRITE` 警告；生产默认拒绝覆盖。
- `unregisterNode(type)` 用于插件禁用/卸载；已打开工作流保留只读快照，不崩溃。
- `onNodeRegistryChange()` 让 Palette、`nodeTypes`、Inspector 自动刷新；页面不得手工重建列表。
- 未知 `type/version/mode` 必须显式报错，不静默丢弃。
- 现有 `packages/core/src/registry.ts` 的 `registerNode`/`registerEdge` 作为起点扩展为 `NodeRegistration`；不新建并行注册表。

## 2. 节点清单评审结论

### 2.1 结论：保留 20 个默认节点

截至 2026-11-24，按 Dify 官方节点文档、Coze Studio `node_meta.go`、n8n 核心节点文档以及 Flowise/Langflow 的组件模型重新核对，当前 20 个默认节点可以覆盖主流产品的工作流原子能力。**不推荐在 P1 把默认面板直接扩到 26+ 个节点**，否则会把 MVP 变成集成市场的目录页。

市场产品常用高频能力映射如下：

| 市场高频能力 | 典型表达 | ai-reflow 落点 |
| --- | --- | --- |
| 手动 / 表单输入 | Start / User Input / Manual Trigger | `start.entryMode=manual` |
| Webhook / 定时 / 事件触发 | Webhook Trigger / Schedule Trigger / Integration Trigger | `start.entryMode=webhook/schedule/event` |
| Chat 回复 / API 响应 | Answer / Output / Respond to Webhook | `output.mode=chat_response/api_response/workflow_output` |
| 文本生成 / 结构化输出 | LLM / Chat / Prompt | `llm.mode=generate/structured` |
| 意图 / 问题分类 | Question Classifier / Intent Recognition | `llm.mode=classify` |
| 参数抽取 | Parameter Extractor / Extractor | `llm.mode=extract` |
| HTTP / 工具 / MCP | HTTP Request / Tool / Plugin | `tool.kind=http/mcp/plugin` |
| 知识检索 / 向量库 | Knowledge Retrieval / Vector Store / Retriever | `knowledge.operation=retrieve` |
| 知识写入 / 索引 | Knowledge Writing / Indexer | `knowledge.operation=index` |
| 文档抽取 | Document Extractor / Document Loader | `document` |
| 条件 / 多分支 | If-Else / Switch / Selector | `condition.mode=binary/switch` |
| 变量设置 / 聚合 | Set / Variable Assigner / Variable Aggregator / Merge | `variable.mode=assign/aggregate` |
| 模板 / 文本处理 | Template / Text Processing | `template` |
| JSON / 列表处理 | List Operator / JSON Serialization / Data Transform | `data-transform.operation=text/json/list` |
| 批量 / 迭代 | Iteration / Batch / Split In Batches | `loop.mode=forEach`、`parallel` |
| 循环 / 递归 | Loop / While | `loop.mode=while/fixed` |
| 等待 / 回调 | Wait / Delay | `wait` |
| 子流程复用 | Execute Workflow / SubWorkflow / Workflow | `subworkflow` |
| 人工表单 / 审批 | Human Input / Approval | `human.mode=form/approval` |
| 自定义代码 | Code / Code Runner / Custom Function | `code` |
| 数据库 / SQL | Database Query / SQL Customization | `database` |
| 文件 / 对象存储 | Read/Write File / Convert to File | `file` |
| 评估 / 护栏 | Evaluation / Guardrails / Moderation | `quality-gate.mode=evaluate/guardrail` |
| Agent / 多步工具循环 | Agent / Tool Agent | `agent` |

Flowise/Langflow 更接近组件图：常见能力是 Chat/Document/Vector Store/Prompt/Tool/Memory/Output Parser/Custom Function。这些能力在 ai-reflow 中由 `llm`、`knowledge`、`template`、`tool`、`code` 等统一 Manifest 承接；不把它们的每一类组件都复制成默认节点。

### 2.2 需要同步收紧的设置边界

1. `start` 保留唯一入口节点，但触发器配置必须是“一等设置”：P0 只开放 `manual/webhook`；P1 开放 `schedule/event`，四个 mode 各自有独立 fixture、错误码、表单组和校验。P2 的插件触发器不得塞进 `start.entryMode`。
2. `tool` 是统一外调节点，不因厂商不同继续膨胀。厂商能力走 plugin registry 与权限清单；若某个外部产品成为高频场景，优先评估独立 plugin，而不是新增默认节点。
3. `parallel` 负责 fan-out/fan-in；`variable.mode=aggregate` 负责分支结果合并；`data-transform` 负责纯结构转换。禁止把网络调用、模型调用、任意代码塞进这三个节点。
4. `llm.mode=classify/extract` 不再为分类器、参数抽取器增设独立节点；当分类或抽取表单复杂到需要专属 Inspector 时，只增加自定义 Inspector，不新增默认节点。
5. P2 候选节点必须先通过准入评审，再进入默认面板：
   - `notification`：站内 / 邮件 / Webhook / 飞书 / 钉钉 / Slack 等通知出口；先做统一 `notify` 抽象，不做每厂商一个节点。
   - `browser`：网页抓取、截图、DOM 提取与受控自动化；必须声明反爬、登录态、文件下载与安全边界。
   - `media-generation`：图像 / 音频 / 视频生成；大输出落 artifact，成本与时长显式上报。
   - `a2a`：Agent-to-Agent 协议入口与调用，不能伪装成普通 `tool`。
   - `plugin-trigger`：插件市场提供的触发器适配器；与 `start` 解耦，但必须绑定触发器运行时和幂等策略（见 09 的 `MKT-F56`）。

准入硬规则：同一能力已有现有节点表达时不准入；节点间共享字段少于 30% 不准入；没有独立错误码、fixture、权限模型、超时/重试策略不准入；没有真实工作流模板和用户证据不准入。

## 3. 20 个默认节点合并规则

| 节点               | 允许的判据                                             | 合并了哪些能力                                   | 禁止再塞入         |
| ---------------- | ------------------------------------------------- | ----------------------------------------- | ------------- |
| `start`          | `entryMode=manual/webhook(P0)；schedule/event(P1)` | webhook/schedule/event trigger            | 聊天/表单入口       |
| `output`         | `mode=workflow_output/chat_response/api_response` | end、response                              | 发邮件/webhook   |
| `llm`            | `mode=generate/structured/classify/extract`       | classifier、extractor、conversation(memory) | 完整 Agent 循环   |
| `tool`           | `kind=http/mcp/plugin`                            | http、mcp-tool、tool                        | 数据库/文件读写      |
| `knowledge`      | `operation=retrieve/index`                        | retrieval、index、merge、rerank              | 文档解析 UI       |
| `condition`      | `mode=binary/switch`                              | 二元/多分支                                    | 语义分类          |
| `template`       | 无                                                 | 变量插值                                      | 字符串函数/任意代码    |
| `variable`       | `mode=assign/aggregate`                           | assign、aggregate                          | 覆盖输入/上游输出     |
| `data-transform` | `operation=text/json/list`                        | text、json、list-operator                   | 网络/模型调用       |
| `document`       | 无                                                 | document-extractor                        | artifact 生命周期 |
| `parallel`       | 无                                                 | fan-out/fan-in                            | 循环            |
| `agent`          | 无                                                 | 多步规划/工具循环                                 | 无限预算          |
| `loop`           | `mode=forEach/while/fixed`                        | iteration、batch                           | 子流程编排         |
| `subworkflow`    | 无                                                 | 复用/子运行                                    | 隐式 latest     |
| `human`          | `mode=form/approval`                              | human-input、form、approval                 | 通知渠道          |
| `wait`           | 无                                                 | 延时/回调等待                                   | 阻塞 worker     |
| `code`           | 无                                                 | 隔离代码执行                                    | 主进程执行         |
| `database`       | 无                                                 | 参数化查询/CRUD                                | 任意 ORM 暴露     |
| `quality-gate`   | `mode=evaluate/guardrail`                         | evaluator、guardrails                      | 模型路由          |
| `file`           | 无                                                 | artifact 读写/列表/转换                         | 解析正文          |

硬规则：一个节点超过 5 个 mode，或 mode 间共享字段少于 30%，应拆回独立节点；任何新增 mode 等同新增节点，必须评审。

## 4. 前端功能

| 编号         | 功能点            | 说明                                                                   |
| ---------- | -------------- | -------------------------------------------------------------------- |
| `NODE-F01` | 默认面板 20 项      | 只展示定稿 20 类；按分类/phase 筛选；P2 候选不进入默认面板                                  |
| `NODE-F02` | 节点图标与颜色        | 分类色 + 文字标签；不只用颜色区分                                                   |
| `NODE-F03` | 通用节点卡片         | 标题、type、状态、错误角标、输入/输出 Handle                                         |
| `NODE-F04` | 分支 Handle 标签   | `true/false/case.<id>/default/body/done/approved/rejected/pass/fail` |
| `NODE-F05` | 模式选择器          | `mode/kind/operation/entryMode` 位于 Inspector 顶部                      |
| `NODE-F06` | 节点专属 Inspector | 复杂节点自定义面板；其余由 configSchema 渲染                                        |
| `NODE-F07` | 输出 fixture 预览  | 每个节点/mode 至少一个静态示例                                                   |
| `NODE-F08` | 节点设置文档页        | 默认 20 个节点 I/O、字段、能力、权限可浏览；P2 候选仅显示准入状态                                 |
| `NODE-F09` | 不支持节点处理        | 导入未知 type/旧 version 时明确报错，不静默丢弃                                      |
| `NODE-F10` | 搜索节点           | 名称、type、中文别名；空结果提示清除筛选                                               |
| `NODE-F11` | 节点校验角标         | 配置/端口/引用错误直接显示在节点                                                    |
| `NODE-F12` | 模式切换提示         | 切换保留旧字段但提示“保存后按当前 mode 校验”                                           |
| `NODE-F13` | 工具结果预览         | `tool.kind=mcp/http` 展示 result/structuredContent/isError             |
| `NODE-F14` | 知识库引用预览        | 展示 chunks/citations/context 结构                                       |
| `NODE-F15` | 分类分支预览         | `llm.mode=classify` 显示类别 handle 与 fallback                           |
| `NODE-F16` | 并行分支编辑         | branches 列表、并发、join、失败策略                                             |
| `NODE-F17` | 人工表单预览         | `human.mode=form` 用 formSchema 渲染预览                                  |
| `NODE-F18` | 代码/SQL 编辑器     | CodeMirror；只读 SQL 预览与风险提示                                            |
| `NODE-F19` | 文件字段           | 上传控件 + FileRef；不出现 base64                                            |
| `NODE-F20` | 节点示例入口         | 从节点设置跳转 06 的示例/fixture 说明                                            |

## 5. 默认 20 个节点 I/O 矩阵

### 5.1 P0

|  # | 节点          | 判据          | 运行输入          | 输出 handles → 字段                                                                                                                   | 关键配置                                                                                                                                    |
| -: | ----------- | ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
|  1 | `start`     | `entryMode` | 无；不能有输入边      | `out` → `input`、`files`、`run`                                                                                                     | P0：manual/webhook；P1：schedule/event；`inputSchema`；文件策略；webhook/cron/event 字段                                                              |
|  2 | `output`    | `mode`      | `in`(any, 必需) | `out`（仅 `final=false`）→ `body/statusCode/headers/streamed/usage`                                                                  | mode；`content`(Tiptap)；outputMapping/jsonSchema；statusCode；stream；final                                                                 |
|  3 | `llm`       | `mode`      | `in`(any, 可选) | `out` → `text/json/classId/confidence/scores/value/toolCalls/finishReason/usage/model/artifact`；classify 另有 `class.<id>/fallback` | model-picker；promptMode；systemPrompt/prompt；messages；json/extractionSchema；classes；memory；tools                                         |
|  4 | `tool`      | `kind`      | `in`(any, 可选) | `out` → `result/structuredContent/usage/kind/source`                                                                              | http：method/url/headers/query/body/auth/response；mcp：serverId/toolName/arguments/schemaHash；plugin：installId/toolName/version/arguments |
|  5 | `knowledge` | `operation` | `in`(any, 可选) | retrieve：`out` → `chunks/citations/context/total`；index：`out` → `documentId/chunks/indexed/failed/usage/artifacts`                | operation；knowledgeBaseIds；query(Tiptap)；topK/threshold/mode/rerank/citation；index 的 parser/chunk/embedding/upsert                      |
|  6 | `condition` | `mode`      | `in`(any, 可选) | binary：`true/false`；switch：`case.<id>/default`；字段 `matched/branch/results`                                                        | mode；combinator；conditions；switchCases；defaultBranch；caseSensitive                                                                      |
|  7 | `template`  | 无           | `in`(any, 可选) | `out` → `text/value/missing/length`                                                                                               | `template`(Tiptap+chip)；syntax；variables；missingStrategy；outputType；jsonSchema；maxLength                                                |
|  8 | `variable`  | `mode`      | `in`(any, 可选) | assign：`out` → `assigned/vars`；aggregate：`out` → `value/items/count`                                                              | mode；assign 的 scope/assignments/strictTypes；aggregate 的 sources/strategy/target/dedupe/type                                             |

### 5.2 P0.5

|  # | 节点               | 判据          | 运行输入                          | 输出 handles → 字段                                                     | 关键配置                                                                                                                                                    |
| -: | ---------------- | ----------- | ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  9 | `data-transform` | `operation` | `in`(string/object/array, 可选) | `out` → `value/text/valid/errors/items/count/parts/length`          | text：operation/input/separator/pattern/caseMode；json：operation/path/paths/merge/schema；list：operation/itemVariable/predicate/mapTemplate/sortBy/groupBy |
| 10 | `document`       | 无           | `in`(file/string, 可选)         | `out` → `text/markdown/pages/tables/metadata/chunks/artifacts`      | source；parser；pages；includeTables/Images；ocr；outputMode；chunk；maxFileSize/maxPages/timeout                                                              |
| 11 | `parallel`       | 无           | `in`(any, 必需)                 | `branch.<id>`；`out` → `results/succeeded/failed/skipped/aggregated` | branches；maxConcurrency；joinStrategy；quorum；errorPolicy；cancelRemainingOnFail；timeouts；aggregate                                                        |

### 5.3 P1

|  # | 节点             | 判据     | 运行输入          | 输出 handles → 字段                                                                                                                        | 关键配置                                                                                                                                   |
| -: | -------------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 12 | `agent`        | 无      | `in`(any, 可选) | `out` → `output/messages/steps/toolCalls/usage/finishReason`                                                                           | modelConnectionId；instructions/inputExpression；knowledge；mcpTools；maxSteps/timeoutMs；memory；outputSchema                                  |
| 13 | `loop`         | `mode` | `in`(any, 必需) | `body`；`done` → `items/iterations/lastOutput/failed/aggregated`                                                                        | forEach：items/concurrency；while：condition；fixed：iterations；item/indexVariable；maxIterations；collectOutput；breakCondition；errorPolicy   |
| 14 | `subworkflow`  | 无      | `in`(any, 必需) | `out` → `output/childRunId/status/usage`；`error`（collect 时）                                                                            | workflow-picker；versionPolicy/version；input/outputMapping；timeout；maxDepth；errorPropagation；inheritWorkspace                           |
| 15 | `human`        | `mode` | `in`(any, 必需) | form：`submitted`；approval：`approved/rejected`；字段 `action/values/comment/submittedBy/submittedAt/decision/decidedAt`                    | form：formSchema/submitLabel/allowDraft；approval：payload/title/assignee/actions；description；timeout/action/resumeTtl                    |
| 16 | `wait`         | 无      | `in`(any, 必需) | `out` → `waitedMs/callbackPayload/timedOut`                                                                                            | durationMs/until/callbackToken；resumePayloadSchema；timeout；onTimeout；idempotencyKey；notifyUrl                                          |
| 17 | `code`         | 无      | `in`(any, 可选) | `out` → `output/stdout/stderr/exitCode/artifacts`                                                                                      | runtime/language/code/entrypoint；input/outputSchema；timeout/memory/cpu；networkPolicy/allowedHosts；packages；sandboxProfile              |
| 18 | `database`     | 无      | `in`(any, 可选) | `out` → `rows/rowCount/affected/lastInsertId`                                                                                          | connectionId；operation；table；sql；where/values；conflictTarget；limit；returning；allowWrite；transaction                                    |
| 19 | `quality-gate` | `mode` | `in`(any, 可选) | evaluate：`pass/fail`；guardrail：`pass/block`；字段 `passed/score/metrics/reasoning/validationType/input/detectedEntities/maskedText/usage` | evaluate：target/reference/rubric、metrics、threshold、passCriteria；guardrail：checks、action、outputField、regex/pii/hallucination/moderation |
| 20 | `file`         | 无      | `in`(any, 可选) | `out` → `file/files/text/artifact`                                                                                                     | operation；source；path；mime；content(Tiptap 仅文本)；encoding；overwrite；convertTo；listPrefix/limit；maxSize/artifactTtl                       |

### 5.4 节点属性明细

#### 5.4.1 通用属性（所有节点）

| 字段                           | 类型                                 | 必填 | 默认            | 说明                          |
| ---------------------------- | ---------------------------------- | -- | ------------- | --------------------------- |
| `title`                      | string                             | 是  | 节点类型名         | 画布显示名，≤80 字符                |
| `description`                | string                             | 否  | `""`          | 节点用途，≤500 字符                |
| `enabled`                    | boolean                            | 否  | `true`        | false 时只发 skipped，不执行       |
| `timeoutMs`                  | number                             | 否  | `30000`       | 节点级超时；长任务节点有专属默认            |
| `retry.maxAttempts`          | number                             | 否  | `1`           | 含首次，1–5                     |
| `retry.delayMs`              | number                             | 否  | `1000`        | 首次重试延迟                      |
| `retry.backoff`              | `fixed` / `exponential`            | 否  | `exponential` | 退避策略                        |
| `retry.retryOn`              | string\[]                          | 否  | 节点默认          | 可重试错误码                      |
| `errorPolicy.mode`           | `fail` / `continue` / `fallback`   | 否  | `fail`        | 失败后的行为                      |
| `errorPolicy.fallbackOutput` | unknown                            | 否  | `null`        | fallback 输出，须过 outputSchema |
| `outputLimitBytes`           | number                             | 否  | `1048576`     | 超限写 artifact                |
| `logLevel`                   | `minimal` / `standard` / `verbose` | 否  | `standard`    | 日志详细度                       |
| `notes`                      | string                             | 否  | `""`          | 协作者备注，不进入运行                 |

> 以下属性表只列节点专属字段；所有节点都同时适用上表通用字段。

#### 5.4.2 `start`

判据：`entryMode`；输出 handle：`out`。运行输入：无，且不能有输入边。

| 字段                  | 类型                                          | 必填 | 默认                     | 说明                      |
| ------------------- | ------------------------------------------- | -- | ---------------------- | ----------------------- |
| `entryMode`         | `manual` / `webhook` / `schedule` / `event` | 否  | `manual`               | 入口模式；P0 仅开放 manual/webhook，schedule/event 在 P1 启用 |
| `inputSchema`       | InputField\[]                               | 是  | `[]`                   | 输入字段定义，建议 1–20 个        |
| `allowFileUpload`   | boolean                                     | 否  | `false`                | 是否允许文件输入                |
| `allowedFileTypes`  | string\[]                                   | 否  | `pdf/md/txt/docx/html` | 扩展名 allowlist           |
| `maxFileSizeBytes`  | number                                      | 否  | `20971520`             | 单文件 20MB                |
| `maxFiles`          | number                                      | 否  | `5`                    | 单次文件数                   |
| `maxInputBytes`     | number                                      | 否  | `1048576`              | 非文件输入总大小                |
| `includeRunContext` | boolean                                     | 否  | `true`                 | 输出是否带 run.id/kind       |
| `exampleInput`      | object                                      | 否  | `{}`                   | 预览默认示例                  |
| `inputErrorMessage` | string                                      | 否  | `输入校验失败`               | 用户错误文案                  |
| `path`              | string                                      | 条件 | —                      | `entryMode=webhook` 必填  |
| `secretRef`         | secretRef                                   | 条件 | —                      | webhook 签名密钥            |
| `replayWindowSec`   | number                                      | 条件 | —                      | webhook 重放窗口            |
| `cron`              | string                                      | 条件 | —                      | `entryMode=schedule` 必填 |
| `timezone`          | string                                      | 条件 | —                      | 调度时区                    |
| `catchUp`           | boolean                                     | 否  | `false`                | schedule 是否补跑           |
| `eventType`         | string                                      | 条件 | —                      | `entryMode=event` 必填    |
| `filter`            | ConditionGroup                              | 否  | `null`                 | event 结构化过滤             |

`InputField`：`name`(string, 是)、`type`(DataType, 是, 默认 `string`)、`required`(false)、`default`(null)、`description`、`format`(text/textarea/select/file/json/number)、`options`、`validation`(RE2 pattern)、`sensitive`(false)。

输出字段：`input`、`files?`、`run?`。关键错误：`INPUT_VALIDATION_FAILED`、`FILE_TOO_LARGE`、`UNSUPPORTED_FILE_TYPE`、`TOO_MANY_FILES`、`INPUT_TOO_LARGE`。

运行侧契约：`webhook` 入口路由、签名校验与重放保护见 04 的 `B-RUN-26`；`schedule/event` 运行时见 04 的 `B-RUN-27`；P2 插件触发器的准入状态与生命周期见 09 的 `MKT-F56`。

#### 5.4.3 `output`

判据：`mode`；输入 handle：`in`（必需）；输出 handle：`out`（仅 `final=false`）。

| 字段                 | 类型                                                   | 必填 | 默认                | 说明                     |
| ------------------ | ---------------------------------------------------- | -- | ----------------- | ---------------------- |
| `mode`             | `workflow_output` / `chat_response` / `api_response` | 是  | `workflow_output` | 输出模式                   |
| `content`          | string / RichTextValue / VariableRef                 | 条件 | —                 | text/chat 时必填          |
| `outputMapping`    | object                                               | 条件 | `{}`              | JSON 输出映射              |
| `jsonSchema`       | object                                               | 否  | `null`            | JSON 输出校验              |
| `statusCode`       | number                                               | 否  | `200`             | 100–599                |
| `headers`          | KeyValue\[]                                          | 否  | `[]`              | 禁止危险响应头                |
| `contentType`      | string                                               | 否  | 按 mode            | text/json/event-stream |
| `stream`           | boolean                                              | 否  | `false`           | 是否流式推送                 |
| `final`            | boolean                                              | 否  | `true`            | 是否终止运行                 |
| `includeCitations` | boolean                                              | 否  | `true`            | 是否附带知识库引用              |
| `maxOutputBytes`   | number                                               | 否  | `1048576`         | 输出上限                   |
| `errorMode`        | `inline` / `http_status`                             | 否  | `inline`          | 错误呈现方式                 |

输出字段：`body`、`statusCode`、`headers`、`streamed`、`usage?`。关键错误：`RESPONSE_SCHEMA_INVALID`、`RESPONSE_TOO_LARGE`、`RESPONSE_STREAM_ABORTED`。

#### 5.4.4 `llm`

判据：`mode`；输入 handle：`in`（可选）；输出：`out`，classify 另有 `class.<classId>` / `fallback`。

| 字段                  | 类型                                                 | 必填 | 默认         | 说明                 |
| ------------------- | -------------------------------------------------- | -- | ---------- | ------------------ |
| `mode`              | `generate` / `structured` / `classify` / `extract` | 否  | `generate` | 模型调用模式             |
| `modelConnectionId` | string                                             | 是  | —          | 模型连接               |
| `model`             | string                                             | 否  | 连接默认       | 覆盖连接模型             |
| `promptMode`        | `single` / `messages`                              | 否  | `single`   | 单 Prompt 或消息数组     |
| `systemPrompt`      | RichTextValue                                      | 否  | `""`       | 系统提示，可插变量          |
| `prompt`            | RichTextValue                                      | 条件 | `""`       | single 模式必填        |
| `messages`          | Message\[]                                         | 条件 | `[]`       | messages 模式必填      |
| `temperature`       | number                                             | 否  | `0.7`      | 0–2                |
| `topP`              | number                                             | 否  | `0.9`      | 0–1                |
| `maxTokens`         | number                                             | 否  | `4096`     | 输出上限               |
| `stop`              | string\[]                                          | 否  | `[]`       | 停止序列               |
| `responseFormat`    | `text` / `json_object` / `json_schema`             | 否  | `text`     | 结构化输出              |
| `jsonSchema`        | object                                             | 条件 | `null`     | structured 必填      |
| `classes`           | ClassDef\[]                                        | 条件 | `[]`       | classify 必填，1–32 类 |
| `fallbackClassId`   | string                                             | 否  | `null`     | 分类失败/低置信           |
| `extractionSchema`  | object                                             | 条件 | `null`     | extract 必填         |
| `repairAttempts`    | number                                             | 否  | `1`        | 结构化修复次数 0–3        |
| `tools`             | ToolRef\[]                                         | 否  | `[]`       | 工具引用               |
| `toolChoice`        | `auto` / `none` / `required` / `{name}`            | 否  | `auto`     | 工具选择               |
| `maxToolSteps`      | number                                             | 否  | `5`        | 工具循环上限             |
| `stream`            | boolean                                            | 否  | `false`    | 流式 token           |
| `memory`            | object                                             | 否  | `{}`       | 会话记忆配置             |
| `vision`            | object                                             | 否  | `{}`       | 图片/文件映射            |
| `fallbackModels`    | string\[]                                          | 否  | `[]`       | 主模型失败后顺序           |

`ClassDef`：`id`(string, 是)、`label`(string, 是)、`description`、`examples`(2–5 个)。抽取/结构化输出必须服务端 schema 校验，不能直接透传模型文本。

输出字段：`text`、`json?`、`classId?`、`confidence?`、`scores?`、`value?`、`toolCalls?`、`finishReason`、`usage`、`model`、`artifact?`。

#### 5.4.5 `tool`

判据：`kind`；输入 handle：`in`（可选）；输出 handle：`out`。

| 字段                | 类型                          | 必填 | 默认                | 适用 kind    | 说明                              |
| ----------------- | --------------------------- | -- | ----------------- | ---------- | ------------------------------- |
| `kind`            | `http` / `mcp` / `plugin`   | 是  | `http`            | 全部         | 工具类型                            |
| `method`          | `GET/POST/PUT/PATCH/DELETE` | 条件 | `GET`             | http       | 请求方法                            |
| `url`             | string                      | 条件 | —                 | http       | 必须过 SSRF 校验                     |
| `headers`         | KeyValue\[]                 | 否  | `[]`              | http       | 敏感值用 secretRef                  |
| `query`           | KeyValue\[]                 | 否  | `[]`              | http       | 查询参数                            |
| `body`            | unknown                     | 否  | `null`            | http       | JSON/text/form                  |
| `auth`            | object                      | 否  | `{type:none}`     | http       | none/bearer/basic/apiKey/oauth2 |
| `responseType`    | `auto/json/text/binary`     | 否  | `auto`            | http       | 响应解析                            |
| `followRedirects` | boolean                     | 否  | `false`           | http       | 默认不跟随                           |
| `maxRedirects`    | number                      | 否  | `3`               | http       | 重定向上限                           |
| `serverId`        | string                      | 条件 | —                 | mcp        | MCP Server                      |
| `toolName`        | string                      | 条件 | —                 | mcp/plugin | 工具名                             |
| `toolSchemaHash`  | string                      | 否  | —                 | mcp        | 发布锁定 schema                     |
| `pluginInstallId` | string                      | 条件 | —                 | plugin     | 插件安装记录                          |
| `toolVersion`     | string                      | 条件 | install 版本        | plugin     | 插件版本                            |
| `arguments`       | object                      | 否  | `{}`              | mcp/plugin | 参数映射                            |
| `credentialRef`   | secretRef                   | 否  | 自动                | mcp/plugin | 凭据引用                            |
| `timeoutMs`       | number                      | 否  | `30000`           | 全部         | 调用超时                            |
| `retryPolicy`     | object                      | 否  | `{maxAttempts:0}` | mcp/plugin | 非幂等工具不自动重试                      |
| `approvalPolicy`  | `none` / `confirm-write`    | 否  | `none`            | mcp        | 写工具显式确认                         |
| `outputMode`      | `envelope` / `mapped`       | 否  | `envelope`        | 全部         | 原始结果或字段映射                       |
| `maxOutputBytes`  | number                      | 否  | `1048576`         | 全部         | 输出上限                            |
| `outputMapping`   | object                      | 否  | `{}`              | 全部         | 结果映射                            |
| `outputSchema`    | object                      | 否  | 插件 schema         | plugin     | 输出校验                            |
| `permissionCheck` | boolean                     | 否  | `true`            | 全部         | 调用前权限检查                         |

输出字段：`result`、`structuredContent?`、`usage?`、`kind`、`source`。

#### 5.4.6 `knowledge`

判据：`operation`；输入 handle：`in`（可选）；输出 handle：`out`。

| 字段                 | 类型                                   | 必填 | 默认             | 适用 operation | 说明              |
| ------------------ | ------------------------------------ | -- | -------------- | ------------ | --------------- |
| `operation`        | `retrieve` / `index`                 | 否  | `retrieve`     | 全部           | 检索或索引           |
| `knowledgeBaseIds` | string\[]                            | 条件 | —              | retrieve     | 1–5 个知识库        |
| `query`            | RichTextValue / VariableRef          | 条件 | —              | retrieve     | 查询文本            |
| `topK`             | number                               | 否  | `5`            | retrieve     | 1–50            |
| `scoreThreshold`   | number                               | 否  | `0.3`          | retrieve     | 低于阈值丢弃          |
| `retrievalMode`    | `vector` / `keyword` / `hybrid`      | 否  | `vector`       | retrieve     | hybrid 为 P1     |
| `vectorWeight`     | number                               | 否  | `0.7`          | retrieve     | hybrid 向量权重     |
| `rerank.enabled`   | boolean                              | 否  | `false`        | retrieve     | 是否 rerank       |
| `rerank.model`     | string                               | 否  | `null`         | retrieve     | rerank 模型       |
| `rerank.topN`      | number                               | 否  | `5`            | retrieve     | rerank 保留数      |
| `metadataFilter`   | Filter\[]                            | 否  | `[]`           | retrieve     | 文档元数据过滤         |
| `citationMode`     | `none` / `inline` / `structured`     | 否  | `structured`   | retrieve     | 引用返回方式          |
| `maxContextTokens` | number                               | 否  | `2048`         | retrieve     | 上下文上限           |
| `includeMetadata`  | boolean                              | 否  | `true`         | retrieve     | 是否返回元数据         |
| `dedupe`           | boolean                              | 否  | `true`         | retrieve     | 文档/内容去重         |
| `emptyStrategy`    | `return_empty` / `fail` / `fallback` | 否  | `return_empty` | retrieve     | 无结果策略           |
| `knowledgeBaseId`  | string                               | 条件 | —              | index        | 目标知识库           |
| `documentSource`   | FileRef\[] / VariableRef             | 条件 | —              | index        | 文档来源            |
| `chunking`         | object                               | 条件 | —              | index        | 分块策略            |
| `embedding`        | object                               | 条件 | —              | index        | embedding 模型/维度 |
| `upsertPolicy`     | `insert` / `upsert` / `replace`      | 否  | `upsert`       | index        | 写入策略            |

输出字段：retrieve 为 `chunks`、`citations`、`context`、`total`；index 为 `documentId`、`chunks`、`indexed`、`failed`、`usage`、`artifacts`。

#### 5.4.7 `condition`

判据：`mode`；输入 handle：`in`（可选）；输出 handle：`true/false` 或 `case.<id>/default`。

| 字段                   | 类型                  | 必填 | 默认        | 说明               |
| -------------------- | ------------------- | -- | --------- | ---------------- |
| `mode`               | `binary` / `switch` | 是  | `binary`  | 分支模式             |
| `combinator`         | `all` / `any`       | 否  | `all`     | binary 条件组合      |
| `conditions`         | Condition\[]        | 条件 | `[]`      | binary 必填        |
| `switchCases`        | SwitchCase\[]       | 条件 | `[]`      | switch 必填        |
| `defaultBranch`      | string              | 否  | `default` | switch 默认 handle |
| `evaluationMode`     | `strict` / `coerce` | 否  | `strict`  | 类型比较             |
| `caseSensitive`      | boolean             | 否  | `true`    | 字符串比较            |
| `maxExpressionDepth` | number              | 否  | `5`       | AST 深度           |
| `exposeResult`       | boolean             | 否  | `true`    | 是否输出明细           |

`Condition`：`id`、`left`、`operator`（eq/neq/gt/gte/lt/lte/contains/not\_contains/starts\_with/ends\_with/regex/in/not\_in/is\_empty/is\_not\_empty/between/length\_eq/length\_gt）、`right`、`rightType`、`caseSensitive`。`SwitchCase`：`id`、`label`、`when`、`isDefault`。

输出字段：`matched`、`branch`、`results`。正则使用 RE2，不走任意代码。

#### 5.4.8 `template`

无判据；输入 handle：`in`（可选）；输出 handle：`out`。

| 字段                | 类型                         | 必填 | 默认         | 说明                     |
| ----------------- | -------------------------- | -- | ---------- | ---------------------- |
| `template`        | RichTextValue / string     | 是  | —          | `{{ $input.name }}` 语法 |
| `syntax`          | `mustache` / `plain`       | 否  | `mustache` | plain 不做替换             |
| `variables`       | VariableBinding\[]         | 否  | `[]`       | 显式变量绑定                 |
| `missingStrategy` | `error` / `empty` / `keep` | 否  | `error`    | 缺失变量策略                 |
| `escapeMode`      | `none` / `html`            | 否  | `none`     | 输出转义                   |
| `trim`            | boolean                    | 否  | `true`     | 去首尾空白                  |
| `outputType`      | `text` / `json`            | 否  | `text`     | json 时解析               |
| `jsonSchema`      | object                     | 否  | `null`     | JSON 校验                |
| `maxLength`       | number                     | 否  | `10000`    | 输出字符上限                 |

输出字段：`text`、`value?`、`missing?`、`length`。不允许函数、循环或任意代码。

#### 5.4.9 `variable`

判据：`mode`；输入 handle：`in`（可选）；输出 handle：`out`。

| 字段               | 类型                                                                                 | 必填 | 默认                | 适用 mode   | 说明                |
| ---------------- | ---------------------------------------------------------------------------------- | -- | ----------------- | --------- | ----------------- |
| `mode`           | `assign` / `aggregate`                                                             | 是  | `assign`          | 全部        | 赋值或聚合             |
| `scope`          | `run` / `workflow`                                                                 | 否  | `run`             | assign    | 变量作用域             |
| `assignments`    | Assignment\[]                                                                      | 条件 | `[]`              | assign    | 1–50 条            |
| `strictTypes`    | boolean                                                                            | 否  | `true`            | assign    | 拒绝隐式转换            |
| `createMissing`  | boolean                                                                            | 否  | `true`            | assign    | 目标不存在时创建          |
| `maxVariables`   | number                                                                             | 否  | `100`             | assign    | 变量总数上限            |
| `outputSnapshot` | boolean                                                                            | 否  | `false`           | assign    | 输出全部变量            |
| `sources`        | VariableRef\[]                                                                     | 条件 | `[]`              | aggregate | 2–20 个来源          |
| `strategy`       | `first_non_empty` / `first_success` / `array` / `concat` / `merge_deep` / `object` | 条件 | `first_non_empty` | aggregate | 聚合策略              |
| `target`         | string                                                                             | 否  | `null`            | aggregate | 写入 `$vars.<name>` |
| `skipNull`       | boolean                                                                            | 否  | `true`            | aggregate | 跳过 null           |
| `dedupe`         | boolean                                                                            | 否  | `false`           | aggregate | array/concat 去重   |
| `maxItems`       | number                                                                             | 否  | `1000`            | aggregate | 数组上限              |
| `type`           | DataType                                                                           | 否  | `any`             | aggregate | 输出类型              |

`Assignment`：`target`、`value`、`mode`(set/append/merge/increment，默认 set)、`type`。只能写 `$vars`，不能改 `$input` 或上游输出。

#### 5.4.10 `data-transform`

判据：`operation`；输入 handle：`in`；输出 handle：`out`。

| 字段              | 类型                                                                                         | 必填 | 默认        | 适用 operation | 说明                                  |
| --------------- | ------------------------------------------------------------------------------------------ | -- | --------- | ------------ | ----------------------------------- |
| `operation`     | `text` / `json` / `list`                                                                   | 是  | `text`    | 全部           | 转换域                                 |
| `textOperation` | `concat/join/split/replace/regex_replace/trim/case/slice/substring/contains/length/format` | 条件 | `trim`    | text         | 文本操作                                |
| `input`         | VariableRef / string / array / object                                                      | 条件 | —         | text/json    | 输入值；缺省取 `$input`                    |
| `separator`     | string                                                                                     | 否  | `\n`      | text         | join/split 分隔符                      |
| `pattern`       | string                                                                                     | 条件 | —         | text         | RE2 正则；`regex_replace`/`contains` 用 |
| `replacement`   | string                                                                                     | 条件 | —         | text         | 正则替换内容                              |
| `caseMode`      | `upper` / `lower` / `title`                                                                | 条件 | —         | text         | 大小写转换                               |
| `start`         | number                                                                                     | 否  | `0`       | text         | slice/substring 起点                  |
| `end`           | number                                                                                     | 否  | `null`    | text         | slice/substring 终点                  |
| `maxLength`     | number                                                                                     | 否  | `10000`   | text/format  | 输出字符上限                              |
| `preserveEmpty` | boolean                                                                                    | 否  | `true`    | text         | 保留空项                                |
| `jsonOperation` | `parse/stringify/query/pick/omit/merge/validate`                                           | 条件 | `parse`   | json         | JSON 操作                             |
| `path`          | JSONPath                                                                                   | 否  | `$`       | json         | 只读路径查询                              |
| `paths`         | string\[]                                                                                  | 条件 | —         | json         | pick/omit 字段路径                      |
| `mergeStrategy` | `shallow` / `deep` / `array_concat`                                                        | 条件 | `shallow` | json         | merge 策略                            |
| `schema`        | object                                                                                     | 条件 | —         | json         | validate 用 JSON Schema              |
| `failOnInvalid` | boolean                                                                                    | 否  | `true`    | json         | 解析/校验失败是否抛错                         |
| `maxDepth`      | number                                                                                     | 否  | `20`      | json         | 嵌套深度上限                              |
| `maxSizeBytes`  | number                                                                                     | 否  | `1048576` | json         | 输入字节上限                              |
| `listOperation` | `map/filter/find/sort/slice/distinct/group/count/flatten/join/reduce`                      | 条件 | `map`     | list         | 列表操作                                |
| `itemVariable`  | string                                                                                     | 否  | `item`    | list         | map/filter 当前项变量名                   |
| `predicate`     | ConditionGroup                                                                             | 条件 | —         | list         | filter/find 条件                      |
| `mapTemplate`   | string / object                                                                            | 条件 | —         | list         | map 输出模板                            |
| `sortBy`        | string                                                                                     | 条件 | —         | list         | 排序字段                                |
| `order`         | `asc` / `desc`                                                                             | 否  | `asc`     | list         | 排序方向                                |
| `limit`         | number                                                                                     | 否  | `null`    | list         | 截取条数                                |
| `offset`        | number                                                                                     | 否  | `0`       | list         | 截取起点                                |
| `distinctBy`    | string                                                                                     | 条件 | —         | list         | 去重字段                                |
| `groupBy`       | string                                                                                     | 条件 | —         | list         | 分组字段                                |
| `reduceInitial` | unknown                                                                                    | 条件 | —         | list         | reduce 初值                           |
| `maxItems`      | number                                                                                     | 否  | `10000`   | list         | 列表长度上限                              |
| `perItemError`  | `fail` / `skip` / `collect`                                                                | 否  | `fail`    | list         | 单项失败策略                              |

输出字段：`value`、`text?`、`valid?`、`errors?`、`items?`、`count?`、`parts?`、`length?`，按 `operation` 组合返回。

#### 5.4.11 `document`

无判据；输入 handle：`in`；输出 handle：`out`。

| 字段                 | 类型                                                       | 必填 | 默认            | 说明                 |
| ------------------ | -------------------------------------------------------- | -- | ------------- | ------------------ |
| `source`           | FileRef / string                                         | 是  | —             | 文档引用或 URL          |
| `parser`           | `auto/pdf/doc/docx/xls/xlsx/csv/pptx/html/markdown/text` | 否  | `auto`        | 解析器；auto 按 MIME 探测 |
| `pages`            | string                                                   | 否  | `null`        | 页码范围，如 `1-5,8`     |
| `includeTables`    | boolean                                                  | 否  | `true`        | 抽取表格               |
| `includeImages`    | boolean                                                  | 否  | `false`       | 抽取图片               |
| `ocr`              | `off` / `auto` / `force`                                 | 否  | `auto`        | 扫描件 OCR 策略         |
| `ocrLanguage`      | string                                                   | 否  | `chi_sim+eng` | OCR 语言             |
| `preserveLayout`   | boolean                                                  | 否  | `false`       | 保留版面               |
| `outputMode`       | `text` / `markdown` / `structured`                       | 否  | `text`        | 输出格式               |
| `chunk.enabled`    | boolean                                                  | 否  | `false`       | 是否分块               |
| `chunk.size`       | number                                                   | 否  | `512`         | 块大小（token）         |
| `chunk.overlap`    | number                                                   | 否  | `64`          | 块重叠                |
| `maxFileSizeBytes` | number                                                   | 否  | `52428800`    | 文件大小上限             |
| `maxPages`         | number                                                   | 否  | `200`         | 页数上限               |

输出字段：`text`、`markdown?`、`pages?`、`tables?`、`metadata`、`chunks?`、`artifacts?`。旧 `.doc`/`.xls` 由服务端转换器处理，不依赖浏览器原生预览。

#### 5.4.12 `parallel`

无判据；输入 handle：`in`；输出 handle：`branch.<id>`、`out`。

| 字段                      | 类型                                         | 必填 | 默认          | 说明           |
| ----------------------- | ------------------------------------------ | -- | ----------- | ------------ |
| `branches`              | `{id,label}[]`                             | 是  | —           | 2–20 条分支     |
| `maxConcurrency`        | number                                     | 否  | `4`         | 并发上限，1–20    |
| `joinStrategy`          | `all` / `any` / `quorum` / `none`          | 是  | `all`       | 汇合策略         |
| `quorum`                | number                                     | 条件 | `1`         | quorum 所需成功数 |
| `errorPolicy`           | `fail_fast` / `collect` / `ignore_partial` | 否  | `fail_fast` | 分支失败策略       |
| `cancelRemainingOnFail` | boolean                                    | 否  | `true`      | 失败后取消其余分支    |
| `branchTimeoutMs`       | number                                     | 否  | `60000`     | 单分支超时        |
| `totalTimeoutMs`        | number                                     | 否  | `120000`    | 总超时          |
| `aggregate`             | `array` / `object` / `keyed`               | 否  | `object`    | 聚合结构         |
| `outputKey`             | string                                     | 否  | `results`   | 聚合结果键名       |
| `includeBranchErrors`   | boolean                                    | 否  | `true`      | 输出中带分支错误     |

输出字段：`results`、`succeeded`、`failed`、`skipped`、`aggregated`。

#### 5.4.13 `agent`

无判据；输入 handle：`in`；输出 handle：`out`。

| 字段                  | 类型                           | 必填 | 默认                     | 说明                                             |
| ------------------- | ---------------------------- | -- | ---------------------- | ---------------------------------------------- |
| `modelConnectionId` | string                       | 是  | —                      | 模型连接；运行时由 worker 读取凭据                          |
| `model`             | string                       | 否  | 连接默认模型                 | 可覆盖模型名                                         |
| `instructions`      | RichTextValue                | 是  | —                      | 系统指令；工具输出视为不可信数据                               |
| `inputExpression`   | string                       | 否  | `{{ $input.question }}` | 输入映射；留空时使用工作流原始输入                              |
| `knowledge`         | object                       | 否  | —                      | `knowledgeBaseIds`、`topK`、`scoreThreshold`、`retrievalMode` |
| `mcpTools`          | AgentMcpToolRef\[]           | 否  | `[]`                   | `serverId`、`toolName`，可选 `description/parameters` |
| `maxSteps`          | number                       | 否  | `8`                    | 最大工具循环步数，1–32                                  |
| `timeoutMs`         | number                       | 否  | `120000`               | 单次执行超时，1 秒到 1 小时                                |
| `memory`            | object                       | 否  | `{ "mode": "run" }`    | `none/run/conversation`；会话模式使用持久 thread            |
| `outputSchema`      | object                       | 否  | `null`                 | 配置后结构化输出必须通过 JSON Schema                        |

输出字段：`output`、`messages`、`steps`、`toolCalls`、`usage`、`finishReason`。

运行时边界：

- 节点配置序列化为 `AgentDefinition`，工作流只负责输入映射与输出接线；Agent 循环由 worker 内的 `AgentRuntime` 执行。
- 问答工作台与工作流节点共用同一个 `AgentRuntime`，差异只在 invocation 的 `kind` 和消息持久化方式。
- `tools/toolChoice/maxTokens/maxCost/stopConditions/humanApproval/stream` 保留为后续扩展字段，不进入当前 P1 的序列化定义。
- 运行时产生 `message.delta/message.completed/tool.started/tool.output/invocation.*` 事件，前端通过 SSE 按 `seq` 断点续传。

#### 5.4.14 `loop`

判据：`mode`；输入 handle：`in`；输出 handle：`body`、`done`。

| 字段                   | 类型                            | 必填 | 默认        | 适用 mode | 说明           |
| -------------------- | ----------------------------- | -- | --------- | ------- | ------------ |
| `mode`               | `forEach` / `while` / `fixed` | 是  | `forEach` | 全部      | 循环类型         |
| `items`              | VariableRef / array           | 条件 | —         | forEach | 遍历集合         |
| `condition`          | ConditionGroup                | 条件 | —         | while   | 继续条件         |
| `iterations`         | number                        | 条件 | —         | fixed   | 固定次数，1–1000  |
| `itemVariable`       | string                        | 否  | `item`    | forEach | 当前项变量名       |
| `indexVariable`      | string                        | 否  | `index`   | 全部      | 索引变量名        |
| `maxIterations`      | number                        | 否  | `100`     | 全部      | 最大次数，上限 1000 |
| `concurrency`        | number                        | 否  | `1`       | forEach | 并发度，1–10     |
| `collectOutput`      | boolean                       | 否  | `true`    | 全部      | 收集每轮输出       |
| `outputKey`          | string                        | 否  | `items`   | 全部      | 结果键名         |
| `breakCondition`     | ConditionGroup                | 否  | `null`    | 全部      | 提前退出条件       |
| `bodyTimeoutMs`      | number                        | 否  | `60000`   | 全部      | 单轮超时         |
| `totalTimeoutMs`     | number                        | 否  | `300000`  | 全部      | 总超时          |
| `errorPolicy`        | `fail` / `skip` / `collect`   | 否  | `fail`    | 全部      | 单轮失败策略       |
| `checkpointInterval` | number                        | 否  | `10`      | 全部      | 检查点间隔        |

输出字段：`items`、`iterations`、`lastOutput`、`failed`、`aggregated?`。

#### 5.4.15 `subworkflow`

无判据；输入 handle：`in`；输出 handle：`out`、`error`。

| 字段                  | 类型                      | 必填 | 默认          | 说明               |
| ------------------- | ----------------------- | -- | ----------- | ---------------- |
| `workflowId`        | string                  | 是  | —           | 子工作流 ID          |
| `versionPolicy`     | `pinned` / `latest`     | 是  | `pinned`    | 版本策略；生产必须 pinned |
| `version`           | number                  | 条件 | —           | pinned 时必填       |
| `inputMapping`      | object                  | 否  | `{}`        | 父变量 → 子输入        |
| `outputMapping`     | object                  | 否  | `{}`        | 子输出 → 父变量        |
| `timeoutMs`         | number                  | 否  | `300000`    | 子运行超时            |
| `maxDepth`          | number                  | 否  | `5`         | 嵌套深度上限           |
| `errorPropagation`  | `propagate` / `collect` | 否  | `propagate` | 错误传播方式           |
| `inheritWorkspace`  | boolean                 | 否  | `true`      | 继承 workspace 上下文 |
| `allowCycle`        | boolean                 | 否  | `false`     | 是否允许递归调用         |
| `runKind`           | `child`                 | 否  | `child`     | 子运行类型            |
| `waitForCompletion` | boolean                 | 否  | `true`      | 是否同步等待           |

输出字段：`output`、`childRunId`、`status`、`usage`。

#### 5.4.16 `human`

判据：`mode`；输入 handle：`in`；输出 handle：`submitted` 或 `approved` / `rejected`。

| 字段                 | 类型                                  | 必填 | 默认                  | 适用 mode  | 说明             |
| ------------------ | ----------------------------------- | -- | ------------------- | -------- | -------------- |
| `mode`             | `form` / `approval`                 | 是  | —                   | 全部       | 人工节点类型         |
| `formSchema`       | object                              | 条件 | —                   | form     | 表单 JSON Schema |
| `payload`          | object                              | 条件 | —                   | approval | 待审批内容          |
| `title`            | string                              | 是  | —                   | 全部       | 任务标题           |
| `description`      | RichTextValue / string              | 否  | `""`                | 全部       | 任务描述           |
| `assignee`         | object                              | 否  | demo user           | 全部       | 处理人/角色         |
| `actions`          | `approve/reject/edit/submit[]`      | 否  | `[approve, reject]` | 全部       | 可用动作           |
| `requiredFields`   | string\[]                           | 否  | `[]`                | form     | 必填字段           |
| `allowComment`     | boolean                             | 否  | `true`              | 全部       | 是否允许备注         |
| `timeoutMs`        | number                              | 否  | `86400000`          | 全部       | 等待超时（24h）      |
| `timeoutAction`    | `fail` / `auto_approve` / `default` | 否  | `fail`              | 全部       | 超时处理           |
| `defaultOutput`    | object                              | 否  | `null`              | 全部       | 超时/默认输出        |
| `resumeTokenTtlMs` | number                              | 否  | `86400000`          | 全部       | 恢复令牌有效期        |
| `notification`     | object                              | 否  | `{}`                | 全部       | 通知渠道配置         |

输出字段：`action`、`values?`、`comment?`、`submittedBy`、`submittedAt`、`decision?`、`decidedAt?`。

#### 5.4.17 `wait`

无判据；输入 handle：`in`；输出 handle：`out`。

| 字段                    | 类型                                | 必填 | 默认         | 说明                |
| --------------------- | --------------------------------- | -- | ---------- | ----------------- |
| `mode`                | `duration` / `until` / `callback` | 是  | `duration` | 等待类型              |
| `durationMs`          | number                            | 条件 | —          | 等待时长，1s–24h       |
| `until`               | ISO 8601 string                   | 条件 | —          | 绝对等待时间            |
| `callbackToken`       | string                            | 否  | 自动生成       | 回调令牌              |
| `resumePayloadSchema` | object                            | 否  | `{}`       | 回调 payload schema |
| `timeoutMs`           | number                            | 否  | `3600000`  | 最大等待              |
| `onTimeout`           | `fail` / `continue`               | 否  | `fail`     | 超时行为              |
| `idempotencyKey`      | string                            | 否  | `null`     | 回调幂等键             |
| `notifyUrl`           | string                            | 否  | `null`     | 完成后通知地址           |

输出字段：`waitedMs`、`callbackPayload?`、`timedOut`。

#### 5.4.18 `code`

无判据；输入 handle：`in`；输出 handle：`out`。

| 字段               | 类型                                     | 必填 | 默认        | 说明            |
| ---------------- | -------------------------------------- | -- | --------- | ------------- |
| `runtime`        | `node` / `python`                      | 是  | `node`    | 运行环境          |
| `language`       | `javascript` / `typescript` / `python` | 是  | —         | 源码语言          |
| `code`           | string                                 | 是  | —         | 源码文本          |
| `entrypoint`     | string                                 | 否  | `main`    | 入口函数          |
| `inputSchema`    | object                                 | 否  | `{}`      | 输入校验          |
| `outputSchema`   | object                                 | 否  | `{}`      | 输出校验          |
| `timeoutMs`      | number                                 | 否  | `30000`   | 执行超时          |
| `memoryMb`       | number                                 | 否  | `256`     | 内存上限，128–1024 |
| `cpuLimit`       | number                                 | 否  | `0.5`     | CPU 配额        |
| `networkPolicy`  | `none` / `allowlist`                   | 否  | `none`    | 网络策略          |
| `allowedHosts`   | string\[]                              | 条件 | —         | allowlist 主机  |
| `env`            | object                                 | 否  | `{}`      | 仅允许 secretRef |
| `packages`       | string\[]                              | 否  | `[]`      | 预装依赖白名单       |
| `sandboxProfile` | `default` / `strict`                   | 否  | `strict`  | 沙箱级别          |
| `maxOutputBytes` | number                                 | 否  | `1048576` | 输出上限          |

输出字段：`output`、`stdout`、`stderr`、`exitCode`、`artifacts?`。必须在 `plugin-runner` 隔离执行，禁止主进程执行。

#### 5.4.19 `database`

无判据；输入 handle：`in`；输出 handle：`out`。

| 字段               | 类型                                   | 必填 | 默认       | 说明               |
| ---------------- | ------------------------------------ | -- | -------- | ---------------- |
| `connectionId`   | string                               | 是  | —        | 数据库连接            |
| `operation`      | `select/insert/update/delete/upsert` | 是  | `select` | 操作类型             |
| `table`          | string                               | 是  | —        | 表名，必须在 allowlist |
| `sql`            | string                               | 条件 | —        | select 参数化 SQL   |
| `where`          | object                               | 条件 | —        | 结构化过滤条件          |
| `values`         | object                               | 条件 | —        | 写入字段             |
| `conflictTarget` | string\[]                            | 条件 | —        | upsert 冲突键       |
| `limit`          | number                               | 否  | `100`    | 查询上限，1–1000      |
| `returning`      | string\[]                            | 否  | `[]`     | 返回字段             |
| `allowWrite`     | boolean                              | 否  | `false`  | 是否允许写操作          |
| `transaction`    | `none` / `run`                       | 否  | `none`   | 是否包裹事务           |
| `timeoutMs`      | number                               | 否  | `30000`  | 查询超时             |

输出字段：`rows`、`rowCount`、`affected`、`lastInsertId?`。

#### 5.4.20 `quality-gate`

判据：`mode`；输入 handle：`in`；输出 handle：`pass` / `fail` 或 `pass` / `block`。

| 字段                       | 类型                        | 必填 | 默认          | 适用 mode   | 说明           |
| ------------------------ | ------------------------- | -- | ----------- | --------- | ------------ |
| `mode`                   | `evaluate` / `guardrail`  | 是  | —           | 全部        | 质量评估或输入护栏    |
| `target`                 | VariableRef / string      | 条件 | —           | evaluate  | 被评估内容        |
| `reference`              | VariableRef / string      | 否  | `null`      | evaluate  | 参考答案         |
| `metrics`                | Metric\[]                 | 条件 | —           | evaluate  | 评估指标         |
| `judgeModelConnectionId` | string                    | 条件 | —           | evaluate  | LLM judge 连接 |
| `rubric`                 | RichTextValue / string    | 否  | `""`        | evaluate  | 评分标准         |
| `threshold`              | number                    | 否  | `0.7`       | evaluate  | 通过阈值         |
| `samples`                | number                    | 否  | `1`         | evaluate  | 采样次数         |
| `passCriteria`           | `all` / `any` / `score`   | 否  | `all`       | evaluate  | 通过条件         |
| `includeReasoning`       | boolean                   | 否  | `true`      | evaluate  | 返回评分理由       |
| `timeoutMs`              | number                    | 否  | `60000`     | 全部        | 评估超时         |
| `checks`                 | Check\[]                  | 条件 | —           | guardrail | 护栏检查项        |
| `order`                  | `fail_fast` / `collect`   | 否  | `fail_fast` | guardrail | 检查顺序         |
| `action`                 | `block` / `mask` / `warn` | 否  | `block`     | guardrail | 命中后动作        |
| `outputField`            | string                    | 否  | `input`     | guardrail | 被检查字段        |

`Metric` 类型：`exact_match / contains / regex / semantic / llm_judge / faithfulness`。

`Check` 子配置：

- `regex`：`pattern`、`flags`
- `pii`：`provider`、`entities`、`language`、`scoreThreshold`
- `hallucination`：`knowledgeBaseId`、`modelConnectionId`、`confidenceThreshold`、`topK`
- `moderation`：`categories`、`threshold`

输出字段：`passed`、`score?`、`metrics?`、`reasoning?`、`validationType`、`input?`、`detectedEntities?`、`maskedText?`、`usage?`。

#### 5.4.21 `file`

无判据；输入 handle：`in`；输出 handle：`out`。

| 字段                | 类型                                      | 必填 | 默认         | 说明      |
| ----------------- | --------------------------------------- | -- | ---------- | ------- |
| `operation`       | `read/write/list/delete/convert/upload` | 是  | `read`     | 文件操作    |
| `source`          | FileRef / URL / string                  | 条件 | —          | 来源文件    |
| `path`            | string                                  | 否  | `null`     | 目标/列表路径 |
| `mime`            | string                                  | 否  | 自动探测       | MIME 类型 |
| `content`         | VariableRef / string / binary           | 条件 | —          | 写入内容    |
| `encoding`        | `utf-8` / `base64` / `binary`           | 否  | `utf-8`    | 内容编码    |
| `overwrite`       | boolean                                 | 否  | `false`    | 是否覆盖    |
| `maxSizeBytes`    | number                                  | 否  | `52428800` | 大小上限    |
| `artifactTtlDays` | number                                  | 否  | `7`        | 产物保留天数  |
| `convertTo`       | `pdf` / `docx` / `markdown` / `text`    | 条件 | —          | 转换目标格式  |
| `listPrefix`      | string                                  | 条件 | —          | 列表前缀    |
| `listLimit`       | number                                  | 否  | `100`      | 列表条数上限  |

输出字段：`file?`、`files?`、`text?`、`artifact?`。

## 6. 后端功能

| 编号          | 功能点                 | 说明                                                                 |
| ----------- | ------------------- | ------------------------------------------------------------------ |
| `B-NODE-01` | 节点注册表               | type+version → Manifest/executor；默认 20 个内置节点                       |
| `B-NODE-02` | executor 分发         | 按 type/mode 选择执行器；未知 mode 拒绝                                       |
| `B-NODE-03` | discriminated union | Zod 校验当前 mode 字段；不校验/不接受其他模式字段                                     |
| `B-NODE-04` | 输入解析                | 受限变量路径、文件引用、类型/缺失策略                                                |
| `B-NODE-05` | 输出校验                | `outputSchema` 严格校验；超限写 artifact                                   |
| `B-NODE-06` | 错误码目录               | 每节点稳定 code；retryable 明确                                            |
| `B-NODE-07` | 重试/副作用              | sideEffect 默认不自动重试；幂等键用于外部调用                                       |
| `B-NODE-08` | 事件 payload          | 带 mode/kind/operation；不泄漏密钥/大输出                                    |
| `B-NODE-09` | fixture 与契约测试       | 每 mode 至少 1 个；输入/输出/错误三类                                           |
| `B-NODE-10` | P0 执行器              | start/output/llm/tool/knowledge/condition/template/variable        |
| `B-NODE-11` | P0.5 执行器            | data-transform/document/parallel                                   |
| `B-NODE-12` | P1 执行器              | agent/loop/subworkflow/human/wait/code/database/quality-gate/file  |
| `B-NODE-13` | 沙箱与限额               | code 走 plugin-runner；网络/CPU/内存/超时                                  |
| `B-NODE-14` | 子流程/循环保护            | maxDepth/maxIterations/allowCycle                                  |
| `B-NODE-15` | 节点 SDK              | 第三方/自定义节点类型与测试 harness（P1）                                         |
| `B-NODE-16` | 统一注册入口              | `registerNode`/`unregisterNode`/`onNodeRegistryChange`；进程投影；重复注册警告 |
| `B-NODE-17` | 执行器基类               | `BaseNodeExecutor.execute` 统一校验/变量/超时/日志/输出/错误；`doExecute` 只写业务    |

### 6.1 节点开发 DoD

每个新节点/mode 必须同时提交：

1. `defineNode()` 注册对象：`manifest`（type/version/category/discriminator/handles/capabilities/permissions）+ `executor` + `form` + `examples`。
2. `configSchema`、`inputSchema`、`outputSchema`。
3. `BaseNodeExecutor` 子类：只实现 `doExecute()`；错误码、副作用/重试声明。
4. 表单：优先 JSON Schema（含 `x-*`）；确需复杂交互才提供自定义组件，且仍按 schema 校验。
5. 进程投影验证：web 注册 form/component，worker 注册 executor；`registerNode()` 后可被 Palette/Inspector/校验发现。
6. 至少一个 fixture（输入、输出、错误）。
7. 单测 + 契约测试；必要时集成测试。
8. 05 文档 I/O 表、03 UI 映射、12 注册表说明更新。
9. 测试用例 CSV 增补。

## 7. 示例

### 7.1 `llm.mode=classify`

```json
{
  "type": "llm",
  "config": {
    "mode": "classify",
    "modelConnectionId": "mc_openai",
    "systemPrompt": "只输出类别，不要解释。",
    "prompt": "{{ $input.text }}",
    "classes": [
      { "id": "bug", "label": "缺陷", "examples": ["报错", "崩溃", "无法保存"] },
      { "id": "feature", "label": "需求", "examples": ["希望支持", "增加功能"] },
      { "id": "other", "label": "其他" }
    ],
    "fallbackClassId": "other",
    "temperature": 0.2
  }
}
```

输出 handle：`class.bug` / `class.feature` / `class.other` / `fallback`。

### 7.2 `tool.kind=mcp`

```json
{
  "type": "tool",
  "config": {
    "kind": "mcp",
    "serverId": "mcp_github",
    "toolName": "search_issues",
    "toolSchemaHash": "sha256:abc123",
    "arguments": {
      "query": "{{ $input.keyword }}",
      "limit": 10
    },
    "credentialRef": "secret://workspace/github",
    "timeoutMs": 30000,
    "retryPolicy": { "maxAttempts": 0 },
    "approvalPolicy": "none",
    "maxOutputBytes": 1048576
  }
}
```

发布时必须锁定 `toolSchemaHash`；运行前检查工具是否存在、参数是否通过 schema、凭据是否有权限。

### 7.3 `condition.mode=switch`

```json
{
  "type": "condition",
  "config": {
    "mode": "switch",
    "switchCases": [
      { "id": "high", "label": "高优先级", "when": { "left": "$input.priority", "operator": "gte", "right": 3 } },
      { "id": "normal", "label": "普通", "when": { "left": "$input.priority", "operator": "eq", "right": 2 } }
    ],
    "defaultBranch": "default"
  }
}
```

输出 handle：`case.high` / `case.normal` / `default`。

### 7.4 `quality-gate.mode=guardrail`

```json
{
  "type": "quality-gate",
  "config": {
    "mode": "guardrail",
    "checks": [
      { "type": "pii", "provider": "presidio", "entities": ["PHONE", "EMAIL"], "action": "mask" },
      { "type": "regex", "pattern": "(?i)api[_-]?key\\s*[:=]", "action": "block" }
    ],
    "order": "fail_fast",
    "action": "block",
    "outputField": "input"
  }
}
```

命中 `block` 时走 `block` handle，命中 `mask` 时输出 `maskedText` 并继续。

## 8. TODOLIST

### 8.1 P0 节点（8 个）

- [ ] 落地 `NodeRegistration`/`registerNode`/`BaseNodeExecutor`；type+version 解析与进程投影。
- [ ] 完成 `start/output/llm/tool/knowledge/condition/template/variable` 的 configSchema、inputSchema、outputSchema。
- [ ] 完成 8 个 `doExecute()`、统一错误码与 sideEffect/retry 声明；公共逻辑不重复实现。
- [ ] 完成表单自动注册；`llm`、`tool`、`knowledge`、`condition` 提供专属表单或复杂控件。
- [ ] 画布 Handle 标签覆盖 `out/true/false/case.<id>/default`。
- [ ] 每节点至少 1 组 fixture（输入、输出、错误）。
- [ ] 单测 + 契约测试接入 CI。

### 8.2 P0.5 节点（3 个）

- [ ] `data-transform` 三域 executor：text/json/list，限制深度、大小、条数。
- [ ] `document` 解析与分块；大文件写 artifact，仅返回引用。
- [ ] `parallel` 分支并发、join/quorum、失败取消与聚合。
- [ ] 三个节点的 Inspector：列表/分支编辑、文档字段、结果聚合预览。
- [ ] 性能用例：1MB 文本、200 页文档、20 分支并发。

### 8.3 P1 节点（9 个）

- [ ] `agent` 多步工具调用、成本/步数上限、人工审批挂起。
- [ ] `loop` 三种 mode、并发、检查点、最大次数保护。
- [ ] `subworkflow` 固定版本、深度限制、循环检测。
- [ ] `human` 表单/审批、恢复令牌、超时策略。
- [ ] `wait` duration/until/callback 与幂等回调。
- [ ] `code` 仅进 `plugin-runner`，落实 CPU/内存/网络/输出限额。
- [ ] `database` 连接白名单、参数化 SQL、写操作显式开关。
- [ ] `quality-gate` 指标评估与 guardrail 检查。
- [ ] `file` 上传/读写/转换与 artifact TTL。

### 8.4 横切事项

- [ ] 默认 20 个节点设置文档页由 Manifest 自动生成，禁止手写漂移。
- [ ] 节点只能通过 `registerNode()` 进入系统；新增节点不改调度器、设计器、表单注册表。
- [ ] 构建期检查：web bundle 无执行器；worker bundle 无表单组件。
- [ ] 未知 type/version/mode 导入时必须显式报错。
- [ ] 事件 payload 带 `type/mode/kind/operation`，且不泄漏密钥与大输出。
- [ ] 每新增 mode 同步更新 03 UI 映射、05 I/O 表、fixture 与 CSV 用例。
- [ ] 节点 SDK（第三方自定义节点）在 P1 提供类型与测试 harness。
- [ ] P2 候选节点只在节点设置页显示准入状态；未评审通过不进入默认面板、不进入画布 Palette。

## 9. 测试关注点

| 范围               | 必测项                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------ |
| 注册与投影            | `registerNode` 后 Palette/画布/Inspector/校验可见；重复注册警告；`unregisterNode` 不崩溃；web 无执行器、worker 无表单 |
| 基类契约             | `execute` 统一校验/变量/超时/日志/输出/错误；`doExecute` 抛错被归一化；输出不过 schema 被拒绝                           |
| Manifest/注册      | 默认 20 个 type 可解析；未知 type/version 明确报错；mode 判别联合不接受其他模式字段                                      |
| 变量与输入            | 点路径/数组索引；缺失变量策略；FileRef 与 secretRef 不落明文                                                   |
| 输出与限额            | outputSchema 严格校验；超限写 artifact；错误码稳定且 retryable 正确                                         |
| `llm`            | 四种 mode；结构化修复；分类 fallback；工具循环上限；流式中断                                                      |
| `tool`           | http SSRF/重定向/超时；mcp schema 锁定与凭据；plugin 版本与权限                                             |
| `knowledge`      | retrieve/index；topK/阈值/去重；引用结构；索引失败可重试                                                     |
| `condition`      | binary/switch；类型严格比较；RE2 正则；默认分支                                                           |
| `template`       | 缺失变量策略；转义；JSON 输出校验；禁止函数/循环                                                                |
| `variable`       | assign/aggregate；只能写 `$vars`；类型冲突与数量上限                                                     |
| `data-transform` | text/json/list 各操作；深度/大小/条数上限；单项失败策略                                                       |
| `document`       | 各解析器；OCR 开关；分页/分块；损坏文件与超大文件                                                                |
| `parallel`       | join 四策略；quorum；失败取消；分支超时与聚合结构                                                             |
| `agent`          | 步数/成本上限；工具审批；停止条件；结构化输出                                                                    |
| `loop`           | 三种 mode；最大次数；并发；break；检查点恢复                                                                |
| `subworkflow`    | pinned/latest；深度与循环；错误传播；子运行事件归属                                                           |
| `human`          | 表单校验；审批动作；超时动作；恢复令牌过期                                                                      |
| `wait`           | duration/until/callback；超时；重复回调幂等                                                          |
| `code`           | 隔离执行；无网络；资源限额；超时终止；输出截断                                                                    |
| `database`       | 只读默认；表白名单；参数化；写开关；事务                                                                       |
| `quality-gate`   | 指标阈值；judge 失败降级；guardrail block/mask/warn                                                  |
| `file`           | 上传大小；路径穿越；覆盖策略；转换失败；artifact TTL                                                           |

## 10. 待决策

1. `llm.mode=classify` 是否允许超过 32 类；超过后是否强制拆成多次调用。
2. `agent` 的 memory 是否跨 run 持久化；P1 默认建议仅在单次 run 内保存。
3. `code` 是否允许 `python` 与 `node` 同时开放，还是 P1 仅开放 node。
4. `quality-gate` 的 `semantic/faithfulness` 指标默认使用哪个 embedding 与 judge 模型。
5. `parallel` 的 `none` join 是否允许在 P1 开放；P0 建议只开放 `all/any/quorum`。
6. `human` 通知渠道 P1 范围：仅站内，还是同时支持 webhook/邮件。
7. 是否允许第三方自定义节点类型进入生产；若允许，签名与权限审核由谁负责。

