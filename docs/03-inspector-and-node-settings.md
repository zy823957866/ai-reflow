# 03 节点属性面板与节点设置

> 优先级：P0（只读 Manifest + Inspector）；P1（Workspace 覆盖与自定义节点）。
> 用户目标：用户能清楚知道“这个节点从上游收到什么、自己要填什么、输出什么、下游怎么引用”。
> 相关包：`@ai-reflow/core`（Manifest/configSchema）、`@ai-reflow/core/node`（`registerNode`/表单注册类型）、`@ai-reflow/capabilities`（fixtures）、`@ai-reflow/ui`（表单原子组件）；设计器子应用见 12。

## 1. 模块边界

包含：

- Inspector 的输入/输出两页、模式切换、配置表单、高级设置、校验提示。
- 表单控件映射、Tiptap 富文本范围、变量/节点输出 chip、图片 FileRef。
- 节点设置页：默认 20 个节点目录、Manifest 详情、I/O/字段/能力/权限/校验结果；P2 候选只做独立预览，不混入默认面板。

不包含：

- 默认 20 个节点的业务语义与完整 I/O 矩阵（见 05）。
- 运行记录详情（见 04）。
- Manifest 的后端执行器实现（见 05）。

不变量：

- Manifest 是画布、表单、校验、执行、文档的唯一真相；前端不维护第二份 I/O。
- “输入”必须拆成 **运行输入（端口）** 与 **配置输入（表单）**。
- 切换 `mode/kind/operation` 时，字段与 handles 同步变化；不能提交其他模式的字段。
- 变量引用只允许 `$input/$node/$vars/$run/$workflow/$loop` 的受限路径。
- Workflow JSON 不保存 base64；图片只存 `FileRef`。
- 节点设置 P0 只读；修改 schema/handles 必须升版本并评审。
- 表单由 `registerNode()` 自动注册，Inspector 不维护 `switch (node.type)` 或第二份表单清单。
- 表单解析优先级固定：自定义组件 > JSON Schema（含 `x-*`）> `manifest.configFields` > 只读兜底。
- 自动保存 500ms 防抖；首次渲染不保存；失焦/切换节点/离开路由/手动保存立即 flush。
- 上游变量只列可达节点，字段来自 `outputSchema`；变量 chip 保存 `nodeId + path`，改名不失效。

## 2. 前端功能

### 2.1 Inspector 功能点

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `INSP-F01` | Header | 节点图标、标题、type、phase、模式切换器 |
| `INSP-F02` | Tab | 输入 / 输出 / 运行记录（P1）；切换不丢草稿 |
| `INSP-F03` | 运行输入区 | 端口 id、类型、是否必填、说明；无输入显示“无运行输入” |
| `INSP-F04` | 配置输入区 | 按 configSchema 分组渲染；required/default/help/unit |
| `INSP-F05` | 模式联动 | 切换 mode 后只显示当前模式字段与 handles |
| `INSP-F06` | 条件显隐 | 字段由 discriminated union 控制；不灰显提交隐藏字段 |
| `INSP-F07` | 高级设置 | 折叠面板：title/description/enabled/timeout/retry/errorPolicy/outputLimitBytes/logLevel/notes |
| `INSP-F08` | 变量提示 | 每个引用输入旁给出可插入的 `$input.*`/`$node.*`/`$vars.*` |
| `INSP-F09` | 输出 Handles | `out/true/false/case/body/done/approved/pass` 等 |
| `INSP-F10` | 输出字段 schema | 字段名、类型、说明、可选；与 handles 分开展示 |
| `INSP-F11` | 引用复制 | 每个字段旁显示 `$node.<id>.output.<path>` 并可复制 |
| `INSP-F12` | 静态示例 | 使用 fixture；明确标注“示例，不是真实运行结果” |
| `INSP-F13` | 最近输出（P1） | 仅已有运行时展示；可切换脱敏/服务端脱敏后的原始 |
| `INSP-F14` | 字段校验提示 | 错误定位到字段；滚动/聚焦到首个错误 |
| `INSP-F15` | 引用失效警告 | 上游节点/路径不存在时提示，不静默替换为空 |
| `INSP-F16` | 保存前预览 | 显示将写入 config 的 JSON，敏感字段掩码 |
| `INSP-F17` | 只读模式 | 运行中/已发布版本只读；提示复制为草稿 |
| `INSP-F18` | 多选节点摘要 | 多选时显示节点数/类型冲突，不提供批量配置写入 |

### 2.2 表单控件映射

| 控件 | 用途 | 典型字段 |
| --- | --- | --- |
| `text` | 单行文本 | URL、路径、模型名、cron |
| `textarea` | 多行纯文本 | 描述、备注 |
| `richtext` | Tiptap 富文本 | Prompt、System Prompt、输出内容、模板、评分标准 |
| `number` | 数值 | topK、threshold、timeout、maxTokens |
| `boolean` | 开关 | enabled、stream、final、allowWrite |
| `select` | 单选 | mode、kind、operation、parser、auth.type |
| `multiselect` | 多选 | 知识库、可用动作 |
| `json` | JSON 编辑器 | outputMapping、arguments、where、values |
| `code` | CodeMirror | code 源码、只读 SQL、JSON 模板 |
| `file` | 文件上传/选择 | document.source、file.source |
| `tags` | 标签输入 | allowedFileTypes、stop、allowedHosts |
| `keyvalue` | 键值对 | headers、query、env、notification |
| `conditions` | 条件编辑器 | condition.conditions、loop.breakCondition |
| `list` | 列表编辑器 | inputSchema、classes、assignments、branches、formSchema |
| `schema` | JSON Schema 编辑器 | jsonSchema、extractionSchema、outputSchema |
| `model-picker` | 模型连接选择 | llm/agent/quality-gate |
| `mcp-server` | MCP Server 选择 | tool.serverId |
| `workflow-picker` | 工作流选择 | subworkflow.workflowId |
| `node-picker` | 上游节点/工具 | llm.tools、agent.tools、变量引用 |

约束：能由 `configSchema` 渲染的字段不写自定义组件；复杂节点才用自定义 Inspector，底层仍按 schema 校验。

### 2.3 Tiptap 范围

| 节点 | 字段 | 需要图片 |
| --- | --- | --- |
| `llm` | `systemPrompt`、`prompt` | 仅 vision 能力且已映射 |
| `output` | `content` | 不建议；媒体用 FileRef 字段 |
| `template` | `template` | 否 |
| `knowledge` | `query` | 否 |
| `agent` | `instructions`、`input` | 仅视觉输入已声明 |
| `human` | `description` | 可选；附件用 FileRef |
| `quality-gate` | `target`、`reference`、`rubric` | 否 |
| `file` | `content`（仅文本） | 二进制用上传控件 |
| `data-transform` | `text.input`、`list.mapTemplate` | 否 |

不使用 Tiptap：

- `document.source`、`knowledge.documentSource`、`file.source`：上传/FileRef。
- `subworkflow.workflowId`：工作流选择器。
- `llm.tools`、`agent.tools`：工具选择器。
- `condition.conditions`、`loop.breakCondition`：结构化条件编辑器。
- `tool.kind=http` body、`code.code`、`database.sql`：JSON/CodeMirror。
- `start.inputSchema`、`output.outputMapping`、`llm.classes`：列表/JSON/Schema 编辑器。

### 2.4 变量 chip 与媒体

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `INSP-F19` | 上游节点选择器 | 只列可达上游节点；选择后列出可引用输出字段 |
| `INSP-F20` | 原子变量 chip | 保存 `nodeId + path`，不保存展示标签；改名不失效 |
| `INSP-F21` | 纯文本序列化 | 复制为 `{{ $node.n_llm.output.text }}` |
| `INSP-F22` | 作用域切换 | `$input/$node/$vars/$run/$workflow` |
| `INSP-F23` | 图片上传 | 上传到 MinIO/S3，返回 FileRef；JSON 无 base64 |
| `INSP-F24` | 媒体按钮显隐 | 仅 `acceptsRichMedia=true` 的节点/字段显示 |
| `INSP-F25` | 粘贴 sanitize | 去脚本/危险属性；只保留允许 marks/节点 |
| `INSP-F26` | 失效引用预览 | 编译前提示失效，不把引用变空字符串 |
| `INSP-F27` | RichTextValue 保存 | doc + text + refs + files；执行端不用 HTML 渲染 |

### 2.5 节点设置页

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `NODE-F01` | 默认 20 个节点目录 | 左侧列表；图标/名称/phase/分类；明确显示“默认面板”边界 |
| `NODE-F02` | 搜索与筛选 | 关键词、分类、P0/P0.5/P1 |
| `NODE-F03` | Manifest 概览 | type/version/category/phase/描述/文档引用 |
| `NODE-F04` | 判据展示 | `mode/kind/operation/entryMode` 与说明 |
| `NODE-F05` | 运行输入详情 | handle、类型、必填、说明 |
| `NODE-F06` | 运行输出详情 | handle、分支、字段 schema |
| `NODE-F07` | 输出字段表 | name/type/required/说明/示例路径 |
| `NODE-F08` | 配置字段表 | key/label/控件/required/default/mode 条件/帮助 |
| `NODE-F09` | 能力标签 | streaming/cancellable/idempotent/sideEffect/longRunning/emitsArtifacts |
| `NODE-F10` | 权限展示 | networkHosts/files/secrets/mcp/code |
| `NODE-F11` | 校验结果 | 缺失 schema、重复 handle、孤立字段、未使用 mode |
| `NODE-F12` | 只读标识 | P0 明确显示“只读，修改需版本评审” |
| `NODE-F13` | 引用关系（P1） | 哪些工作流/边使用该 handle |
| `NODE-F14` | 版本对比（P1） | 字段/handle 增删与 deprecated 标记 |
| `NODE-F21` | P2 候选视图 | `notification/browser/media-generation/a2a/plugin-trigger` 单独展示准入状态，不进入画布默认面板 |
| `NODE-F22` | 节点准入摘要 | 展示新增节点是否重复现有能力、共享字段比例、fixture/权限/真实用例证据 |

### 2.6 表单自动注册与解析

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `INSP-F28` | 表单自动注册 | 节点 `registerNode()` 后 Inspector 自动可渲染；无需再调用 `nodeSettingsRegistry.register` |
| `INSP-F29` | 三级解析 | 自定义组件 > JSON Schema > `configFields` > 只读兜底；顺序固定且可测试 |
| `INSP-F30` | Schema 扩展 | 支持 `x-variable`、`x-component`、`x-component-props`、`x-group`、`x-order`、`x-hidden`、`x-sensitive` |
| `INSP-F31` | 未注册兜底 | 未知节点/表单显示只读 Manifest 与“未注册表单”提示，不渲染空白 |
| `INSP-F32` | 自动保存 | 500ms 防抖；首次渲染不保存；失焦/切换/离开/手动保存 flush |
| `INSP-F33` | 保存状态 | 顶部显示未保存/保存中/已保存/保存失败/冲突；失败不阻塞继续编辑 |
| `INSP-F34` | 上游变量推导 | 只列可达上游节点；字段来自 `outputSchema`；节点改名后引用仍有效 |
| `INSP-F35` | 自定义表单约束 | 自定义表单仍按 `configSchema` 校验，不能绕过协议 |
| `INSP-F36` | 插件表单沙箱（P1） | 第三方表单在沙箱运行，遵守 09 权限与隔离规则 |

> 表单解析与自动保存的完整实现契约见 12 第 5 节；本节只定义 Inspector 的可见行为。

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-NODE-01` | Manifest registry | 注册默认 20 个节点；按 type+version 查找 |
| `B-NODE-02` | UI 投影 API | `NodeManifestView`：无需前端解析 Zod |
| `B-NODE-03` | configSchema → JSON Schema | 生成表单字段、required、default、enum |
| `B-NODE-04` | mode 过滤 | 后端与前端用同一 discriminators 过滤字段/handles |
| `B-NODE-05` | Manifest 校验 | 重复 handle、孤立字段、未使用 mode、无效版本 |
| `B-NODE-06` | 版本与兼容 | 破坏性变更升版本；发布 pin 版本 |
| `B-NODE-07` | 引用完整性 | 被边引用的 handle 禁止静默删除 |
| `B-NODE-08` | Fixture registry | 每个节点/mode 至少 1 个示例输出 |
| `B-NODE-09` | 节点设置只读 API | P0 只返回内置 Manifest，不允许写 |
| `B-NODE-10` | Workspace 覆盖（P1） | 草稿覆盖显示名/描述；字段/handle 需评审 |
| `B-NODE-11` | 自定义节点（P1） | 必须通过“第 21 个默认节点”准入规则与市场/管理员启用 |
| `B-NODE-12` | 敏感字段标记 | `secretRef`/sensitive 字段不进日志与示例 |
| `B-INSP-01` | 表单注册投影 | `registerNode` 的 `form` 投影到 web；`NodeManifestView` 带 `formKind` |
| `B-INSP-02` | Schema 扩展规范化 | 服务端校验 `x-*` 扩展合法；未知扩展忽略并告警 |
| `B-INSP-03` | 自动保存冲突 | PATCH 带 `revision`；409 返回当前 revision 与服务端摘要 |
| `B-INSP-04` | 上游变量推导 | 基于图可达性与 `outputSchema` 返回可引用路径 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/node-manifests` | 列表，可按 category/phase 过滤 |
| `GET` | `/api/node-manifests/:type` | 详情，默认最新已启用版本 |
| `GET` | `/api/node-manifests/:type/versions/:version` | 指定版本 |
| `GET` | `/api/node-manifests/:type/fixtures` | 示例输出，按 mode |
| `POST` | `/api/node-manifests/validate` | P1：校验覆盖/自定义 Manifest |
| `PUT` | `/api/node-manifests/:type/overrides` | P1：Workspace 覆盖 |

### 3.2 NodeManifestView

```ts
type NodeManifestView = {
  type: string;
  version: string;
  displayName: string;
  description: string;
  category: string;
  phase: 'P0' | 'P0.5' | 'P1';
  discriminator?: {
    key: 'mode' | 'kind' | 'operation' | 'entryMode';
    options: Array<{ value: string; label: string; description?: string }>;
    default: string;
  };
  inputs: HandleDef[];
  outputs: HandleDef[];
  outputFields: JsonSchemaField[];
  configFields: Array<{
    key: string;
    label: string;
    widget: FormWidget;
    required?: boolean;
    default?: unknown;
    modes?: string[];
    group?: string;
    help?: string;
    sensitive?: boolean;
  }>;
  capabilities: Record<string, boolean>;
  permissions: Record<string, unknown>;
  runtime: 'builtin' | 'declarative' | 'sandbox';
  formKind?: 'component' | 'schema' | 'fields' | 'none';
  formSchema?: unknown;
  examples: string[];
  deprecated?: boolean;
};
```

## 4. 示例

### 4.1 RichTextValue

```json
{
  "kind": "richtext",
  "doc": { "type": "doc", "content": [] },
  "text": "请根据 {{ $input.question }} 回答，并引用 {{ $node.n_kb.output.context }}。",
  "refs": [
    { "kind": "input", "path": "question", "label": "用户问题" },
    { "kind": "node", "nodeId": "n_kb", "path": "output.context", "label": "知识库上下文" }
  ],
  "files": []
}
```

### 4.2 节点输出字段示例

```json
{
  "type": "condition",
  "version": "1.0.0",
  "discriminator": {
    "key": "mode",
    "options": [
      { "value": "binary", "label": "二元分支" },
      { "value": "switch", "label": "多分支" }
    ],
    "default": "binary"
  },
  "outputs": [
    { "id": "true", "label": "True", "kind": "source" },
    { "id": "false", "label": "False", "kind": "source" }
  ],
  "outputFields": [
    { "name": "matched", "type": "boolean", "required": true },
    { "name": "branch", "type": "string", "required": true }
  ]
}
```

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-INSP-01` | P0 | Inspector 壳与输入/输出 Tab | 默认 20 个节点无空白页 |
| `T-INSP-02` | P0 | configSchema 驱动表单 | 17 类控件均可用，必填/默认生效 |
| `T-INSP-03` | P0 | 模式切换与条件显隐 | 切换后无旧模式字段残留 |
| `T-INSP-04` | P0 | 输出 handles + 字段 + 引用复制 | 每个字段可复制稳定路径 |
| `T-INSP-05` | P0 | 静态 fixture 展示 | 示例明确标注非真实输出 |
| `T-INSP-06` | P0 | 校验错误定位 | 滚动/聚焦到首个错误字段 |
| `T-INSP-07` | P0 | Tiptap 变量 chip | 插入/删除/序列化正确，改名不失效 |
| `T-INSP-08` | P0 | 图片 FileRef 上传 | JSON 无 base64，日志只记摘要 |
| `T-INSP-09` | P0 | 粘贴 sanitize | 脚本/危险属性被移除 |
| `T-INSP-10` | P0 | 节点设置只读页 | 默认 20 个节点全可浏览，筛选可用；P2 候选不可拖入画布 |
| `T-INSP-11` | P0 | Manifest 校验器 | 重复 handle/孤立字段可报错 |
| `T-INSP-12` | P1 | 最近运行输出与脱敏切换 | 不泄漏密钥 |
| `T-INSP-13` | P1 | Workspace 覆盖与评审 | schema 变更升版本，引用保护 |
| `T-INSP-14` | P1 | 自定义节点入口 | 不绕过“第 21 个默认节点”准入规则 |
| `T-INSP-15` | P0 | 表单自动注册与三级解析 | `registerNode` 后自动渲染；顺序可测 |
| `T-INSP-16` | P0 | SchemaForm + `x-*` 扩展 | 7 类扩展生效；未知扩展告警 |
| `T-INSP-17` | P0 | 自动保存 500ms + flush + 409 | 首次不保存；冲突不丢本地 |
| `T-INSP-18` | P0 | 上游变量推导与改名安全 | 只列可达上游；改名引用仍有效 |

## 6. 测试关注点

- 默认 20 个节点 × 所有 mode 的字段显隐、必填校验、handles。
- 表单三级解析：自定义/schema/configFields/只读兜底；未注册节点不空白。
- `x-hidden` 字段不提交；`x-sensitive` 不进日志/示例；`x-variable` 可插入变量。
- 自动保存：500ms 防抖、首次不保存、失焦/离开 flush、409 冲突保留本地。
- 上游变量只列可达节点；节点改名后 chip 仍解析。
- 变量 chip 在节点改名后仍可解析；路径失效有警告。
- 富文本粘贴 HTML、脚本、超大图片、重复上传。
- Manifest 版本升级后，已发布工作流仍按旧版本解释。
- 节点设置读到未知/弃用 version 时有明确提示。

## 7. 待决策

1. “输入”是否包含配置表单？建议包含，但必须分区展示。
2. Tiptap 存储用 HTML 还是结构化值？建议 `doc + text + refs`。
3. 图片绑定 Prompt 字段还是独立 `attachments`？建议独立附件映射，避免 UI 猜测模型消息结构。
4. 节点设置 P0 是否可编辑？建议只读；P1 再做 Workspace 覆盖与评审。

