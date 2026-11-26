import { defineConfig, presetWind3, transformerVariantGroup } from 'unocss'

/**
 * Reflow Web 的原子化样式入口。
 *
 * 页面优先使用 Wind3 工具类；设计令牌继续通过 CSS 变量提供，
 * 仅在复杂响应式、画布与第三方组件适配场景保留组件样式。
 */
export default defineConfig({
  presets: [presetWind3()],
  transformers: [transformerVariantGroup()],
  theme: {
    colors: {
      ink: 'var(--ink)',
      muted: 'var(--ink-2)',
      subtle: 'var(--ink-3)',
      line: 'var(--border)',
      'border-strong': 'var(--border-strong)',
      surface: 'var(--surface)',
      'surface-2': 'var(--surface-2)',
      'surface-3': 'var(--surface-3)',
      canvas: 'var(--bg)',
      primary: 'var(--primary)',
      'primary-hover': 'var(--primary-hover)',
      'primary-soft': 'var(--primary-soft)',
      success: 'var(--success)',
      'success-soft': 'var(--success-soft)',
      warning: 'var(--warning)',
      'warning-soft': 'var(--warning-soft)',
      danger: 'var(--danger)',
      'danger-soft': 'var(--danger-soft)',
      info: 'var(--info)',
      'info-soft': 'var(--info-soft)',
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      card: 'var(--card)',
      'card-foreground': 'var(--card-foreground)',
      popover: 'var(--popover)',
      'popover-foreground': 'var(--popover-foreground)',
      'primary-foreground': 'var(--primary-foreground)',
      secondary: 'var(--secondary)',
      'secondary-foreground': 'var(--secondary-foreground)',
      'muted-foreground': 'var(--muted-foreground)',
      accent: 'var(--accent)',
      'accent-foreground': 'var(--accent-foreground)',
      destructive: 'var(--destructive)',
      'destructive-foreground': 'var(--destructive-foreground)',
      input: 'var(--input)',
      ring: 'var(--ring)',
    },
  },
})
