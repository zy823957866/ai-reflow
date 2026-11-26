<template>
  <AppShell>
    <div class="min-h-screen">
      <header class="flex min-h-[62px] items-center justify-between gap-[18px] border-b border-line bg-white/96 px-7 max-md:pl-15 max-md:pr-4">
        <div class="flex min-w-0 items-center gap-[7px] text-[10px] text-subtle">
          <span>Acme 团队</span>
          <ChevronRight :size="13" />
          <strong class="truncate font-600 text-ink">知识库</strong>
        </div>
        <div class="flex items-center gap-2 max-md:flex-wrap">
          <label class="flex h-[35px] w-[min(280px,100%)] items-center gap-[7px] rounded-[7px] border border-line bg-surface px-2.5 max-[760px]:hidden">
            <Search :size="14" />
            <input v-model="kbQuery" class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[10px] shadow-none" placeholder="搜索知识库、文档..." />
            <kbd class="rounded-[3px] border border-line bg-[var(--surface-2)] px-1 py-0.5 font-sans text-[10.5px] text-subtle">⌘K</kbd>
          </label>
          <button class="btn btn-primary" @click="openCreateKnowledgeBase">
            <Plus :size="14" /> 新建知识库
          </button>
        </div>
      </header>

      <main class="mx-auto max-w-[1380px] px-7 pb-16 pt-[26px] max-md:pl-15 max-md:pr-4">
        <section class="mb-[18px] flex items-end justify-between gap-[22px] max-md:flex-col max-md:items-start">
          <div>
            <h1 class="m-0 text-[27px] font-[730]">知识库</h1>
            <p class="mb-0 mt-[7px] text-[10px] leading-[1.55] text-subtle">{{ kbList.length }} 个知识库 · {{ totalDocuments }} 份文档 · 最近同步于 {{ latestSync }}</p>
          </div>
          <div class="inline-flex flex-wrap gap-0.5 rounded-[7px] border border-line bg-[var(--surface-2)] p-[3px]">
            <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap rounded-[5px] border-0 px-[9px] text-[11.5px]" :class="kbStatusFilter === 'all' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="kbStatusFilter = 'all'">
              全部 <span>{{ kbList.length }}</span>
            </button>
            <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap rounded-[5px] border-0 px-[9px] text-[11.5px]" :class="kbStatusFilter === 'indexing' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="kbStatusFilter = 'indexing'">
              同步中 <span>{{ indexingCount }}</span>
            </button>
            <button class="inline-flex h-[27px] items-center gap-[5px] whitespace-nowrap rounded-[5px] border-0 px-[9px] text-[11.5px]" :class="kbStatusFilter === 'ready' ? 'bg-ink text-white' : 'bg-transparent text-subtle'" @click="kbStatusFilter = 'ready'">
              已完成 <span>{{ readyCount }}</span>
            </button>
          </div>
        </section>

        <div class="mb-3 flex items-start gap-[7px] rounded-[7px] border border-[#c9d9fb] bg-info-soft px-[11px] py-[9px] text-[11.5px] leading-[1.5] text-info">
          <Info :size="14" />
          <span>当前已接入知识库 CRUD、文档列表、切片与 PostgreSQL 全文检索；对象存储、ingest、向量/混合检索和对象签名预览未配置时会返回稳定错误码。</span>
        </div>

        <div v-if="loadError" class="mb-3 flex items-start gap-2 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-[11.5px] leading-[1.5] text-danger">
          <CircleAlert :size="14" />
          <span class="min-w-0 flex-1">{{ loadError }}</span>
          <button class="border-0 bg-transparent p-0 text-[11.5px] font-600 text-primary" @click="loadKnowledgeBases()">重试</button>
        </div>
        <div v-if="actionError" class="mb-3 flex items-start gap-2 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-[11.5px] leading-[1.5] text-danger">
          <CircleAlert :size="14" />
          <span class="min-w-0 flex-1">{{ actionError }}</span>
          <button class="icon-btn !h-6 !w-6" title="关闭错误提示" @click="actionError = ''"><X :size="12" /></button>
        </div>

        <section class="mb-3 grid grid-cols-3 gap-2.5 max-[980px]:grid-cols-1">
          <button
            v-for="kb in filteredKnowledgeBases"
            :key="kb.id"
            class="surface grid min-w-0 min-h-[112px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-[1fr_auto] gap-x-[9px] gap-y-[5px] p-[13px] text-left transition-[border-color,box-shadow] hover:border-border-strong"
            :class="activeKbId === kb.id ? 'border-primary shadow-[0_0_0_2px_rgba(91,77,240,0.08)]' : ''"
            @click="activeKbId = kb.id"
          >
            <span class="flex h-9 w-9 items-center justify-center rounded-[7px] bg-primary-soft text-primary"><BookOpen :size="18" /></span>
            <span class="flex min-w-0 flex-col gap-1">
              <strong class="text-[12px]">{{ kb.name }}</strong>
              <small class="line-clamp-2 text-[10.5px] leading-[1.45] text-subtle">{{ kb.description }}</small>
            </span>
            <span class="flex flex-col items-end gap-0.5">
              <strong class="text-[15px]">{{ compactNumber(kb.documents) }}</strong>
              <small class="text-[10px] text-subtle">{{ kb.documents }} 文档</small>
            </span>
            <span class="col-span-full flex min-w-0 items-center gap-1.5 border-t border-dashed border-line pt-2 text-[10px] text-subtle">
              <StatusBadge :status="kb.status === 'ready' ? 'ready' : kb.status" />
              <span>{{ kb.chunks.toLocaleString('zh-CN') }} chunks</span>
              <span class="ml-auto truncate font-mono">{{ kb.embeddingModel }}</span>
            </span>
          </button>
        </section>
        <div v-if="!kbLoading && !filteredKnowledgeBases.length" class="surface mb-3 flex min-h-[108px] flex-col items-center justify-center gap-2 text-[11.5px] text-subtle">
          <BookOpen :size="19" />
          <span>{{ kbQuery.trim() ? '没有匹配的知识库。' : '当前 workspace 还没有知识库。' }}</span>
          <button v-if="!kbQuery.trim()" class="border-0 bg-transparent p-0 text-[11.5px] text-primary" @click="openCreateKnowledgeBase">新建知识库</button>
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_360px] items-stretch gap-3 max-[1240px]:grid-cols-1">
          <section class="surface flex min-h-[660px] min-w-0 flex-col overflow-hidden">
            <div class="flex min-h-14 items-center justify-between gap-2.5 border-b border-line px-3.5 py-2.5 max-[760px]:flex-col max-[760px]:items-start">
              <div>
                <strong class="block text-[11px]">{{ activeKb?.name }}</strong>
                <span class="text-[10.5px] text-subtle">{{ activeDocuments.length }} 文档 · {{ activeChunkCount }} chunks</span>
              </div>
              <div class="flex items-center gap-[7px]">
                <button class="btn" :disabled="!activeKb" @click="openEditKnowledgeBase">编辑</button>
                <button class="btn btn-danger" :disabled="!activeKb" @click="removeKnowledgeBase">删除</button>
                <select v-model="docStatusFilter" class="h-[34px] w-auto min-w-[112px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按文档状态筛选">
                  <option value="">全部状态</option>
                  <option value="ready">已索引</option>
                  <option value="processing">处理中</option>
                  <option value="failed">索引失败</option>
                </select>
                <button class="btn" :disabled="!activeKb" @click="triggerFilePicker">
                  <Upload :size="13" /> 上传文档
                </button>
              </div>
            </div>

            <div
              class="mx-3 mt-2.5 flex min-h-[39px] flex-wrap items-center justify-center gap-[7px] rounded-[6px] border border-dashed p-[7px] text-[10.5px]"
              :class="dragActive ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong bg-[var(--surface-2)] text-subtle'"
              @dragover.prevent="dragActive = true"
              @dragleave.prevent="dragActive = false"
              @drop.prevent="handleDrop"
            >
              <UploadCloud :size="17" />
              <span>拖入 PDF、Word、Excel、CSV、Markdown 或 TXT</span>
              <button class="border-0 bg-transparent p-0 text-[10.5px] text-primary" @click="triggerFilePicker">选择文件</button>
              <input
                ref="fileInput"
                class="hidden"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.md,.markdown,.txt,.html"
                @change="handleFileInput"
              />
            </div>

            <div v-if="uploadQueue.length" class="flex flex-col px-3 pt-2">
              <div v-for="item in uploadQueue" :key="item.id" class="grid min-h-[43px] grid-cols-[28px_minmax(0,1fr)_minmax(70px,120px)_auto_auto] items-center gap-2 border-b border-dashed border-line text-[10.5px]">
                <span class="flex h-7 w-7 items-center justify-center rounded-[5px] bg-primary-soft text-primary"><FileText :size="14" /></span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <strong class="truncate">{{ item.name }}</strong>
                  <small class="text-[10px] text-subtle">{{ item.sizeLabel }} · {{ item.stage }}</small>
                </span>
                <span class="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]"><i class="block h-full rounded-full bg-primary transition-[width]" :style="{ width: `${item.progress}%` }" /></span>
                <StatusBadge :status="item.status" />
                <button v-if="item.status === 'failed'" class="border-0 bg-transparent p-0 text-[10.5px] text-primary" @click="retryUpload(item)">重试</button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto">
              <table class="w-full min-w-[780px] border-collapse [&_th]:h-[35px] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[10.5px] [&_th]:font-500 [&_th]:text-subtle [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-[11.5px] [&_td]:text-muted [&_tbody_tr:last-child_td]:border-b-0">
                <thead>
                  <tr>
                    <th>文档</th>
                    <th>类型</th>
                    <th>大小</th>
                    <th>分块</th>
                    <th>状态</th>
                    <th>更新</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="document in pagedDocuments" :key="document.id">
                    <td>
                      <button class="flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left" @click="openDocument(document)">
                        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] font-mono text-[10px] font-700 uppercase" :class="fileMarkClass(document.extension)">{{ document.extension }}</span>
                        <span class="flex min-w-0 flex-col gap-0.5">
                          <strong class="max-w-[260px] truncate text-[11.5px]">{{ document.name }}</strong>
                          <small class="truncate font-mono text-[10px] text-subtle">{{ document.chunkStrategy }}</small>
                        </span>
                      </button>
                    </td>
                    <td>{{ document.extension.toUpperCase() }}</td>
                    <td>{{ document.size }}</td>
                    <td>{{ document.chunks }}</td>
                    <td>
                      <span class="flex flex-col items-start gap-1">
                        <StatusBadge :status="document.status === 'ready' ? 'succeeded' : document.status" />
                        <small v-if="isProcessing(document)" class="text-[10px] text-subtle">{{ document.progress }}%</small>
                      </span>
                      <button
                        v-if="document.error"
                        class="max-w-[150px] truncate border-0 bg-transparent p-0 text-[10px] text-danger"
                        :title="document.error"
                        @click="openDocument(document)"
                      >
                        {{ document.error }}
                      </button>
                    </td>
                    <td>{{ relativeTime(document.updatedAt) }}</td>
                    <td>
                      <div class="flex items-center gap-1">
                        <button class="icon-btn !h-7 !w-7" title="查看切片与原文" @click="openDocument(document)">
                          <Eye :size="13" />
                        </button>
                        <button
                          v-if="document.status === 'failed'"
                          class="icon-btn"
                          title="重试索引"
                          @click="retryDocument(document)"
                        >
                          <RefreshCw :size="13" />
                        </button>
                        <button class="icon-btn" title="删除文档" @click="deleteDocument(document)">
                          <Trash2 :size="13" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!pagedDocuments.length" class="flex min-h-[120px] flex-col items-center justify-center gap-[7px] text-center text-[11.5px] text-subtle">
                <FileSearch :size="20" />
                <span>当前知识库没有匹配文档。</span>
              </div>
            </div>

            <div class="flex min-h-10 items-center justify-between border-t border-line px-3 text-[10.5px] text-subtle">
              <span>显示 {{ pageStart + 1 }}–{{ Math.min(pageStart + pageSize, filteredDocuments.length) }} / {{ filteredDocuments.length }}</span>
              <div class="flex items-center gap-2">
                <button class="icon-btn !h-[27px] !w-[27px]" :disabled="page === 1" @click="page--"><ChevronLeft :size="13" /></button>
                <span>{{ page }} / {{ totalPages }}</span>
                <button class="icon-btn !h-[27px] !w-[27px]" :disabled="page >= totalPages" @click="page++"><ChevronRight :size="13" /></button>
              </div>
            </div>
          </section>

          <aside class="surface flex min-h-[660px] flex-col overflow-hidden max-[1240px]:min-h-[530px]">
            <div class="flex min-h-[58px] items-center justify-between gap-2.5 border-b border-line px-3.5 py-2.5">
              <div>
                <strong class="block text-[13px]">检索测试</strong>
                <span class="text-[10.5px] text-subtle">keyword 已接入 · vector/hybrid 待配置</span>
              </div>
              <StatusBadge :status="testLoading ? 'processing' : activeKb?.status ?? 'none'" />
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <textarea
                v-model="searchQuery"
                class="min-h-[78px] resize-y text-[10px] leading-[1.6]"
                rows="3"
                placeholder="输入要检索的问题，例如：企业版试用需要哪些材料？"
                @keydown.ctrl.enter.prevent="runSearch"
              />
              <div class="mt-2.5 grid grid-cols-4 gap-2 max-[760px]:grid-cols-2">
                <label>
                  <span class="mb-1 block text-[10px] text-subtle">模式</span>
                  <select v-model="searchMode" class="h-[32px] min-w-0 rounded-[7px] py-0 pl-2 pr-6 text-[10.5px]">
                    <option value="hybrid" disabled>混合检索（未配置）</option>
                    <option value="vector" disabled>向量（未配置）</option>
                    <option value="keyword">全文</option>
                  </select>
                </label>
                <label>
                  <span class="mb-1 block text-[10px] text-subtle">Top K</span>
                  <input v-model.number="topK" class="h-[32px] px-2 py-0 text-[10.5px]" type="number" min="1" max="20" />
                </label>
                <label>
                  <span class="mb-1 block text-[10px] text-subtle">阈值</span>
                  <input v-model.number="threshold" class="h-[32px] px-2 py-0 text-[10.5px]" type="number" min="0" max="1" step="0.01" />
                </label>
                <label>
                  <span class="mb-1 block text-[10px] text-subtle">Rerank</span>
                  <button
                    class="h-[32px] w-full rounded-[7px] border border-line p-[7px] transition-colors"
                    :class="rerankEnabled ? 'bg-primary-soft' : 'bg-[var(--surface-2)]'"
                    @click="rerankEnabled = !rerankEnabled"
                  ><span class="block h-[18px] w-8 rounded-full p-0.5 transition-colors" :class="rerankEnabled ? 'bg-primary' : 'bg-[#c7ccd6]'"><i class="block h-3.5 w-3.5 rounded-full bg-white transition-transform" :class="rerankEnabled ? 'translate-x-[14px]' : ''" /></span></button>
                </label>
              </div>

              <button class="btn btn-primary mt-3 !h-[34px] w-full text-[11.5px]" :disabled="!searchQuery.trim() || testLoading" @click="runSearch">
                <LoaderCircle v-if="testLoading" :size="14" class="animate-spin" />
                <Search v-else :size="14" />
                {{ testLoading ? '检索中' : '运行检索' }}
              </button>

              <div class="mt-2.5 flex min-h-[26px] items-center justify-between border-b border-line pb-1.5 text-[10.5px] text-muted">
                <span>{{ searchResults.length ? `命中 ${searchResults.length} 条` : '检索结果' }}</span>
                <small v-if="lastSearchDuration" class="text-[10px] text-subtle">{{ lastSearchDuration }} ms · rerank {{ rerankEnabled ? 'on' : 'off' }}</small>
              </div>

              <div class="flex flex-col">
                <article v-for="result in searchResults" :key="result.id" class="mt-2 rounded-[6px] border border-line bg-[var(--surface-2)] p-2.5">
                  <div class="flex items-center justify-between gap-2">
                    <strong class="truncate text-[10.5px]">{{ result.documentName }}</strong>
                    <span class="rounded-[4px] bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] text-primary">{{ result.score.toFixed(2) }}</span>
                  </div>
                  <p class="mb-1.5 mt-1.5 line-clamp-3 text-[10.5px] leading-[1.55] text-muted">{{ result.snippet }}</p>
                  <div class="flex flex-wrap gap-2 text-[10px] text-subtle">
                    <span>{{ result.location }}</span>
                    <span v-if="result.vectorScore !== undefined">vector {{ result.vectorScore.toFixed(2) }}</span>
                    <span v-if="result.fulltextScore !== undefined">fulltext {{ result.fulltextScore.toFixed(2) }}</span>
                  </div>
                  <button class="mt-1 border-0 bg-transparent p-0 text-[10.5px] text-primary" @click="copyCitation(result)">复制引用</button>
                </article>
                <div v-if="!searchResults.length" class="flex min-h-[220px] flex-col items-center justify-center gap-[7px] text-center text-[10.5px] text-subtle">
                  <Sparkles :size="19" />
                  <strong>{{ searchRan ? '没有达到阈值的结果' : '等待检索' }}</strong>
                  <span>{{ searchRan ? '降低阈值或调整检索模式。' : '输入 query 后可验证引用、分数与定位元数据。' }}</span>
                </div>
              </div>
            </div>
            <div class="flex min-h-10 items-center justify-between border-t border-line px-3 text-[10px] text-subtle">
              <span>{{ activeKb?.embeddingModel }} · {{ activeKb?.dimensions }}d</span>
              <button class="border-0 bg-transparent p-0 text-[10.5px] text-primary disabled:text-subtle" :disabled="!searchResults.length" @click="saveSearchFixture">保存为测试样例</button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  </AppShell>

  <DialogRoot :open="createOpen" @update:open="createOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-80 bg-[rgba(18,20,26,0.28)] backdrop-blur-[2px]" />
      <DialogContent class="fixed left-1/2 top-1/2 z-81 w-[min(480px,calc(100vw-28px))] -translate-1/2 rounded-8px border border-line bg-surface p-[22px] shadow-lg">
        <DialogTitle class="m-0 text-[17px] font-700">{{ editingKbId ? '编辑知识库' : '新建知识库' }}</DialogTitle>
        <DialogDescription class="mb-[13px] mt-1.5 text-[10px] leading-[1.6] text-subtle">
          P0 部署级 embedding 模型与维度为只读，创建后不可随知识库单独切换。
        </DialogDescription>
        <div class="flex flex-col gap-2.5">
          <label class="flex flex-col gap-[7px]">
            <span class="text-[12px] font-600 text-muted">名称</span>
            <input v-model="newKbName" placeholder="例如：售后政策中心" />
          </label>
          <label class="flex flex-col gap-[7px]">
            <span class="text-[12px] font-600 text-muted">描述</span>
            <textarea v-model="newKbDescription" rows="3" placeholder="说明文档范围与使用场景" />
          </label>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line">
            <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px]"><span class="text-subtle">embedding 模型</span><strong class="truncate font-mono text-muted">text-embedding-3-small</strong></div>
            <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px]"><span class="text-subtle">维度</span><strong class="text-muted">1536</strong></div>
          </div>
        </div>
        <div v-if="actionError" class="mt-3 rounded-[6px] bg-danger-soft p-2 text-[10.5px] leading-[1.5] text-danger">{{ actionError }}</div>
        <div class="mt-5 flex justify-end gap-2">
          <DialogClose as-child><button class="btn">取消</button></DialogClose>
          <button class="btn btn-primary" :disabled="!newKbName.trim() || saving" @click="saveKnowledgeBase">{{ saving ? '保存中…' : editingKbId ? '保存修改' : '创建知识库' }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <div v-if="documentDrawerOpen && selectedDocument" class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" @click.self="documentDrawerOpen = false">
    <aside class="absolute inset-y-0 right-0 flex w-[min(820px,100vw)] flex-col bg-surface shadow-lg">
      <div class="flex min-h-[62px] items-center justify-between gap-3.5 border-b border-line px-4 py-3">
        <div>
          <h2 class="m-0 max-w-[680px] truncate text-[16px]">{{ selectedDocument.name }}</h2>
          <p class="mb-0 mt-1 text-[11.5px] text-subtle">{{ selectedDocument.extension.toUpperCase() }} · {{ selectedDocument.size }} · {{ selectedDocument.chunks }} chunks</p>
        </div>
        <button class="icon-btn" @click="documentDrawerOpen = false"><X :size="16" /></button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex min-h-10 items-center gap-2 text-[10.5px] text-subtle">
          <StatusBadge :status="documentBadgeStatus(selectedDocument)" />
          <span>{{ selectedPreview?.previewStatus ? `预览：${selectedPreview.previewStatus}` : '预览描述未就绪' }}</span>
          <button class="ml-auto border-0 bg-transparent p-0 text-[10.5px] text-primary" @click="rebuildDocument">重建索引</button>
        </div>

        <div v-if="selectedDocument.error" class="mt-2 flex items-start gap-2 rounded-[6px] border border-[#efbfc1] bg-danger-soft p-2.5 text-[10.5px] text-danger">
          <CircleAlert :size="14" />
          <span class="flex-1">{{ selectedDocument.error }}</span>
          <button class="border-0 bg-transparent p-0 text-[10.5px] text-primary" @click="retryDocument(selectedDocument)">重试失败阶段</button>
        </div>

        <div class="mt-3 grid min-h-[390px] grid-cols-[minmax(0,1.1fr)_minmax(250px,0.9fr)] gap-2.5 max-[980px]:grid-cols-1">
          <section class="flex min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
            <div class="flex min-h-9 items-center justify-between border-b border-line px-2.5 text-[10.5px] text-muted">
              <span>切片文本预览</span>
              <small class="text-[10px] text-subtle">{{ selectedDocument.pages ? `${selectedDocument.pages} 页` : selectedDocument.rows ? `${selectedDocument.rows} 行` : '文本文件' }}</small>
            </div>
            <div class="relative min-h-[354px] bg-[#fdfdfc] px-[18px] py-5">
              <div class="flex items-center justify-between text-[10px] text-subtle">
                <span>{{ selectedDocument.name }}</span>
                <span>{{ selectedChunk?.location ?? '未提供定位' }}</span>
              </div>
              <div v-if="chunksLoading" class="mt-8 flex items-center justify-center gap-2 text-[11.5px] text-subtle"><LoaderCircle :size="14" class="animate-spin" /> 正在读取切片…</div>
              <div v-else-if="!selectedChunk" class="mt-8 flex flex-col items-center justify-center gap-2 text-[11.5px] text-subtle"><FileSearch :size="18" /><span>该文档尚无可展示切片。</span></div>
              <template v-else>
                <h3 class="mb-3 mt-6 text-[14px]">{{ selectedDocument.titlePath?.[0] ?? selectedChunk.title }}</h3>
                <p class="mb-2.5 whitespace-pre-wrap text-[11.5px] leading-[1.75] text-muted">{{ selectedChunk.content }}</p>
              </template>
              <span class="absolute bottom-2.5 right-2.5 rounded-[4px] bg-white/80 px-1.5 py-0.5 font-mono text-[10px] text-subtle">切片正文 · 原始文件预览服务未配置</span>
            </div>
          </section>

          <section class="flex min-w-0 flex-col overflow-hidden rounded-[7px] border border-line bg-[var(--surface-2)]">
            <div class="flex min-h-9 items-center justify-between border-b border-line px-2.5 text-[10.5px] text-muted">
              <span>切片</span>
              <small class="text-[10px] text-subtle">{{ chunks.length }} 条 · 点击定位</small>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <button
                v-for="chunk in chunks"
                :key="chunk.id"
                class="mx-1.5 mt-1.5 flex w-[calc(100%-12px)] flex-col items-start gap-1 rounded-[6px] border bg-surface p-2 text-left"
                :class="selectedChunkId === chunk.id ? 'border-primary bg-primary-soft' : 'border-line hover:border-border-strong'"
                @click="selectedChunkId = chunk.id"
              >
                <span class="font-mono text-[10px] text-primary">{{ chunk.id }}</span>
                <strong class="text-[10.5px]">{{ chunk.title }}</strong>
                <p class="m-0 line-clamp-3 text-[10.5px] leading-[1.45] text-muted">{{ chunk.content }}</p>
                <span class="text-[10px] text-subtle">{{ chunk.location }} · {{ chunk.tokens }} tokens</span>
              </button>
              <div v-if="!chunks.length && !chunksLoading" class="flex min-h-[240px] items-center justify-center text-[10.5px] text-subtle">没有可展示的切片。</div>
            </div>
          </section>
        </div>

        <section class="mt-3">
          <div class="mb-2 text-[11.5px] font-650 text-muted">定位元数据</div>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line max-[620px]:grid-cols-1">
            <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px]"><span class="text-subtle">文件类型</span><strong class="truncate text-muted">{{ selectedDocument.mime }}</strong></div>
            <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px]"><span class="text-subtle">分块策略</span><strong class="truncate text-muted">{{ selectedDocument.chunkStrategy }}</strong></div>
            <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px]"><span class="text-subtle">embedding</span><strong class="truncate font-mono text-muted">{{ activeKb?.embeddingModel }}</strong></div>
            <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[10.5px]"><span class="text-subtle">向量状态</span><strong :class="documentChunks[0]?.embeddingStatus === 'failed' ? 'text-danger' : documentChunks[0]?.embeddingStatus === 'ready' ? 'text-success' : 'text-warning'">{{ documentChunks[0]?.embeddingStatus ?? '无切片' }}</strong></div>
          </div>
        </section>
      </div>
      <div class="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-4 py-3">
        <button class="btn" @click="copyText(chunks.map((item) => item.content).join('\n\n'))">复制切片</button>
        <button class="btn btn-primary" @click="documentDrawerOpen = false">关闭预览</button>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  FileSearch,
  FileText,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import AppShell from '@/components/AppShell.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { ApiError } from '@/api/client'
import { relativeTime } from '@/shared/format'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  getKnowledgePreview,
  getKnowledgeStats,
  listDocumentChunks,
  listKnowledgeBases,
  listKnowledgeDocuments,
  reindexKnowledgeDocument,
  retryKnowledgeDocument,
  searchKnowledge,
  updateKnowledgeBase,
  uploadKnowledgeDocument,
  type DocumentChunkDto,
  type KnowledgeBaseDto,
  type KnowledgeDocumentDto,
  type KnowledgePreviewDto,
  type KnowledgeSearchChunk,
  type KnowledgeStatsDto,
} from '@/services/reflowApi'

type KnowledgeBaseItem = KnowledgeBaseDto

type KnowledgeDocument = KnowledgeDocumentDto & {
  pages?: number
  rows?: number
  titlePath?: string[]
}

interface UploadItem {
  id: string
  name: string
  sizeLabel: string
  progress: number
  stage: string
  status: 'processing' | 'ready' | 'failed'
  file?: File
}

type SearchResult = KnowledgeSearchChunk & { citationId?: string }

const kbList = ref<KnowledgeBaseItem[]>([])
const documents = ref<KnowledgeDocument[]>([])
const uploadQueue = ref<UploadItem[]>([])
const activeKbId = ref('')
const kbQuery = ref('')
const kbStatusFilter = ref('all')
const docStatusFilter = ref('')
const page = ref(1)
const pageSize = 8
const dragActive = ref(false)
const fileInput = ref<HTMLInputElement>()
const createOpen = ref(false)
const newKbName = ref('')
const newKbDescription = ref('')
const searchQuery = ref('企业版试用如何申请？需要准备哪些材料？')
const searchMode = ref<'hybrid' | 'vector' | 'keyword'>('keyword')
const topK = ref(5)
const threshold = ref(0)
const rerankEnabled = ref(false)
const testLoading = ref(false)
const searchRan = ref(false)
const searchResults = ref<SearchResult[]>([])
const lastSearchDuration = ref(0)
const documentDrawerOpen = ref(false)
const selectedDocumentId = ref('')
const selectedChunkId = ref('')
const documentChunks = ref<DocumentChunkDto[]>([])
const selectedPreview = ref<KnowledgePreviewDto>()
const activeStats = ref<KnowledgeStatsDto>()
const kbLoading = ref(false)
const documentsLoading = ref(false)
const saving = ref(false)
const chunksLoading = ref(false)
const loadError = ref('')
const actionError = ref('')
const editingKbId = ref('')
let searchTimer: number | undefined

const activeKb = computed(() => kbList.value.find((item) => item.id === activeKbId.value))
const filteredKnowledgeBases = computed(() =>
  kbList.value.filter((item) => {
    if (kbStatusFilter.value !== 'all' && item.status !== kbStatusFilter.value) return false
    const needle = kbQuery.value.trim().toLowerCase()
    return !needle || [item.name, item.description].some((value) => value.toLowerCase().includes(needle))
  }),
)
const totalDocuments = computed(() => kbList.value.reduce((total, item) => total + item.documents, 0))
const indexingCount = computed(() => kbList.value.filter((item) => item.status === 'indexing').length)
const readyCount = computed(() => kbList.value.filter((item) => item.status === 'ready').length)
const latestSync = computed(() => {
  const latest = kbList.value.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  return latest ? relativeTime(latest.updatedAt) : '—'
})
const activeDocuments = computed(() =>
  documents.value.filter((document) => document.kbId === activeKbId.value),
)
const filteredDocuments = computed(() =>
  activeDocuments.value.filter((document) => {
    if (
      docStatusFilter.value &&
      (docStatusFilter.value === 'processing'
        ? !isProcessing(document)
        : document.status !== docStatusFilter.value)
    ) {
      return false
    }
    if (!kbQuery.value.trim()) return true
    return document.name.toLowerCase().includes(kbQuery.value.trim().toLowerCase())
  }),
)
const activeChunkCount = computed(() =>
  activeStats.value?.chunks ??
  activeDocuments.value.reduce((total, item) => total + item.chunks, 0),
)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredDocuments.value.length / pageSize)))
const pageStart = computed(() => (page.value - 1) * pageSize)
const pagedDocuments = computed(() => filteredDocuments.value.slice(pageStart.value, pageStart.value + pageSize))
const selectedDocument = computed(() => documents.value.find((item) => item.id === selectedDocumentId.value))
const chunks = computed(() =>
  documentChunks.value.map((chunk) => ({
    id: chunk.id,
    title: String(chunk.metadata.title ?? `切片 ${chunk.chunkIndex + 1}`),
    content: chunk.snippet,
    location: chunk.location,
    tokens: chunk.tokenCount ?? 0,
  })),
)
const selectedChunk = computed(() =>
  chunks.value.find((chunk) => chunk.id === selectedChunkId.value) ?? chunks.value[0],
)

watch([kbQuery, kbStatusFilter, docStatusFilter], () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    void loadKnowledgeBases(true)
  }, 300)
  page.value = 1
})

watch(activeKbId, async () => {
  docStatusFilter.value = ''
  page.value = 1
  await loadActiveKnowledge()
})

/**
 * 判断文档是否处于 ingest 中间状态。
 *
 * @param document 文档 DTO。
 * @returns 是否仍在处理中。
 */
function isProcessing(document: KnowledgeDocument) {
  return ['queued', 'parsing', 'chunking', 'embedding'].includes(document.status)
}

/**
 * 将文档状态映射到通用状态徽标。
 *
 * @param document 文档 DTO。
 * @returns 徽标状态。
 */
function documentBadgeStatus(document: KnowledgeDocument) {
  if (document.status === 'ready') return 'ready'
  if (document.status === 'failed') return 'failed'
  return 'processing'
}

/**
 * 将 API 异常转换为页面可读错误。
 *
 * @param error 捕获的异常。
 * @returns 适合展示的错误文本。
 */
function errorText(error: unknown) {
  if (error instanceof ApiError) {
    return [error.code, error.message].filter(Boolean).join('：')
  }
  return error instanceof Error ? error.message : '请求失败。'
}

/**
 * 加载知识库列表。
 *
 * @param silent 是否保留当前加载态。
 */
async function loadKnowledgeBases(silent = false) {
  if (!silent) kbLoading.value = true
  loadError.value = ''
  try {
    kbList.value = await listKnowledgeBases({
      search: kbQuery.value.trim() || undefined,
      status: kbStatusFilter.value === 'all' ? undefined : kbStatusFilter.value,
    })
    if (!kbList.value.some((item) => item.id === activeKbId.value)) {
      activeKbId.value = kbList.value[0]?.id ?? ''
    }
  } catch (error) {
    loadError.value = errorText(error)
  } finally {
    if (!silent) kbLoading.value = false
  }
}

/**
 * 加载当前知识库的文档和统计。
 */
async function loadActiveKnowledge() {
  if (!activeKbId.value) {
    documents.value = []
    activeStats.value = undefined
    return
  }
  documentsLoading.value = true
  loadError.value = ''
  try {
    const [items, stats] = await Promise.all([
      listKnowledgeDocuments(activeKbId.value),
      getKnowledgeStats(activeKbId.value),
    ])
    documents.value = items.map((item) => ({
      ...item,
      pages:
        typeof item.metadata?.pages === 'number'
          ? item.metadata.pages
          : undefined,
      rows:
        typeof item.metadata?.rows === 'number'
          ? item.metadata.rows
          : typeof item.metadata?.rowCount === 'number'
            ? item.metadata.rowCount
            : undefined,
      titlePath: Array.isArray(item.metadata?.headingPath)
        ? item.metadata.headingPath.map(String)
        : undefined,
    }))
    activeStats.value = stats
  } catch (error) {
    loadError.value = errorText(error)
    documents.value = []
  } finally {
    documentsLoading.value = false
  }
}

/**
 * 以千位单位压缩文档或切片数量。
 * @param value 原始数量。
 * @returns 适合概览卡片的短文本。
 */
function compactNumber(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

/** 触发隐藏文件输入选择上传文件。 */
function triggerFilePicker() {
  fileInput.value?.click()
}

/**
 * 将文件选择控件的结果加入上传队列。
 * @param event input change 事件。
 */
function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) queueFiles([...input.files])
  input.value = ''
}

/**
 * 处理拖放文件并重置拖拽高亮状态。
 * @param event 浏览器拖放事件。
 */
function handleDrop(event: DragEvent) {
  dragActive.value = false
  if (event.dataTransfer?.files) queueFiles([...event.dataTransfer.files])
}

/**
 * 校验扩展名和大小后上传文件。
 *
 * @param files 用户选择或拖入的文件。
 */
async function queueFiles(files: File[]) {
  const allowed = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'md', 'markdown', 'txt', 'html']
  await Promise.all(
    files.map(async (file) => {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      const item = reactive<UploadItem>({
        id: `upload_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        sizeLabel: formatFileSize(file.size),
        progress: 0,
        stage: 'queued',
        status: 'processing',
        file,
      })
      uploadQueue.value.unshift(item)
      if (!allowed.includes(extension)) {
        Object.assign(item, {
          status: 'failed',
          stage: '格式不支持',
          progress: 0,
        })
        return
      }
      if (file.size > 50 * 1024 * 1024) {
        Object.assign(item, {
          status: 'failed',
          stage: '超过 50 MB 单文件限制',
          progress: 0,
        })
        return
      }
      await uploadFile(item)
    }),
  )
}

/**
 * 调用文档上传接口并展示服务端真实状态。
 *
 * @param item 上传队列项。
 */
async function uploadFile(item: UploadItem) {
  if (!item.file || !activeKbId.value) return
  actionError.value = ''
  item.status = 'processing'
  item.progress = 0
  item.stage = 'uploading'
  try {
    const document = await uploadKnowledgeDocument(activeKbId.value, item.file)
    item.status = document.status === 'failed' ? 'failed' : 'ready'
    item.progress = document.status === 'ready' ? 100 : document.progress
    item.stage = document.status
    await loadActiveKnowledge()
  } catch (error) {
    item.status = 'failed'
    item.stage = errorText(error)
    item.progress = 0
    actionError.value = errorText(error)
  }
}

/**
 * 重新提交失败的上传项。
 *
 * @param item 上传队列项。
 */
async function retryUpload(item: UploadItem) {
  await uploadFile(item)
}

/**
 * 请求服务端从失败阶段重试文档 ingest。
 *
 * @param document 目标文档。
 */
async function retryDocument(document: KnowledgeDocument) {
  actionError.value = ''
  try {
    await retryKnowledgeDocument(document.id)
    await loadActiveKnowledge()
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 请求服务端重建当前文档索引。
 */
async function rebuildDocument() {
  if (!selectedDocument.value) return
  actionError.value = ''
  try {
    await reindexKnowledgeDocument(selectedDocument.value.id)
    await loadActiveKnowledge()
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 二次确认后删除文档并刷新真实统计。
 *
 * @param document 目标文档。
 */
async function deleteDocument(document: KnowledgeDocument) {
  if (!window.confirm(`删除“${document.name}”？切片和预览也会被清理。`)) return
  actionError.value = ''
  try {
    await deleteKnowledgeDocument(document.id)
    if (selectedDocumentId.value === document.id) {
      documentDrawerOpen.value = false
      selectedDocumentId.value = ''
    }
    await Promise.all([loadKnowledgeBases(true), loadActiveKnowledge()])
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 打开真实文档切片和预览抽屉。
 *
 * @param document 目标文档。
 */
async function openDocument(document: KnowledgeDocument) {
  selectedDocumentId.value = document.id
  selectedChunkId.value = ''
  documentChunks.value = []
  selectedPreview.value = undefined
  documentDrawerOpen.value = true
  chunksLoading.value = true
  actionError.value = ''
  try {
    documentChunks.value = await listDocumentChunks(document.id)
    selectedChunkId.value = documentChunks.value[0]?.id ?? ''
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    chunksLoading.value = false
  }
  try {
    selectedPreview.value = await getKnowledgePreview(document.id)
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 重置知识库表单并进入新建模式。
 */
function openCreateKnowledgeBase() {
  editingKbId.value = ''
  newKbName.value = ''
  newKbDescription.value = ''
  createOpen.value = true
}

/**
 * 用当前知识库数据进入编辑模式。
 */
function openEditKnowledgeBase() {
  if (!activeKb.value) return
  editingKbId.value = activeKb.value.id
  newKbName.value = activeKb.value.name
  newKbDescription.value = activeKb.value.description
  createOpen.value = true
}

/**
 * 创建或更新知识库。
 */
async function saveKnowledgeBase() {
  const name = newKbName.value.trim()
  if (!name || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    const saved = editingKbId.value
      ? await updateKnowledgeBase(editingKbId.value, {
          name,
          description: newKbDescription.value.trim(),
        })
      : await createKnowledgeBase({
          name,
          description: newKbDescription.value.trim(),
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          embeddingDimension: 1536,
        })
    createOpen.value = false
    await loadKnowledgeBases()
    activeKbId.value = saved.id
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

/**
 * 二次确认后删除当前知识库。
 */
async function removeKnowledgeBase() {
  if (!activeKb.value) return
  if (!window.confirm(`删除“${activeKb.value.name}”？服务端会检查工作流引用。`)) return
  actionError.value = ''
  try {
    await deleteKnowledgeBase(activeKb.value.id)
    activeKbId.value = ''
    await loadKnowledgeBases()
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 调用真实知识库检索接口并记录耗时。
 */
async function runSearch() {
  if (!searchQuery.value.trim() || testLoading.value || !activeKbId.value) return
  testLoading.value = true
  actionError.value = ''
  searchResults.value = []
  searchRan.value = false
  lastSearchDuration.value = 0
  const startedAt = performance.now()
  try {
    const response = await searchKnowledge(activeKbId.value, {
      query: searchQuery.value.trim(),
      topK: topK.value,
      scoreThreshold: threshold.value,
      retrievalMode: searchMode.value,
      rerank: { enabled: rerankEnabled.value },
    })
    searchResults.value = response.chunks.map((chunk, index) => ({
      ...chunk,
      citationId:
        typeof response.citations[index]?.id === 'string'
          ? response.citations[index].id
          : `c${index + 1}`,
    }))
    lastSearchDuration.value = Math.round(performance.now() - startedAt)
    searchRan.value = true
    if (response.warnings?.length) actionError.value = response.warnings.join('；')
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    testLoading.value = false
  }
}

/**
 * 复制可追踪的检索引用。
 *
 * @param result 命中的切片结果。
 */
function copyCitation(result: SearchResult) {
  void copyText(
    `[${result.citationId ?? result.id}] ${result.documentName} · ${result.location} · score=${result.score.toFixed(4)}`,
  )
}

/**
 * 将当前真实检索参数与结果保存为本地 fixture。
 */
function saveSearchFixture() {
  localStorage.setItem(
    'reflow_knowledge_search_fixture',
    JSON.stringify({
      query: searchQuery.value,
      mode: searchMode.value,
      results: searchResults.value,
      savedAt: new Date().toISOString(),
    }),
  )
}

/**
 * 将文本写入系统剪贴板。
 *
 * @param value 待复制文本。
 */
async function copyText(value: string) {
  await navigator.clipboard?.writeText(value)
}

/**
 * 将字节数格式化为 MB 或 KB。
 *
 * @param bytes 文件字节数。
 * @returns 紧凑文件大小文本。
 */
function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * 按文件扩展名返回文档标记的原子色类。
 *
 * @param extension 文件扩展名。
 * @returns 背景与前景色类名。
 */
function fileMarkClass(extension: string) {
  if (extension === 'xlsx' || extension === 'csv') return 'bg-success-soft text-success'
  if (extension === 'docx') return 'bg-primary-soft text-primary'
  return 'bg-info-soft text-info'
}

onMounted(async () => {
  await loadKnowledgeBases()
  if (activeKbId.value) await loadActiveKnowledge()
})

onUnmounted(() => {
  window.clearTimeout(searchTimer)
})
</script>

