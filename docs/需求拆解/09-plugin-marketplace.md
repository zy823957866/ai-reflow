# 09 插件市场

> 优先级：P1（M7）。首个切片使用官方 seed catalog。
> 用户目标：用户能判断插件是什么、需要什么权限、会影响哪些工作流，并能安全安装/禁用/升级/回滚/卸载。
> 相关包：`@ai-reflow/marketplace/registry`、`@ai-reflow/marketplace/plugin-sdk`、`@ai-reflow/core/node`（插件节点注册）、`apps/plugin-runner`；设计器表单链路见 12。

## 1. 模块边界

包含：

- 官方 seed catalog 浏览、搜索、类型/兼容性筛选、排序。
- 插件详情：版本、能力、权限、依赖、签名、许可证、更新记录。
- 安装计划：依赖解析、版本变化、权限清单、缺失凭据、影响工作流。
- 安装、配置凭据、启用/禁用、卸载、升级、回滚、审计。
- 市场设置：catalog 源、签名策略、网络 allowlist、同步状态。

不包含：

- 社区提交、审核、评分、评论、付费、开发者门户（P2）。
- 模板市场（见 10）。
- 在 web/api/worker 主进程执行第三方代码。
- 直接 npm 安装或自动跟随“最新版本”。

不变量：

- 一个 workspace 内同一 `entry_id` 只保留一个活跃安装记录。
- 安装记录固定 `entry_id + version`；升级/回滚产生新审计事件。
- 安装前必须生成并确认安装计划；没有 `planId` 不得安装。
- 签名缺失/checksum 不匹配/许可证阻断/依赖冲突时禁止安装。
- 凭据只存 `secret_ref`，前端只显示掩码。
- 禁用不删除凭据/历史权限；卸载不删除历史运行/审计。
- 代码型插件只在 `plugin-runner` 执行；网络按 host allowlist。
- 插件提供的节点必须通过 `registerNode()` 注册，节点类型命名 `plugin:<pluginId>:<nodeType>`，不得占用内置 type。
- 插件节点表单优先 JSON Schema；自定义表单组件在沙箱渲染，仍按 `configSchema` 校验；表单通过设计器表单注册链路接入（见 12）。
- 插件启用/禁用/升级/卸载必须同步 `registerNode`/`unregisterNode`；已打开工作流保留只读快照。
- 插件执行器只能访问权限代理（网络/文件/密钥/MCP），不得直接读取宿主环境。

## 2. 前端功能

### 2.1 市场首页与目录

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MKT-F01` | 全局入口 | 侧边栏“插件市场”；显示可更新/待配置徽标 |
| `MKT-F02` | 市场一级视图 | 发现 / 已安装两个一级入口 |
| `MKT-F03` | 搜索 | 名称/描述/发布者；300ms 防抖 |
| `MKT-F04` | 类型筛选 | 全部/工具/工具包/模型/数据源/触发器/节点包 |
| `MKT-F05` | 次级筛选 | 官方/已验证、兼容当前版本、已安装、可更新 |
| `MKT-F06` | 排序 | 推荐/最近更新/名称/安装量 |
| `MKT-F07` | 插件卡片 | 图标、名称、类型、发布者、价值说明、版本、兼容性、许可证 |
| `MKT-F08` | 安装状态叠加 | 已安装版本、启用状态、更新徽标 |
| `MKT-F09` | 主操作 | 查看详情/安装/配置/更新/启用；随状态变化 |
| `MKT-F10` | 空态 | 清除筛选 + 推荐分类 |
| `MKT-F11` | 错误态 | catalog 失败可重试，不显示为空 |
| `MKT-F12` | 深链 | 详情页 URL 直达，可从 Inspector/审计跳转 |
| `MKT-F13` | 窄屏布局 | 卡片网格转单列 |
| `MKT-F14` | 键盘与焦点 | 筛选/排序/卡片可键盘操作；抽屉焦点回收 |

### 2.2 插件详情

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MKT-F15` | 详情头部 | 图标、名称、发布者、类型、最新版本、描述、许可证 |
| `MKT-F16` | 签名/校验状态 | 已验证/未签名/失败；不能只靠颜色 |
| `MKT-F17` | 兼容性 | 应用版本、引擎版本、schemaVersion |
| `MKT-F18` | 概览 Tab | 能力、示例、支持节点/工具、最近更新 |
| `MKT-F19` | 版本 Tab | 版本列表、发布时间、兼容性、弃用、变更记录 |
| `MKT-F20` | 能力 Tab | 工具/模型/数据源/触发器/节点包清单 |
| `MKT-F21` | 权限 Tab | 网络 host、文件、密钥、MCP、代码、资源限额 |
| `MKT-F22` | 依赖 Tab | 依赖插件/版本范围；冲突高亮 |
| `MKT-F23` | 右侧安装卡 | 版本选择、大小、checksum、签名、许可证、已安装版本 |
| `MKT-F24` | 查看安装计划 | 没有计划不得直接安装 |

### 2.3 安装计划与权限审查

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MKT-F25` | 计划抽屉五段 | 版本与影响、依赖、权限、凭据、确认 |
| `MKT-F26` | 版本与影响 | action、from/toVersion、受影响工作流数量 |
| `MKT-F27` | 依赖解析 | 新增/升级/降级/跳过依赖；冲突链可读 |
| `MKT-F28` | 权限分组 | 网络/文件/密钥/MCP/代码/资源限额 |
| `MKT-F29` | 凭据检查 | 缺失/已配置/将失效；配置入口 |
| `MKT-F30` | 高风险确认 | 代码执行、写文件、MCP、敏感 host 显式确认 |
| `MKT-F31` | 阻断条件 | checksum/签名/许可证/依赖/废弃版本阻止确认 |
| `MKT-F32` | 确认安装 | 提交 planId + 幂等键；重复点击不重复安装 |
| `MKT-F33` | 计划过期 | 重新计算；不复用旧版本计划 |
| `MKT-F34` | 进度反馈 | 安装/升级/回滚显示当前步骤与错误 |

### 2.4 已安装管理

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MKT-F35` | 已安装列表 | 插件、版本、启用状态、凭据状态、更新状态、影响工作流 |
| `MKT-F36` | 状态徽标 | config_required / update_available / degraded / failed |
| `MKT-F37` | 筛选 | 全部/已启用/已禁用/需配置/可更新/异常 |
| `MKT-F38` | 配置凭据 | 只显示掩码、有效期、最近验证 |
| `MKT-F39` | 启用/禁用 | 禁用不删除凭据/历史授权 |
| `MKT-F40` | 检查更新 | 有更新进入升级计划；不自动升级 |
| `MKT-F41` | 回滚 | 回到已验证版本；展示审计 |
| `MKT-F42` | 卸载 | 先展示影响工作流 + 历史保留说明 |
| `MKT-F43` | 审计 | 安装/权限/配置/升级/回滚/卸载记录 |

### 2.5 市场设置与异常

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MKT-F44` | 设置页 | catalog 源、同步状态、ETag/错误 |
| `MKT-F45` | 签名策略 | 严格要求/管理员放行/仅警告 |
| `MKT-F46` | 网络策略 | allowlist、内网/回环默认拒绝 |
| `MKT-F47` | 默认策略 | 只提示更新，不自动升级 |
| `MKT-F48` | 安装中断 | 保持可恢复状态；重连后查询服务端结果 |
| `MKT-F49` | 插件下架 | 已安装可继续；禁止新安装/升级 |
| `MKT-F50` | 凭据过期 | 转 degraded，提示受影响工作流 |

### 2.6 插件节点与表单

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MKT-F51` | 插件节点注册 | 启用后节点出现在 Palette；type 为 `plugin:<pluginId>:<nodeType>`；禁用后从 Palette 移除 |
| `MKT-F52` | 表单自动注册 | 插件 manifest 的 `form`（JSON Schema 优先）自动进入 Inspector；无表单显示只读兜底 |
| `MKT-F53` | 表单组件沙箱 | 自定义表单组件在沙箱运行；不直接访问宿主 DOM/密钥；仍按 schema 校验 |
| `MKT-F54` | 权限代理 | 插件执行器只通过权限代理访问网络/文件/密钥/MCP；越权明确拒绝 |
| `MKT-F55` | 生命周期同步 | 安装/启用/升级/禁用/卸载同步注册表；已打开工作流保留只读快照 |
| `MKT-F56` | 插件触发器（P2） | 触发器插件与 `start` 解耦；默认面板不混入 `plugin-trigger`，运行前显示幂等、重放、回压与权限策略 |

> 该类型是 05 节点目录的 P2 候选，不是默认面板节点；只有在通过 05 的准入规则后，才按本节的插件生命周期注册、展示与执行。

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-MKT-01` | Seed catalog | 12 个官方/已验证条目；类型/版本/清单 |
| `B-MKT-02` | Registry 查询 | kind/关键词/分类/兼容性分页 |
| `B-MKT-03` | Manifest 校验 | Zod + JSON Schema；必填字段 |
| `B-MKT-04` | semver 解析 | 依赖范围、冲突、升级/降级/跳过 |
| `B-MKT-05` | 安装计划 | 权限/依赖/凭据/影响工作流快照 + planId |
| `B-MKT-06` | checksum/签名 | SHA-256；签名策略；阻断原因 |
| `B-MKT-07` | 许可证策略 | 阻断级/谨慎级；CI/安装检查 |
| `B-MKT-08` | 安装记录 | workspace 级、固定版本、previousVersion |
| `B-MKT-09` | 凭据 | `secret_ref`；OAuth/API Key/Bearer |
| `B-MKT-10` | 权限授权 | 安装时快照；高风险显式确认 |
| `B-MKT-11` | 生命周期 | install/configure/enable/disable/upgrade/rollback/uninstall |
| `B-MKT-12` | 审计 | 动作、actor、metadata（无密钥） |
| `B-MKT-13` | 幂等 | 写操作 Idempotency-Key + planId |
| `B-MKT-14` | 引用影响 | 计算锁定该插件的工作流 |
| `B-MKT-15` | catalog 同步 | P1 远程源、ETag、私有源 |
| `B-MKT-16` | 隔离执行 | plugin-runner；CPU/内存/时间/网络限额 |
| `B-MKT-17` | 失败恢复 | 升级失败回滚 previousVersion；半安装清理 |
| `B-MKT-18` | 下架/弃用 | 已安装可见；新安装/升级受限 |
| `B-MKT-19` | 插件节点注册 | `plugin:<pluginId>:<nodeType>`；启用注册/禁用注销；禁止覆盖内置 type |
| `B-MKT-20` | 插件表单投影 | manifest `form`（JSON Schema/component）投影；schema 校验强制 |
| `B-MKT-21` | 组件沙箱 | 自定义表单在沙箱渲染；CSP/权限限制；无宿主密钥 |
| `B-MKT-22` | 权限代理 | 网络/文件/密钥/MCP 代理；按安装快照授权；越权拒绝并审计 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/registry/entries` | 目录查询/分页 |
| `GET` | `/api/registry/entries/:id` | 详情/版本列表 |
| `GET` | `/api/registry/entries/:id/versions/:version` | 指定 manifest |
| `POST` | `/api/registry/install-plan` | 计算安装/升级/回滚计划 |
| `GET` | `/api/plugin-installs` | 已安装列表 |
| `GET` | `/api/plugin-installs/:id` | 详情/凭据/权限快照 |
| `GET` | `/api/plugin-installs/:id/audit` | 审计 |
| `POST` | `/api/plugin-installs` | 按 planId 安装 |
| `PATCH` | `/api/plugin-installs/:id` | 启用/禁用/配置凭据 |
| `POST` | `/api/plugin-installs/:id/upgrade` | 升级 |
| `POST` | `/api/plugin-installs/:id/rollback` | 回滚 |
| `DELETE` | `/api/plugin-installs/:id` | 卸载 |
| `POST` | `/api/registry/sync` | P1 同步 |
| `GET` | `/api/registry/sync-status` | 同步状态 |

### 3.2 数据

- `registry_entries`：id、kind、name、publisher、summary、visibility、verified。
- `registry_versions`：entry/version、manifest、tarball_key、checksum、signature、license、compatibility、deprecated。
- `plugin_installs`：workspace、entry、version、status、enabled、previousVersion。
- `plugin_credentials`：install、key、authType、secretRef、expiresAt、verifiedAt。
- `plugin_permissions`：install、permission、value、grantedAt。
- `plugin_audit_events`：workspace、install、action、actor、metadata。

所有查询带 `workspace_id`；写操作带幂等键；manifest 保留版本快照，不随 registry 更新。

## 4. 示例

### 4.1 安装计划

```json
{
  "planId": "plan_01",
  "action": "install",
  "fromVersion": null,
  "toVersion": "1.2.0",
  "dependencies": [{ "id": "com.example.core", "version": "1.0.0" }],
  "conflicts": [],
  "permissions": {
    "network": ["api.example.com"],
    "files": "none",
    "secrets": ["EXAMPLE_API_KEY"],
    "mcp": false,
    "code": false
  },
  "credentials": [{ "key": "EXAMPLE_API_KEY", "state": "missing", "required": true }],
  "affectedWorkflows": 3,
  "verification": { "checksum": "ok", "signature": "verified", "license": "MIT" }
}
```

### 4.2 安装状态

```text
not_installed -> planning -> installing -> config_required -> enabled
enabled <-> disabled
enabled/disabled -> update_available -> planning -> installing -> enabled
enabled/disabled/degraded -> rolling_back -> enabled/disabled
any -> uninstalling -> not_installed
```

## 5. 交付切片

| 切片 | 范围 | 验收 |
| --- | --- | --- |
| S1 目录与详情 | seed catalog、筛选/搜索/排序、详情/版本/权限/依赖 | 能判断插件是什么、需要什么权限 |
| S2 安装计划 | 依赖、版本、权限、凭据、影响工作流、阻断条件 | 没有计划不能安装 |
| S3 已安装生命周期 | 凭据、启用/禁用、卸载、审计 | 禁用/卸载不破坏历史 |
| S4 更新与策略 | 检查更新、升级、回滚、签名/许可证策略 | 升级失败可回滚 |
| S5 远程与隔离 | 远程同步、私有源、plugin-runner、allowlist | 代码插件不在主进程执行 |

## 6. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-MKT-01` | P1 | registry 表 + seed catalog | 12 条目可查询 |
| `T-MKT-02` | P1 | manifest/semver/依赖解析 | 冲突链可读，阻断安装 |
| `T-MKT-03` | P1 | checksum/签名/许可证策略 | 失败默认拒绝 |
| `T-MKT-04` | P1 | 安装计划 API + planId | 计划绑定版本/权限/workspace |
| `T-MKT-05` | P1 | 安装/配置/启用/禁用/卸载 | 生命周期状态正确 |
| `T-MKT-06` | P1 | 凭据加密与掩码 | 前端无明文 |
| `T-MKT-07` | P1 | 审计事件 | 动作可追溯，无密钥 |
| `T-MKT-08` | P1 | 升级/回滚 | 失败恢复 previousVersion |
| `T-MKT-09` | P1 | 市场前端 S1-S4 | 状态/错误/空态/键盘完整 |
| `T-MKT-10` | P1 | plugin-runner 接入 | 代码插件隔离/限额/网络策略 |
| `T-MKT-11` | P1 | 远程 sync + ETag + 私有源 | 计划过期需重算 |
| `T-MKT-12` | P1 | 引用影响计算 | 卸载前展示受影响工作流 |
| `T-MKT-13` | P1 | 插件节点 `registerNode`/`unregisterNode` | 启用可见、禁用移除；不覆盖内置 |
| `T-MKT-14` | P1 | 插件表单投影 + SchemaForm | JSON Schema 生效；自定义组件仍校验 |
| `T-MKT-15` | P1 | 表单组件沙箱 | 无宿主 DOM/密钥访问；CSP 生效 |
| `T-MKT-16` | P1 | 权限代理 | 网络/文件/密钥/MCP 越权被拒并审计 |

## 7. 测试关注点

- 依赖冲突、checksum 失败、签名缺失、许可证阻断、版本弃用。
- 计划过期、幂等键冲突、重复安装、半安装恢复。
- 缺凭据安装到 `config_required`，不能启用。
- 禁用/卸载后历史运行/审计保留；跨 workspace 404。
- 代码插件无主进程加载；网络仅允许 manifest host。
- 插件节点启用后出现在 Palette，禁用后移除；type 不覆盖内置节点。
- 插件表单 JSON Schema 生效；自定义组件在沙箱运行且仍按 schema 校验。
- 插件执行器越权访问网络/文件/密钥/MCP 被拒并审计。
- 升级/卸载同步注册表；已打开工作流保留只读快照不崩溃。

## 8. 待决策

1. 更新是否自动？建议只提示，不自动升级。
2. 卸载被工作流引用时强制阻止还是允许并标记？建议展示影响并要求确认。
3. 签名默认策略？建议严格要求；管理员放行需显式配置。
4. seed catalog 数量？建议先 12 个，覆盖模型/工具包/数据源/触发器/节点包。
