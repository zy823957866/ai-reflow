<script setup lang="ts">
import type { SelectScrollDownButtonProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ChevronDown } from 'lucide-vue-next'
import { SelectScrollDownButton, useForwardProps } from 'reka-ui'
import { cn } from '../../lib/utils'

const props = defineProps<SelectScrollDownButtonProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectScrollDownButton v-bind="forwardedProps" :class="cn('ui-select-scroll', props.class)">
    <slot>
      <ChevronDown class="h-3.5 w-3.5" />
    </slot>
  </SelectScrollDownButton>
</template>
