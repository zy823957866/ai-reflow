<template>
  <ToastPortal>
    <ToastViewport
      class="fixed right-4 top-[78px] z-100 flex max-h-[calc(100vh-94px)] w-[min(390px,calc(100vw-32px))] flex-col-reverse gap-2 outline-none"
      label="通知"
    >
      <ToastRoot
        v-for="toast in toasts"
        :key="`${toast.id}-${toast.updateKey}`"
        :toast="toast"
        data-testid="app-toast"
        class="pointer-events-auto rounded-8px border border-line bg-surface p-3 text-ink shadow-lg data-[state=closed]:(translate-x-3 opacity-0) data-[limited]:hidden"
      >
        <div class="flex items-start gap-2.5">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-danger-soft text-danger">
            <CircleAlert :size="16" />
          </span>
          <div class="min-w-0 flex-1">
            <ToastTitle class="m-0 text-[13px] font-650 text-ink">{{ toast.title }}</ToastTitle>
            <ToastDescription class="mt-1 block break-words text-[12px] leading-[1.55] text-muted">
              {{ toast.description }}
            </ToastDescription>
          </div>
          <ToastClose class="icon-btn !h-7 !w-7 shrink-0" aria-label="关闭通知">
            <X :size="14" />
          </ToastClose>
        </div>
        <ToastAction
          v-if="toast.actionProps"
          class="mt-2.5 ml-[42px] border-0 bg-transparent p-0 text-[12px] font-600 text-primary"
        />
      </ToastRoot>
    </ToastViewport>
  </ToastPortal>
</template>

<script setup lang="ts">
import { CircleAlert, X } from 'lucide-vue-next'
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastPortal,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from 'reka-ui'

const { toasts } = useToastManager()
</script>
