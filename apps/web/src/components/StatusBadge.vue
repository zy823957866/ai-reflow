<template>
  <span class="inline-flex h-[21px] items-center gap-[5px] whitespace-nowrap rounded-[4px] px-[7px] text-[12px] font-600" :class="toneClass(tone)">
    <span class="h-[5px] w-[5px] rounded-full bg-current" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { NodeRunStatus, RunStatus, WorkflowStatus } from '@/shared/types'

const props = defineProps<{
  status: WorkflowStatus | RunStatus | NodeRunStatus | 'online' | 'ready' | 'reviewing' | string
}>()

const mapping: Record<string, { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'neutral' },
  published: { label: '已发布', tone: 'success' },
  reviewing: { label: '审核中', tone: 'warning' },
  archived: { label: '已归档', tone: 'neutral' },
  error: { label: '异常', tone: 'danger' },
  pending: { label: '待执行', tone: 'neutral' },
  running: { label: '运行中', tone: 'primary' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
  waiting: { label: '等待中', tone: 'warning' },
  skipped: { label: '已跳过', tone: 'neutral' },
  online: { label: '在线', tone: 'success' },
  ready: { label: '就绪', tone: 'success' },
  healthy: { label: '健康', tone: 'success' },
  degraded: { label: '降级', tone: 'warning' },
  offline: { label: '离线', tone: 'danger' },
  queued: { label: '排队中', tone: 'neutral' },
  installed: { label: '已安装', tone: 'success' },
  enabled: { label: '已启用', tone: 'success' },
  disabled: { label: '已禁用', tone: 'neutral' },
  config_required: { label: '需配置', tone: 'warning' },
  update_available: { label: '可更新', tone: 'primary' },
  processing: { label: '处理中', tone: 'warning' },
  parsing: { label: '解析中', tone: 'warning' },
  chunking: { label: '分块中', tone: 'warning' },
  embedding: { label: '向量化中', tone: 'warning' },
  indexing: { label: '索引中', tone: 'warning' },
  converting: { label: '转换中', tone: 'warning' },
  unsupported: { label: '不支持预览', tone: 'neutral' },
}

const value = computed(() => mapping[props.status] ?? { label: props.status, tone: 'neutral' })
const tone = computed(() => value.value.tone)
const label = computed(() => value.value.label)

/**
 * 将状态色调映射为轻量原子类。
 * @param value 当前状态色调。
 * @returns 背景与前景色原子类。
 */
function toneClass(value: string) {
  return {
    neutral: 'bg-[var(--surface-3)] text-muted',
    success: 'bg-success-soft text-success',
    primary: 'bg-primary-soft text-primary',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  }[value] ?? 'bg-[var(--surface-3)] text-muted'
}
</script>
