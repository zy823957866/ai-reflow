<template>
  <aside class="flex h-full w-[264px] flex-col border-r border-line bg-white/97">
    <div class="flex items-start justify-between px-[15px] pb-3 pt-[17px]">
      <div>
        <h2 class="m-0 text-[15px] font-700">添加节点</h2>
        <p class="mb-0 mt-1 text-[12px] text-subtle">{{ registrations.length }} 个节点 · 拖到画布或点击添加</p>
      </div>
      <button class="icon-btn" title="关闭节点面板" @click="$emit('close')">
        <X :size="16" />
      </button>
    </div>
    <div class="control-shell mx-3.5 mb-2.5 flex h-[34px] items-center gap-1.5 rounded-[7px] bg-surface-2 px-[9px] text-subtle">
      <Search :size="14" />
      <input v-model="search" class="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] shadow-none" placeholder="搜索名称、type 或中文别名" />
      <button v-if="search" type="button" class="border-0 bg-transparent p-0 text-[12px] text-subtle" @click="search = ''">清除</button>
    </div>
    <div class="flex gap-1 px-3.5 pb-[9px]">
      <button
        v-for="option in phaseOptions"
        :key="option.value"
        class="inline-flex h-[26px] items-center gap-1 rounded-[5px] border-0 px-[7px] text-[12px]"
        :class="phase === option.value ? 'bg-primary-soft text-primary' : 'bg-transparent text-subtle'"
        @click="phase = option.value"
      >
        {{ option.label }}
        <span class="opacity-68">{{ countByPhase(option.value) }}</span>
      </button>
    </div>
    <div class="flex gap-1 overflow-x-auto px-3.5 pb-[9px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        v-for="category in categories"
        :key="category"
        class="h-6 whitespace-nowrap rounded-[5px] border border-line px-[7px] text-[12px]"
        :class="activeCategory === category ? 'border-[#d2cefc] bg-primary-soft text-primary' : 'bg-surface text-subtle'"
        @click="activeCategory = category"
      >
        {{ category }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-[11px] pb-1">
      <section v-for="group in groups" :key="group.category" class="pb-[7px]">
        <div class="flex items-center gap-1.5 px-[5px] pb-[5px] pt-2 text-[12px] font-650 text-subtle">
          <span>{{ group.category }}</span>
          <small class="text-[12px] text-subtle">{{ group.items.length }}</small>
        </div>
        <button
          v-for="item in group.items"
          :key="item.manifest.type"
          class="flex min-h-[42px] w-full items-center gap-2 rounded-[6px] border border-transparent bg-transparent px-[7px] py-[5px] text-left transition-colors hover:border-line hover:bg-surface-2"
          draggable="true"
          @dragstart="onDragStart($event, item.manifest.type)"
          @click="$emit('add', item.manifest.type)"
        >
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
            :style="{
              color: item.manifest.color,
              background: `color-mix(in srgb, ${item.manifest.color}, white 91%)`,
            }"
          >
            <NodeGlyph :name="item.manifest.icon" :size="17" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-px">
            <strong class="text-[12px] font-600 text-ink">{{ item.manifest.displayName }}</strong>
            <small class="font-mono text-[12px] text-subtle">{{ item.manifest.type }}</small>
          </span>
          <span class="rounded-[3px] px-1 py-0.5 text-[12px] font-600" :class="phaseClass(item.manifest.phase)">
            {{ item.manifest.phase }}
          </span>
          <GripVertical :size="13" class="text-subtle opacity-60" />
        </button>
      </section>
      <div v-if="!groups.length" class="flex flex-col items-center gap-[7px] px-4 py-[50px] text-[12px] text-subtle">
        <SearchX :size="20" />
        <span>没有匹配节点</span>
        <button type="button" class="border-0 bg-transparent text-[12px] text-primary" @click="clearFilters">清除筛选</button>
      </div>
    </div>
    <div class="flex items-center justify-between border-t border-line px-[13px] py-2.5 text-[12px] text-subtle">
      <span class="flex items-center gap-1"><MousePointer2 :size="13" /> 拖到画布后自动创建 nodeId</span>
      <span>注册表驱动</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { GripVertical, MousePointer2, Search, SearchX, X } from 'lucide-vue-next'
import NodeGlyph from '@/components/NodeGlyph.vue'
import { getNodeRegistrations, onNodeRegistryChange } from '@/shared/registry'
import type { NodeRegistration } from '@/shared/types'

defineEmits<{
  add: [type: string]
  close: []
}>()

const registrations = ref<NodeRegistration[]>(getNodeRegistrations())
const search = ref('')
const phase = ref('全部')
const activeCategory = ref('全部')
const phaseOptions = [
  { value: '全部', label: '全部' },
  { value: 'P0', label: 'P0' },
  { value: 'P0.5', label: 'P0.5' },
  { value: 'P1', label: 'P1' },
]

const cleanupRegistry = onNodeRegistryChange(() => {
  registrations.value = getNodeRegistrations()
})
onUnmounted(cleanupRegistry)

const categories = computed(() => {
  const groups = [...new Set(registrations.value.map((item) => item.manifest.category))]
  return ['全部', ...groups]
})

/**
 * 统计指定阶段内的节点数量。
 * @param value 阶段名称或全部。
 * @returns 节点数量。
 */
function countByPhase(value: string) {
  if (value === '全部') return registrations.value.length
  return registrations.value.filter((item) => item.manifest.phase === value).length
}

/**
 * 返回节点阶段标签的颜色。
 * @param phase 节点阶段。
 * @returns UnoCSS 背景和文本颜色类。
 */
function phaseClass(phase: string) {
  if (phase === 'P0') return 'bg-primary-soft text-primary'
  if (phase === 'P0.5') return 'bg-warning-soft text-warning'
  return 'bg-surface-3 text-subtle'
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return registrations.value.filter((item) => {
    const matchesSearch =
      !query ||
      item.manifest.displayName.toLowerCase().includes(query) ||
      item.manifest.type.toLowerCase().includes(query) ||
      item.manifest.description.includes(search.value.trim())
    const matchesPhase = phase.value === '全部' || item.manifest.phase === phase.value
    const matchesCategory =
      activeCategory.value === '全部' || item.manifest.category === activeCategory.value
    return matchesSearch && matchesPhase && matchesCategory
  })
})

const groups = computed(() => {
  const result: Array<{ category: string; items: NodeRegistration[] }> = []
  filtered.value.forEach((item) => {
    let group = result.find((entry) => entry.category === item.manifest.category)
    if (!group) {
      group = { category: item.manifest.category, items: [] }
      result.push(group)
    }
    group.items.push(item)
  })
  return result
})

/**
 * 将节点类型写入拖拽数据。
 * @param event 拖拽事件。
 * @param type 节点类型。
 */
function onDragStart(event: DragEvent, type: string) {
  event.dataTransfer?.setData('application/reflow-node', type)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

/** 清除搜索、阶段与分类筛选。 */
function clearFilters() {
  search.value = ''
  phase.value = '全部'
  activeCategory.value = '全部'
}
</script>

