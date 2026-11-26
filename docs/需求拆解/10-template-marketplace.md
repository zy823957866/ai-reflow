# 10 模板市场

> 优先级：P1，与插件市场共用 registry 基础设施，但模板与插件严格分离。
> 用户目标：用户能预览模板、看到缺失依赖、克隆为**新草稿**，且不会覆盖现有工作流或写入真实密钥。
> 相关包：`@ai-reflow/marketplace/registry`、`@ai-reflow/core/workflow`、`apps/server`。

## 1. 模块边界

包含：

- 模板目录、搜索/分类/筛选、模板详情、节点图预览、示例输入输出。
- 依赖清单：requiredPlugins/Models/Secrets/Knowledge/schemaVersion。
- 克隆计划与克隆向导：依赖检查、占位密钥、生成新草稿、记录 forkOf。
- 克隆结果：缺失依赖、需配置项、直接打开/预览。

不包含：

- 自动安装插件或写真实密钥。
- 覆盖用户现有工作流。
- 模板编辑/创作者工作台（P2）。
- 社区审核/评分/付费（P2）。

不变量：

- 克隆生成新草稿，不覆盖现有工作流。
- 模板包必须带 `schemaVersion`、`requiredPlugins`、`requiredModels`、`requiredSecrets`、`requiredKnowledge`、`license`、`author`、`forkOf`。
- 克隆前必须展示缺失依赖；不能等到运行才报错。
- 模板中的模型/密钥使用占位符；不导入真实密钥。
- 不自动安装依赖插件；必须用户确认。
- 导入后必须能进入预览；缺依赖标记“需配置”。
- 模板节点图预览必须复用设计器只读模式（`apps/web/src/workflow` 的 `mode=readonly/preview`，见 12），不另写一套画布。
- 模板包必须记录节点 `type + version` 依赖；克隆/预览前检查内置节点版本与插件节点是否可用。
- 未知节点类型、缺失插件节点、版本不兼容必须显式报错并阻止克隆，不能静默丢弃节点。

## 2. 前端功能

### 2.1 模板目录

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `TPL-F01` | 模板市场入口 | 首页“从模板开始” + 侧边栏市场入口 |
| `TPL-F02` | 目录列表 | 卡片：名称、作者、类型、版本、许可证、所需插件/模型 |
| `TPL-F03` | 搜索 | 名称/描述/作者/标签；300ms 防抖 |
| `TPL-F04` | 分类筛选 | Workflow/Agent/Chat/Prompt/Knowledge/节点组合包 |
| `TPL-F05` | 标签筛选 | 业务域、模型、知识库、MCP |
| `TPL-F06` | 排序 | 推荐/最近更新/名称/使用量 |
| `TPL-F07` | 模板卡片预览 | 节点缩略图/预览图；不渲染完整画布 |
| `TPL-F08` | 空/错/加载态 | 空态推荐分类；错误可重试 |
| `TPL-F09` | 深链详情 | URL 直达，可从工作流创建页跳转 |

### 2.2 模板详情与克隆

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `TPL-F10` | 详情头部 | 名称、作者、版本、许可证、类型、描述 |
| `TPL-F11` | 节点图预览 | 只读画布/缩略图；节点类型与分支可见 |
| `TPL-F12` | 能力说明 | 适用场景、示例输入/预期输出 |
| `TPL-F13` | 版本列表 | 版本、发布时间、schemaVersion、依赖 |
| `TPL-F14` | 依赖清单 | 插件/模型/密钥/知识库/缺失状态 |
| `TPL-F15` | 使用模板按钮 | 先进入 clone plan，不直接克隆 |
| `TPL-F16` | Clone plan 抽屉 | 缺失依赖、需配置项、目标 workspace、名称 |
| `TPL-F17` | 占位密钥说明 | 明确“需配置后运行”，不写真实密钥 |
| `TPL-F18` | 克隆确认 | 生成新草稿；不覆盖同名/现有工作流 |
| `TPL-F19` | 克隆结果 | 成功/部分缺失/失败；提供打开编辑器/预览 |
| `TPL-F20` | 需配置标记 | 缺插件/模型/密钥/知识库时卡片/详情显示 |
| `TPL-F21` | forkOf 展示 | 来源模板/版本；支持后续对比（P1） |
| `TPL-F22` | 预览入口 | 克隆后直接预览；缺依赖明确阻止并指引 |
| `TPL-F23` | 示例导入 | 示例输入填充预览表单；不写运行历史 |
| `TPL-F24` | 重复克隆 | 每次生成新 workflow；nodeId 可重映射 |
| `TPL-F25` | 只读设计器预览 | 复用设计器 `mode=readonly`；节点/边/分支可见，不暴露编辑与密钥 |
| `TPL-F26` | 节点版本依赖 | 展示模板使用的节点 type+version；不兼容时标记 |
| `TPL-F27` | 插件节点缺失 | 缺失插件节点显示“需安装插件”，阻止克隆或标记需配置 |
| `TPL-F28` | 预览示例运行 | P1：用示例输入只读预览运行；不写真实运行历史 |

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-TPL-01` | 模板目录 | kind/name/author/license/summary/preview/visibility |
| `B-TPL-02` | 模板版本 | manifest、bundleKey、schemaVersion、required_* |
| `B-TPL-03` | 模板包校验 | schemaVersion、workflow JSON、预览资源、许可证 |
| `B-TPL-04` | 依赖检查 | plugins/models/secrets/knowledge 与 workspace 现状 |
| `B-TPL-05` | clone plan | 缺失依赖、需配置项、目标名称、冲突检查 |
| `B-TPL-06` | 克隆 | 生成新草稿；nodeId 重映射；记录 forkOf |
| `B-TPL-07` | 占位密钥 | 只生成 placeholder/secretRef 提示，不写真实值 |
| `B-TPL-08` | 不覆盖 | 同名工作流自动加后缀或要求改名 |
| `B-TPL-09` | 导入记录 | template_imports：workspace、version、workflow、missing_dependencies |
| `B-TPL-10` | 依赖确认 | 不自动安装插件；返回需用户确认项 |
| `B-TPL-11` | 模板预览 | 解析 workflow + previewGraph；不返回运行数据 |
| `B-TPL-12` | 来源版本 | forkOf + 来源版本，支持后续 diff（P1） |
| `B-TPL-13` | 只读预览投影 | 复用设计器只读模式；返回定义 + previewGraph，不含运行数据/密钥 |
| `B-TPL-14` | 节点版本检查 | 校验内置节点 type/version 与插件节点可用性；不兼容阻止克隆 |
| `B-TPL-15` | 插件节点依赖 | 缺失插件节点列出 pluginId/version；不自动安装 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/templates` | 模板列表/筛选 |
| `GET` | `/api/templates/:id` | 详情 |
| `GET` | `/api/templates/:id/versions/:version` | 指定版本/依赖 |
| `POST` | `/api/templates/:id/clone-plan` | 依赖检查/冲突/目标名称 |
| `POST` | `/api/templates/:id/clone` | 克隆到 workspace |
| `GET` | `/api/template-imports/:id` | 导入结果/缺失依赖 |

## 4. 示例

### 4.1 模板 manifest

```yaml
id: com.example.support-triage
name: 客服工单分类
version: 1.0.0
type: workflow
schemaVersion: 1
author: example
license: MIT
description: 工单分类 + 优先级 + 回复草稿
requiredPlugins:
  - id: com.example.crm
    version: "^1.0.0"
requiredModels:
  - capability: text
    suggested: openai:gpt-4.1-mini
requiredSecrets:
  - CRM_API_KEY
requiredKnowledge:
  - name: 客服知识库
    embeddingDimension: 1024
workflow: workflow.json
examples:
  - input.json
  - expected-output.json
```

### 4.2 Clone plan

```json
{
  "templateId": "com.example.support-triage",
  "version": "1.0.0",
  "targetName": "客服工单分类（副本）",
  "missingDependencies": [
    { "type": "plugin", "id": "com.example.crm", "required": "^1.0.0" },
    { "type": "secret", "key": "CRM_API_KEY" }
  ],
  "warnings": ["克隆后需配置 CRM 凭据才能预览"],
  "willAutoInstall": false,
  "willWriteSecrets": false
}
```

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-TPL-01` | P1 | 模板目录/版本表与 seed | 可浏览/筛选/搜索 |
| `T-TPL-02` | P1 | 模板 manifest 校验 | schemaVersion/required_* 必填 |
| `T-TPL-03` | P1 | clone plan 依赖检查 | 缺失依赖可读，不自动安装 |
| `T-TPL-04` | P1 | 克隆生成新草稿 | 不覆盖现有，nodeId 重映射 |
| `T-TPL-05` | P1 | 占位密钥/模型 | 不写真实密钥 |
| `T-TPL-06` | P1 | 模板详情/节点图预览 | 只读，不返回运行数据 |
| `T-TPL-07` | P1 | 克隆结果与需配置标记 | 可打开/预览，缺依赖有指引 |
| `T-TPL-08` | P1 | forkOf/来源版本 | 可追溯，支持后续 diff |
| `T-TPL-09` | P1 | 重复克隆/同名冲突 | 每次新工作流，名称不冲突 |
| `T-TPL-10` | P1 | 模板导入后预览 | 缺依赖明确阻止 |
| `T-TPL-11` | P1 | 只读设计器预览复用 | 与编辑器同一渲染；不暴露编辑/密钥 |
| `T-TPL-12` | P1 | 节点 type+version 依赖检查 | 不兼容/未知节点阻止克隆 |
| `T-TPL-13` | P1 | 插件节点缺失检查 | 列出 pluginId/version；不自动安装 |

## 6. 测试关注点

- 缺插件/模型/密钥/知识库的 clone plan。
- 同名工作流、重复克隆、nodeId 重映射。
- 模板含真实密钥/base64/未知节点/旧 schemaVersion。
- 克隆后直接预览；缺依赖时“需配置”而不是运行时崩溃。
- 不覆盖现有工作流；forkOf 记录正确。
- 模板预览复用只读设计器；不能编辑、不能看到密钥。
- 未知节点/旧节点版本/缺失插件节点阻止克隆并给出原因。

## 7. 待决策

1. 模板是否允许内嵌插件包？建议只声明依赖，不内嵌代码。
2. 克隆同名策略？建议自动后缀 + 允许用户改名。
3. 模板更新是否影响已克隆草稿？建议不影响，只提示 diff。
4. 模板市场是否 P1 首发？建议与插件市场共用 registry，但分开验收。
