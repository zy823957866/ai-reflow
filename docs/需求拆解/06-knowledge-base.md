# 06 知识库

> 优先级：P0。
> 用户目标：上传文档后可被检索；工作流能得到带页码/标题/URL 的引用；失败可重试且原因可见。
> 相关包：`@ai-reflow/capabilities/knowledge`（解析/分块/embedding/检索）、`@ai-reflow/platform`（DB/对象存储/队列）。

## 1. 模块边界

包含：

- 知识库 CRUD、文档上传、对象存储、解析、分块、embedding、pgvector 检索、文件预览。
- 文档状态、失败原因、重试、删除/重建索引。
- 知识库检索测试与引用展示。
- `knowledge.operation=retrieve` 的节点配置；`index` 的索引策略。

不包含：

- 文档正文编辑（P2）。
- OCR 独立服务（P1）。
- 多 embedding 维度/多向量库分片（P1）。
- 复杂评测平台（P1 只做小评测集）。

不变量：

- P0 支持 PDF、Word（`.doc`/`.docx`）、Excel（`.xls`/`.xlsx`）、CSV、Markdown、TXT、HTML。
- 原始文件存 MinIO/S3；DB 只存 `storage_key` 与元数据。
- `document_chunks.embedding` 维度与 `knowledge_bases.embedding_dimension` 一致。
- 所有查询带 `workspace_id`；跨 workspace 不可见。
- 检索必须返回可追溯引用，不只返回拼接文本。
- 切片必须带可定位元数据：页码、工作表/行范围、标题路径或字符偏移。
- 文件预览与切片预览共用同一份文件版本；预览只读，不支持正文编辑。
- 预览文件只通过短期签名 URL 访问；不得暴露对象存储 key 或原始路径。
- 大文件/超页数/超 token 必须明确失败或截断，不能静默。
- 混合检索必须同时返回向量分与全文分（或归一化后的合成分），不能只返回一个黑盒分数。
- 分块策略必须区分 Markdown/纯文本结构：标题层级、段落、列表、代码块不被硬切断。
- rerank 失败必须按配置降级到原始排序，并在事件/响应中标注，不能静默改变结果。

## 2. 前端功能

### 2.1 知识库列表

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `KB-F01` | 知识库列表 | 名称、描述、文档数、chunk 数、embedding 模型、更新时间 |
| `KB-F02` | 新建知识库 | 名称/描述；embedding 模型与维度只读展示（P0 部署级） |
| `KB-F03` | 编辑/删除 | 重命名/描述；删除需二次确认并提示影响节点/工作流 |
| `KB-F04` | 搜索 | 名称/描述；300ms 防抖 |
| `KB-F05` | 空/加载/错误态 | 空态可新建；错误可重试 |
| `KB-F06` | 文档状态汇总 | processing/ready/failed 数量；失败可点击过滤 |
| `KB-F07` | 引用入口 | 哪些工作流/节点使用此知识库（P1） |

### 2.2 知识库详情与上传

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `KB-F08` | 文档列表 | 文件名、类型、大小、状态、chunks、更新时间、错误 |
| `KB-F09` | 拖拽上传 | 拖入/选择文件；显示队列与进度 |
| `KB-F10` | 格式/大小校验 | 前端预检 + 后端强校验；错误可读 |
| `KB-F11` | 上传后状态 | queued → parsing → chunking → embedding → ready/failed |
| `KB-F12` | 失败重试 | 单文档重试/批量重试；保留原文件 |
| `KB-F13` | 删除文档 | 二次确认；同时清理 chunks/向量 |
| `KB-F14` | 文档详情 | 页数/工作表数、标题层级、chunk 列表、metadata、预览入口 |
| `KB-F15` | 切片预览 | 内容、页码/工作表/行范围、标题、token 数、向量状态；支持分页、复制与原文定位 |
| `KB-F16` | 重建索引 | 修改分块/embedding 后重建；显示影响范围 |
| `KB-F17` | 处理日志 | 只读错误原因与阶段；不显示密钥 |
| `KB-F18` | 文档筛选/分页 | 状态、类型、时间；cursor 分页 |

### 2.3 检索测试与节点配置

| 编号 | 功能点 | 交互与验收 |
| --- | --- | --- |
| `KB-F19` | 检索测试台 | 输入 query，设置 topK/阈值/模式，返回结果 |
| `KB-F20` | 结果卡片 | chunk 文本、分数、文档名、页码/标题/URL |
| `KB-F21` | 引用高亮 | 展示 citation id 与可复制引用 |
| `KB-F22` | 检索模式 | vector / keyword / hybrid（P1 可后置） |
| `KB-F23` | rerank 配置 | 开关、模型、topN；无 rerank 时明确说明 |
| `KB-F24` | 节点知识库选择 | 多选 KB；显示 embedding 模型一致性提示 |
| `KB-F25` | Query 编辑器 | Tiptap + 变量 chip；可引用上游问题/上下文 |
| `KB-F26` | 检索参数 | topK、scoreThreshold、mergeStrategy、citationMode |
| `KB-F27` | 索引模式 | documentSource、parser、chunking、upsertPolicy |
| `KB-F28` | 结果预览 | 用 fixture 显示 chunks/citations/context/total |
| `KB-F29` | 降级提示 | 维度不一致/无文档/embedding 失败时阻止运行并说明 |
| `KB-F30` | 文件预览入口 | 文档列表/详情点击文件名打开预览；按 MIME 选择渲染器；支持全屏/关闭 |
| `KB-F31` | PDF 预览 | 页码跳转、缩放、适应宽度、文本搜索；从 citation/chunk 直接跳到对应页 |
| `KB-F32` | Word 预览 | `.docx` 服务端转 HTML/PDF，`.doc` 转 PDF；保留标题层级与分页；转换中显示进度 |
| `KB-F33` | Excel/CSV 预览 | sheet 切换、冻结表头、虚拟滚动、行列范围；CSV 编码/分隔符提示；超限只预览前 N 行 |
| `KB-F34` | 切片与原文联动 | 点击切片高亮 PDF 页、Word 标题、Excel/CSV sheet+行区间；反向点击原文定位切片 |
| `KB-F35` | 双栏预览 | 左侧原文件、右侧切片列表；分隔条可拖拽；选中/滚动同步 |
| `KB-F36` | 预览状态与错误 | `none/converting/ready/failed/unsupported`；失败可重试；不显示空白页 |
| `KB-F37` | 预览限额与降级 | 加密/超大/宏文件明确提示；超出前端行数/页数时只预览分页，不整文件下载 |
| `KB-F38` | 混合检索权重 | vector/keyword/hybrid 切换；hybrid 显示向量/全文权重与合成分 |
| `KB-F39` | 分块策略 | Markdown/文本可选标题/段落/字符窗口；预览分块结果与重叠 |
| `KB-F40` | rerank 降级提示 | rerank 失败时标注“已降级为原始排序”，不静默 |
| `KB-F41` | 检索解释 | 结果卡展示 vectorScore/fulltextScore/rerankScore（可用时） |

### 2.4 文件预览矩阵

| 格式 | 预览实现 | 切片定位 | P0 限制 |
| --- | --- | --- | --- |
| PDF | `pdfjs-dist` 渲染；原文件支持 Range | 页码 + bbox/文本层 | 加密 PDF 拒绝；单文件页数上限 |
| Word `.docx` | `mammoth` 转 HTML，或 LibreOffice 转 PDF | `headingPath` / 页码 | 转换失败可重试 |
| Word `.doc` | LibreOffice 转 PDF | 页码 | 宏/密码/损坏文件拒绝 |
| Excel `.xlsx` / `.xls` | SheetJS 解析为分页 sheet JSON，虚拟表格 | sheet + `rowStart/rowEnd` | 单 sheet 首屏 200 行 |
| CSV | 编码/分隔符探测后分页解析 | sheet（默认）+ 行区间 | 超大文件只分页，不整文件下载 |
| Markdown/TXT/HTML | 服务端安全渲染 HTML | 标题路径/字符偏移 | HTML 消毒，禁脚本 |

Word/Excel 不依赖浏览器原生 Office 渲染；服务端转换后前端只读展示。

## 3. 后端功能

| 编号 | 功能点 | 说明 |
| --- | --- | --- |
| `B-KB-01` | 知识库 CRUD | workspace 隔离；embedding 模型/维度校验 |
| `B-KB-02` | 上传 | 预签名/流式上传到 MinIO；MIME/大小/数量限制 |
| `B-KB-03` | Ingest 队列 | upload → parse → chunk → source-map → embed；preview 异步生成；可重试 |
| `B-KB-04` | 解析器 | PDF（unpdf/pdf-parse）、DOCX（mammoth）、DOC（LibreOffice 转 PDF/HTML）、XLSX/XLS（SheetJS）、CSV（编码/分隔符探测）、HTML（cheerio）、MD/TXT |
| `B-KB-05` | 规范化 | 去噪、空白、编码、标题层级；保留页码/URL |
| `B-KB-06` | 分块 | 标题/段落/字符窗口 + overlap；token 上限 |
| `B-KB-07` | Embedding | Provider adapter；批量、限流、维度固定 |
| `B-KB-08` | 向量写入 | pgvector + HNSW cosine；事务与幂等 |
| `B-KB-09` | 检索 | topK、阈值、向量/关键词/混合；多库合并 |
| `B-KB-10` | Rerank | 可选模型；失败降级策略 |
| `B-KB-11` | 引用 | chunkId、docId、页码/工作表/行范围、标题、URL、score |
| `B-KB-12` | 文档状态 | processing/ready/failed；阶段与错误码 |
| `B-KB-13` | 重试 | 从失败阶段重试；幂等，不重复 chunk |
| `B-KB-14` | 删除/重建 | 清理 chunks/向量/预览产物；重建不产生重复 |
| `B-KB-15` | 限额 | 文件大小、页数/行数、chunk 数、总 token、预览页/行、并发 |
| `B-KB-16` | 评测 | P1：20–50 条问答集，召回率/引用准确率 |
| `B-KB-17` | 文件预览服务 | 按 MIME 分流：PDF Range 流、Word 转 HTML/PDF、Excel/CSV 转分页 sheet JSON；转换结果缓存 |
| `B-KB-18` | 预览产物缓存 | 对象存储保存转换产物；按 `document_hash + converter_version` 失效；删除/重建时清理 |
| `B-KB-19` | 切片定位 | 保存页码、sheet、行区间、标题路径、字符偏移/bbox；提供 chunk → 原文定位 |
| `B-KB-20` | 预览安全 | 短期签名 URL、Range 限制、HTML 消毒、禁宏/禁密码文件、页数/行数上限 |
| `B-KB-21` | 预览状态 | `none/converting/ready/failed`；与 ingest 状态解耦，可单独重试 |
| `B-KB-22` | 混合检索 | 向量 + 全文（tsvector/BM25 等价）加权；分数归一化；权重可配置 |
| `B-KB-23` | 结构化分块 | Markdown 标题/段落/列表/代码块感知；纯文本段落/字符窗口；重叠与 token 上限 |
| `B-KB-24` | rerank 降级 | 超时/失败/无模型时回退原始排序；响应标注 `rerankApplied=false` |
| `B-KB-25` | 检索解释 | 返回各阶段分数与命中原因；不返回内部向量明文 |

### 3.1 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/POST` | `/api/knowledge-bases` | 列表/创建 |
| `GET/PATCH/DELETE` | `/api/knowledge-bases/:id` | 详情/更新/删除 |
| `GET` | `/api/knowledge-bases/:id/documents` | 文档列表/过滤 |
| `POST` | `/api/knowledge-bases/:id/documents` | 上传（multipart/预签名） |
| `GET` | `/api/documents/:id` | 文档详情 |
| `DELETE` | `/api/documents/:id` | 删除文档与向量 |
| `POST` | `/api/documents/:id/retry` | 重试 ingest |
| `POST` | `/api/documents/:id/reindex` | 重建索引 |
| `GET` | `/api/documents/:id/chunks` | chunk 分页 |
| `GET` | `/api/documents/:id/preview` | 预览描述：kind/status/pages/sheets/签名 URL |
| `GET` | `/api/documents/:id/file` | 原文件流；支持 `Range`（PDF） |
| `GET` | `/api/documents/:id/preview/pages/:page` | PDF 单页图/文本层 |
| `GET` | `/api/documents/:id/preview/sheets/:sheet` | Excel/CSV 分页行数据 |
| `GET` | `/api/documents/:id/chunks/:chunkId/source` | 切片原文定位 |
| `POST` | `/api/documents/:id/preview/retry` | 重试预览转换 |
| `POST` | `/api/knowledge-bases/:id/search` | 检索测试 |
| `GET` | `/api/knowledge-bases/:id/stats` | 文档/chunk/失败统计 |

### 3.2 数据与流程

```text
upload -> object storage -> ingest queue -> parse -> normalize -> chunk -> source-map
       -> embedding -> document_chunks(pgvector) -> retrieve -> citations
preview: parse/convert -> preview artifact -> signed URL
```

- `documents.status`：`queued/parsing/chunking/embedding/ready/failed`；`preview_status`：`none/converting/ready/failed`。
- `document_chunks` 存 `content`、`metadata`（页码/sheet/行范围/标题路径/字符偏移/bbox）与 `embedding`。
- `document_previews` 存 `document_id`、`kind`、`storage_key`、`converter_version`、`pages/sheets`、`status`、`error_code`、`expires_at`。
- P0 一个部署固定 embedding 模型/维度；不同维度知识库不能同库检索。
- 检索先做 workspace/KB 过滤，再相似度排序。
- rerank 失败按配置回退到原始排序，并在事件中标注。
- 预览转换异步执行，不阻塞检索；大文件首次打开可能处于 `converting`。

## 4. 示例

### 4.1 检索请求

```json
{
  "query": "退款多久到账？",
  "knowledgeBaseIds": ["kb_support"],
  "topK": 5,
  "scoreThreshold": 0.72,
  "retrievalMode": "hybrid",
  "rerank": { "enabled": false }
}
```

### 4.2 检索响应

```json
{ "total": 1, "citations": [{ "id": "c1", "documentName": "退款政策.pdf", "page": 2 }] }
```

每个 chunk 带 `chunkId`、文档名、页码与分数；返回 `chunks`、`citations`、`context`、`total`。

### 4.3 文件预览描述

```json
{
  "documentId": "doc_refund",
  "previewKind": "pdf",
  "previewStatus": "ready",
  "pages": 12,
  "sheets": [],
  "url": "https://files.example.com/preview/doc_refund.pdf?token=...",
  "expiresAt": "2026-11-20T10:15:00Z"
}
```

### 4.4 Excel/CSV 预览描述

```json
{
  "documentId": "doc_price",
  "previewKind": "sheet",
  "previewStatus": "ready",
  "sheets": [
    { "name": "报价", "rows": 1200, "cols": 18 },
    { "name": "历史", "rows": 300, "cols": 12 }
  ],
  "url": "https://files.example.com/preview/doc_price.json?token=...",
  "pageSize": 100
}
```

### 4.5 切片原文定位

```json
{
  "chunkId": "chk_price_07",
  "documentId": "doc_price",
  "headingPath": ["报价", "2026Q4"],
  "locator": { "type": "sheet", "sheet": "报价", "rowStart": 12, "rowEnd": 18 }
}
```

PDF 使用 `{"type":"pdf","page":2,"bbox":[72,180,520,240]}`；Word 使用 `{"type":"html","headingPath":[...]}` 或转换后的页码定位。

## 5. TODOLIST

| 编号 | 优先级 | 任务 | 验收 |
| --- | --- | --- | --- |
| `T-KB-01` | P0 | KB CRUD + 文档表/迁移 | 空库可迁移，workspace 隔离 |
| `T-KB-02` | P0 | MinIO 上传 + MIME/大小限制 | 超限有稳定错误码 |
| `T-KB-03` | P0 | ingest 队列与状态机 | 失败可从阶段重试 |
| `T-KB-04` | P0 | PDF/Word/Excel/CSV/HTML/MD/TXT 解析 | 9 类格式样例通过 |
| `T-KB-05` | P0 | 分块 + 定位 metadata + 切片预览 | 页码/sheet/行范围/标题可追溯 |
| `T-KB-06` | P0 | embedding + pgvector + HNSW | 检索返回正确排序 |
| `T-KB-07` | P0 | knowledge retrieve 节点 | chunks/citations/context 可用 |
| `T-KB-08` | P0 | 前端列表/详情/上传/状态 | 失败原因与重试可用 |
| `T-KB-09` | P0 | 检索测试台 | topK/阈值/引用可调 |
| `T-KB-10` | P0 | 文档删除/重建索引 | 不产生重复向量 |
| `T-KB-11` | P1 | hybrid + rerank | 失败可降级并记录 |
| `T-KB-12` | P1 | OCR 独立 worker | 不阻塞普通解析 |
| `T-KB-13` | P1 | 小评测集 | 召回率/引用准确率报告 |
| `T-KB-14` | P1 | 多向量库抽象 | 不牺牲 pgvector 可读性 |
| `T-KB-15` | P0 | 文件预览服务（PDF/Word/Excel/CSV） | 6 类格式可打开；doc 转换失败可重试 |
| `T-KB-16` | P0 | 切片预览 + 原文定位 | PDF 页码、Word 标题、Excel sheet/行区间可跳转 |
| `T-KB-17` | P0 | 预览缓存/签名/安全 | 签名过期、Range、HTML 消毒、缓存失效通过 |
| `T-KB-18` | P1 | 预览增强（缩略图/全文搜索） | 不阻塞首屏与检索 |
| `T-KB-19` | P1 | 混合检索加权 + 分数解释 | vector/fulltext 权重可配；结果可解释 |
| `T-KB-20` | P0 | Markdown/文本结构化分块 | 标题/段落/代码块不被硬切断；重叠正确 |
| `T-KB-21` | P1 | rerank 降级与标注 | 失败回退原始排序；响应标注 |

## 6. 测试关注点

- 6 类格式预览：PDF、DOC、DOCX、XLS、XLSX、CSV；空文件、加密 PDF、损坏 DOC、超大表格、CSV GBK/UTF-8、宏文件。
- 切片定位：PDF 页码/bbox、Word 标题、Excel/CSV sheet+行区间；点击切片能定位原文。
- 预览安全：签名 URL 过期、Range 限制、HTML 消毒、对象存储 key 不泄漏。
- 预览与检索并发：preview=converting 不影响 retrieve=ready。
- 重复上传/删除后重建/失败重试的幂等。
- 维度不一致、知识库为空、query 为空、topK 超限。
- 多知识库合并、引用顺序、页码/标题正确。
- 向量检索跨 workspace 隔离。
- 混合检索权重变化影响排序；分数解释与最终排序一致。
- Markdown 标题/代码块/列表不被硬切断；纯文本重叠正确。
- rerank 超时/模型缺失时回退原始排序并标注。

## 7. 待决策

1. P0 是否支持 hybrid？建议先 vector，P1 加 hybrid/rerank。
2. 文档删除是否保留历史引用？建议运行历史保留 citation 快照，文档删除不破坏历史。
3. embedding 模型是部署级还是 KB 级？P0 建议部署级固定，P1 再分片。
4. OCR 是否 P0？建议 P1 独立 worker，避免拖慢上传。
5. 旧 `.doc` 预览是否 P0 支持？建议 P0 用 LibreOffice worker 转 PDF；若部署不允许 LibreOffice，则明确只支持 `.docx`。
6. Excel/CSV 预览上限？建议单 sheet 首屏 200 行、分页加载，超过 10 万行只提供分页。
7. 预览产物生成时机？建议文档 ready 后异步生成并缓存，首次打开显示 converting。
