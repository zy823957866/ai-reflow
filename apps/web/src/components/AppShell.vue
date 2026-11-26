<template>
  <div class="min-h-screen bg-canvas">
    <button class="icon-btn fixed left-[13px] top-[13px] z-35 hidden border-line bg-white/90 shadow-sm max-md:inline-flex" aria-label="打开导航" @click="menuOpen = true">
      <Menu :size="19" />
    </button>
    <Transition
      enter-active-class="transition-opacity duration-180"
      leave-active-class="transition-opacity duration-180"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="menuOpen" class="fixed inset-0 z-39 bg-[rgba(10,12,18,0.24)] max-md:block md:hidden" @click="menuOpen = false" />
    </Transition>
    <aside class="fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col border-r border-line bg-[#f8f9fb] transition-transform duration-220 max-md:-translate-x-full max-md:shadow-lg" :class="{ 'max-md:!translate-x-0': menuOpen }">
      <div class="flex h-[74px] items-center gap-2.5 px-[21px] py-[15px]">
        <BrandMark />
        <div>
          <div class="text-[17px] font-[750] text-ink">Reflow</div>
          <div class="mt-px text-[11.5px] text-muted">工作流工作室</div>
        </div>
        <button class="icon-btn ml-auto hidden max-md:inline-flex" aria-label="关闭导航" @click="menuOpen = false">
          <X :size="18" />
        </button>
      </div>

      <button class="mx-[18px] mb-3.5 flex h-[52px] items-center gap-[9px] rounded-8px border border-line bg-surface px-2.5 text-left shadow-sm">
        <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#10131b] text-[11px] font-650 text-white">A</span>
        <span class="flex min-w-0 flex-1 flex-col">
          <strong class="truncate text-[11px] font-650 text-ink">Acme 团队</strong>
          <small class="mt-0.5 truncate text-[11.5px] text-subtle">demo workspace</small>
        </span>
        <ChevronsUpDown :size="14" />
      </button>

      <nav class="flex-1 overflow-y-auto px-3">
        <div class="px-2.5 pb-[7px] pt-2.5 text-[10px] font-550 text-subtle">工作台</div>
        <RouterLink
          v-for="item in primaryNav"
          :key="item.to"
          :to="item.to"
          class="mb-px flex h-[38px] items-center gap-2.5 rounded-[7px] px-[11px] text-[12px] font-500 transition-colors"
          :class="isNavActive(item) ? 'bg-primary-soft text-primary font-650' : 'text-muted hover:bg-[#f0f2f6] hover:text-ink'"
          @click="menuOpen = false"
        >
          <component :is="item.icon" :size="17" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="ml-auto text-[11.5px] font-650" :class="item.badgeTone === 'danger' ? 'text-danger' : 'text-subtle'">{{ item.badge }}</span>
        </RouterLink>
        <div class="px-2.5 pb-[7px] pt-[22px] text-[10px] font-550 text-subtle">管理</div>
        <RouterLink
          v-for="item in adminNav"
          :key="item.to"
          :to="item.to"
          class="mb-px flex h-[38px] items-center gap-2.5 rounded-[7px] px-[11px] text-[12px] font-500 transition-colors"
          :class="isNavActive(item) ? 'bg-primary-soft text-primary font-650' : 'text-muted hover:bg-[#f0f2f6] hover:text-ink'"
          @click="menuOpen = false"
        >
          <component :is="item.icon" :size="17" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="px-[17px] pb-4 pt-3">
        <div class="flex h-[33px] items-center gap-[7px] rounded-[7px] border border-line bg-surface px-2.5 text-[11.5px] text-muted">
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="gatewayState === 'online'
              ? 'bg-success shadow-[0_0_0_3px_var(--success-soft)]'
              : gatewayState === 'offline'
                ? 'bg-danger shadow-[0_0_0_3px_var(--danger-soft)]'
                : 'bg-subtle'"
          />
          <span>{{ gatewayLabel }}</span>
          <small v-if="gatewayHost" class="ml-auto font-mono text-[10.5px] text-subtle">{{ gatewayHost }}</small>
        </div>
        <div class="mt-[13px] flex items-center gap-[9px] px-[3px] py-0.5">
          <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-ink text-[11px] font-650 text-white">林</span>
          <span class="flex min-w-0 flex-1 flex-col">
            <strong class="truncate text-[11px] font-650 text-ink">林一舟</strong>
            <small class="mt-0.5 truncate text-[11.5px] text-subtle">工作区管理员</small>
          </span>
          <Settings :size="15" class="text-subtle" />
        </div>
      </div>
    </aside>
    <main class="min-h-screen ml-[236px] max-md:ml-0">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  Activity,
  BookOpen,
  Boxes,
  ChevronsUpDown,
  CodeXml,
  KeyRound,
  LayoutGrid,
  Menu,
  PackageOpen,
  Plug,
  Settings,
  X,
} from 'lucide-vue-next'
import { apiGet } from '@/api/client'
import { listMcpServers } from '@/services/reflowApi'
import BrandMark from './BrandMark.vue'

const menuOpen = ref(false)
const gatewayState = ref<'checking' | 'online' | 'offline'>('checking')
const gatewayHost = ref('')
const mcpIssueCount = ref<number | null>(null)
const route = useRoute()

const primaryNav = computed(() => [
  { to: '/', label: '工作流', icon: LayoutGrid },
  { to: '/runs', label: '运行记录', icon: Activity },
  { to: '/knowledge', label: '知识库', icon: BookOpen },
  {
    to: '/mcp',
    label: 'MCP 调用',
    icon: Plug,
    badge: mcpIssueCount.value === null
      ? undefined
      : mcpIssueCount.value > 0
        ? `${mcpIssueCount.value} 异常`
        : undefined,
    badgeTone: 'danger',
  },
  { to: '/templates', label: '模板市场', icon: Boxes },
  { to: '/plugins', label: '插件市场', icon: PackageOpen },
])

const adminNav = [
  { to: '/models', label: '模型与密钥', icon: KeyRound },
  { to: '/nodes', label: '节点库', icon: CodeXml },
]

const gatewayLabel = computed(() => {
  if (gatewayState.value === 'online') return 'MCP 网关可用'
  if (gatewayState.value === 'offline') return 'MCP 网关不可用'
  return '检查 MCP 网关'
})

/**
 * 读取 API 健康状态与真实 MCP 连接异常数量。
 */
async function loadRuntimeStatus() {
  gatewayHost.value = window.location.hostname
  try {
    const [health, servers] = await Promise.all([
      apiGet<{ ok: boolean }>('/api/health'),
      listMcpServers(),
    ])
    gatewayState.value = health.ok ? 'online' : 'offline'
    mcpIssueCount.value = servers.filter(
      (server) => server.enabled && server.status !== 'healthy',
    ).length
  } catch {
    gatewayState.value = 'offline'
    mcpIssueCount.value = null
  }
}

/**
 * 判断主导航项是否属于当前路由。
 * @param item 导航项配置。
 * @returns 当前路由命中时返回 `true`。
 */
function isNavActive(item: { to: string }) {
  return item.to === '/' ? route.path === '/' : route.path.startsWith(item.to)
}

onMounted(loadRuntimeStatus)
</script>
