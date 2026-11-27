<script setup lang="ts">
import type { DrawerDescriptionProps } from 'vaul-vue'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps } from 'reka-ui'
import { DrawerDescription } from 'vaul-vue'
import { cn } from '../../lib/utils'

const props = defineProps<DrawerDescriptionProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DrawerDescription v-bind="forwardedProps" :class="cn('ui-drawer-description', props.class)">
    <slot />
  </DrawerDescription>
</template>
