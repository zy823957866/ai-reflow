# 12 Workflow 设计器子应用

> 优先级：P0（与 02/03 同期）。
> 用户目标：打开工作流后，节点、边、Inspector、撤销、校验、预览运行都在一个独立、可嵌入、可单独测试的设计器里完成；业务页面只负责“进入/离开/发布/运行”这些壳层动作。
> 相关包：`@ai-reflow/core`（Manifest/注册表/协议）、`@ai-reflow/ui`（无业务组件）、`@ai-reflow/engine/graph`（纯校验）、OpenAPI 生成客户端。
> 本文回答一个具体问题：**web 下面那个“单独的 workflow”到底放什么、边界在哪、怎么被挂载。**

## 1. 模块边界与不变量

### 1.1 包含

- 三栏编辑器壳：节点面板（Palette）、画布、Inspector、顶部工具栏。
- 节点/边的渲染、连线、Handle、分支标签、选中、多选、框选、缩放、缩略图。
- 节点表单解析与自动注册：自定义表单、JSON Schema 表单、`configFields` 兜底。
- 命令栈：新增/删除/移动/改配置/改标题/加边/删边/粘贴子图。
- 本地快速校验 + 服务端编译校验的错误映射。
- 脏数据、自动保存、revision 冲突、离开保护。
- 预览运行时的节点状态叠加、输出抽屉、取消/重跑入口。
- 设计器的公共挂载契约：`mountWorkflowDesigner()` / `<WorkflowDesigner>`。

### 1.2 不包含

- 工作流首页、卡片、搜索、归档（见 02）。
- 知识库、模型连接、MCP 管理、插件/模板市场页面（各自模块）。
- 节点执行器实现与调度（见 01/05，运行在 worker）。
- 运行历史列表与全局日志页（见 04；设计器只消费单次预览运行）。
- 账号、权限、计费、审计。

### 1.3 不变量

1. **设计器只编辑 JSON 定义**，不在浏览器执行节点、不读取数据库、不持有模型密钥。
2. **节点类型只有一个注册入口**：`registerNode()`；Palette、画布、Inspector、校验、执行器查找都从注册表取，不允许再维护第二份节点/表单清单。
3. **表单由注册表自动解析**：自定义组件 > JSON Schema > `manifest.configFields` > 只读兜底；禁止在 Inspector 里写 `switch (node.type)`。
4. **边也是注册项**：`registerEdge()` 决定边渲染与默认样式；设计器不硬编码边类型。
5. **画布状态与业务数据分离**：Pinia 只存画布/选中/命令栈/脏标记；服务端数据走 TanStack Query。
6. **所有图变更走命令栈**；撤销/重做不能绕过 dirty、revision 与校验。
7. **设计器不得 import 业务 feature**（knowledge/models/mcp/marketplace/runs 页面）；需要选项数据时通过 `DesignerServices` 端口注入。
8. **公共入口稳定**：外部只依赖 `apps/web/src/workflow/index.ts`；未来拆成 `apps/workflow` 时不改调用方。
9. **运行态只叠加、不回写**：节点状态/输出不得覆盖节点配置。
10. **未知节点/边/表单必须显式报错**，不能静默丢弃或渲染空白。

## 2. 目录与依赖

### 2.1 目录

```text
apps/web/src/workflow/                 # 独立流程设计器子应用
├─ index.ts                               # 唯一公共入口：mount / 组件 / 类型
├─ routes.ts                              # /workflows/:id、/workflows/:id/versions
├─ shell/                                 # 三栏布局、工具栏、面包屑、快捷键
├─ canvas/                                # Vue Flow 画布
│  ├─ FlowCanvas.vue
│  ├─ nodes/                              # 节点渲染器与注册桥接
│  ├─ edges/                              # 边渲染器与注册桥接
│  └─ handles/                            # Handle、分支标签、连线校验提示
├─ palette/                               # 节点面板、分类、搜索、拖拽源
├─ inspector/                             # 输入/输出/运行记录 Tab、错误定位
├─ forms/                                 # 表单解析与自动注册
│  ├─ NodeFormRegistry.ts
│  ├─ resolveNodeForm.ts
│  ├─ SchemaForm.vue
│  └─ fields/                             # text/richtext/number/select/json/...
├─ commands/                              # 命令栈与事务
├─ validation/                            # 本地校验 + 服务端错误映射
├─ runtime/                               # 预览运行状态叠加、事件适配
├─ stores/                                # createDesignerStore()，实例级
├─ api/                                   # WorkflowDesignerPort 默认适配器
├─ shared/                                # 与 runs 页共享的展示组件（无业务请求）
└─ __tests__/
```

未来拆分只需把该目录迁到 `apps/workflow/`，并补一个 `package.json`；公共 API、路由与 Port 不变。

### 2.2 依赖方向

```text
apps/web/src/workflow
  -> @ai-reflow/core            # Manifest、registerNode、协议类型
  -> @ai-reflow/ui              # 设计令牌、Reka UI 封装、无业务组件
  -> @ai-reflow/engine/graph    # 纯编译/校验（禁止 I/O）
  -> OpenAPI generated client   # 仅默认 Port 适配器使用
  -> Vue / Vue Flow / Pinia / TanStack Query
```

硬规则：

- 禁止 import `@ai-reflow/capabilities`（节点执行器）、`@ai-reflow/platform`（DB/队列/存储）。
- 禁止 import `apps/web/src/features/{knowledge,models,mcp,marketplace,runs}`。
- 禁止组件内裸 `fetch`；所有请求走 `WorkflowDesignerPort`。
- 共享展示组件放 `workflow/shared/` 或 `@ai-reflow/ui`；不要从业务页面反向引用。
- 需要“模型列表/知识库列表/MCP Server/文件上传”时，由壳层注入 `DesignerServices`，设计器只依赖接口。

## 3. 公共挂载契约

### 3.1 组件与命令式挂载

```ts
// apps/web/src/workflow/index.ts
export interface WorkflowDesignerProps {
  workflowId: string;
  mode: 'edit' | 'preview' | 'readonly';
  port: WorkflowDesignerPort;
  services?: DesignerServices;
  initialVersionId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (result: SaveResult) => void;
  onPublishRequested?: () => void;
  onRunCreated?: (runId: string) => void;
  onValidationChange?: (result: ValidationResult) => void;
  onNodeSelected?: (nodeId: string | null) => void;
}

export interface WorkflowDesignerHandle {
  flushSave(): Promise<void>;
  undo(): void;
  redo(): void;
  fitView(): void;
  focusNode(nodeId: string): void;
  getDefinition(): WorkflowDefinition;
  destroy(): void;
}

export function mountWorkflowDesigner(
  el: HTMLElement,
  props: WorkflowDesignerProps,
): WorkflowDesignerHandle;
```

Vue 内直接使用 `<WorkflowDesigner v-bind="props" />`；`mountWorkflowDesigner` 用于嵌入旧页面、独立部署或未来微前端。

### 3.2 WorkflowDesignerPort

设计器不关心数据来自 REST、MCP 还是本地 mock；端口是唯一 I/O 边界。

```ts
export interface WorkflowDesignerPort {
  load(input: { workflowId: string; versionId?: string }): Promise<WorkflowDraft>;
  save(input: {
    workflowId: string;
    definition: WorkflowDefinition;
    revision: number;
    reason: 'autosave' | 'manual' | 'leave';
  }): Promise<{ revision: number; savedAt: string }>;
  validate(input: {
    workflowId: string;
    definition: WorkflowDefinition;
  }): Promise<ValidationResult>;
  publish(input: {
    workflowId: string;
    revision: number;
    changelog?: string;
  }): Promise<{ versionId: string; version: number }>;
  createPreviewRun(input: {
    workflowId: string;
    definition: WorkflowDefinition;
    input: Record<string, unknown>;
  }): Promise<{ runId: string }>;
  subscribeRun(input: {
    runId: string;
    afterSeq?: number;
    onEvent: (event: RunEvent) => void;
    onError: (error: Error) => void;
    onEnd: () => void;
  }): () => void;
  cancelRun?(runId: string): Promise<void>;
}
```

- 默认适配器在 `workflow/api/openapiPort.ts`，内部使用生成的 OpenAPI client。
- 测试使用 `mockPort.ts`，不启动后端。
- 端口抛出的错误必须归一化为 `DesignerError`（`code/message/retryable/details`），UI 不解析 HTTP 状态码。

### 3.3 DesignerServices

```ts
export interface DesignerServices {
  loadModelOptions?(): Promise<SelectOption[]>;
  loadKnowledgeOptions?(): Promise<SelectOption[]>;
  loadMcpServers?(): Promise<SelectOption[]>;
  loadMcpTools?(serverId: string): Promise<SelectOption[]>;
  loadWorkflowOptions?(): Promise<SelectOption[]>;
  uploadFile?(file: File): Promise<FileRef>;
  confirm?(message: string): Promise<boolean>;
  notify?(level: 'info' | 'warn' | 'error', message: string): void;
}
```

缺省时相关控件显示“未接入”并禁用，不报错、不伪造数据。

## 4. 节点与边注册

### 4.1 一个节点 = 一个注册对象

```ts
// packages/core/src/node/registration.ts
export interface NodeRegistration<TConfig = unknown> {
  manifest: NodeManifest<TConfig>;
  /** 仅 worker/执行进程注册；web 不打包执行器 */
  executor?: NodeExecutorFactory<TConfig>;
  /** 仅 web/设计器注册；worker 不打包表单 */
  form?: NodeFormRegistration;
  /** 节点渲染器覆盖；缺省用通用节点卡片 */
  component?: unknown;
  /** 节点级示例，供 Inspector 与测试使用 */
  examples?: NodeExample[];
}
```

```ts
// packages/capabilities/src/nodes/llm/index.ts
export const llmNode = defineNode({
  manifest: llmManifest,
  executor: () => new LlmExecutor(),
  form: { kind: 'schema', schema: llmConfigJsonSchema },
  examples: [llmGenerateExample, llmClassifyExample],
});
```

> `executor` 一律是 `BaseNodeExecutor` 子类：`execute()` 由基类统一处理校验/变量/超时/日志/输出/错误，节点只实现 `doExecute()`。设计器不加载该字段，只在 worker 注册。

```ts
// packages/capabilities/src/nodes/index.ts
export function registerBuiltinNodes(target: 'web' | 'worker' | 'api') {
  for (const node of builtinNodes) {
    registerNode(projectRegistration(node, target));
  }
}
```

### 4.2 进程投影

同一份节点定义，按进程只注册需要的部分：

| 进程 | manifest | form | executor | component | 用途 |
| --- | --- | --- | --- | --- | --- |
| `apps/web` | 是 | 是 | 否 | 是 | Palette、Inspector、校验、节点渲染 |
| `apps/worker` | 是 | 否 | 是 | 否 | 执行与输出校验 |
| `apps/server` | 是 | 否 | 否 | 否 | Manifest 投影、导入校验、文档生成 |
| `apps/plugin-runner` | 插件 manifest | 否 | 插件 executor | 否 | 隔离执行第三方代码 |

投影规则：

- `projectRegistration(node, 'web')` 删除 `executor`，保留 `form/component`。
- `projectRegistration(node, 'worker')` 删除 `form/component`，保留 `executor`。
- 构建期用依赖图检查：web bundle 不得出现 `capabilities` 执行器代码；worker bundle 不得出现表单组件。

### 4.3 注册表语义

- `registerNode()` 按 `manifest.type` 合并；后注册字段覆盖先注册字段。
- 重复注册 `executor` 或 `form` 时输出 `REGISTRY_OVERWRITE` 警告，生产环境默认拒绝覆盖（插件升级需显式 `allowOverwrite`）。
- `unregisterNode(type)` 用于插件禁用/卸载；已打开工作流保留只读快照，不崩溃。
- `onNodeRegistryChange(listener)` 让 Palette、`nodeTypes`、Inspector 自动刷新；不允许页面手动重建列表。
- `registerEdge()` 同理；边类型、默认样式、动画、marker 都由注册项决定。
- 注册是**进程内**的；跨进程一致性由同一份 `defineNode` 源文件与构建检查保证，不靠手工同步。

### 4.4 设计器如何使用注册表

```ts
// canvas/nodeTypes.ts
export function buildNodeTypes(): Record<string, Component> {
  const types: Record<string, Component> = {};
  for (const node of getNodeRegistrations()) {
    types[node.manifest.type] = node.component ?? GenericNodeCard;
  }
  return types;
}
```

- Palette 读 `manifest.category/phase/displayName/icon`。
- 画布读 `component` 与 `manifest.handles`。
- Inspector 读 `form` 与 `manifest.configFields`。
- 校验读 `manifest.handles/inputSchema/outputSchema`。
- 运行态读 `manifest.capabilities` 决定是否可取消/流式/长任务。

## 5. 表单解析与自动注册

### 5.1 解析优先级

```text
resolveNodeForm(type)
  1. form.kind = 'component'  -> 懒加载自定义表单组件
  2. form.kind = 'schema'     -> SchemaForm + x-* 扩展
  3. form.kind = 'fields'     -> configFields 通用渲染器
  4. 未注册                   -> 只读 Manifest + “未注册表单”提示
```

- `registerNode()` 时把 `form` 写入 `NodeFormRegistry`，设计器不需要再 `nodeSettingsRegistry.register(...)`。
- 自定义表单只在确有复杂交互时使用（条件编辑器、代码编辑器、知识库选择）；其余一律 schema 驱动。
- 自定义表单仍必须接受 `configSchema` 校验，不能绕过协议。

### 5.2 JSON Schema 扩展

| 扩展 | 类型 | 作用 |
| --- | --- | --- |
| `x-variable` | boolean | 允许插入 `$input/$node/$vars` 变量 chip |
| `x-component` | string | 指定控件：`textarea/password/code/json/...` |
| `x-component-props` | object | 传给控件的额外属性 |
| `x-group` | string | 字段分组 |
| `x-order` | number | 字段顺序 |
| `x-hidden` | boolean | 条件隐藏；隐藏字段不提交 |
| `x-sensitive` | boolean | 掩码展示，不进入日志/示例 |

### 5.3 自动保存与命令栈

- 表单变更先写入命令栈（`updateNodeConfig`），再触发 500ms 防抖自动保存。
- 首次渲染不保存；保存前比较序列化 JSON，未变化不发请求。
- 连续输入合并为一次命令；失焦、切换节点、离开路由、点击保存时立即 flush。
- 保存带 `revision`；409 时保留本地草稿，提示刷新/另存，不静默覆盖。
- 自动保存失败不阻塞继续编辑，但顶部状态必须显示“未保存/保存失败/冲突”。

## 6. 画布、命令栈与校验

### 6.1 命令

| 命令 | 说明 |
| --- | --- |
| `addNode` | 从 Palette 拖入/点击添加；默认配置来自 Manifest |
| `removeNodes` | 删除节点及关联边；有引用时提示影响 |
| `moveNodes` | 拖动结束合并为一条命令 |
| `updateNodeConfig` | 表单变更；按节点合并 |
| `updateNodeTitle` | 只改 `title`，不改 `node.id` |
| `addEdge` / `removeEdge` | 边创建/删除；带端口校验 |
| `pasteSubgraph` | 复制子图，重映射 nodeId 与边 |
| `setNodeMode` | 切换 `mode/kind/operation`，同步字段与 handles |

- 撤销/重做只回放命令，不整图替换。
- 命令执行后统一触发 `markDirty()`、`scheduleValidate()`、`scheduleSave()`。
- 多选移动/删除使用事务，撤销一次恢复整组。

### 6.2 校验

1. 本地快速校验（同步）：唯一 start、至少一个终止节点、边目标存在、端口匹配、孤立节点、条件分支完整。
2. 服务端编译校验（300ms 防抖）：变量可达、类型、Manifest 版本、输出 schema。
3. 错误映射：`{ code, nodeId?, edgeId?, field?, message }` → 节点角标、边高亮、Inspector 字段定位。
4. 发布前必须服务端校验通过；本地校验只用于即时反馈。

## 7. 运行态叠加

- 预览运行通过 `port.createPreviewRun` + `port.subscribeRun`；设计器不直接拼 SSE URL。
- `RunEvent` 映射为节点状态：`pending/running/succeeded/failed/skipped/cancelled/waiting`。
- 节点输出抽屉复用 `workflow/shared/` 的展示组件，与 04 的运行详情保持同一套字段。
- 运行态只叠加在节点上，不修改 `node.config`；退出运行态后恢复编辑态。
- 支持取消、原样重跑；P1 支持失败节点/分支重跑。
- 运行中切换节点仍可查看配置，但保存按钮按 `mode` 禁用或提示。

## 8. 前端功能点

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `WD-F01` | 独立挂载 | 壳层可通过组件或 `mountWorkflowDesigner` 打开；卸载无残留监听 |
| `WD-F02` | 三栏布局 | Palette/画布/Inspector 可折叠；窄屏降级为抽屉 |
| `WD-F03` | 注册表驱动 Palette | 新增 `registerNode` 后自动出现，无需改设计器代码 |
| `WD-F04` | 注册表驱动节点渲染 | 未注册 `component` 用通用节点卡片；未知类型明确报错 |
| `WD-F05` | 注册表驱动边 | `registerEdge` 后自动可选；默认边类型来自注册表 |
| `WD-F06` | 表单自动解析 | 自定义 > schema > configFields > 只读兜底 |
| `WD-F07` | 表单自动保存 | 500ms 防抖；首次不保存；失焦/离开 flush |
| `WD-F08` | 保存冲突 | 409 保留本地草稿；提供刷新/另存/对比 |
| `WD-F09` | 命令栈 | 九类命令可撤销/重做；多选操作为事务 |
| `WD-F10` | 本地校验 | 缺失 start/终止、端口不匹配、孤立节点即时提示 |
| `WD-F11` | 服务端校验映射 | 错误定位到 node/edge/field；发布被阻止 |
| `WD-F12` | 上游变量推导 | 只列可达上游；字段来自 `outputSchema`；改名不失效 |
| `WD-F13` | 运行态叠加 | 节点状态与输出抽屉；不覆盖配置 |
| `WD-F14` | 运行取消/重跑 | 取消二次确认；重跑使用同一 snapshot |
| `WD-F15` | 只读模式 | 已发布版本/运行中只读；提示复制为草稿 |
| `WD-F16` | 离开保护 | 有未保存修改时二次确认；可 flush 后离开 |
| `WD-F17` | 性能模式 | 200 节点可拖拽；300 节点提示简化渲染 |
| `WD-F18` | 服务注入 | 模型/知识库/MCP/文件能力由 `DesignerServices` 提供；缺失时禁用 |
| `WD-F19` | 错误隔离 | 单个节点表单/渲染异常不拖垮整张画布 |
| `WD-F20` | 可访问性 | 键盘选择/删除/撤销、焦点回收、错误可读 |

## 9. 示例

### 9.1 壳层挂载

```ts
import { mountWorkflowDesigner } from '@/workflow';
import { openapiPort } from '@/workflow/api/openapiPort';

const designer = mountWorkflowDesigner(document.getElementById('designer')!, {
  workflowId: 'wf_support_triage',
  mode: 'edit',
  port: openapiPort,
  services: {
    loadModelOptions: () => modelsQuery.fetchOptions(),
    loadKnowledgeOptions: () => knowledgeQuery.fetchOptions(),
    uploadFile: (file) => uploads.upload(file),
    confirm: (message) => dialog.confirm(message),
  },
  onDirtyChange: (dirty) => shell.setDirty(dirty),
  onRunCreated: (runId) => router.push(`/runs/${runId}`),
});
```

### 9.2 注册一个带自定义表单的节点

```ts
import { defineNode } from '@ai-reflow/core/node';
import { LlmForm } from './LlmForm.vue';

export const llmNode = defineNode({
  manifest: llmManifest,
  executor: () => new LlmExecutor(),
  form: {
    kind: 'component',
    load: () => Promise.resolve(LlmForm),
  },
});
```

### 9.3 注册一个纯 Schema 表单的节点

```ts
export const waitNode = defineNode({
  manifest: waitManifest,
  executor: () => new WaitExecutor(),
  form: {
    kind: 'schema',
    schema: {
      type: 'object',
      properties: {
        durationMs: { type: 'number', title: '等待时长', default: 5000, 'x-order': 1 },
        until: { type: 'string', title: '等待到', 'x-variable': true, 'x-order': 2 },
      },
    },
  },
});
```

### 9.4 注册自定义边

```ts
registerEdge({
  type: 'branch',
  label: '条件分支',
  animated: true,
  style: { stroke: '#7c5cff', strokeWidth: 2 },
  markerEnd: true,
});
```

## 10. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-WD-01` | P0 | 把现有画布/Inspector 散落代码收敛到 `apps/web/src/workflow/` 子应用 | 设计器可独立挂载；页面无循环依赖 |
| `T-WD-02` | P0 | 公共入口 `index.ts` 与 `mountWorkflowDesigner` | 组件式与命令式均可打开/销毁 |
| `T-WD-03` | P0 | `WorkflowDesignerPort` + OpenAPI 适配器 | 设计器内无裸 fetch |
| `T-WD-04` | P0 | `DesignerServices` 注入模型/知识库/MCP/上传 | 缺失服务时控件禁用而非报错 |
| `T-WD-05` | P0 | Palette/画布/Inspector 全部读注册表 | 新增节点不改设计器代码 |
| `T-WD-06` | P0 | 表单三级解析 + `NodeFormRegistry` | 自定义/schema/configFields 均可渲染 |
| `T-WD-07` | P0 | 命令栈九类命令 | 撤销/重做与 dirty/校验一致 |
| `T-WD-08` | P0 | 自动保存 500ms + flush + 409 | 不丢本地修改；冲突可恢复 |
| `T-WD-09` | P0 | 本地校验 + 服务端错误映射 | 发布前阻断非法定义 |
| `T-WD-10` | P0 | 上游变量推导 | 只列可达上游；改名不失效 |
| `T-WD-11` | P0 | 运行态叠加与输出抽屉 | 不覆盖配置；取消/重跑可用 |
| `T-WD-12` | P0 | 边界 lint：禁止 import 业务 feature | CI 阻断越界依赖 |
| `T-WD-13` | P0 | 设计器单测/组件测试 | 注册、表单、命令、冲突、校验覆盖 |
| `T-WD-14` | P1 | 拆为 `apps/workflow` 独立应用 | 公共 API 不变，壳层零改动 |
| `T-WD-15` | P1 | 只读分享/嵌入模式 | 不暴露编辑与密钥 |

## 11. 测试关注点

- 注册：新增节点/边后 Palette、画布、Inspector、校验自动同步；重复注册/覆盖警告。
- 进程投影：web bundle 无执行器；worker bundle 无表单组件。
- 表单：三级解析顺序；未知类型只读兜底；`x-hidden` 不提交；`x-variable` 可插入变量。
- 命令：九类命令撤销/重做；多选事务；撤销后 dirty 与 revision 正确。
- 保存：500ms 防抖、首次不保存、失焦/离开 flush、409 冲突不丢本地。
- 校验：本地与服务端错误映射一致；发布被阻止。
- 运行：状态叠加不覆盖配置；断线重连；取消/重跑。
- 边界：设计器不能 import 业务 feature；无裸 fetch；无数据库/执行器依赖。
- 性能：200 节点拖拽/缩放；300 节点性能模式。

## 12. 待决策

1. 设计器是否需要独立路由前缀（`/workflows/:id` 还是 `/designer/:id`）？建议保持 `/workflows/:id`，由 web 壳层挂载。
2. 是否 P0 就拆成 `apps/workflow`？建议先做 `apps/web/src/workflow`，公共 API 稳定后再拆，降低构建复杂度。
3. 共享运行详情组件放 `@ai-reflow/ui` 还是 `workflow/shared`？建议展示型放 `ui`，与设计器强耦合的放 `workflow/shared`。
4. 自动保存是否可关闭？建议默认开启，设置项允许改为手动保存；关闭时离开保护必须保留。
5. 自定义表单是否允许第三方插件注入？P1 允许，但必须在组件沙箱中运行，遵守 09 的权限与隔离规则。
