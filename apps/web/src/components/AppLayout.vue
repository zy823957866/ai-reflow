<template>
  <div class="h-screen overflow-hidden bg-canvas">
    <Menu />
    <div class="ml-[236px] flex h-full min-h-0 flex-col max-md:ml-0">
      <header data-testid="app-header" class="flex h-[62px] shrink-0 items-center justify-between gap-4 border-b border-line bg-white/96 px-7 max-md:pl-15 max-md:pr-4">
        <nav class="flex min-w-0 items-center gap-2 text-[14px] text-muted" aria-label="页面导航">
          <RouterLink to="/" class="shrink-0 font-500 hover:text-ink">AI 工作流</RouterLink>
          <ChevronRight :size="15" class="shrink-0 text-subtle" />
          <strong class="truncate font-650 text-ink">{{ pageTitle }}</strong>
        </nav>
        <div id="page-header-actions" class="flex min-w-0 max-w-[75%] items-center justify-end gap-2 overflow-x-auto py-1" />
      </header>
      <main class="min-h-0 flex-1 overflow-y-auto">
        <div data-testid="app-content" class="mx-auto min-h-full w-full max-w-[1440px]">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
  <AppToaster />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import AppToaster from './AppToaster.vue'
import Menu from './Menu.vue'

const route = useRoute()

const pageTitle = computed(() => String(route.meta.title ?? route.name ?? 'AI 工作流'))
</script>
