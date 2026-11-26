<template>
  <section class="surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <header class="flex min-h-[58px] shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div>
        <h2 class="m-0 text-[14px] font-650">检索测试</h2>
        <p class="mb-0 mt-1 text-[12px] text-subtle">全文检索已接入</p>
      </div>
      <StatusBadge :status="loading ? 'processing' : activeKb?.status ?? 'none'" />
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <label class="block">
        <span class="mb-1.5 block text-[12px] text-subtle">检索问题</span>
        <textarea
          v-model="query"
          class="min-h-[88px] resize-y px-2.5 py-2 text-[12px] leading-[1.6]"
          rows="3"
          placeholder="输入要检索的问题..."
          @keydown.ctrl.enter.prevent="runSearch"
        />
      </label>

      <div class="mt-2.5 grid grid-cols-4 gap-2 max-[1100px]:grid-cols-2">
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">模式</span>
          <select v-model="mode" class="h-8 min-w-0 rounded-[7px] py-0 pl-2 pr-6 text-[12px]">
            <option value="hybrid" disabled>混合（未配置）</option>
            <option value="vector" disabled>向量（未配置）</option>
            <option value="keyword">全文</option>
          </select>
        </label>
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">Top K</span>
          <input v-model.number="topK" class="h-8 rounded-[7px] px-2 py-0 text-[12px]" type="number" min="1" max="20" />
        </label>
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">阈值</span>
          <input v-model.number="threshold" class="h-8 rounded-[7px] px-2 py-0 text-[12px]" type="number" min="0" max="1" step="0.01" />
        </label>
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">Rerank</span>
          <button
            type="button"
            class="h-8 w-full rounded-[7px] border border-line p-1.5 transition-colors"
            :class="rerankEnabled ? 'bg-primary-soft' : 'bg-[var(--surface-2)]'"
            @click="rerankEnabled = !rerankEnabled"
          >
            <span class="block h-[18px] w-8 rounded-full p-0.5 transition-colors" :class="rerankEnabled ? 'bg-primary' : 'bg-[#c7ccd6]'">
              <i class="block h-3.5 w-3.5 rounded-full bg-white transition-transform" :class="rerankEnabled ? 'translate-x-[14px]' : ''" />
            </span>
          </button>
        </label>
      </div>

      <button
        class="btn btn-primary mt-3 !h-9 w-full text-[12px]"
        type="button"
        :disabled="!query.trim() || loading || !activeKb"
        @click="runSearch"
      >
        <LoaderCircle v-if="loading" :size="14" class="animate-spin" />
        <Search v-else :size="14" />
        {{ loading ? '检索中' : '运行检索' }}
      </button>

      <div class="mt-3 flex min-h-7 items-center justify-between border-b border-line pb-1.5 text-[12px] text-muted">
        <span>{{ results.length ? `命中 ${results.length} 条` : '检索结果' }}</span>
        <small v-if="lastDuration" class="text-[12px] text-subtle">{{ lastDuration }} ms</small>
      </div>

      <article
        v-for="result in results"
        :key="result.id"
        class="mt-2 rounded-[7px] border border-line bg-[var(--surface-2)] p-2.5"
      >
        <div class="flex items-center justify-between gap-2">
          <strong class="truncate text-[12px]">{{ result.documentName }}</strong>
          <span class="shrink-0 rounded-[4px] bg-primary-soft px-1.5 py-0.5 font-mono text-[12px] text-primary">
            {{ result.score.toFixed(2) }}
          </span>
        </div>
        <p class="mb-1.5 mt-1.5 line-clamp-3 text-[12px] leading-[1.55] text-muted">{{ result.snippet }}</p>
        <div class="flex flex-wrap gap-2 text-[12px] text-subtle">
          <span>{{ result.location }}</span>
          <span v-if="result.vectorScore !== undefined">vector {{ result.vectorScore.toFixed(2) }}</span>
          <span v-if="result.fulltextScore !== undefined">fulltext {{ result.fulltextScore.toFixed(2) }}</span>
        </div>
        <button class="mt-1.5 border-0 bg-transparent p-0 text-[12px] text-primary" @click="copyCitation(result)">
          复制引用
        </button>
      </article>

      <div v-if="!results.length" class="flex min-h-44 flex-col items-center justify-center gap-2 text-center text-[12px] text-subtle">
        <Sparkles :size="20" />
        <strong class="text-[12px]">{{ searchRan ? '没有达到阈值的结果' : '等待检索' }}</strong>
        <span>{{ searchRan ? '降低阈值或调整检索条件。' : '输入问题后验证引用与定位信息。' }}</span>
      </div>
    </div>

    <footer class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-t border-line px-3 text-[12px] text-subtle">
      <span class="truncate">{{ activeKb?.embeddingModel }} · {{ activeKb?.dimensions }}d</span>
      <button class="border-0 bg-transparent p-0 text-primary disabled:text-subtle" :disabled="!results.length" @click="saveFixture">
        保存样例
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { LoaderCircle, Search, Sparkles } from 'lucide-vue-next'
import StatusBadge from '@/components/StatusBadge.vue'
import type { KnowledgeBaseItem, SearchRequest, SearchResult } from '../types'

const props = defineProps<{
  activeKb?: KnowledgeBaseItem
  results: SearchResult[]
  loading: boolean
  searchRan: boolean
  lastDuration: number
}>()

const emit = defineEmits<{
  search: [request: SearchRequest]
}>()

const query = ref('企业版试用如何申请？需要准备哪些材料？')
const mode = ref<'hybrid' | 'vector' | 'keyword'>('keyword')
const topK = ref(5)
const threshold = ref(0)
const rerankEnabled = ref(false)

function runSearch() {
  if (!query.value.trim() || props.loading) return
  emit('search', {
    query: query.value.trim(),
    retrievalMode: mode.value,
    topK: topK.value,
    scoreThreshold: threshold.value,
    rerankEnabled: rerankEnabled.value,
  })
}

async function copyCitation(result: SearchResult) {
  const citation = `[${result.citationId ?? result.id}] ${result.documentName} · ${result.location} · score=${result.score.toFixed(4)}`
  await navigator.clipboard?.writeText(citation)
}

function saveFixture() {
  localStorage.setItem('reflow_knowledge_search_fixture', JSON.stringify({
    query: query.value,
    mode: mode.value,
    results: props.results,
    savedAt: new Date().toISOString(),
  }))
}
</script>
