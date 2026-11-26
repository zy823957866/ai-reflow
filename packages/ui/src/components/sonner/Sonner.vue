<template>
  <Toaster
    position="top-right"
    :offset="{ top: 78, right: 16 }"
    :mobile-offset="16"
    :gap="8"
    :duration="6000"
    :visible-toasts="3"
    :toast-options="toastOptions"
    container-aria-label="通知"
    style="--width: 390px"
  >
    <template #error-icon>
      <CircleAlert :size="16" />
    </template>
    <template #close-icon>
      <X :size="14" />
    </template>
  </Toaster>
</template>

<script setup lang="ts">
import { CircleAlert, X } from 'lucide-vue-next'
import { Toaster } from 'vue-sonner'

const toastOptions = {
  unstyled: true,
  closeButton: true,
  closeButtonAriaLabel: '关闭通知',
  classes: {
    toast: 'pointer-events-auto grid w-full grid-cols-[32px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 rounded-8px border border-line bg-surface p-3 text-ink shadow-lg',
    content: 'col-start-2 row-start-1 min-w-0 pr-8',
    title: 'm-0 text-[13px] font-650 leading-[1.5] text-ink',
    description: 'mt-1 block break-words text-[12px] leading-[1.55] text-muted',
    icon: 'col-start-1 row-start-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-danger-soft text-danger',
    closeButton: 'icon-btn !absolute !right-2 !top-2 !h-7 !w-7 shrink-0',
    actionButton: 'col-start-2 row-start-2 justify-self-start border-0 bg-transparent p-0 text-[12px] font-600 text-primary',
  },
}
</script>
