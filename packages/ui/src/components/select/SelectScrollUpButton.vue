<script setup lang="ts">
import type { SelectScrollUpButtonProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ChevronUp } from 'lucide-vue-next'
import { SelectScrollUpButton, useForwardProps } from 'reka-ui'
import { cn } from '../../lib/utils'

const props = defineProps<SelectScrollUpButtonProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectScrollUpButton v-bind="forwardedProps" :class="cn('ui-select-scroll', props.class)">
    <slot>
      <ChevronUp class="h-3.5 w-3.5" />
    </slot>
  </SelectScrollUpButton>
</template>
