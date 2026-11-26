# AI Reflow MinIO/S3 附件上传设计

## 目标

统一实现知识库文档与工作流通用附件上传。浏览器通过 multipart 将文件提交
到 API，API 将文件写入 MinIO 或 S3 兼容对象存储。MinIO 保持内网访问，
客户端的 FileRef 不包含对象存储 key、预签名 URL 或 base64 正文。

知识库本期只完成可靠入库和 `queued` 文档记录，不实现解析、分块、
embedding、预览或 ingest worker。

## 非目标

- 不实现本地文件系统 fallback。
- 不实现自动过期、病毒扫描、文档转换或向量索引。
- 不改变当前无认证、默认 workspace 的部署模式。
- 不向浏览器暴露 MinIO 端点或对象存储 key。

## 选定方案

- 本地 Compose 使用 MinIO，生产通过 `S3_*` 环境变量切换 S3 兼容服务。
- 使用服务端中转上传，单文件上限 50 MiB，一次请求一个文件。
- 通用附件落 `file_assets`，知识库文件继续落 `documents`，运行产物继续落
  `artifacts`。
- 文件正文由 API 从对象存储读取并流式下载，不返回签名 URL。
- FileRef 固定为 `{ id, name, mime, size, sha256? }`。
- JSON Schema 使用 `format: "file-ref"`；数组字段在 `items` 上声明该格式。
- 同一知识库内相同 SHA-256 重复上传返回已有文档并标记 `deduplicated`。
- 文件默认永久保留，只通过显式删除接口清理。

## 文件策略

允许 PDF、DOC/DOCX、XLS/XLSX、CSV、Markdown、TXT、HTML、PNG、JPEG、
WebP。知识库不接受图片。服务端校验扩展名、客户端 MIME 和可识别的内容
签名，并清理原文件名中的路径和控制字符。

错误码保持稳定：`OBJECT_STORAGE_NOT_CONFIGURED`、`FILE_REQUIRED`、
`FILE_TOO_LARGE`、`FILE_TYPE_NOT_ALLOWED`、`FILE_NAME_INVALID`、
`FILE_NOT_FOUND`、`OBJECT_STORAGE_ERROR`。

## 接口

- `POST /api/files` 上传通用附件。
- `DELETE /api/files/:id` 删除附件与对象。
- `GET /api/files/:id/content` 流式下载附件。
- `POST /api/knowledge-bases/:id/documents` 上传知识库文档。
- `GET /api/documents/:id/file` 流式下载知识库原文件。

所有查询强制带 `workspace_id`。运行创建前校验输入 Schema 中的 FileRef，
并用数据库内容规范化引用，防止伪造 ID 或跨 workspace 访问。

## 部署

Compose 增加 MinIO、bucket 初始化服务和持久化卷。MinIO 仅绑定
`127.0.0.1`；server/worker 使用 `http://minio:9000`。Nginx 上传上限约
55 MiB，并为 multipart 预留额外空间。

## 验收

- 完整、缺失和部分错误的对象存储配置行为明确。
- 两种上传、下载、去重和删除均通过真实 MinIO 集成测试。
- 非法文件、超限、伪造引用、跨 workspace 和存储故障稳定失败。
- Web、server、worker 类型检查与构建通过。
- Playwright 验证设计器、试运行台和知识库页面在桌面与移动端可用。
