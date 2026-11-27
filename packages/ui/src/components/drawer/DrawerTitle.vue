<script setup lang="ts">
import type { DrawerTitleProps } from 'vaul-vue'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps } from 'reka-ui'
import { DrawerTitle } from 'vaul-vue'
import { cn } from '../../lib/utils'

const props = defineProps<DrawerTitleProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DrawerTitle v-bind="forwardedProps" :class="cn('ui-drawer-title', props.class)">
    <slot />
  </DrawerTitle>
</template>
