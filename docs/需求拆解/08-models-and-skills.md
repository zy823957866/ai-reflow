# 08 模型设置与 Skills

> 优先级：模型连接 P0；Skills P1。
> 注意：本文的 “Skills” 是**产品运行时能力包**，不是 `docs/skills/*` 中面向编码代理的技能。UI 可暂用 Skills 名称，但产品文档需明确区分。
> 相关包：`@ai-reflow/capabilities/providers`、`@ai-reflow/platform`（密钥/DB）、`@ai-reflow/marketplace`（P1 Skills 包）。

## 1. 模块边界

包含：

- 模型连接 CRUD、凭据掩码、模型列表、能力标签、默认模型、fallback、测试连接。
- LLM/Agent/Quality-gate 节点中的模型选择与成本提示。
- P1 Skills：可安装、可授权、可挂载到节点/工作流的能力包。

不包含：

- 模型微调、训练、私有模型部署。
- 计费与账单（P2）。
- 把编码代理的 `docs/skills` 暴露给终端用户。

不变量：

- 模型密钥只在 worker 读取；前端只拿掩码/`secret_ref`。
- 模型连接是 Workspace 级；P0 使用 demo workspace。
- 节点可覆盖模型，但不能突破“允许的模型范围”。
- 已发布工作流固定连接/模型版本；变更需显式提示。
- Skill 只能提供声明式能力（Prompt 片段、工具引用、默认参数），不能静默改节点 I/O schema。
- 代码型 Skill 必须在隔离 runner 执行，遵守插件权限。
- 节点模型选择器是设计器 `DesignerServices.loadModelOptions` 的消费方；设计器组件不直接请求模型接口。
- 模型/能力选项由壳层注入，设计器缺失服务时禁用选择器并提示“未接入”，不伪造默认模型。

## 2. 前端功能

### 2.1 模型连接

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `MODEL-F01` | 模型设置入口 | 侧边栏；显示连接异常数量 |
| `MODEL-F02` | 连接卡片 | 名称、provider、默认模型、状态、延迟、上下文窗口、能力标签 |
| `MODEL-F03` | 新建连接 | provider、baseUrl（可选）、默认模型、凭据 |
| `MODEL-F04` | 编辑连接 | 修改配置；凭据不可回显，只能重新输入 |
| `MODEL-F05` | 凭据掩码 | 只显示名称、类型、末四位/状态；不显示明文 |
| `MODEL-F06` | 模型列表 | provider 返回或手动配置；支持设为默认 |
| `MODEL-F07` | 能力标签 | text/vision/tools/structured/embedding/rerank |
| `MODEL-F08` | 测试连接 | 返回延迟、模型列表、最小调用结果/错误 |
| `MODEL-F09` | 连接状态 | healthy/degraded/failed；不只靠颜色 |
| `MODEL-F10` | 删除连接 | 提示被节点/工作流引用；不可静默删除 |
| `MODEL-F11` | 默认模型 | 连接内设置；节点可覆盖 |
| `MODEL-F12` | Fallback 路由 | 主模型 + fallback 顺序 + 成本阈值 |
| `MODEL-F13` | 成本展示 | 预估 token/费用；来源标注，不伪造实时价格 |
| `MODEL-F14` | 允许模型范围 | 节点设置可限制可选模型/能力 |
| `MODEL-F15` | 节点模型选择器 | 显示当前模型、上下文窗口、能力、预计成本 |
| `MODEL-F16` | 能力不匹配提示 | embedding 模型不能选进 LLM 节点 |
| `MODEL-F17` | 版本提示 | 连接/模型变更对已发布工作流的影响提示 |
| `MODEL-F18` | 错误态 | 凭据失效、限流、超时、模型不存在可读 |

### 2.2 Skills（P1）

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `SKILL-F01` | Skills 入口 | 已安装/目录/详情/挂载关系 |
| `SKILL-F02` | 已安装列表 | 名称、来源、版本、启用状态、调用次数、权限摘要 |
| `SKILL-F03` | 可用目录 | 搜索、分类、作者、许可证、所需模型/密钥 |
| `SKILL-F04` | 详情页 | 描述、权限、依赖、可用节点、示例、变更记录 |
| `SKILL-F05` | 安装前审查 | 权限/依赖/版本/缺失凭据必须展示 |
| `SKILL-F06` | 启用/禁用 | 不删除历史授权与运行记录 |
| `SKILL-F07` | 升级/卸载 | 版本 pin；卸载前展示引用工作流/节点 |
| `SKILL-F08` | 挂载关系 | 哪些工作流/节点使用；避免直接卸载 |
| `SKILL-F09` | 测试 | 最小输入/预期输出/失败态；不写生产数据 |
| `SKILL-F10` | 节点挂载 | 只增加声明式能力；不静默改 I/O |
| `SKILL-F11` | 版本固定 | 生产工作流 pin 版本；latest 只预览 |
| `SKILL-F12` | 权限展示 | 网络/文件/密钥/MCP/代码分组 |

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-MODEL-01` | 连接 CRUD | workspace 隔离；provider 枚举 |
| `B-MODEL-02` | 凭据加密 | AES-256-GCM；只返回掩码/`secret_ref` |
| `B-MODEL-03` | 模型目录 | provider 模型/手填；能力校验 |
| `B-MODEL-04` | 测试连接 | 最小调用、延迟、错误归一化 |
| `B-MODEL-05` | 能力注册 | text/vision/tools/structured/embedding/rerank |
| `B-MODEL-06` | 默认与 fallback | 连接默认 + 节点覆盖；顺序/预算 |
| `B-MODEL-07` | 路由执行 | worker 读取密钥并发起调用；失败切换 fallback |
| `B-MODEL-08` | 版本 pin | 连接版本/模型名进入 snapshot |
| `B-MODEL-09` | 成本统计 | token/cost 按 run/node/provider |
| `B-MODEL-10` | 引用检查 | 删除/禁用连接前查引用 |
| `B-SKILL-01` | 能力包 manifest | 类型/版本/权限/依赖/可用节点 |
| `B-SKILL-02` | 安装/授权 | workspace 级；权限快照 |
| `B-SKILL-03` | 挂载关系 | workflow/node → skill install |
| `B-SKILL-04` | 声明式注入 | Prompt 片段/工具/默认参数；不改 schema |
| `B-SKILL-05` | 隔离执行 | 代码型 Skill 走 runner；资源/网络限额 |
| `B-SKILL-06` | 版本与回滚 | pin、升级、回滚、审计 |
| `B-SKILL-07` | 依赖检查 | requiredModels/Secrets/Plugins/Knowledge |
| `B-SKILL-08` | 测试沙箱 | 不写生产数据 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/POST` | `/api/model-connections` | 列表/新增 |
| `GET/PATCH/DELETE` | `/api/model-connections/:id` | 详情/编辑/删除 |
| `POST` | `/api/model-connections/:id/test` | 测试连接 |
| `GET` | `/api/model-connections/:id/models` | 模型与能力 |
| `GET/POST` | `/api/skills` | P1 目录/已安装 |
| `POST` | `/api/skill-installs` | 安装 |
| `PATCH/DELETE` | `/api/skill-installs/:id` | 启用/禁用/卸载 |
| `POST` | `/api/skill-installs/:id/upgrade` / `rollback` | 升级/回滚 |
| `GET` | `/api/skill-installs/:id/mounts` | 挂载关系 |
| `POST` | `/api/skill-installs/:id/test` | 沙箱测试 |

## 4. 示例

### 4.1 模型连接

```json
{
  "name": "OpenAI 默认",
  "provider": "openai",
  "baseUrl": null,
  "defaultModel": "gpt-4.1-mini",
  "capabilities": ["text", "tools", "structured"],
  "credentialRef": "cred_openai",
  "fallbackOrder": ["anthropic:claude-sonnet"],
  "status": "healthy"
}
```

### 4.2 节点模型覆盖

```json
{
  "modelConnectionId": "mc_openai",
  "model": "gpt-4.1-mini",
  "maxTokens": 2048,
  "temperature": 0.2
}
```

### 4.3 Skill manifest 要点

```json
{
  "id": "skill.support-tone",
  "version": "1.0.0",
  "type": "prompt",
  "permissions": { "network": [], "files": "none", "secrets": [] },
  "requiredModels": [{ "capability": "text" }],
  "availableNodes": ["llm", "agent"],
  "provides": { "promptSnippet": "使用简洁、共情的客服语气。" }
}
```

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-MODEL-01` | P0 | 连接 CRUD + 凭据加密 | 前端只看到掩码 |
| `T-MODEL-02` | P0 | provider 适配 + 测试连接 | 延迟/模型/错误返回正确 |
| `T-MODEL-03` | P0 | 模型能力注册与节点校验 | embedding 不能选入 LLM |
| `T-MODEL-04` | P0 | 节点模型选择器 | 显示能力/上下文/成本提示 |
| `T-MODEL-05` | P0 | 默认模型与 fallback | 失败切换可解释 |
| `T-MODEL-06` | P0 | 成本/token 统计 | 按 run/node 聚合 |
| `T-MODEL-07` | P0 | 删除前引用检查 | 不静默破坏已发布工作流 |
| `T-SKILL-01` | P1 | Skill manifest 与校验 | 权限/依赖/版本必填 |
| `T-SKILL-02` | P1 | 安装/授权/挂载关系 | workspace 隔离，权限可见 |
| `T-SKILL-03` | P1 | 声明式注入 | 不改节点 I/O schema |
| `T-SKILL-04` | P1 | 代码型 Skill 隔离 | 不在主进程执行 |
| `T-SKILL-05` | P1 | 升级/回滚/卸载 | 历史运行可解释 |
| `T-SKILL-06` | P1 | 沙箱测试 | 不写生产数据 |

## 6. 测试关注点

- 凭据保存后不可回显；日志/事件无密钥。
- 模型不存在、限流、超时、fallback 失败。
- 已发布工作流在模型连接变更后仍可解释/可重放。
- Skill 权限变更、依赖缺失、版本回滚、挂载节点删除。
- 代码型 Skill 在 runner 外不可执行。

## 7. 待决策

1. 模型连接是 Workspace 级还是个人级？P0 建议 Workspace demo。
2. 是否展示实时价格？建议展示手动维护的估算价，并标注来源。
3. fallback 是节点级还是全局？建议全局默认 + 节点覆盖，冲突时节点优先并提示。
4. Skills 是否与插件市场同域？建议复用市场基础设施，但独立目录与权限语义。
