# 11 交付、工程化与质量

> 目标：按“用户能完成一条工作流”交付，不按“页面数量”交付。
> 原则：每个里程碑有可运行产物；草稿预览、发布后试运行与正式运行同引擎；日志可见性是 P0；无登录不等于无边界。

## 1. 里程碑

| 里程碑 | 交付 | 验收 |
| --- | --- | --- |
| M0 工程底座 | pnpm/Turbo/TS/ESLint/UnoCSS；4 apps 空壳；Postgres/Redis/MinIO；健康检查/迁移/OpenAPI/Vitest | install/build/lint/typecheck 全绿；compose 健康；空库迁移 |
| M1 工作流与画布 | 列表/创建/重命名/删除；草稿/乐观锁/发布；抽出 `apps/web/src/workflow` 设计器；Inspector 壳；undo/redo | 可创建 start→end；设计器可独立挂载；非法连线双端报错；刷新不丢；200 节点可用 |
| M1.5 节点注册与表单 | `core/node` 注册表 + `BaseNodeExecutor`；`registerNode` 自动注册表单；三级解析；自动保存 | 新增节点不改设计器；web/worker 投影正确；409 不丢本地 |
| M2 引擎与 P0 节点 | core/engine/platform；8 节点；DAG/分支/并行/超时/重试/取消；run 表与 worker | 线性 HTTP→LLM→output 可执行；分支 skipped；引擎单测 ≥90% |
| M3 预览与日志 | 草稿预览台/发布后试运行台/就绪检查/SSE/节点状态/运行列表/详情/重连/脱敏 | 草稿可预览；发布后固定版本可试运行；断网补齐；1 万事件可用；无密钥 |
| M3.5 P0.5 节点 | data-transform/document/parallel；llm classify/extract；output chat/api | 边界/失败策略/分支/JSON 重试通过 |
| M4 知识库 | KB CRUD/上传/解析/分块/embedding/pgvector/引用/状态 | PDF/MD 可检索；引用正确；失败可重试 |
| M5 MCP 双向 | 出站连接/工具缓存/调用/错误；入站 Workflow as MCP Tool | 外部工具可调；Claude/Codex/Cursor 可调已发布工作流；run 可查/可取消；内网拒绝 |
| M6 发布与加固 | 版本/导入导出/幂等/限流/监控/Compose/Nginx/E2E | 空白环境完成创建→预览→发布→试运行→日志；安全清单 |
| M7 P1 节点与市场 | loop/subworkflow/wait/agent/code/human/quality-gate/database/file；插件/模板市场/runner | 节点限制/隔离/市场生命周期/模板 clone plan 通过 |

## 2. 前端工程化功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `ENG-F01` | Vite + Vue 3 SFC | `<script setup lang="ts">`；无 Options API 业务组件 |
| `ENG-F02` | 设计令牌与 UnoCSS | 禁止魔法色值；暗色模式 |
| `ENG-F03` | shadcn-vue 组件 | Button/Input/Select/Dialog 等统一维护在 `@ai-reflow/ui`；底层使用 Reka UI，页面不得重复封装 |
| `ENG-F04` | OpenAPI client | 生成 types/client；组件无裸 fetch |
| `ENG-F05` | TanStack Query | 服务端数据缓存/失效/错误态 |
| `ENG-F06` | Pinia 边界 | 画布/选中/undo 栈；不塞服务端数据 |
| `ENG-F07` | 虚拟滚动 | 日志、表格、长列表 |
| `ENG-F08` | 可访问性 | 键盘、焦点、空态、错误态、加载态 |
| `ENG-F09` | i18n | 文案 key；不散落硬编码中文 |
| `ENG-F10` | 性能预算 | 首屏 <800KB gzip；200 节点；1 万事件 |
| `ENG-F11` | 组件测试 | Vue Test Utils 覆盖关键 Inspector/卡片/日志 |
| `ENG-F12` | Playwright E2E | 画布→草稿预览→发布→固定版本试运行→日志主线 |
| `ENG-F13` | 设计器公共契约 | `mountWorkflowDesigner` 与 `WorkflowDesignerPort`；组件式/命令式均可 |
| `ENG-F14` | 设计器边界 lint | CI 阻断 import 业务 feature/执行器/platform 与裸 `fetch` |
| `ENG-F15` | 注册表契约测试 | `registerNode`/`registerEdge`/表单自动注册/进程投影 |

## 3. 后端工程化功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `ENG-B01` | NestJS 模块化 | Controller 薄；Service 业务；Repository SQL |
| `ENG-B02` | Drizzle + 迁移 | 空库可执行；只前进；禁止生产 push |
| `ENG-B03` | Zod + OpenAPI | DTO 校验；OpenAPI 同步；错误码 |
| `ENG-B04` | BullMQ | 队列/重试/延迟/并发；健康检查 |
| `ENG-B05` | Redis Stream + SSE | 事件回放；代理关闭 buffering |
| `ENG-B06` | 对象存储 | MinIO/S3；artifact/文档；签名 URL |
| `ENG-B07` | 配置校验 | 环境变量 Zod；启动失败可读 |
| `ENG-B08` | 日志与 trace | Pino + requestId/runId/traceId；脱敏 |
| `ENG-B09` | 幂等/限流 | Idempotency-Key；基础限流；CORS |
| `ENG-B10` | 健康检查 | liveness/readiness；迁移前置 |
| `ENG-B11` | 集成测试 | Testcontainers Postgres/Redis |
| `ENG-B12` | 供应链 | license/Knip/SBOM；镜像非 root；固定 digest |
| `ENG-B13` | 构建期投影检查 | web bundle 无执行器；worker bundle 无表单组件 |
| `ENG-B14` | 注册表/基类契约测试 | `registerNode`、`BaseNodeExecutor.execute/doExecute` 固定 fixture |

## 4. 测试策略

| 层级 | 范围 | 工具 | 要求 |
| --- | --- | --- | --- |
| Unit | engine graph、node 纯函数、redaction、semver | Vitest | 引擎核心 ≥90% |
| Contract | workflow/manifest/event/OpenAPI | Vitest + schema | 固定 fixture，防漂移 |
| Contract | `registerNode`/表单解析/`BaseNodeExecutor` | Vitest | 注册、投影、三级解析、基类职责边界 |
| Component | 卡片/Inspector/日志/市场状态 | Vue Test Utils | 关键交互与状态 |
| Boundary | 设计器依赖边界 | ESLint/依赖图 | 禁止业务 feature/执行器/platform/裸 fetch |
| Integration | api/worker/DB/Redis/MinIO | Testcontainers | 真 DB/队列，不 mock 核心 |
| E2E | 创建→编排→草稿预览→发布→固定版本试运行→日志 | Playwright | 主线必绿 |
| Security | SSRF、stdio、密钥泄漏、跨 workspace | 集成/安全 | P0 必跑 |

测试原则：

- 引擎测试不依赖网络/DB。
- Provider/MCP/S3 是外部边界，可 mock；自身实现不 mock。
- 每个 bug 修复带回归测试；每个节点/mode 带 fixture。
- 新增节点必须验证 `registerNode` 后 Palette/Inspector/校验可见，且 web/worker 投影正确。
- 设计器测试不启动后端：使用 `mockPort`；边界测试由 lint/依赖图在 CI 阻断。
- 市场覆盖安装/禁用/卸载/升级/回滚/签名失败/依赖冲突/模板缺依赖。

## 5. CI/CD

```text
install -> license/knip -> lint -> typecheck -> unit
        -> registry/projection check -> integration(postgres/redis) -> build
        -> openapi drift -> e2e（主分支/夜间）
```

- Turbo affected 只跑变更包；主分支全量。
- `pnpm-lock.yaml` 必须同步；CI 不改 lockfile。
- 迁移在空库执行；构建产物 `web/dist`、`server/dist`、`worker/dist`、`coverage`、`openapi.json`。
- 镜像多阶段构建，runtime 非 root；web 用 Nginx 静态；server/worker 用 Node slim。
- 构建期检查：web bundle 不含 `capabilities` 执行器；worker bundle 不含表单组件。

## 6. 性能与可用性预算

- 编辑器首屏 gzip < 800KB（不含按需节点面板）。
- 画布 200 节点拖拽/缩放可用；超过 300 节点启用性能模式。
- 日志 1 万事件滚动可用；只渲染可视区域。
- 预览首事件 < 1s（不含模型首 token）。
- 事件批量写入；token 流不逐 token 写 DB。
- API P95：普通查询 < 300ms；创建 run < 500ms（不含执行）。
- 长于 2s 的操作必须异步化或流式化。

## 7. 安全与供应链

- 允许 MIT/Apache-2.0/BSD/ISC；MPL/LGPL/EPL 需确认；AGPL/SSPL/BUSL 阻断。
- 新增依赖审核维护度、许可证、包体/运行时成本。
- 插件/模板：manifest、checksum、签名、许可证、SBOM。
- 生产镜像固定 digest；非 root；不放 `.env`/密钥/真实数据。
- 无鉴权阶段默认绑定 localhost；公网前必须 API Key/Auth。

## 8. 风险与缓解

| 风险 | 信号 | 缓解 |
| --- | --- | --- |
| 画布复杂度失控 | 编辑态与运行态耦合 | 状态分离；命令栈；先 DAG |
| 设计器与业务耦合 | 页面直接 import 业务 feature | 独立子应用 + Port/Services + 边界 lint |
| 日志写放大 | token 流直接写 DB | 生命周期落库；token 走 Redis；批量渲染 |
| 知识库效果差 | 解析乱、召回低 | 先 5 格式；引用可追溯；小评测集 |
| MCP 安全 | stdio/SSRF | 托管禁 stdio；allowlist；内网拦截 |
| 预览/正式不一致 | 两套执行路径 | 单一引擎 + snapshot |
| 节点膨胀 | 每节点改调度器 | Manifest + 通用 executor；mode 合并 |
| 注册/表单漂移 | 页面与 worker 两份清单 | 单一 `defineNode` + `registerNode`；构建期投影检查 |
| 基类职责失控 | 节点重复写超时/日志/校验 | `execute` 固定流程；`doExecute` 只写业务；契约测试 |
| 无鉴权暴露 | 公网可写 | localhost/CORS/限流；上线前鉴权 |
| 市场供应链 | 恶意插件/签名缺失 | 签名/校验和/版本锁/权限/隔离 runner |
| 包合并后边界糊 | core 变成大杂烩 | 强制 exports 子路径；依赖图检查；超 3 子域拆出 |

## 9. 常用命令（脚手架完成后）

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm db:generate
pnpm db:migrate
pnpm openapi:generate
pnpm compose:up
pnpm compose:down
```

只使用 pnpm；不生成 `package-lock.json`/`yarn.lock`；不手改生成文件。

## 10. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-OPS-01` | P0 | 7 包/4 apps 脚手架与 exports | 依赖图无环、无 deep import |
| `T-OPS-02` | P0 | Turbo 任务 + lint/typecheck/test | 全绿，affected 生效 |
| `T-OPS-03` | P0 | Compose Postgres/Redis/MinIO | 健康检查/迁移可跑 |
| `T-OPS-04` | P0 | OpenAPI 生成 + drift check | 前后端类型一致 |
| `T-OPS-05` | P0 | 迁移空库执行 | CI 阻断不可执行迁移 |
| `T-OPS-06` | P0 | 日志/事件脱敏测试 | 固定快照无密钥 |
| `T-OPS-07` | P0 | 主线 E2E | 创建→预览→发布→固定版本试运行→日志 |
| `T-OPS-08` | P0 | 安全测试：SSRF/stdio/跨 workspace | 阻断项通过 |
| `T-OPS-09` | P0 | 镜像与 Nginx SSE 配置 | compose 生产模式可用 |
| `T-OPS-10` | P1 | 市场/模板测试矩阵 | 安装/回滚/克隆/缺依赖 |
| `T-OPS-11` | P1 | Knip/license/SBOM | CI 阻断高风险依赖 |
| `T-OPS-12` | P1 | 可观测性仪表盘 | 队列/运行/P95/存储 |
| `T-OPS-13` | P0 | 节点注册/表单契约测试 | 注册、投影、三级解析、基类职责 |
| `T-OPS-14` | P0 | 设计器边界 lint + 依赖图检查 | 越界 import 阻断构建 |
| `T-OPS-15` | P0 | 构建期进程投影检查 | web 无执行器；worker 无表单 |

## 11. Definition of Done

- [ ] 产品验收用例通过。
- [ ] 单元/集成/E2E 覆盖关键路径。
- [ ] OpenAPI 与前端 client 已更新。
- [ ] 迁移空库可执行。
- [ ] 日志脱敏检查通过。
- [ ] 设计器边界与进程投影检查通过（web 无执行器、worker 无表单）。
- [ ] 新增节点通过 `registerNode` 注册，表单自动可用；基类契约测试通过。
- [ ] 文档更新（节点 I/O、API、运行说明、测试 CSV）。
- [ ] 插件/模板版本、checksum/签名、权限/依赖检查通过（如涉及）。
- [ ] 无未评估高风险依赖。
- [ ] 不影响 `docs/` 原稿与 `agent/`（如存在）。

## 12. 发布前检查清单

- [ ] `.env`/密钥/真实数据未提交。
- [ ] 生产工作流 pin 版本；无隐式 latest。
- [ ] 发布后试运行绑定显式 `workflowVersionId`；修改草稿不影响当前试运行。
- [ ] SSE 代理关闭 buffering；read timeout 足够。
- [ ] 队列失败/延迟任务有告警或可查。
- [ ] 事件保留期与清理任务生效。
- [ ] artifact 下载有权限校验。
- [ ] 插件代码无主进程执行；网络 allowlist 生效。
- [ ] 模板克隆不自动安装、不写真实密钥。
