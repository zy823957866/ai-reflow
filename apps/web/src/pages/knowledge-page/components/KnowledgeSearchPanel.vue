<template>
  <section class="surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <header class="flex min-h-[58px] shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div>
        <h2 class="m-0 text-[14px] font-650">检索测试</h2>
        <p class="mb-0 mt-1 text-[12px] text-subtle">向量、全文与混合检索已接入</p>
      </div>
      <StatusBadge :status="loading ? 'processing' : activeKb?.status ?? 'none'" />
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <div
        v-if="warnings.length"
        class="mb-3 flex items-start gap-2 rounded-[7px] border border-[#ecd5a3] bg-warning-soft px-2.5 py-2 text-[12px] leading-[1.5] text-warning"
      >
        <CircleAlert :size="14" class="mt-0.5 shrink-0" />
        <div class="min-w-0 flex-1">
          <strong class="block">检索已降级</strong>
          <p
            v-for="warning in warnings"
            :key="warning"
            class="mb-0 mt-0.5 break-words"
          >
            {{ retrievalWarningLabel(warning) }}
          </p>
        </div>
      </div>

      <label class="block">
        <span class="mb-1.5 block text-[12px] text-subtle">检索问题</span>
        <Textarea
          v-model="query"
          class="min-h-[88px] resize-y px-2.5 py-2 text-[12px] leading-[1.6]"
          rows="3"
          placeholder="输入要检索的问题..."
          @keydown.ctrl.enter.prevent="runSearch"
        />
      </label>

      <div class="mt-2.5 grid grid-cols-2 gap-2">
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">模式</span>
          <Select v-model="mode">
            <SelectTrigger class="h-8 min-w-0 rounded-[7px] px-2 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">混合</SelectItem>
              <SelectItem value="vector">向量</SelectItem>
              <SelectItem value="keyword">全文</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">Top K</span>
          <Input
            v-model.number="topK"
            class="h-8 rounded-[7px] px-2 py-0 text-[12px]"
            type="number"
            min="1"
            max="20"
          />
        </label>
        <label>
          <span class="mb-1.5 block text-[12px] text-subtle">阈值</span>
          <Input
            v-model.number="threshold"
            class="h-8 rounded-[7px] px-2 py-0 text-[12px]"
            type="number"
            min="0"
            max="1"
            step="0.01"
          />
        </label>
        <label title="使用 Rerank 模型对召回结果重新排序">
          <span class="mb-1.5 block text-[12px] text-subtle">Rerank</span>
          <Switch v-model="rerankEnabled" class="mt-1" />
        </label>
      </div>

      <Button
        class="mt-3 !h-9 w-full text-[12px]"
        type="button"
        :disabled="!query.trim() || loading || !activeKb"
        @click="runSearch"
      >
        <LoaderCircle v-if="loading" :size="14" class="animate-spin" />
        <Search v-else :size="14" />
        {{ loading ? '检索中' : '运行检索' }}
      </Button>

      <div class="mt-3 flex min-h-7 items-center justify-between border-b border-line pb-1.5 text-[12px] text-muted">
        <span>{{ results.length ? `命中 ${results.length} 条` : '检索结果' }}</span>
        <div class="flex items-center gap-2">
          <span
            v-if="rerankApplied"
            class="rounded-[4px] bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary"
            :title="rerankModel ? `Rerank: ${rerankModel}` : 'Rerank 已应用'"
          >
            Rerank 已应用
          </span>
          <small v-if="lastDuration" class="text-[12px] text-subtle">{{ lastDuration }} ms</small>
        </div>
      </div>

      <article
        v-for="result in results"
        :key="result.id"
        class="mt-2 rounded-[7px] border border-line bg-[var(--surface-2)] p-2.5"
      >
        <div class="flex items-center justify-between gap-2">
          <strong class="truncate text-[12px]">{{ result.documentName }}</strong>
          <span class="shrink-0 rounded-[4px] bg-primary-soft px-1.5 py-0.5 font-mono text-[12px] text-primary">
            {{ formatScore(result.rerankScore ?? result.score) }}
          </span>
        </div>
        <p class="mb-1.5 mt-1.5 line-clamp-3 text-[12px] leading-[1.55] text-muted">{{ result.snippet }}</p>
        <div class="flex flex-wrap gap-2 text-[12px] text-subtle">
          <span>{{ result.location }}</span>
          <span v-if="result.vectorScore !== undefined">vector {{ result.vectorScore.toFixed(2) }}</span>
          <span v-if="result.fulltextScore !== undefined">fulltext {{ result.fulltextScore.toFixed(2) }}</span>
          <span v-if="result.rerankScore !== undefined">rerank {{ formatScore(result.rerankScore) }}</span>
        </div>
        <Button variant="link" size="xs" class="mt-1.5" @click="copyCitation(result)">
          复制引用
        </Button>
      </article>

      <div v-if="!results.length" class="flex min-h-44 flex-col items-center justify-center gap-2 text-center text-[12px] text-subtle">
        <Sparkles :size="20" />
        <strong class="text-[12px]">{{ searchRan ? '没有达到阈值的结果' : '等待检索' }}</strong>
        <span>{{ searchRan ? '降低阈值或调整检索条件。' : '输入问题后验证引用与定位信息。' }}</span>
      </div>
    </div>

    <footer class="flex min-h-11 shrink-0 items-center justify-between gap-2 border-t border-line px-3 text-[12px] text-subtle">
      <span class="truncate">
        {{ activeKb
          ? `${activeKb.embeddingModel || '未配置模型'} · ${activeKb.dimensions || 0}d`
          : '请选择知识库' }}
      </span>
      <Button variant="link" size="xs" :disabled="!results.length" @click="saveFixture">
        保存样例
      </Button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { CircleAlert, LoaderCircle, Search, Sparkles } from 'lucide-vue-next'
import { searchKnowledge } from '@/services/reflowApi'
import { notifyError } from '@/shared/toast'
import StatusBadge from '@/components/StatusBadge.vue'
import { useKnowledgeBases } from '../composables/useKnowledgeBases'
import type { SearchResult } from '../types'
import { apiErrorText } from '../utils/errors'
import { retrievalWarningLabel } from '../utils/status'

const { activeKb, activeKbId } = useKnowledgeBases()

/** 检索问题文本 */
const query = ref('')
/** 检索模式：混合 / 向量 / 全文 */
const mode = ref<'hybrid' | 'vector' | 'keyword'>('hybrid')
/** 召回条数上限 */
const topK = ref(5)
/** 命中分数阈值 */
const threshold = ref(0)
/** 是否启用 Rerank 重排序 */
const rerankEnabled = ref(false)
/** 检索请求进行中 */
const loading = ref(false)
/** 是否已执行过检索（用于区分空态提示文案） */
const searchRan = ref(false)
/** 命中的检索结果列表 */
const results = ref<SearchResult[]>([])
/** 服务端返回的检索降级警告 */
const warnings = ref<string[]>([])
/** 最近一次检索耗时（毫秒） */
const lastDuration = ref(0)
/** 服务端是否实际应用了 rerank */
const rerankApplied = ref(false)
/** rerank 使用的模型名 */
const rerankModel = ref('')
/** 请求版本号，用于丢弃过期响应 */
let requestVersion = 0

/** 清空检索结果及全部相关状态 */
function resetResults() {
  requestVersion += 1
  loading.value = false
  searchRan.value = false
  results.value = []
  warnings.value = []
  lastDuration.value = 0
  rerankApplied.value = false
  rerankModel.value = ''
}

/** 执行知识库检索请求，成功后渲染结果与降级警告 */
async function runSearch() {
  const kbId = activeKbId.value
  if (loading.value || !query.value.trim() || !kbId) return
  const version = ++requestVersion
  loading.value = true
  searchRan.value = false
  results.value = []
  warnings.value = []
  lastDuration.value = 0
  rerankApplied.value = false
  rerankModel.value = ''
  const startedAt = performance.now()
  try {
    const response = await searchKnowledge(kbId, {
      query: query.value.trim(),
      topK: topK.value,
      scoreThreshold: threshold.value,
      retrievalMode: mode.value,
      rerank: { enabled: rerankEnabled.value },
    })
    if (version !== requestVersion || kbId !== activeKbId.value) return
    results.value = response.chunks.map((chunk, index) => ({
      ...chunk,
      citationId:
        typeof response.citations[index]?.id === 'string'
          ? response.citations[index].id
          : `c${index + 1}`,
    }))
    lastDuration.value = Math.round(performance.now() - startedAt)
    searchRan.value = true
    warnings.value = response.warnings ?? []
    rerankApplied.value = response.rerankApplied
    rerankModel.value = response.rerankModel ?? ''
  } catch (error) {
    if (version !== requestVersion) return
    warnings.value = []
    notifyError({
      title: '知识库检索失败',
      description: apiErrorText(error),
      retry: () => void runSearch(),
    })
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

/** 命中分数格式化（保留两位小数） */
function formatScore(value: number) {
  return value.toFixed(2)
}

/** 复制某条结果的引用文本到剪贴板 */
async function copyCitation(result: SearchResult) {
  const citation = `[${result.citationId ?? result.id}] ${result.documentName} · ${result.location} · score=${result.score.toFixed(4)}`
  await navigator.clipboard?.writeText(citation)
}

/** 把当前检索输入与结果存入 localStorage 作为回放样例 */
function saveFixture() {
  localStorage.setItem('reflow_knowledge_search_fixture', JSON.stringify({
    query: query.value,
    mode: mode.value,
    results: results.value,
    savedAt: new Date().toISOString(),
  }))
}

// 切换知识库时清空上一库的检索结果
watch(activeKbId, resetResults)
</script>
