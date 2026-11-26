<script setup lang="ts">
import type { CheckboxGroupRootEmits, CheckboxGroupRootProps } from 'reka-ui'
import { CheckboxGroupRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<CheckboxGroupRootProps>()
const emits = defineEmits<CheckboxGroupRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <CheckboxGroupRoot v-bind="forwarded">
    <slot />
  </CheckboxGroupRoot>
</template>
