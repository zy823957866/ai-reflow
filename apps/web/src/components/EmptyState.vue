<template>
  <div class="flex min-h-[300px] flex-col items-center justify-center p-10 text-center">
    <div class="flex h-[46px] w-[46px] items-center justify-center rounded-8px bg-[var(--surface-3)] text-subtle"><component :is="icon" :size="22" /></div>
    <h3 class="mb-[5px] mt-[13px] text-[14px]">{{ title }}</h3>
    <p class="mb-4 mt-0 max-w-[380px] text-[12px] leading-[1.65] text-subtle">{{ description }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { Inbox } from 'lucide-vue-next'

/**
 * 空状态展示组件属性。
 * icon 使用工厂返回 Vue 组件，避免 Vue 将 Lucide 组件函数误当作默认值工厂执行。
 */
withDefaults(
  defineProps<{
    title: string
    description: string
    icon?: Component
  }>(),
  { icon: () => Inbox },
)
</script>
