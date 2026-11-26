<template>
  <RouterView v-if="route.meta.layout === 'editor'" />
  <AppLayout v-else />
</template>

<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import AppLayout from '@/components/AppLayout.vue'

const route = useRoute()
</script>
