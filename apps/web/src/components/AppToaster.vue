<template>
  <ToastProvider
    :toast-manager="toastManager"
    label="通知"
    :duration="5000"
    :limit="3"
  >
    <AppToastList />
  </ToastProvider>
</template>

<script setup lang="ts">
import { ToastProvider } from 'reka-ui'
import { toastManager } from '@/shared/toast'
import AppToastList from './AppToastList.vue'
</script>
