# ai-reflow 文档新版（整理稿）

> 生成时间：2026-11-20（Asia/Shanghai）
> 最近修订：2026-11-24（补充 MCP 双向竞品基线、设置分层、外部调用与参数模型；补齐发布后试运行台；重审默认 20 节点与 P2 准入；补齐触发器运行边界）
> 范围：只整理文档，不改动 `docs/` 原稿，不包含业务代码实现。
> 结论：原文档以“调研、决策过程、能力池”为主；本目录改为“架构说明 + 按模块拆分的可开发/可验收文档 + CSV 测试用例”。

## 1. 文档目标

- 给出唯一一份整体架构与技术方案，回答“系统怎么分层、包怎么合并、数据怎么流”。
- 按业务模块输出开发文档，每份文档固定包含 **前端功能 / 后端功能 / TODOLIST**，必要时附示例。
- 前端功能点使用稳定编号，便于排期、评审与测试用例关联。
- 输出一份可直接导入表格工具的 CSV 测试用例，覆盖 P0、P0.5 与 P1 关键路径。

## 2. 文档索引

| 文档 | 模块 | 主要读者 | 优先级 |
| --- | --- | --- | --- |
| [01 架构与技术方案](./01-architecture-and-tech-plan.md) | 全局（分层、技术栈、目录、协议、运行时） | 架构、前后端负责人 | P0 |
| [02 工作流管理与画布](./02-workflow-management-and-canvas.md) | 工作流首页、CRUD、发布；画布委托 `src/workflow` 设计器 | 前端、产品、后端控制面 | P0 |
| [03 节点属性面板与节点设置](./03-inspector-and-node-settings.md) | Inspector、表单自动注册与解析、Tiptap、Manifest 浏览 | 前端、节点开发 | P0 |
| [04 运行、预览与日志](./04-runtime-preview-and-logs.md) | 草稿预览、发布后试运行、SSE、日志、取消/重试 | 前端、运行时、后端 | P0 |
| [05 节点目录与 20 个默认节点](./05-node-catalog.md) | 竞品对齐后的默认节点清单、I/O、模式、P2 候选与实现 | 节点开发、前端、测试 | P0/P0.5/P1 |
| [06 知识库](./06-knowledge-base.md) | 上传、解析、分块、向量检索、引用、文件/切片预览 | 后端、前端、算法 | P0 |
| [07 MCP 双向集成](./07-mcp-integration.md) | 竞品基线、出站 MCP 客户端、入站 MCP Server、Workflow 暴露、外部 run 调用 | 后端、前端、集成 | P0/P1 |
| [08 模型设置与 Skills](./08-models-and-skills.md) | 模型连接、路由、Skills 安装与挂载 | 前端、后端、平台 | P0/P1 |
| [09 插件市场](./09-plugin-marketplace.md) | 插件目录、安装计划、权限、生命周期 | 产品、前后端、安全 | P1 |
| [10 模板市场](./10-template-marketplace.md) | 模板预览、依赖检查、克隆 | 产品、前后端 | P1 |
| [11 交付、工程化与质量](./11-delivery-engineering-quality.md) | 里程碑、CI、测试、部署、DoD | Tech Lead、QA、运维 | 全程 |
| [12 Workflow 设计器子应用](./12-workflow-designer-app.md) | `apps/web/src/workflow` 独立设计器、节点/边注册、表单自动解析、命令栈、运行态叠加 | 前端、架构、节点开发 | P0 |
| [13 数据库表关系与迁移基线](./13-database-schema-and-relationships.md) | PostgreSQL 表、外键、约束、索引、状态机、迁移顺序与前端 mock 映射 | 后端、架构、测试 | P0 |
| [test-cases.csv](./test-cases.csv) | 测试用例 | QA、开发 | P0-P1 |

## 3. 旧文档到新文档的映射

| 原文档 | 新位置 | 处理方式 |
| --- | --- | --- |
| `docs/01-competitive-analysis.md` | 不作为主文档，仅保留产品判断 | 原 MCP 单列会混淆客户端/服务端；修正后的双向结论与参数基线统一沉淀到 07 |
| `docs/02-technical-architecture.md` | `01-architecture-and-tech-plan.md` | 重写为“单一架构入口”，补包合并方案 |
| `docs/03-tech-stack.md` | `01` + `11` | 技术选型归架构，工程化归交付 |
| `docs/04-delivery-plan.md` | `11-delivery-engineering-quality.md` | 里程碑、验收、风险、DoD 统一 |
| `docs/05-marketplace-and-node-catalog.md` | `05` + `09` + `10` | 节点体系与两类市场拆开 |
| `docs/06-node-reference.md` | `05-node-catalog.md` | 保留 20 个默认节点定稿，能力池不再混入默认面板 |
| `docs/07-node-portfolio-review.md` | `05-node-catalog.md` | 只保留 20 个默认节点结论、合并规则与 P2 准入 |
| `docs/08-plugin-marketplace.md` | `09-plugin-marketplace.md` | 按模块文档格式重排，补前后端/TODO |
| `docs/09-workflow-studio-ui.md` | `02` `03` `05` `07` `08` `12` | 按页面与模块拆开，功能点编号；流程设计器单独成文 |
| `docs/AGENTS.md` | 仍以原文件为准 | 架构不变量与代码红线不变 |
| `docs/skills/*` | 仍以原文件为准 | 面向编码代理，不是产品 Skills |

## 4. 包合并结论（先看这里）

原方案是 **5 个 apps + 16 个 packages**。本稿建议收敛为 **4 个 apps + 7 个 packages**：

- `@ai-reflow/core`：合并 `contracts`、`reflow-schema`、`reflow-node-sdk`，并吸收事件 envelope/脱敏类型与节点注册/执行器基类契约。
- `@ai-reflow/engine`：合并 `reflow-engine`、`reflow-runtime`，内部保留 `pure` 与 `runtime` 子路径。
- `@ai-reflow/capabilities`：合并 `reflow-nodes`、`reflow-providers`、`reflow-knowledge`、`reflow-mcp`。
- `@ai-reflow/marketplace`：合并 `reflow-registry`、`reflow-plugin-sdk`。
- `@ai-reflow/platform`：合并 `db`、`reflow-observability` 的落库/队列/存储适配部分。
- `@ai-reflow/ui`：保持独立。
- `@ai-reflow/tooling`：合并 `config`、`testkit`。

apps 目录收敛为 `web`、`server`、`worker`、`plugin-runner`；P0 的 MCP Gateway 作为 `server` 的独立入口模块运行，P1 确有必要时再拆成独立进程。`web` 内部把流程设计器收敛为独立子应用 `apps/web/src/workflow/`（见 12），页面壳只负责进入/离开/发布/运行；未来可平滑拆成 `apps/workflow`，公共 API 不变。详细依赖方向见 01 第 3 节。

### 4.1 节点执行与注册模型（新增约定）

同一份节点定义按进程投影，不再维护多份节点/表单清单：

```text
defineNode({ manifest, executor?, form?, component?, examples? })
        │
        ├─ registerNode() ──> NodeRegistry（进程内唯一注册入口）
        │       ├─ web      : manifest + form + component
        │       ├─ worker   : manifest + executor
        │       ├─ server   : manifest
        │       └─ plugin-runner : 插件 manifest + executor
        │
        └─ 设计器读取注册表：Palette / 画布 / Inspector / 校验 / 运行态
```

硬约定：

- 每个节点必须有 `execute`（基类 `BaseNodeExecutor` 统一校验、变量解析、超时、日志、输出校验、错误归一化）和 `doExecute`（节点业务逻辑，只返回 `NodeOutput`）。
- 节点通过 `registerNode()` 自动注册**该节点类型的表单**；禁止在 Inspector 里写 `switch (node.type)`，也禁止再维护第二份表单注册表。
- 表单解析优先级：自定义组件 > JSON Schema（含 `x-*` 扩展）> `manifest.configFields` > 只读兜底。
- 边同样通过 `registerEdge()` 注册；调度器、画布、Inspector、校验都从注册表取类型，新增节点不改调度器/设计器代码。

### 4.2 参考项目吸收清单（`miaoma-aiflow-v2`）

只吸收与“可开发、可验收”相关的做法，不照搬其技术栈：

| 借鉴点 | 本项目落点 | 说明 |
| --- | --- | --- |
| `BaseNodeExecutor.execute/doExecute` | 01/05 节点基类契约 | 统一日志、超时、错误、输出校验；节点只写业务 |
| 节点类型 + 策略式表单注册 | 03/12 表单自动注册 | `registerNode` 自动带表单；三级解析 |
| JSON Schema `x-*` 扩展 + 动态渲染器 | 03/12 SchemaForm | `x-variable/x-component/x-group/x-order/x-hidden/x-sensitive` |
| 500ms 防抖自动保存 | 02/12 保存模型 | 首次不保存、失焦/离开 flush、409 保留本地 |
| 上游变量推导 + Tiptap 变量 chip | 03 变量引用 | 只列可达上游，改名不失效 |
| 测试运行 4 Tab + 可复用执行详情 | 04/12 运行态 | 输入/输出/错误/元数据统一组件 |
| 节点 trace / 执行 logger | 04 事件与日志 | nodeId + attempt + 阶段日志 |
| 插件权限沙箱 | 09 插件隔离 | plugin-runner + 权限清单 + 网络 allowlist |
| 本地/服务端校验器 + 错误映射 | 02/12 校验 | 发布前阻断；错误定位 node/edge/field |
| 图分支选择 / 条件 Handle | 02/05/12 画布 | 分支标签可见；未选分支 skipped |
| 混合检索（向量 + 全文加权） | 06 检索 | P1；rerank 失败可降级 |
| 应用发布 / API Key / 监控 | 04 P1 扩展 | 不改变 P0 运行模型 |

明确不吸收：React/Next.js、Prisma、Qdrant、在主进程执行第三方代码、硬编码节点输出清单、手工维护第二份表单注册表。

## 5. 统一文档结构

每个模块文档按以下顺序组织：

1. 模块边界与不变量。
2. **前端功能**：页面、路由、功能点编号、状态与异常。
3. **后端功能**：能力、API、数据、任务/队列、安全。
4. 示例：请求、响应、事件或配置 JSON。
5. **TODOLIST**：按 P0/P0.5/P1 拆任务，带验收口径。
6. 测试关注点与已知待决策项。

功能点编号规则：

- `WF-Fxx` 工作流管理；`ED-Fxx` 画布；`INSP-Fxx` 属性面板；`NODE-Fxx` 节点设置/目录。
- `WD-Fxx` Workflow 设计器子应用；`RUN-Fxx` 运行与日志；`KB-Fxx` 知识库；`MCP-Fxx` MCP；`MODEL-Fxx` 模型；`SKILL-Fxx` Skills。
- `MKT-Fxx` 插件市场；`TPL-Fxx` 模板市场；`ENG-Fxx`/`OPS-Fxx` 工程化。
- 后端用 `B-模块-序号`；TODO 用 `T-模块-序号`。

## 6. 测试用例说明

`test-cases.csv` 列定义：

| 列 | 含义 |
| --- | --- |
| `case_id` | 稳定用例 ID，例如 `TC-WF-001` |
| `module` | 模块名 |
| `feature_id` | 对应前端/后端功能点编号 |
| `priority` | P0 / P0.5 / P1 |
| `type` | 功能 / 集成 / 安全 / 性能 / 回归 / E2E |
| `preconditions` | 前置条件 |
| `steps` | 操作步骤，使用 `1) 2) 3)` |
| `expected` | 可直接判定的预期结果 |
| `layer` | Unit / Component / API / Integration / E2E / Security |
| `automation` | 是否必须自动化 |
| `notes` | 备注 |

CSV 使用 UTF-8 with BOM 保存，便于 Excel 直接打开；包含逗号的字段已加引号。

## 7. 使用建议

- 架构评审先读 01，确认包合并、节点注册模型与依赖红线后再拆开发任务。
- 产品/前端评审按 02 → 03 → 12 → 04 → 05 顺序，先确认页面、设计器边界与节点 I/O。
- 发布闭环按“草稿预览 → 发布 → 固定版本试运行 → 外部 HTTP/MCP 调用”验收；试运行不得隐式使用 latest。
- 设计器与节点开发先读 12：`registerNode`、表单自动解析、命令栈、`WorkflowDesignerPort` 是并行开发契约。
- P0 开发先完成 `01`、`02`、`03`、`12`、`04`、`05`、`06` 与 07 的双向闭环。
- P1 市场开发再读 09、10；不要在 P0 把市场做成静态下载页。
- 任何新增节点或 mode，先改 05，再确认 12 的注册表投影，最后改 03 的 UI 映射与 CSV 用例。

