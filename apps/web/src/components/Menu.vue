<template>
  <Button
    variant="outline"
    size="icon-sm"
    class="fixed left-[13px] top-[13px] z-35 hidden border-line bg-white/90 shadow-sm max-md:inline-flex"
    aria-label="打开导航"
    @click="menuOpen = true"
  >
    <MenuIcon :size="19" />
  </Button>
  <Transition
    enter-active-class="transition-opacity duration-180"
    leave-active-class="transition-opacity duration-180"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="menuOpen"
      class="fixed inset-0 z-39 bg-[rgba(10,12,18,0.24)] max-md:block md:hidden"
      @click="menuOpen = false"
    />
  </Transition>
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col border-r border-line bg-[#f8f9fb] transition-transform duration-220 max-md:-translate-x-full max-md:shadow-lg"
    :class="{ 'max-md:!translate-x-0': menuOpen }"
  >
    <div class="flex h-[74px] items-center gap-2.5 px-[21px] py-[15px]">
      <BrandMark />
      <div>
        <div class="text-[17px] font-[750] text-ink">Reflow</div>
        <div class="mt-px text-[12px] text-muted">AI 工作流</div>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto px-3">
      <div class="px-2.5 pb-[7px] pt-2.5 text-[12px] font-550 text-subtle">工作台</div>
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
        <span
          v-if="item.badge"
          class="ml-auto text-[12px] font-650"
          :class="item.badgeTone === 'danger' ? 'text-danger' : 'text-subtle'"
        >
          {{ item.badge }}
        </span>
      </RouterLink>
      <div class="px-2.5 pb-[7px] pt-[22px] text-[12px] font-550 text-subtle">管理</div>
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
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Button } from '@ai-reflow/ui'
import {
  Activity,
  BookOpen,
  Bot,
  Boxes,
  KeyRound,
  LayoutGrid,
  Menu as MenuIcon,
  PackageOpen,
  Plug,
} from 'lucide-vue-next'
import { listMcpServers } from '@/services/reflowApi'
import BrandMark from './BrandMark.vue'

const menuOpen = ref(false)
const mcpIssueCount = ref<number | null>(null)
const route = useRoute()

const primaryNav = computed(() => [
  { to: '/', label: '工作流', icon: LayoutGrid },
  { to: '/agents', label: 'Agent', icon: Bot },
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
]

async function loadMcpIssueCount() {
  try {
    const servers = await listMcpServers()
    mcpIssueCount.value = servers.filter(
      (server) => server.enabled && server.status !== 'healthy',
    ).length
  } catch {
    mcpIssueCount.value = null
  }
}

function isNavActive(item: { to: string }) {
  return item.to === '/' ? route.path === '/' : route.path.startsWith(item.to)
}

onMounted(loadMcpIssueCount)
</script>
