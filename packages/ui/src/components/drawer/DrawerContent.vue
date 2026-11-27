<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DrawerContent, DrawerOverlay, DrawerPortal } from 'vaul-vue'
import { cn } from '../../lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <DrawerPortal>
    <DrawerOverlay class="ui-drawer-overlay" />
    <DrawerContent :class="cn('ui-drawer-content', props.class)">
      <slot />
    </DrawerContent>
  </DrawerPortal>
</template>
