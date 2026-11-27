<script setup lang="ts">
import type { DrawerTriggerProps } from 'vaul-vue'
import { DrawerTrigger } from 'vaul-vue'

const props = defineProps<DrawerTriggerProps>()
</script>

<template>
  <DrawerTrigger v-bind="props">
    <slot />
  </DrawerTrigger>
</template>
