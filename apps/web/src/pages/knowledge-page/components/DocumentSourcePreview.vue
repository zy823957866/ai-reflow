<template>
  <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
    <div class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3 text-[12px] text-muted">
      <span>原件预览</span>
      <small class="truncate text-[12px] text-subtle">{{ document.size }}</small>
    </div>

    <div class="relative min-h-0 flex-1 overflow-auto bg-[#f4f5f7]">
      <div v-if="loading" class="flex h-full min-h-60 items-center justify-center gap-2 text-[12px] text-subtle">
        <LoaderCircle :size="15" class="animate-spin" />
        正在读取原件
      </div>

      <div v-else-if="error" class="flex h-full min-h-60 flex-col items-center justify-center gap-3 px-5 text-center">
        <CircleAlert :size="20" class="text-danger" />
        <div>
          <div class="text-[13px] font-600 text-ink">原件读取失败</div>
          <p class="mb-0 mt-1 text-[12px] leading-5 text-subtle">{{ error }}</p>
        </div>
        <Button variant="outline" size="xs" @click="loadSource">重新加载</Button>
      </div>

      <div v-else-if="kind === 'unsupported'" class="flex h-full min-h-60 flex-col items-center justify-center gap-2 px-5 text-center text-[12px] text-subtle">
        <FileQuestion :size="20" />
        <span>暂不支持预览 .{{ document.extension }} 原件</span>
      </div>

      <iframe
        v-else-if="kind === 'pdf' && pdfUrl"
        :src="pdfUrl"
        class="h-full min-h-0 w-full border-0 bg-white"
        :title="`${document.name} 原件预览`"
      />

      <iframe
        v-else-if="kind === 'html' && htmlFrame"
        :srcdoc="htmlFrame"
        class="h-full min-h-0 w-full border-0 bg-white"
        :title="`${document.name} 原件预览`"
        sandbox=""
      />

      <article
        v-else-if="kind === 'docx' || kind === 'markdown'"
        class="source-doc mx-auto min-h-full max-w-[760px] bg-white px-8 py-7 text-[13px] leading-7 text-muted shadow-sm"
        v-html="articleHtml"
      />

      <div v-else-if="kind === 'text'" class="min-h-full bg-white">
        <pre class="m-0 whitespace-pre-wrap break-words px-6 py-5 font-mono text-[12px] leading-6 text-muted">{{ textContent }}</pre>
      </div>

      <div v-else-if="kind === 'csv'" class="min-h-full bg-white p-3">
        <table class="w-full border-collapse text-left text-[12px]">
          <thead class="sticky top-0 z-1 bg-[var(--surface-3)]">
            <tr>
              <th
                v-for="(cell, columnIndex) in csvRows[0] ?? []"
                :key="columnIndex"
                class="min-w-24 max-w-[320px] border border-line px-2.5 py-2 font-600 text-muted"
              >
                {{ cell || `列 ${columnIndex + 1}` }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in csvRows.slice(1)" :key="rowIndex" class="even:bg-[var(--surface-2)]">
              <td
                v-for="(cell, columnIndex) in row"
                :key="columnIndex"
                class="min-w-24 max-w-[320px] whitespace-pre-wrap break-words border border-line px-2.5 py-2 align-top text-muted"
              >
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="kind === 'xlsx'" class="flex min-h-full flex-col bg-white">
        <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-[var(--surface-2)] px-2 pt-2">
          <button
            v-for="sheet in sheets"
            :key="sheet.name"
            type="button"
            class="shrink-0 border-0 border-b-2 bg-transparent px-3 py-2 text-[12px]"
            :class="activeSheetName === sheet.name ? 'border-primary font-600 text-primary' : 'border-transparent text-subtle hover:text-muted'"
            @click="activeSheetName = sheet.name"
          >
            {{ sheet.name }}
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-3">
          <table class="w-full border-collapse text-left text-[12px]">
            <thead class="sticky top-0 z-1 bg-[var(--surface-3)]">
              <tr>
                <th
                  v-for="(cell, columnIndex) in activeSheet?.rows[0] ?? []"
                  :key="columnIndex"
                  class="min-w-24 max-w-[320px] border border-line px-2.5 py-2 font-600 text-muted"
                >
                  {{ cell || `列 ${columnIndex + 1}` }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in activeSheet?.rows.slice(1) ?? []"
                :key="rowIndex"
                class="even:bg-[var(--surface-2)]"
              >
                <td
                  v-for="(cell, columnIndex) in row"
                  :key="columnIndex"
                  class="min-w-24 max-w-[320px] whitespace-pre-wrap break-words border border-line px-2.5 py-2 align-top text-muted"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { CircleAlert, FileQuestion, LoaderCircle } from 'lucide-vue-next'
import { Button } from '@ai-reflow/ui'
import { getKnowledgeSource } from '@/services/reflowApi'
import { renderAgentMarkdown } from '@/pages/agents-page/markdown'
import type { KnowledgeDocument } from '../types'
import {
  knowledgeSourcePreviewKind,
  parseCsvPreview,
} from '../sourcePreview'

interface PreviewSheet {
  name: string
  rows: string[][]
}

const props = defineProps<{
  document: KnowledgeDocument
}>()

const maxSheetRows = 2000
const loading = ref(false)
const error = ref('')
const textContent = ref('')
const articleHtml = ref('')
const htmlFrame = ref('')
const csvRows = ref<string[][]>([])
const sheets = ref<PreviewSheet[]>([])
const activeSheetName = ref('')
const pdfUrl = ref('')
let loadSequence = 0

const kind = computed(() =>
  knowledgeSourcePreviewKind(props.document.extension),
)
const activeSheet = computed(() =>
  sheets.value.find((sheet) => sheet.name === activeSheetName.value),
)

watch(
  () => props.document.id,
  () => {
    void loadSource()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  revokePdfUrl()
})

/**
 * 读取并转换当前附件原件。
 */
async function loadSource() {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  textContent.value = ''
  articleHtml.value = ''
  htmlFrame.value = ''
  csvRows.value = []
  sheets.value = []
  activeSheetName.value = ''
  revokePdfUrl()

  try {
    const blob = await getKnowledgeSource(props.document.id)
    if (sequence !== loadSequence) return
    if (kind.value === 'pdf') {
      pdfUrl.value = URL.createObjectURL(
        new Blob([blob], { type: 'application/pdf' }),
      )
    } else if (kind.value === 'docx') {
      const imported = await import('mammoth') as unknown as {
        default?: MammothApi
      } & MammothApi
      const mammoth = imported.default ?? imported
      const result = await mammoth.convertToHtml({
        arrayBuffer: await blob.arrayBuffer(),
      })
      articleHtml.value = sanitizeArticleHtml(result.value)
    } else if (kind.value === 'xlsx') {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
      sheets.value = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name]
        const rows = worksheet
          ? XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
              header: 1,
              blankrows: false,
              defval: '',
              raw: false,
            }).map((row) => row.map((cell) => String(cell ?? '')))
          : []
        return { name, rows: rows.slice(0, maxSheetRows) }
      })
      activeSheetName.value = sheets.value[0]?.name ?? ''
    } else {
      textContent.value = await blob.text()
      if (kind.value === 'csv') {
        csvRows.value = parseCsvPreview(textContent.value)
      } else if (kind.value === 'markdown') {
        articleHtml.value = renderAgentMarkdown(textContent.value)
      } else if (kind.value === 'html') {
        htmlFrame.value = sanitizeHtmlDocument(textContent.value)
      }
    }
  } catch (cause) {
    if (sequence !== loadSequence) return
    error.value = cause instanceof Error ? cause.message : '请稍后重试。'
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function sanitizeArticleHtml(source: string) {
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcdoc'],
  })
}

function sanitizeHtmlDocument(source: string) {
  const sanitized = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'object', 'embed', 'form', 'base'],
    FORBID_ATTR: ['srcdoc'],
  })
  const policy = [
    '<meta http-equiv="Content-Security-Policy"',
    ' content="default-src \'none\'; img-src * data: blob:;',
    ' style-src * \'unsafe-inline\'; font-src * data:;">',
  ].join('')
  return /<\/head>/i.test(sanitized)
    ? sanitized.replace(/<\/head>/i, `${policy}</head>`)
    : `${policy}${sanitized}`
}

function revokePdfUrl() {
  if (!pdfUrl.value) return
  URL.revokeObjectURL(pdfUrl.value)
  pdfUrl.value = ''
}

interface MammothApi {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
}
</script>

<style scoped>
.source-doc :deep(h1),
.source-doc :deep(h2),
.source-doc :deep(h3),
.source-doc :deep(h4) {
  margin: 1.25em 0 0.55em;
  color: var(--ink);
  font-weight: 650;
  line-height: 1.45;
}

.source-doc :deep(h1:first-child),
.source-doc :deep(h2:first-child),
.source-doc :deep(h3:first-child) {
  margin-top: 0;
}

.source-doc :deep(h1) {
  font-size: 22px;
}

.source-doc :deep(h2) {
  font-size: 18px;
}

.source-doc :deep(h3) {
  font-size: 15px;
}

.source-doc :deep(p),
.source-doc :deep(ul),
.source-doc :deep(ol),
.source-doc :deep(blockquote),
.source-doc :deep(pre),
.source-doc :deep(table) {
  margin: 0 0 1em;
}

.source-doc :deep(ul),
.source-doc :deep(ol) {
  padding-left: 1.5em;
}

.source-doc :deep(blockquote) {
  border-left: 3px solid var(--border-strong);
  padding-left: 1em;
  color: var(--ink-3);
}

.source-doc :deep(pre) {
  overflow: auto;
  border-radius: 6px;
  background: var(--surface-3);
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.source-doc :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.source-doc :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.source-doc :deep(th),
.source-doc :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
}

.source-doc :deep(img) {
  max-width: 100%;
  height: auto;
}

.source-doc :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
</style>
