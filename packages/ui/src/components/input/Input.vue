<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useVModel } from '@vueuse/core'
import { computed } from 'vue'
import { cn } from '../../lib/utils'

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  modelModifiers?: Record<string, boolean>
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void
}>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const value = computed({
  get: () => modelValue.value,
  set: (next: string | number) => {
    if (!props.modelModifiers?.number || next === '') {
      modelValue.value = next
      return
    }
    const parsed = Number.parseFloat(String(next))
    modelValue.value = Number.isNaN(parsed) ? next : parsed
  },
})
</script>

<template>
  <input v-model="value" :class="cn('ui-input', props.class)">
</template>
