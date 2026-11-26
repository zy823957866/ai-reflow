# MinIO/S3 附件上传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为知识库文档和工作流附件提供可靠的 MinIO/S3 上传、引用、下载和删除能力。

**Architecture:** 服务端持有唯一对象存储适配器；通用附件元数据落
`file_assets`，知识库沿用 `documents`。浏览器只拿 FileRef，正文下载始终经过
API。运行创建时按输入 Schema 校验并规范化 FileRef。

**Tech Stack:** TypeScript、NestJS、Drizzle/PostgreSQL、AWS SDK S3 v3、
MinIO、Vue 3、Playwright、Node test runner、tsx。

**Spec:** `docs/superpowers/specs/2026-11-26-minio-s3-attachment-upload-design.md`

## Global Constraints

- 单文件上限固定为 `50 * 1024 * 1024` 字节，单请求只接受一个文件。
- 允许 PDF、DOC/DOCX、XLS/XLSX、CSV、Markdown、TXT、HTML、PNG、JPEG、
  WebP；知识库不接受图片。
- FileRef 固定字段为 `id`、`name`、`mime`、`size`、可选 `sha256`。
- 客户端、日志和错误响应不得包含 `storage_key`、access key、secret 或 bucket key。
- 所有附件与文档查询必须带 workspace 条件。
- 对象存储全部未配置时应用可启动；部分配置时启动校验失败。
- 上传正文经 API 中转，不返回预签名 URL。

## Review Focus

- 50 MiB 边界：恰好 50 MiB 可上传，超出 1 字节必须稳定返回 `FILE_TOO_LARGE`。
- 伪造 FileRef：不存在的 ID、跨 workspace ID 和缺少对象的 ID 必须在运行创建前拒绝。
- 删除副作用：删除文档、知识库或附件后，原文件和预览对象不得残留。
- 对象存储故障：上传或下载不得写半条成功记录，错误需可重试且不泄漏内部 key。
- 活跃内容：HTML 必须以附件下载并提供 `nosniff`，不能在浏览器内联执行。

---

### Task 1: 环境配置与对象存储适配器

**Files:**
- Create: `packages/platform/src/config.test.ts`
- Create: `packages/platform/src/storage/index.ts`
- Create: `packages/platform/src/storage/index.test.ts`
- Modify: `packages/platform/src/config.ts`
- Modify: `packages/platform/src/index.ts`
- Modify: `packages/platform/package.json`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`
- Produces: `getObjectStorageConfig(environment): ObjectStorageConfig | undefined`;
  `createObjectStorage(config): ObjectStorage | undefined`;
  `ObjectStorage.putObject/input`, `.getObject(key)`, `.deleteObject(key)`。

- [ ] **Step 1: 写配置和适配器失败测试**

测试完整配置、全部缺失、部分缺失、path-style 默认值和未配置时调用抛
`OBJECT_STORAGE_NOT_CONFIGURED`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec tsx --test packages/platform/src/config.test.ts packages/platform/src/storage/index.test.ts`
Expected: FAIL，配置函数和存储模块尚不存在。

- [ ] **Step 3: 实现配置解析、S3 客户端与稳定错误**

添加 `@aws-sdk/client-s3`。全部 bucket/credential 缺失时返回 undefined；只要
其中任一存在就要求 bucket、access key、secret 齐全。S3 endpoint 可选，
`S3_FORCE_PATH_STYLE` 默认 true。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `pnpm exec tsx --test packages/platform/src/config.test.ts packages/platform/src/storage/index.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

`git add packages/platform && git commit -m "feat: add s3 object storage adapter"`

### Task 2: 上传校验与 FileRef 契约

**Files:**
- Create: `packages/platform/src/files/validation.ts`
- Create: `packages/platform/src/files/validation.test.ts`
- Create: `packages/platform/src/files/references.ts`
- Create: `packages/platform/src/files/references.test.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/platform/package.json`

**Interfaces:**
- Produces: `FileRef`; `fileRefSchema`;
  `validateUploadFile(input: {name,mime,buffer}, scope): NormalizedUploadFile`;
  `validateFileReferences(input, schema, resolve): Promise<Record<string, unknown>>`。

- [ ] **Step 1: 写边界和引用失败测试**

覆盖 50 MiB 边界、非法扩展、MIME/内容不匹配、路径文件名、单文件/数组
FileRef 成功、不存在引用和规范化数据库结果。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec tsx --test packages/platform/src/files/validation.test.ts packages/platform/src/files/references.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现校验与 FileRef 遍历**

添加 `file-type` 识别可支持格式；纯文本按扩展名回退。错误使用 `AppError`
稳定错误码。FileRef 按 `format: "file-ref"` 定位，数组读取 `items`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `pnpm exec tsx --test packages/platform/src/files/validation.test.ts packages/platform/src/files/references.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

`git add packages/core packages/platform && git commit -m "feat: add file validation and references"`

### Task 3: 附件表与文件元数据仓库

**Files:**
- Create: `packages/platform/src/db/migrations/0011_file_assets.sql`
- Create: `packages/platform/src/db/repositories/file-repository.ts`
- Modify: `packages/platform/src/db/schema.ts`
- Modify: `packages/platform/src/index.ts`
- Test: `scripts/api-integration.mjs`

**Interfaces:**
- Consumes: Task 1 的 `ObjectStorage`，Task 2 的校验与 FileRef。
- Produces: `FileRepository.upload(file): Promise<FileRef>`；
  `.content(id)`；`.remove(id)`。

- [ ] **Step 1: 扩展真实 API 集成测试，先断言附件上传 201**

测试同时读取数据库确认存在 `file_assets` 行，并断言响应无 `storageKey`。

- [ ] **Step 2: 运行集成测试确认 RED**

Run: `pnpm test:api`
Expected: FAIL，`/api/files` 不存在且迁移未包含 `file_assets`。

- [ ] **Step 3: 实现迁移、schema 和仓库**

使用服务端生成 key：`workspace/{workspaceId}/files/{id}.{extension}`。上传成功
后落库；落库失败 best-effort 删除对象。

- [ ] **Step 4: 运行迁移后重跑测试确认 GREEN**

Run: `pnpm db:migrate && pnpm test:api`
Expected: 迁移成功，附件断言 PASS。

- [ ] **Step 5: 提交**

`git add packages/platform scripts/api-integration.mjs && git commit -m "feat: add file asset storage"`

### Task 4: 服务端上传、下载与知识库入库

**Files:**
- Modify: `apps/server/src/main.ts`
- Modify: `packages/platform/src/db/repositories/knowledge-repository.ts`
- Modify: `apps/server/package.json`
- Test: `scripts/api-integration.mjs`

**Interfaces:**
- Consumes: `FileRepository`、`validateUploadFile`、`ObjectStorage`。
- Produces: `POST /api/files`、`DELETE /api/files/:id`、
  `GET /api/files/:id/content`、multipart 知识库上传、
  `GET /api/documents/:id/file`。

- [ ] **Step 1: 添加真实接口失败测试**

覆盖通用附件下载/删除、知识库 upload 返回 queued、同 hash 去重、文档下载、
删除后对象不存在、缺失文件、超限和非法格式。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test:api`
Expected: FAIL，上传接口不接收 multipart 或返回旧 503。

- [ ] **Step 3: 实现 Nest multipart 与流式响应**

添加 `@types/multer`。FileInterceptor 限制 50 MiB；413 映射为
`FILE_TOO_LARGE`。响应设置 `Content-Disposition: attachment`、
`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `pnpm test:api`
Expected: PASS。

- [ ] **Step 5: 提交**

`git add apps/server packages/platform && git commit -m "feat: expose attachment upload APIs"`

### Task 5: 运行输入 FileRef 校验

**Files:**
- Modify: `packages/platform/src/db/repositories/workflow-repository.ts`
- Modify: `packages/platform/src/files/references.test.ts`
- Modify: `scripts/api-integration.mjs`

**Interfaces:**
- Consumes: `validateFileReferences` 与 `file_assets`。
- Produces: preview/production 运行创建前规范化 `start.inputSchema` 中的 FileRef。

- [ ] **Step 1: 添加伪造和跨 workspace 引用失败测试**

先上传一个附件，再断言有效引用被接受、不存在 ID 被拒绝、其他 workspace
文件被拒绝且 run 不创建。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test:api`
Expected: FAIL，当前 Repository 直接保存任意输入。

- [ ] **Step 3: 在两种运行创建路径接入校验**

只处理 `format: "file-ref"` 字段；用数据库值覆盖客户端 name/mime/size。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `pnpm test:api`
Expected: PASS。

- [ ] **Step 5: 提交**

`git add packages/platform scripts/api-integration.mjs && git commit -m "feat: validate run file references"`

### Task 6: 前端上传进度与文件控件

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/EditorPage.vue`
- Modify: `apps/web/src/pages/TrialPage.vue`
- Modify: `apps/web/src/pages/knowledge-page/index.vue`
- Modify: `apps/web/src/workflow/forms/SchemaForm.vue`
- Modify: `apps/web/src/shared/nodes.ts`
- Modify: `apps/web/src/shared/types.ts`

**Interfaces:**
- Consumes: 新上传接口和 FileRef。
- Produces: `apiUpload(path, formData, onProgress?)`；设计器、试运行台和知识库
  上传状态、重试和 FileRef 展示。

- [ ] **Step 1: 添加 Playwright 失败验收**

`scripts/smoke.mjs` 先断言知识库上传区、设计器文件控件和试运行台附件控件
存在，且上传中的运行按钮禁用。

- [ ] **Step 2: 运行验收确认 RED**

Run: `pnpm build && pnpm smoke`
Expected: FAIL，试运行台缺少 FileRef 控件或真实进度不可观察。

- [ ] **Step 3: 实现 XHR 进度和三类 UI**

`apiUpload` 使用 XMLHttpRequest 保留 ApiError 解析。单文件与数组 FileRef
按 JSON Schema `format` 识别。知识库队列改为串行。

- [ ] **Step 4: 运行验收确认 GREEN**

Run: `pnpm typecheck && pnpm build && pnpm smoke`
Expected: PASS。

- [ ] **Step 5: 提交**

`git add apps/web scripts/smoke.mjs && git commit -m "feat: wire attachment uploads in web"`

### Task 7: Compose、Nginx 与交付验证

**Files:**
- Modify: `.env.example`
- Modify: `infra/compose/.env.example`
- Modify: `infra/compose/docker-compose.yml`
- Modify: `infra/compose/README.md`
- Modify: `infra/nginx/default.conf`
- Modify: `package.json`

**Interfaces:**
- Produces: 本地 MinIO + bucket 初始化；生产 S3 环境变量；约 55 MiB Nginx 上限。

- [ ] **Step 1: 添加配置检查失败测试**

新增脚本验证 Compose 配置中存在 MinIO、bucket init、持久化卷和 S3 环境变量，
并验证 Nginx 55 MiB 上限。

- [ ] **Step 2: 运行检查确认 RED**

Run: `pnpm test:config`
Expected: FAIL，相关服务与配置尚不存在。

- [ ] **Step 3: 更新 Compose、Nginx 与部署文档**

MinIO 仅绑定 `127.0.0.1`；server/worker 等待 bucket init；端口和密钥全部来自
环境变量。

- [ ] **Step 4: 运行完整验证确认 GREEN**

Run: `pnpm typecheck && pnpm typecheck:server && pnpm typecheck:worker && pnpm build && pnpm test:api && pnpm smoke`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

`git add .env.example infra package.json && git commit -m "chore: provision minio object storage"`
