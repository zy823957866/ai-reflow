# 02 工作流管理与画布

> 优先级：P0 主闭环。
> 用户目标：3 秒内判断该打开哪条工作流；进入编辑器后能完成创建 → 编排 → 校验 → 保存 → 发布；发布后可对固定版本试运行。
> 相关包：`@ai-reflow/core`（schema/校验）、`@ai-reflow/platform`（Repository）、`@ai-reflow/ui`（画布组件）、`@ai-reflow/engine/graph`（编译校验）；画布与编辑器实现位于 `apps/web/src/workflow`（见 12）。

## 1. 模块边界

包含：

- 首页“我的工作流”、指标、搜索/筛选/排序、卡片/列表、快捷动作。
- 工作流 CRUD、草稿保存、乐观锁、复制、归档、导入/导出。
- 编辑器入口：页面壳挂载 `apps/web/src/workflow` 的流程设计器；画布、节点面板、连线、撤销/重做、校验标记由设计器实现（见 12）。
- 发布与版本列表；发布快照不可变。
- 发布后试运行入口：把固定 `workflowVersionId` 交给 04 的试运行台，不重新打开可编辑草稿。

不包含：

- 节点属性表单细节（见 03）。
- 运行执行、SSE、日志（见 04）。
- 节点语义与默认 20 个节点矩阵（见 05）。

不变量：

- 草稿与发布版本分离；发布版本不可修改。
- `node.id` 稳定；重命名只改 `title`，不改 ID。
- 画布只编辑 JSON；不在浏览器执行节点。
- 非法连线、缺失 start/终止节点、端口不匹配必须在画布与 API 两侧报错。
- 撤销/重做走命令栈，不直接替换整张图。
- 工作流页面只负责“进入/离开/发布/运行”壳层动作；设计器通过 `mountWorkflowDesigner`/`<WorkflowDesigner>` 挂载，公共 API 稳定。
- 工作流页面的“运行”必须区分草稿预览与发布版本试运行；已发布快捷运行固定版本并带 `trigger=manual_trial`。
- 设计器不得 import 业务 feature（knowledge/models/mcp/marketplace/runs）、`capabilities` 执行器或 `platform`；所有 I/O 走 `WorkflowDesignerPort`。

## 2. 前端功能

### 2.1 页面与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 我的工作流 | 卡片/列表、指标、创建、模板入口 |
| `/workflows/:id` | 工作流编辑器 | 页面壳 + `apps/web/src/workflow` 设计器（画布 + 节点面板 + Inspector + 工具栏） |
| `/workflows/:id/versions` | 版本列表 | 可在编辑器侧栏或独立页 |
| `/workflows/:id/trial?versionId=...` | 发布后试运行台 | 固定发布版本；输入、运行、结果与当前版本历史（见 04） |

### 2.2 首页功能点

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `WF-F01` | 顶部指标 | 工作流总数、已发布数、本周运行数、整体成功率；点击联动筛选 |
| `WF-F02` | 搜索 | 名称/描述/标签；输入 300ms 防抖；可清除 |
| `WF-F03` | 状态筛选 | 全部/草稿/已发布/审核中；标签多选 |
| `WF-F04` | 排序 | 最近更新（默认）/最近运行/运行次数/成功率 |
| `WF-F05` | 视图切换 | 卡片网格（默认）与紧凑列表共享同一查询 |
| `WF-F06` | Cursor 分页 | 滚动加载保留筛选；无重复/漏项 |
| `WF-F07` | 工作流卡片字段 | 状态、缩略图、标题、描述、标签、节点数、最近运行、成功率、负责人、更新时间 |
| `WF-F08` | 状态表达 | 草稿/已发布/审核中同时有颜色和文字，不只靠颜色 |
| `WF-F09` | 图形缩略图 | 节点类型 + 连线 + 分支方向；不渲染完整画布 |
| `WF-F10` | 快捷动作 | 打开、运行、复制、重命名、归档；已发布工作流直接进入固定版本试运行，草稿进入编辑器预览 |
| `WF-F11` | 新建空白工作流 | 输入名称/描述；创建后进入编辑器 |
| `WF-F12` | 从模板开始 | 入口跳模板市场；P0 可只展示入口或内置 seed |
| `WF-F13` | 空态 | 空态说明 + 新建空白 + 从模板开始 |
| `WF-F14` | 加载态 | 骨架卡片保持网格尺寸，避免跳动 |
| `WF-F15` | 错误态 | 明确原因 + 重试；不能显示为空列表 |
| `WF-F16` | 无权限态 | 说明无权限，不暴露工作流内容 |
| `WF-F17` | 运行中提示 | 卡片显示状态点与 runId，点击进入运行追踪 |
| `WF-F18` | 相对时间 | 相对时间 + 精确时间 tooltip，使用客户端时区 |
| `WF-F19` | 发布状态与试运行 | 已发布卡片显示最近发布版本；快捷运行显示版本号并以 `trigger=manual_trial` 创建 run |

### 2.3 编辑器与画布功能点

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `ED-F01` | 三栏编辑器壳 | 左节点面板、中画布、右 Inspector；可折叠 |
| `ED-F02` | 工作流标题栏 | 名称、状态、保存状态、发布按钮、草稿预览按钮、返回 |
| `ED-F03` | 节点面板搜索 | 按名称/type 搜索；支持分类与 P0/P0.5/P1 筛选 |
| `ED-F04` | 拖拽添加节点 | 从面板拖入画布；新生 nodeId；默认配置来自 Manifest |
| `ED-F05` | 点击添加节点 | 双击或按钮在视口中心添加 |
| `ED-F06` | 节点移动 | 拖动更新 position；不触发后端保存直到 dirty 变更 |
| `ED-F07` | 连线创建 | 从 source handle 拖到 target handle；非法连接直接拒绝并提示 |
| `ED-F08` | 端口类型校验 | 不匹配的目标 handle 禁用；条件分支只能连对应 sourceHandle |
| `ED-F09` | 删除节点/边 | Delete 键与右键菜单；删除有引用时提示影响 |
| `ED-F10` | 多选与框选 | 支持移动/删除多选；Inspector 显示多选摘要 |
| `ED-F11` | 复制/粘贴 | 复制节点或子图；粘贴生成新 nodeId；边同步复制 |
| `ED-F12` | 撤销/重做 | 命令栈覆盖 addNode/removeNodes/moveNodes/updateNodeConfig/updateNodeTitle/addEdge/removeEdge/pasteSubgraph/setNodeMode |
| `ED-F13` | 缩放/平移 | 滚轮缩放、空格/中键平移；工具栏显示当前缩放 |
| `ED-F14` | 适应视图 | Fit view、重置缩放、定位选中节点 |
| `ED-F15` | 缩略图/控制器 | MiniMap + Controls；大图可关闭以省性能 |
| `ED-F16` | 自动布局 | dagre/elkjs；仅初始或手动触发，拖拽中不重排 |
| `ED-F17` | 节点视觉 | 图标、标题、类型、状态徽标、错误角标、I/O Handle |
| `ED-F18` | 分支边标签 | 条件/循环/人工分支显示 `true/false/case/approved` 等标签 |
| `ED-F19` | 校验标记 | 节点/边错误直接标红；Inspector 展示详情 |
| `ED-F20` | 实时编译提示 | 缺失 start/终止、孤立节点、无环/端口/变量错误即时提示 |
| `ED-F21` | 选中联动 | 点击节点打开 Inspector；运行态点击节点定位到运行详情 |
| `ED-F22` | 节点重命名 | 只改 `title`；所有 `$node.<id>` 引用保持有效 |
| `ED-F23` | Dirty 与保存 | 首次修改显示未保存；保存成功显示 revision/时间 |
| `ED-F24` | 离开保护 | 有未保存修改时离开/刷新二次确认 |
| `ED-F25` | 保存失败恢复 | 保留本地草稿，显示冲突/网络错误与重试 |
| `ED-F26` | 乐观锁冲突 | revision 不匹配时提示“已更新”，提供刷新/覆盖策略 |
| `ED-F27` | 发布流程 | 先编译校验；填写版本说明；成功后展示版本号 |
| `ED-F28` | 版本列表 | 版本号、时间、说明、节点数；可查看定义、试运行固定版本、复制为草稿 |
| `ED-F29` | 导入 JSON | 校验 schemaVersion 与节点 type；失败定位字段 |
| `ED-F30` | 导出 JSON | 导出当前草稿或指定版本；不含密钥/运行数据 |
| `ED-F31` | 键盘快捷键 | 删除、复制/粘贴、撤销/重做、保存、运行、Fit view |
| `ED-F32` | 性能模式 | 200 节点可拖拽；超过 300 节点提示开启简化渲染 |

> `ED-F01`–`ED-F32` 的落地位置是 `apps/web/src/workflow`；本文件定义产品行为，12 定义实现边界、公共 API 与注册表契约。

### 2.4 设计器边界与公共契约

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `ED-F33` | 设计器独立挂载 | 页面通过 `<WorkflowDesigner>` 或 `mountWorkflowDesigner` 打开；卸载无残留监听 |
| `ED-F34` | 注册表驱动节点 | Palette/画布/Inspector 读 `registerNode`；新增节点不改页面代码 |
| `ED-F35` | 注册表驱动边 | `registerEdge` 后自动可选；默认边样式来自注册表 |
| `ED-F36` | 端口 I/O 隔离 | 所有请求走 `WorkflowDesignerPort`；页面无裸 `fetch` |
| `ED-F37` | 服务注入 | 模型/知识库/MCP/上传由 `DesignerServices` 注入；缺失时禁用而非报错 |
| `ED-F38` | 只读预览 | 版本详情/模板预览复用设计器只读模式，不暴露编辑与密钥 |
| `ED-F39` | 发布后试运行跳转 | 发布成功与版本列表可打开 `/workflows/:id/trial?versionId=...`；页面只读固定版本，不进入编辑态 |

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-WF-01` | 工作流列表聚合 | 一次返回卡片 DTO：状态、标签、节点数、运行统计、缩略图 |
| `B-WF-02` | 搜索/筛选/排序 | 名称/描述/标签；cursor 分页；统计窗口固定 |
| `B-WF-03` | 工作流 CRUD | 创建、读取、更新元数据、归档/删除（软删除优先） |
| `B-WF-04` | 草稿保存 | PATCH 定义 + `revision` 乐观锁；冲突返回 409 |
| `B-WF-05` | 草稿复制 | 复制定义生成新 workflow，nodeId 可保留或重映射 |
| `B-WF-06` | 发布版本 | 编译校验通过后写 `workflow_versions`，版本号单调 |
| `B-WF-07` | 版本不可变 | 发布后禁止 PATCH/DELETE；只能新建版本 |
| `B-WF-08` | 编译校验 API | 返回结构化错误：nodeId、edgeId、field、code、message |
| `B-WF-09` | Manifest 版本锁定 | 发布时固化节点 `type+version`；历史运行不受 manifest 更新影响 |
| `B-WF-10` | 导入/导出 | 校验 schemaVersion；导出脱敏；附带 manifest 版本 |
| `B-WF-11` | 运行统计 | 运行次数、成功率、最近运行；明确统计窗口 |
| `B-WF-12` | 缩略图投影 | `previewGraph` 只含类型/坐标/边索引，不返回完整 definition |
| `B-WF-13` | 快捷运行 | 草稿创建 preview run；已发布工作流按指定 version 创建 `runKind=production`、`trigger=manual_trial` 的 run；不覆盖草稿 |
| `B-WF-14` | 租户隔离 | 所有查询带 `workspace_id`；跨 workspace 404 |
| `B-WF-15` | 幂等 | 创建/复制/发布支持 `Idempotency-Key` |
| `B-WF-16` | 版本差异（P1） | 版本 diff、节点增删改、配置差异 |
| `B-WF-17` | 设计器契约 API | 提供 `load/save/validate/publish/createPreviewRun/subscribeRun` 对应端点；错误归一化 |
| `B-WF-18` | 设计器只读投影 | 版本/模板预览返回只读定义与 `previewGraph`，不返回密钥/运行数据 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/workflows` | 列表：query/search/status/tag/sort/cursor |
| `POST` | `/api/workflows` | 创建；可带 `templateId` |
| `GET` | `/api/workflows/:id` | 元数据 + 草稿定义 |
| `PATCH` | `/api/workflows/:id` | 元数据/草稿；带 `revision` |
| `DELETE` | `/api/workflows/:id` | 归档/软删除 |
| `POST` | `/api/workflows/:id/duplicate` | 复制 |
| `POST` | `/api/workflows/:id/validate` | 编译校验，不保存 |
| `POST` | `/api/workflows/:id/publish` | 发布 |
| `GET` | `/api/workflows/:id/versions` | 版本列表 |
| `POST` | `/api/workflows/:id/runs` | 创建固定发布版本试运行；`workflowVersionId` 必填（运行契约见 04） |
| `POST` | `/api/workflows/:id/import` | 导入 JSON |
| `GET` | `/api/workflows/:id/export?version=` | 导出 |

### 3.2 数据要点

- `workflows.draft_definition` 与 `workflow_versions.definition` 分离。
- `workflows.revision` 每次草稿写 +1；客户端保存必须回传。
- `definition_snapshot` 在运行时再次固化，不能只依赖 workflow 当前值。
- 发布版本试运行必须固化 `workflow_version_id`；发布成功后的跳转也带显式 `versionId`。
- 列表统计走聚合查询/缓存，不在前端逐卡片请求。
- 缩略图坐标只用于展示，不能作为编辑器数据源。

## 4. 示例

### 4.1 首页卡片 DTO

```json
{
  "id": "wf_support_triage",
  "name": "客服工单分流",
  "description": "分类、优先级与回复草稿",
  "status": "published",
  "tags": ["客服", "OpenAI"],
  "owner": { "id": "demo", "name": "Demo", "initials": "D" },
  "nodeCount": 9,
  "runCount": 128,
  "successRate": 0.94,
  "lastRun": { "runId": "run_01", "status": "succeeded", "at": "2026-11-20T09:20:00Z" },
  "updatedAt": "2026-11-20T08:10:00Z",
  "previewGraph": {
    "nodes": [{ "type": "start", "x": 0, "y": 0 }, { "type": "llm", "x": 1, "y": 0 }],
    "edges": [{ "from": 0, "to": 1 }]
  }
}
```

### 4.2 编译校验响应

```json
{
  "valid": false,
  "errors": [
    {
      "code": "EDGE_HANDLE_MISMATCH",
      "edgeId": "e3",
      "nodeId": "n_condition",
      "field": "sourceHandle",
      "message": "条件节点只有 true/false，不能连接到 case.1 以外的 handle"
    }
  ]
}
```

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-WF-01` | P0 | 工作流列表接口 + 卡片聚合 DTO | 列表一次请求返回卡片所需字段 |
| `T-WF-02` | P0 | 首页壳：指标、搜索、筛选、排序、网格/列表 | 条件可组合，刷新后保留 |
| `T-WF-03` | P0 | 卡片全状态：loading/empty/error/no-permission | 四种状态均可复现 |
| `T-WF-04` | P0 | 创建/重命名/复制/归档 | 危险动作有二次确认 |
| `T-WF-05` | P0 | 草稿保存 + revision 乐观锁 | 并发保存返回 409 且不丢本地 |
| `T-WF-06` | P0 | 抽出 `apps/web/src/workflow` 设计器并接入页面 | 画布可拖拽/连线/删除/缩放/缩略图；页面无循环依赖 |
| `T-WF-07` | P0 | 设计器命令栈 undo/redo | 九类操作可撤销/重做，与 dirty/校验一致 |
| `T-WF-08` | P0 | 双端编译校验 | 画布与 API 对同一非法定义报同一错误 |
| `T-WF-09` | P0 | 发布与版本列表 | 发布后不可修改，历史定义可查看；可进入固定版本试运行 |
| `T-WF-10` | P0 | 导入/导出 JSON | schema 错误可定位，导出无密钥 |
| `T-WF-11` | P0 | 200 节点性能基线 | 拖拽/缩放保持可用 |
| `T-WF-12` | P1 | 自动布局与批量选择 | 不改变手动拖拽位置除非用户触发 |
| `T-WF-13` | P1 | 版本 diff 与复制为草稿 | 差异可读，复制生成新草稿 |
| `T-WF-14` | P1 | 运行中卡片状态实时更新 | 不轮询整页，按 run 状态更新 |
| `T-WF-15` | P0 | 设计器公共入口与 `WorkflowDesignerPort` | 组件式/命令式均可打开；无裸 fetch |
| `T-WF-16` | P0 | 设计器边界 lint | 禁止 import 业务 feature/执行器/platform |

## 6. 测试关注点

- 非法起点/终点、循环边、端口类型不匹配、变量引用不可达。
- 并发保存冲突、刷新页面草稿恢复、发布后历史运行可解释。
- 发布成功后从版本列表进入试运行，运行始终使用 URL 中的固定版本；后续修改草稿不影响该版本。
- 200/300 节点拖拽、缩略图渲染、虚拟化或简化模式。
- 导入含未知节点/旧 schemaVersion 的 JSON。
- 深链打开 `/workflows/:id` 时权限/不存在返回一致。
- 设计器可独立挂载/卸载；新增 `registerNode` 后 Palette/画布/Inspector 自动出现。
- 设计器不得 import 业务 feature/执行器/platform；无裸 `fetch`。

## 7. 待决策

1. “我的工作流”是“我创建”还是“我创建 + 我参与”？P0 无鉴权建议 demo owner 映射。
2. 首页是否允许直接运行草稿？建议草稿必须进入编辑器预览；已发布工作流可直接进入固定版本试运行，但不能隐式使用最新版本。
3. 模板入口是否与工作流卡片同层级？建议独立入口，不混入卡片网格。
4. 归档是软删除还是独立状态？建议独立 `archived` 状态，可恢复。

