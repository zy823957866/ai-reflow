# @ai-reflow/ui

Web 端共享的 shadcn-vue 组件层。组件源码直接维护在本包内，不再在 `apps/web` 下复制或二次包装。

## 结构

- `src/components/<name>/`：单个组件的官方 shadcn-vue 文件结构与导出。
- `src/lib/utils.ts`：`cn()` 类名合并工具。
- `src/styles.css`：组件样式，使用 Web 应用提供的设计令牌。
- `src/index.ts`：统一导出入口。

## 约定

- 页面统一从 `@ai-reflow/ui` 导入组件，不直接引用包内文件。
- 交互控件保留 Reka UI 提供的键盘操作、焦点管理和可访问语义。
- 常规操作使用 `Button` 的标准变体；需要完整继承页面布局的卡片、状态分段和工具轨使用 `variant="unstyled"`，避免复制原生 `<button>`。
- 组件类名使用 `ui-*` 前缀，样式通过 `:where()` 降低特异性，页面尺寸类可以安全覆盖。
- 新增 shadcn-vue 组件时，保持官方文件结构，只替换 Tailwind 令牌为项目 UnoCSS / CSS 变量。
