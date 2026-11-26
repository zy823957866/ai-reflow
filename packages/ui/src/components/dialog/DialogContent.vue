<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { X } from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '../../lib/utils'

const props = withDefaults(defineProps<DialogContentProps & {
  class?: HTMLAttributes['class']
  showClose?: boolean
}>(), {
  showClose: true,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'showClose')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="ui-dialog-overlay" />
    <DialogContent v-bind="forwarded" :class="cn('ui-dialog-content', props.class)">
      <slot />

      <DialogClose v-if="showClose" class="ui-dialog-close" aria-label="关闭">
        <X :size="16" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
