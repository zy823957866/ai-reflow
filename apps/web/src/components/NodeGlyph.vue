<template>
  <component :is="glyph" :size="size" :stroke-width="1.8" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Blocks,
  Bot,
  Braces,
  BookOpen,
  Clock3,
  Code2,
  Database,
  File,
  FileText,
  GitBranch,
  Maximize2,
  Monitor,
  Package,
  Play,
  Repeat2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Variable,
  Wrench,
  Box,
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{ name?: string; size?: number }>(), {
  name: 'box',
  size: 18,
})

const iconMap = {
  play: Play,
  monitor: Monitor,
  sparkles: Sparkles,
  wrench: Wrench,
  'book-open': BookOpen,
  'git-branch': GitBranch,
  braces: Braces,
  variable: Variable,
  blocks: Blocks,
  'file-text': FileText,
  split: Maximize2,
  bot: Bot,
  repeat: Repeat2,
  package: Package,
  'user-check': UserCheck,
  'clock-3': Clock3,
  'code-2': Code2,
  database: Database,
  'shield-check': ShieldCheck,
  file: File,
  box: Box,
}

const glyph = computed(() => iconMap[props.name as keyof typeof iconMap] ?? Box)
</script>
