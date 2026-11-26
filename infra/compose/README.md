# AI Reflow Docker Compose 部署

这套配置在目标 Docker 主机内运行以下服务：

- `web`：Nginx，托管前端静态文件，并代理 `/api/` 与 `POST /mcp`
- `server`：NestJS 控制面
- `worker`：数据库队列消费与工作流执行
- `migrate`：一次性数据库迁移
- `postgres`：PostgreSQL 18 + pgvector
- `redis`：Redis 7，启用密码和 AOF

当前代码的 `QUEUE_MODE` 只实现了 `database`，worker 通过 PostgreSQL
轮询任务。Redis 容器已纳入部署并持久化，但暂时不会被业务代码消费。

## 1. 同步代码到 Docker 主机

如果 Docker 运行在独立虚拟机，需要先把代码同步到虚拟机。Windows 主机可以
先打包一份不含本机依赖和密钥的部署包：

```powershell
tar -czf ai-reflow-deploy.tar.gz `
  --exclude=node_modules `
  --exclude=.env `
  --exclude=infra/compose/.env `
  --exclude=apps/web/dist `
  --exclude=artifacts `
  --exclude=.artifacts `
  .

scp .\ai-reflow-deploy.tar.gz user@<vm-ip>:/tmp/
```

在 Docker 主机解压：

```bash
mkdir -p /srv/ai-reflow
tar -xzf /tmp/ai-reflow-deploy.tar.gz -C /srv/ai-reflow
cd /srv/ai-reflow
```

如果 Docker 主机可以直接挂载当前目录，或在主机上已有代码仓库，可跳过打包步骤。

## 2. 准备配置

在 Docker 主机上进入项目根目录：

```bash
cp infra/compose/.env.example infra/compose/.env
```

修改 `infra/compose/.env`：

- 修改 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`。
- 将 `ENCRYPTION_KEY` 改为至少 32 位随机字符串。
- 如果通过局域网访问，将 `WEB_ORIGIN` 改成实际访问地址。
- 如需执行模型节点，填写 `AI_REFLOW_MODEL_API_KEY` 或 `OPENAI_API_KEY`。

不要提交 `infra/compose/.env`。

## 3. 启动

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml up -d --build
```

首次启动时，`migrate` 会自动建表然后退出，`server` 和 `worker` 随后启动。

查看状态和日志：

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml ps

docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml logs -f server worker
```

浏览器访问：

```text
http://<Docker 主机地址>:8080
```

健康检查：

```bash
curl http://<Docker 主机地址>:8080/healthz
curl http://<Docker 主机地址>:8080/api/health
```

## 4. 可选：写入演示数据

种子脚本可重复执行：

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml --profile demo run --rm seed
```

## 5. 数据持久化与备份

数据库和 Redis 分别写入命名卷：

- `ai-reflow_postgres-data`
- `ai-reflow_redis-data`

普通停止不会删除数据：

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml down
```

只有显式执行 `down -v` 才会删除卷。不要在没有备份时执行该命令。

PostgreSQL 逻辑备份：

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > ai-reflow.sql
```

## 6. 更新代码

将新代码同步到 Docker 主机后重新构建：

```bash
docker compose --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml up -d --build
```

迁移服务会先执行尚未应用的迁移，再启动新版本 server 和 worker。

## 7. 常见问题

- `postgres` 启动失败：确认使用的是 `pgvector/pgvector:pg18`，因为迁移依赖
  PostgreSQL 18 的 `uuidv7()` 和 pgvector 的 `vector` 扩展。
- 页面能打开但 API 报错：检查 `docker compose ... logs server`。
- 运行一直不结束：检查 `worker` 日志和模型 API Key。
- 外网访问：当前只发布 Web 端口；PostgreSQL 和 Redis 仅在 Compose 内网可见。
- SSE 卡住：Nginx 已关闭 `/api/` 缓冲，若再套一层反向代理，也需要关闭 buffering。

