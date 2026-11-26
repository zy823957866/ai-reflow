# Apps

`apps/` 下每个可运行应用都是独立的 pnpm workspace 包，配置和依赖不得回落到仓库根目录。

## 包边界

| 目录 | 包名 | 入口 |
| --- | --- | --- |
| `apps/web` | `@ai-reflow/web` | `index.html` + `src/main.ts` |
| `apps/server` | `@ai-reflow/server` | `src/main.ts` |
| `apps/worker` | `@ai-reflow/worker` | `src/main.ts` |

## 常用命令

```powershell
pnpm dev:web
pnpm dev:server
pnpm dev:worker
pnpm build
pnpm typecheck
pnpm typecheck:server
pnpm typecheck:worker
```

根脚本通过 `pnpm --filter <package>` 调用应用脚本。单独调试前端时也可执行：

```powershell
pnpm --filter @ai-reflow/web dev
```

## Web 配置

- `apps/web/vite.config.ts`：Vite、Vue、UnoCSS 和 API 代理。
- `apps/web/uno.config.ts`：Wind3 预设与 Reflow 设计令牌。
- `apps/web/tsconfig.json`：前端源码、Vite 配置和 workspace 包路径。
- `packages/ui/`：共享 shadcn-vue 组件包，Web 通过 `@ai-reflow/ui` 统一导入。

前端生产产物固定输出到 `apps/web/dist`，供 `infra/docker/web.Dockerfile` 和 smoke 验收脚本使用。
