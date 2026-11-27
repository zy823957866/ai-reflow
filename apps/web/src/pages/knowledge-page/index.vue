<template>
  <div class="h-[calc(100vh-62px)] min-h-[560px] w-full overflow-x-auto overflow-y-hidden p-4">
    <div
      data-testid="knowledge-grid"
      class="grid h-full min-h-0 min-w-[1200px] grid-cols-[240px_minmax(0,1fr)_360px] gap-3"
    >
      <KnowledgeGroupPanel />
      <KnowledgeDocumentPanel />
      <KnowledgeSearchPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import KnowledgeDocumentPanel from './components/KnowledgeDocumentPanel.vue'
import KnowledgeGroupPanel from './components/KnowledgeGroupPanel.vue'
import KnowledgeSearchPanel from './components/KnowledgeSearchPanel.vue'
import { provideKnowledgeBases } from './composables/useKnowledgeBases'

// 在页面根部注入知识库共享状态（列表、选中项等），供三个子面板使用
provideKnowledgeBases()
</script>
