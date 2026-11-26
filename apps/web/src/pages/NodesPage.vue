<template>
  <AppShell>
    <div class="min-h-screen">
      <header class="flex min-h-62px items-center justify-between gap-4 border-b border-line bg-white/96 px-7">
        <div class="flex min-w-0 items-center gap-2 text-10px text-subtle">
          <span>Acme 团队</span>
          <ChevronRight :size="13" />
          <strong class="truncate font-650 text-ink">节点库</strong>
        </div>
        <div class="flex items-center gap-2">
          <label class="flex h-9 w-[min(320px,100%)] items-center gap-2 rounded-7px border border-line bg-surface px-3">
            <Search :size="14" class="shrink-0 text-subtle" />
            <input
              v-model="search"
              class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-10px shadow-none outline-none"
              placeholder="搜索名称、type、分类或字段..."
            />
            <kbd class="rounded-4px border border-line bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">⌘K</kbd>
          </label>
        </div>
      </header>

      <main class="mx-auto max-w-1380px px-7 pt-7 pb-16">
        <section class="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="m-0 text-27px font-730 leading-tight text-ink">节点库 · {{ registrations.length }} 节点</h1>
            <p class="mb-0 mt-2 text-10px leading-1.6 text-subtle">
              6 个能力类别 · 单一 Node Manifest 驱动画布、Inspector、校验和执行器
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-6px bg-primary-soft px-2.5 py-1.5 text-[11.5px] font-600 text-primary">{{ registrations.length }} 个节点</span>
            <span class="rounded-6px border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-subtle">
              P0 · {{ phaseCount('P0') }} / P0.5 · {{ phaseCount('P0.5') }} / P1 · {{ phaseCount('P1') }}
            </span>
          </div>
        </section>

        <section class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              class="inline-flex h-7 items-center gap-1.5 rounded-6px border border-line bg-surface px-2.5 text-[11.5px] text-muted transition hover:(bg-[var(--surface-2)] text-ink) focus-visible:outline-2 focus-visible:outline-primary-soft"
              :class="{ '!border-primary !bg-primary !text-white': activeCategory === '全部' }"
              @click="activeCategory = '全部'"
            >
              全部 <span class="opacity-70">{{ registrations.length }}</span>
            </button>
            <button
              v-for="category in categories"
              :key="category.name"
              class="inline-flex h-7 items-center gap-1.5 rounded-6px border border-line bg-surface px-2.5 text-[11.5px] text-muted transition hover:(bg-[var(--surface-2)] text-ink)"
              :class="{ '!border-primary !bg-primary !text-white': activeCategory === category.name }"
              @click="activeCategory = category.name"
            >
              {{ category.name }} <span class="opacity-70">{{ category.count }}</span>
            </button>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1 text-[10.5px] text-subtle"><i class="h-1.5 w-1.5 rounded-full bg-primary" /> P0</span>
              <span class="inline-flex items-center gap-1 text-[10.5px] text-subtle"><i class="h-1.5 w-1.5 rounded-full bg-warning" /> P0.5</span>
              <span class="inline-flex items-center gap-1 text-[10.5px] text-subtle"><i class="h-1.5 w-1.5 rounded-full bg-[var(--ink-3)]" /> P1</span>
            </div>
            <select v-model="phaseFilter" class="management-select" aria-label="按阶段筛选节点">
              <option value="">全部阶段</option>
              <option value="P0">P0</option>
              <option value="P0.5">P0.5</option>
              <option value="P1">P1</option>
            </select>
          </div>
        </section>

        <div
          v-if="!filteredNodes.length"
          class="surface flex min-h-160px flex-col items-center justify-center gap-3 text-subtle"
        >
          <SearchX :size="24" />
          <strong class="text-12px text-ink">没有匹配的节点</strong>
          <span class="text-10px">调整关键词、分类或阶段筛选。</span>
          <button class="btn" @click="clearFilters">清除筛选</button>
        </div>

        <section v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="registration in filteredNodes"
            :key="registration.manifest.type"
            class="group flex min-h-148px cursor-pointer flex-col rounded-8px border border-line bg-surface p-3.5 shadow-sm transition hover:(-translate-y-1px border-[var(--border-strong)] shadow-md)"
            role="button"
            tabindex="0"
            @click="openNode(registration)"
            @keydown.enter="openNode(registration)"
          >
            <div class="flex items-start gap-2.5">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-7px"
                :style="{
                  color: registration.manifest.color,
                  background: `color-mix(in srgb, ${registration.manifest.color}, white 91%)`,
                }"
              >
                <NodeGlyph :name="registration.manifest.icon" :size="17" />
              </span>
              <div class="min-w-0 flex-1">
                <strong class="block truncate text-12px font-650 text-ink">{{ registration.manifest.displayName }}</strong>
                <span class="mt-1 block truncate font-mono text-[10.5px] text-subtle">
                  {{ registration.manifest.type }} · {{ registration.manifest.category }}
                </span>
              </div>
              <span
                class="rounded-4px px-1.5 py-0.5 text-[10.5px] font-650"
                :class="phaseClass(registration.manifest.phase)"
              >
                {{ registration.manifest.phase }}
              </span>
            </div>

            <p class="mb-0 mt-3 line-clamp-2 min-h-32px text-[11.5px] leading-1.65 text-muted">
              {{ registration.manifest.description }}
            </p>

            <div class="mt-auto pt-3">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="option in registration.manifest.discriminator?.options ?? []"
                  :key="option.value"
                  class="rounded-4px border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[10.5px] text-subtle"
                >
                  {{ option.label }}
                </span>
                <span
                  v-if="!registration.manifest.discriminator"
                  class="rounded-4px border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[10.5px] text-subtle"
                >
                  v{{ registration.manifest.version }}
                </span>
              </div>
              <div class="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
                <span class="flex items-center gap-1 text-[10.5px] text-subtle">
                  <i class="h-1.5 w-1.5 rounded-full bg-success" />
                  {{ registration.manifest.inputs.length }} in · {{ registration.manifest.outputs.length }} out
                </span>
                <span class="inline-flex items-center gap-1 text-[10.5px] font-600 text-primary">
                  配置 <ArrowRight :size="11" />
                </span>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  </AppShell>

  <DialogRoot :open="Boolean(selectedNode)" @update:open="(open) => !open && (selectedNode = null)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" />
      <DialogContent class="fixed inset-y-0 right-0 z-71 flex w-[min(620px,100vw)] flex-col bg-surface shadow-lg outline-none">
        <header class="flex min-h-64px items-center justify-between gap-4 border-b border-line px-5">
          <div class="flex min-w-0 items-center gap-3">
            <span
              v-if="selectedNode"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-7px"
              :style="{
                color: selectedNode.manifest.color,
                background: `color-mix(in srgb, ${selectedNode.manifest.color}, white 91%)`,
              }"
            >
              <NodeGlyph :name="selectedNode.manifest.icon" :size="18" />
            </span>
            <div class="min-w-0">
              <DialogTitle class="truncate text-16px font-700 text-ink">
                {{ selectedNode?.manifest.displayName }}
              </DialogTitle>
              <DialogDescription class="mt-1 block font-mono text-[11.5px] text-subtle">
                {{ selectedNode?.manifest.type }} · v{{ selectedNode?.manifest.version }} · {{ selectedNode?.manifest.category }}
              </DialogDescription>
            </div>
          </div>
          <DialogClose as-child>
            <button class="icon-btn" title="关闭节点详情"><X :size="16" /></button>
          </DialogClose>
        </header>

        <div v-if="selectedNode" class="flex-1 overflow-y-auto px-5 py-4">
          <p class="m-0 text-11px leading-1.7 text-muted">{{ selectedNode.manifest.description }}</p>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <div class="rounded-7px border border-line bg-[var(--surface-2)] p-3">
              <span class="text-[10.5px] uppercase tracking-wide text-subtle">Runtime</span>
              <strong class="mt-1 block text-11px text-ink">{{ selectedNode.manifest.runtime ?? 'builtin' }}</strong>
            </div>
            <div class="rounded-7px border border-line bg-[var(--surface-2)] p-3">
              <span class="text-[10.5px] uppercase tracking-wide text-subtle">Phase</span>
              <strong class="mt-1 block text-11px text-ink">{{ selectedNode.manifest.phase }}</strong>
            </div>
          </div>

          <section class="mt-5">
            <h3 class="mb-2 text-12px font-650 text-ink">输入与输出端口</h3>
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="rounded-7px border border-line p-3">
                <span class="text-[10.5px] font-600 text-subtle">INPUT</span>
                <div v-if="selectedNode.manifest.inputs.length" class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="handle in selectedNode.manifest.inputs"
                    :key="handle.id"
                    class="rounded-4px bg-[var(--surface-3)] px-2 py-1 font-mono text-[11.5px] text-muted"
                  >
                    {{ handle.id }} · {{ handle.label }}
                  </span>
                </div>
                <p v-else class="mb-0 mt-2 text-[11.5px] text-subtle">无输入边，开始节点只能作为入口。</p>
              </div>
              <div class="rounded-7px border border-line p-3">
                <span class="text-[10.5px] font-600 text-subtle">OUTPUT</span>
                <div v-if="selectedNode.manifest.outputs.length" class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="handle in selectedNode.manifest.outputs"
                    :key="handle.id"
                    class="rounded-4px bg-primary-soft px-2 py-1 font-mono text-[11.5px] text-primary"
                  >
                    {{ handle.id }} · {{ handle.label }}
                  </span>
                </div>
                <p v-else class="mb-0 mt-2 text-[11.5px] text-subtle">终止节点，无输出端口。</p>
              </div>
            </div>
          </section>

          <section class="mt-5">
            <h3 class="mb-2 text-12px font-650 text-ink">输出字段</h3>
            <div class="overflow-hidden rounded-7px border border-line">
              <div
                v-for="field in selectedNode.manifest.outputFields"
                :key="field.name"
                class="grid grid-cols-[120px_64px_1fr] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span class="truncate font-mono text-[11.5px] text-ink">{{ field.name }}</span>
                <span class="text-[10.5px] text-subtle">{{ field.type }}</span>
                <span class="text-[11.5px] leading-1.5 text-muted">{{ field.description ?? (field.required ? '必填' : '可选') }}</span>
              </div>
            </div>
          </section>

          <section class="mt-5">
            <h3 class="mb-2 text-12px font-650 text-ink">配置字段</h3>
            <div class="space-y-2">
              <div
                v-for="field in selectedNode.manifest.configFields"
                :key="field.key"
                class="rounded-7px border border-line bg-[var(--surface-2)] p-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <strong class="text-10px text-ink">{{ field.label }}</strong>
                  <span class="rounded-4px bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">
                    {{ field.key }} · {{ field.widget }}
                  </span>
                </div>
                <p class="mb-0 mt-1.5 text-[11.5px] leading-1.55 text-muted">
                  {{ field.help ?? field.placeholder ?? '由 configFields 自动投射到 Inspector。' }}
                </p>
              </div>
            </div>
          </section>

          <section class="mt-5">
            <h3 class="mb-2 text-12px font-650 text-ink">能力与权限</h3>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="[key, enabled] in Object.entries(selectedNode.manifest.capabilities)"
                :key="key"
                class="rounded-4px px-2 py-1 text-[10.5px]"
                :class="enabled ? 'bg-success-soft text-success' : 'bg-[var(--surface-3)] text-subtle'"
              >
                {{ capabilityLabel(key) }} {{ enabled ? '是' : '否' }}
              </span>
              <span
                v-for="[key, value] in Object.entries(selectedNode.manifest.permissions)"
                :key="`permission-${key}`"
                class="rounded-4px border border-line px-2 py-1 text-[10.5px] text-muted"
              >
                {{ capabilityLabel(key) }}: {{ formatPermission(value) }}
              </span>
            </div>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { ArrowRight, ChevronRight, Search, SearchX, X } from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import AppShell from '@/components/AppShell.vue'
import NodeGlyph from '@/components/NodeGlyph.vue'
import { getNodeRegistrations, onNodeRegistryChange } from '@/shared/registry'
import type { NodeRegistration } from '@/shared/types'

const registrations = ref<NodeRegistration[]>(getNodeRegistrations())
const search = ref('')
const activeCategory = ref('全部')
const phaseFilter = ref('')
const selectedNode = ref<NodeRegistration | null>(null)

const cleanupRegistry = onNodeRegistryChange(() => {
  registrations.value = getNodeRegistrations()
})

onUnmounted(cleanupRegistry)

/** 返回当前注册表中的全部节点分类及数量。 */
const categories = computed(() =>
  [...new Set(registrations.value.map((item) => item.manifest.category))]
    .map((name) => ({
      name,
      count: registrations.value.filter((item) => item.manifest.category === name).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
)

/** 按关键词、分类与 phase 筛选节点，筛选范围只来自注册表。 */
const filteredNodes = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return registrations.value.filter((registration) => {
    const manifest = registration.manifest
    const searchable = [
      manifest.displayName,
      manifest.type,
      manifest.category,
      manifest.description,
      ...manifest.configFields.map((field) => `${field.key} ${field.label}`),
    ]
      .join(' ')
      .toLowerCase()
    return (
      (!keyword || searchable.includes(keyword)) &&
      (activeCategory.value === '全部' || manifest.category === activeCategory.value) &&
      (!phaseFilter.value || manifest.phase === phaseFilter.value)
    )
  })
})

/**
 * 统计指定 phase 的节点数量。
 *
 * @param phase P0、P0.5 或 P1。
 */
function phaseCount(phase: string): number {
  return registrations.value.filter((item) => item.manifest.phase === phase).length
}

/**
 * 返回 phase 徽标的原子类组合。
 *
 * @param phase 节点阶段。
 */
function phaseClass(phase: string): string {
  if (phase === 'P0') return 'bg-primary-soft text-primary'
  if (phase === 'P0.5') return 'bg-warning-soft text-warning'
  return 'bg-[var(--surface-3)] text-subtle'
}

/** 打开节点 Manifest 详情抽屉。 */
function openNode(registration: NodeRegistration) {
  selectedNode.value = registration
}

/** 清空节点搜索与筛选条件。 */
function clearFilters() {
  search.value = ''
  activeCategory.value = '全部'
  phaseFilter.value = ''
}

/** 将 Manifest 能力键转换为可读中文。 */
function capabilityLabel(key: string): string {
  const labels: Record<string, string> = {
    cancellable: '可取消',
    idempotent: '幂等',
    streaming: '流式',
    sideEffect: '副作用',
    longRunning: '长任务',
    emitsArtifacts: '产物',
    code: '代码',
    files: '文件',
    mcp: 'MCP',
    secrets: '密钥',
    networkHosts: '网络',
  }
  return labels[key] ?? key
}

/** 以稳定文本格式展示权限值，避免只靠颜色表达风险。 */
function formatPermission(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '无'
  if (typeof value === 'boolean') return value ? '允许' : '拒绝'
  if (value === null || value === undefined) return '无'
  return String(value)
}
</script>
