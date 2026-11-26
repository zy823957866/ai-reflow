<template>
  <AppShell>
    <div class="min-h-screen">
      <header class="flex min-h-[62px] items-center justify-between gap-[18px] border-b border-line bg-white/96 px-7 max-md:pl-15 max-md:pr-4">
        <div class="flex min-w-0 items-center gap-[7px] text-[10px] text-subtle">
          <RouterLink to="/" class="hover:text-ink">工作流</RouterLink>
          <ChevronRight :size="13" />
          <RouterLink to="/runs" class="hover:text-ink">运行记录</RouterLink>
          <ChevronRight :size="13" />
          <strong class="truncate font-mono text-ink">{{ runId }}</strong>
        </div>
        <div class="flex items-center gap-2 max-md:flex-wrap">
          <button class="btn btn-ghost" @click="router.push('/runs')">
            <ArrowLeft :size="14" /> 返回列表
          </button>
          <button class="btn" @click="copyDiagnostics">
            <Copy :size="14" /> 复制诊断包
          </button>
          <button class="btn" :disabled="actionPending" @click="replay">
            <RotateCcw :size="14" /> 原样重跑
          </button>
        </div>
      </header>

      <main class="mx-auto max-w-[1380px] px-7 pb-16 pt-[26px] max-md:pl-15 max-md:pr-4">
        <section v-if="loading" class="surface flex min-h-[420px] flex-col items-center justify-center gap-3 p-10 text-center text-subtle">
          <LoaderCircle :size="28" class="animate-spin text-primary" />
          <h1 class="m-0 text-[20px]">正在读取运行详情</h1>
          <p class="m-0 text-[10px]">正在加载 definition_snapshot、节点记录与已脱敏事件。</p>
        </section>

        <section v-else-if="loadError" class="surface flex min-h-[420px] flex-col items-center justify-center gap-3 p-10 text-center">
          <CircleAlert :size="30" class="text-danger" />
          <h1 class="m-0 text-[20px]">运行详情加载失败</h1>
          <p class="m-0 max-w-[520px] text-[10px] leading-[1.6] text-subtle">{{ loadError }}</p>
          <button class="btn btn-primary" @click="refreshRun()">重试</button>
        </section>

        <section v-else-if="!run" class="surface flex min-h-[420px] flex-col items-center justify-center gap-3 p-10 text-center">
          <FileQuestion :size="30" />
          <h1 class="m-0 text-[24px]">运行记录不存在</h1>
          <p class="m-0 text-[10px] text-subtle"><span class="font-mono">{{ runId }}</span> 不存在或当前工作区无权访问。</p>
          <RouterLink to="/runs" class="btn btn-primary">返回运行记录</RouterLink>
        </section>

        <template v-else>
          <div v-if="actionError" class="mb-3 flex items-start justify-between gap-3 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-danger">
            <div class="min-w-0">
              <strong class="text-[10px]">运行操作失败</strong>
              <p class="mb-0 mt-1 text-[11.5px] leading-[1.55] text-[#9c4045]">{{ actionError }}</p>
            </div>
            <button class="icon-btn !h-[30px] !w-[30px] shrink-0" title="关闭错误提示" @click="actionError = ''"><X :size="13" /></button>
          </div>

          <section class="mb-[18px] flex items-end justify-between gap-[22px] max-md:flex-col max-md:items-start">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2.5">
                <h1 class="m-0 font-mono text-[27px] tracking-0">{{ shortRunId(run.id, 12) }}</h1>
                <StatusBadge :status="run.status" />
                <span class="rounded-[4px] px-1.5 py-0.5 text-[10.5px]" :class="run.runKind === 'production' ? 'bg-primary-soft text-primary' : 'bg-[var(--surface-3)] text-subtle'">
                  {{ run.runKind === 'production' ? '正式运行' : '草稿预览' }}
                </span>
              </div>
              <p class="mb-0 mt-[7px] text-[10px] text-subtle">
                {{ run.workflowName }} · {{ triggerLabel(run.trigger) }} ·
                <span class="font-mono">{{ run.versionId ?? 'definition_snapshot' }}</span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2 max-md:flex-wrap">
              <button
                v-if="canCancel"
                class="btn btn-danger"
                :disabled="actionPending"
                @click="cancelRun"
              >
                <Square :size="13" /> 取消运行
              </button>
              <RouterLink
                v-if="run.versionId"
                :to="{ path: `/workflows/${run.workflowId}/trial`, query: { versionId: run.versionId } }"
                class="btn"
              >
                <GitCommitHorizontal :size="14" /> 查看固定版本
              </RouterLink>
            </div>
          </section>

          <section class="surface mb-3 grid grid-cols-1 gap-px overflow-hidden bg-line sm:grid-cols-2 xl:grid-cols-4">
            <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
              <span class="text-[11.5px] text-subtle">总耗时</span>
              <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">{{ durationLabel(run) }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic text-success">含节点重试</em></div>
            </div>
            <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
              <span class="text-[11.5px] text-subtle">节点完成</span>
              <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">{{ completedNodes }}/{{ run.nodeRuns.length }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic" :class="failedNodes ? 'text-danger' : 'text-success'">{{ failedNodes }} 失败</em></div>
            </div>
            <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
              <span class="text-[11.5px] text-subtle">Token 用量</span>
              <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">{{ run.metadata.tokens?.toLocaleString('zh-CN') ?? '—' }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic text-success">服务端 usage</em></div>
            </div>
            <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
              <span class="text-[11.5px] text-subtle">估算费用</span>
              <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="truncate text-[19px] tabular-nums">{{ run.metadata.cost ? `¥${run.metadata.cost.toFixed(2)}` : '—' }}</strong><em class="whitespace-nowrap text-[10.5px] not-italic text-success">来源可追溯</em></div>
            </div>
          </section>

          <div v-if="run.error" class="mb-3 flex items-start gap-2.5 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-danger">
            <CircleAlert :size="15" />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <strong class="font-mono text-[11.5px]">{{ run.error.code }}</strong>
              <span class="text-[10.5px] leading-[1.45] text-[#9c4045]">{{ run.error.message }}</span>
            </div>
            <button class="border-0 bg-transparent p-0 text-[10.5px] text-danger" @click="openNode(run.error.nodeId)">定位失败节点</button>
          </div>

          <div class="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-3 max-[1120px]:grid-cols-1">
            <section class="surface min-w-0 overflow-hidden">
              <div class="flex min-h-[45px] items-center gap-1 overflow-x-auto border-b border-line px-3">
                <button
                  v-for="tab in mainTabs"
                  :key="tab.key"
                  class="inline-flex h-[31px] shrink-0 items-center gap-[5px] rounded-[5px] border-0 px-2.5 text-[11.5px]"
                  :class="activeTab === tab.key ? 'bg-primary-soft text-primary' : 'bg-transparent text-muted hover:bg-[var(--surface-2)]'"
                  @click="activeTab = tab.key"
                >
                  <component :is="tab.icon" :size="13" />
                  {{ tab.label }}
                  <span v-if="tab.count !== undefined">{{ tab.count }}</span>
                </button>
              </div>

              <div v-if="activeTab === 'nodes'" class="p-3">
                <div class="mb-2.5 flex min-h-[38px] items-center justify-between gap-2.5">
                  <div>
                    <strong class="block text-[10px]">节点执行</strong>
                    <span class="text-[10.5px] text-subtle">点击行查看输入、输出、attempt 与错误。</span>
                  </div>
                  <select v-model="nodeStatusFilter" class="h-[34px] w-auto min-w-[112px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按节点状态筛选">
                    <option value="">全部状态</option>
                    <option value="succeeded">成功</option>
                    <option value="failed">失败</option>
                    <option value="queued">排队中</option>
                    <option value="running">运行中</option>
                    <option value="pending">等待</option>
                    <option value="skipped">跳过</option>
                  </select>
                </div>
                <div class="overflow-auto rounded-[6px] border border-line">
                  <table class="w-full min-w-[720px] border-collapse [&_th]:h-[35px] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[10.5px] [&_th]:font-500 [&_th]:text-subtle [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-[11.5px] [&_td]:text-muted [&_tbody_tr:last-child_td]:border-b-0">
                    <thead>
                      <tr>
                        <th>节点</th>
                        <th>类型</th>
                        <th>attempt</th>
                        <th>状态</th>
                        <th>开始</th>
                        <th>耗时</th>
                        <th>错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="nodeRun in filteredNodeRuns"
                        :key="nodeRun.nodeId"
                        class="cursor-pointer transition-colors hover:bg-[#fbfcfe]"
                        @click="openNode(nodeRun.nodeId)"
                      >
                        <td>
                          <div class="flex items-center gap-[7px]">
                            <span class="h-[7px] w-[7px] rounded-full" :class="nodeRun.status === 'succeeded' ? 'bg-success' : nodeRun.status === 'running' ? 'bg-primary animate-pulse' : nodeRun.status === 'failed' ? 'bg-danger' : 'bg-[#c7ccd6]'" />
                            <strong class="text-[11.5px]">{{ nodeRun.title }}</strong>
                          </div>
                        </td>
                        <td><span class="font-mono">{{ nodeRun.type }}</span></td>
                        <td>{{ nodeRun.attempt ?? nodeRun.attempts?.length ?? 1 }}</td>
                        <td><StatusBadge :status="nodeRun.status" /></td>
                        <td>{{ nodeRun.startedAt ? formatEventTime(nodeRun.startedAt) : '—' }}</td>
                        <td>{{ formatDuration(nodeRun.durationMs) }}</td>
                        <td>
                          <span v-if="nodeRun.error" class="font-mono text-danger">{{ nodeRun.error.code }}</span>
                          <span v-else class="text-subtle">—</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-if="!filteredNodeRuns.length" class="flex min-h-[120px] flex-col items-center justify-center gap-[7px] text-center text-[11.5px] text-subtle">
                    <SearchX :size="20" />
                    <span>当前筛选没有节点记录。</span>
                  </div>
                </div>
              </div>

              <div v-else-if="activeTab === 'events'" class="p-3">
                <div class="mb-2.5 flex min-h-[38px] items-center justify-between gap-2.5">
                  <div>
                    <strong class="block text-[10px]">事件时间线</strong>
                    <span class="text-[10.5px] text-subtle">按 seq 排序，服务端事件已脱敏。</span>
                  </div>
                  <select v-model="eventTypeFilter" class="h-[34px] w-auto min-w-[112px] rounded-[7px] border-line bg-surface py-0 pl-[9px] pr-7 text-[11.5px]" aria-label="按事件类型筛选">
                    <option value="">全部事件</option>
                    <option value="run">运行生命周期</option>
                    <option value="node">节点事件</option>
                    <option value="token">Token 流</option>
                  </select>
                </div>
                <div class="max-h-[560px] overflow-y-auto rounded-[6px] border border-line">
                  <button
                    v-for="event in filteredEvents"
                    :key="event.seq"
                    class="grid min-h-[42px] w-full grid-cols-[34px_7px_minmax(0,1fr)_58px_46px] items-center gap-2 border-0 border-b border-line bg-transparent px-2.5 text-left hover:bg-[#fbfcfe] last:border-b-0"
                    @click="openNode(event.nodeId)"
                  >
                    <span class="font-mono text-[10px] text-subtle">{{ String(event.seq).padStart(3, '0') }}</span>
                    <span class="h-[7px] w-[7px] rounded-full" :class="eventTone(event.type) === 'success' ? 'bg-success' : eventTone(event.type) === 'danger' ? 'bg-danger' : 'bg-primary'" />
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <strong class="truncate font-mono text-[10.5px] text-muted">{{ event.type }}</strong>
                      <small class="truncate text-[10px] text-subtle">{{ eventDescription(event) }}</small>
                    </span>
                    <span class="text-right text-[10px] text-subtle">{{ formatEventTime(event.at) }}</span>
                    <span class="text-right text-[10px] text-subtle">{{ eventDuration(event) }}</span>
                  </button>
                  <div v-if="!filteredEvents.length" class="flex min-h-[120px] items-center justify-center text-[11.5px] text-subtle">当前筛选没有事件。</div>
                </div>
              </div>

              <div v-else class="p-3">
                <div class="mb-2.5 flex items-center justify-between gap-2.5">
                  <div>
                    <strong class="block text-[10px]">原始 JSON</strong>
                    <span class="text-[10.5px] text-subtle">展示服务端脱敏版本，大输出请从 artifact 下载。</span>
                  </div>
                  <button class="border-0 bg-transparent p-0 text-[10.5px] text-primary" @click="copyText(rawJson)">复制完整 JSON</button>
                </div>
                <pre class="m-0 max-h-[620px] overflow-auto rounded-[6px] bg-[var(--code-bg)] p-3 font-mono text-[11.5px] leading-[1.65] text-[#d8dbe5]">{{ rawJson }}</pre>
              </div>
            </section>

            <aside class="flex flex-col gap-3">
              <section class="surface overflow-hidden">
                <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                  <div><h2 class="m-0 text-[14px]">运行信息</h2><p class="mb-0 mt-1 text-[10.5px] text-subtle">definition_snapshot 固定执行计划</p></div>
                </div>
                <div class="flex flex-col">
                  <div class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0"><span class="text-subtle">runId</span><strong class="max-w-[160px] truncate font-mono text-muted">{{ run.id }}</strong></div>
                  <div class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0"><span class="text-subtle">工作流</span><RouterLink :to="`/workflows/${run.workflowId}`" class="max-w-[160px] truncate text-primary">{{ run.workflowName }}</RouterLink></div>
                  <div class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0"><span class="text-subtle">版本</span><strong class="text-muted">v{{ run.version ?? '预览快照' }}</strong></div>
                  <div class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0"><span class="text-subtle">触发</span><strong class="text-muted">{{ triggerLabel(run.trigger) }}</strong></div>
                  <div class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0"><span class="text-subtle">执行者</span><strong class="text-muted">{{ run.metadata.actor ?? '系统' }}</strong></div>
                  <div class="flex min-h-[34px] items-center justify-between gap-2.5 px-2.5 text-[10.5px]"><span class="text-subtle">创建时间</span><strong class="text-muted">{{ formatDateTime(run.createdAt) }}</strong></div>
                </div>
              </section>

              <section class="surface overflow-hidden">
                <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                  <div><h2 class="m-0 text-[14px]">最终输出</h2><p class="mb-0 mt-1 text-[10.5px] text-subtle">{{ run.output ? 'run snapshot' : '尚无终态输出' }}</p></div>
                </div>
                <div v-if="run.output" class="bg-[var(--code-bg)]">
                  <pre class="m-0 max-h-[260px] overflow-auto p-2.5 font-mono text-[10.5px] leading-[1.6] text-[#d8dbe5]">{{ JSON.stringify(run.output, null, 2) }}</pre>
                </div>
                <div v-else class="flex min-h-[88px] items-center justify-center px-4 text-center text-[10.5px] text-subtle">运行尚未产生最终输出。</div>
              </section>

              <section class="surface overflow-hidden">
                <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                  <div><h2 class="m-0 text-[14px]">Artifacts</h2><p class="mb-0 mt-1 text-[10.5px] text-subtle">{{ artifacts.length }} 个可下载文件</p></div>
                </div>
                <div class="p-2">
                  <button v-for="artifact in artifacts" :key="artifact.name" class="flex min-h-[50px] w-full items-center gap-2 border-0 border-b border-dashed border-line bg-transparent px-2 text-left last:border-b-0 hover:bg-[var(--surface-2)]" @click="downloadArtifact(artifact)">
                    <FileText :size="15" />
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5"><strong class="truncate text-[11.5px]">{{ artifact.name }}</strong><small class="text-[10px] text-subtle">{{ artifact.meta }}</small></span>
                    <Download :size="13" />
                  </button>
                  <div v-if="!artifacts.length" class="flex min-h-[80px] items-center justify-center text-[10.5px] text-subtle">本次运行没有 artifact。</div>
                </div>
              </section>

              <section class="surface overflow-hidden pb-[11px]">
                <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                  <div><h2 class="m-0 text-[14px]">诊断信息</h2><p class="mb-0 mt-1 text-[10.5px] text-subtle">不包含明文凭证或完整敏感输入。</p></div>
                </div>
                <code class="mx-[11px] mb-[9px] mt-2 block break-all rounded-[5px] bg-[var(--surface-2)] p-2 font-mono text-[10px] leading-[1.5] text-muted">{{ diagnosticText }}</code>
                <button class="btn ml-[11px] !h-[31px] text-[11.5px]" @click="copyDiagnostics"><Copy :size="13" /> 复制诊断包</button>
              </section>
            </aside>
          </div>
        </template>
      </main>
    </div>
  </AppShell>

  <div v-if="nodeDrawerOpen && selectedNode" class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" @click.self="nodeDrawerOpen = false">
    <aside class="absolute inset-y-0 right-0 flex w-[min(640px,100vw)] flex-col bg-surface shadow-lg">
      <div class="flex min-h-[62px] items-center justify-between gap-3.5 border-b border-line px-4 py-3">
        <div>
          <h2 class="m-0 text-[16px]">{{ selectedNode.title }}</h2>
          <p class="mb-0 mt-1 text-[11.5px] text-subtle"><span class="font-mono">{{ selectedNode.nodeId }}</span> · {{ selectedNode.type }}</p>
        </div>
        <button class="icon-btn" @click="nodeDrawerOpen = false"><X :size="16" /></button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="flex min-h-[42px] items-center gap-2 text-[10.5px] text-subtle">
          <StatusBadge :status="selectedNode.status" />
          <span>{{ formatDuration(selectedNode.durationMs) }}</span>
          <span class="font-mono">attempt {{ activeAttempt?.attempt ?? 1 }}</span>
        </div>

        <div v-if="attempts.length > 1" class="mb-2.5 flex flex-wrap gap-1 rounded-[6px] bg-[var(--surface-2)] p-1">
          <button
            v-for="attempt in attempts"
            :key="attempt.attempt"
            class="rounded-[5px] border-0 px-2 py-1 text-[10.5px]"
            :class="activeAttempt?.attempt === attempt.attempt ? 'bg-surface text-ink shadow-sm' : 'bg-transparent text-subtle'"
            @click="selectedAttemptNumber = attempt.attempt"
          >
            attempt {{ attempt.attempt }}
            <span :class="attempt.status">{{ attempt.status }}</span>
          </button>
        </div>

        <div v-if="activeAttempt?.error" class="mb-2.5 flex items-start gap-2 rounded-[6px] border border-[#efbfc1] bg-danger-soft p-2.5 text-danger">
          <CircleAlert :size="14" />
          <div>
            <strong class="font-mono text-[10.5px]">{{ activeAttempt.error.code }}</strong>
            <p class="mb-0 mt-[3px] text-[10.5px] leading-[1.45] text-[#9c4045]">{{ activeAttempt.error.message }}</p>
          </div>
        </div>

        <section class="mb-3">
          <div class="mb-2 text-[11.5px] font-650 text-muted">执行 trace <small class="font-400 text-subtle">validate / resolve / execute / output</small></div>
          <div class="flex flex-col rounded-[6px] border border-line bg-[var(--surface-2)] p-2">
            <div v-for="phase in tracePhases" :key="phase.name" class="grid min-h-[28px] grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dashed border-line text-[10.5px] last:border-b-0">
              <span class="h-[7px] w-[7px] rounded-full" :class="phase.status === 'succeeded' ? 'bg-success' : phase.status === 'running' ? 'bg-primary animate-pulse' : phase.status === 'failed' ? 'bg-danger' : 'bg-[#c7ccd6]'" />
              <strong class="text-muted">{{ phase.name }}</strong>
              <span class="text-[10px] text-subtle">{{ phase.duration }}</span>
            </div>
          </div>
        </section>

        <section class="mb-3.5">
          <div class="mb-2 text-[11.5px] font-650 text-muted">输入 <small class="font-400 text-subtle">运行态只读</small></div>
          <pre class="m-0 max-h-[260px] overflow-auto rounded-[6px] bg-[var(--code-bg)] p-2.5 font-mono text-[10.5px] leading-[1.6] text-[#d8dbe5]">{{ pretty(activeAttempt?.input ?? selectedNode.input ?? run?.input) }}</pre>
        </section>

        <section class="mb-3.5">
          <div class="mb-2 text-[11.5px] font-650 text-muted">输出</div>
          <pre class="m-0 max-h-[260px] overflow-auto rounded-[6px] bg-[var(--code-bg)] p-2.5 font-mono text-[10.5px] leading-[1.6] text-[#d8dbe5]">{{ pretty(activeAttempt?.output ?? selectedNode.output ?? {}) }}</pre>
        </section>

        <section v-if="branchEdges.length" class="mb-3.5">
          <div class="mb-2 text-[11.5px] font-650 text-muted">分支信息</div>
          <div class="overflow-hidden rounded-[6px] border border-line">
            <div v-for="edge in branchEdges" :key="edge.id" class="grid min-h-[34px] grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0">
              <span class="h-[6px] w-[6px] rounded-full bg-primary" />
              <strong class="truncate text-muted">{{ edge.label ?? edge.sourceHandle ?? '默认分支' }}</strong>
              <span class="font-mono text-[10px] text-subtle">{{ edge.target }}</span>
            </div>
          </div>
        </section>

        <section class="mb-3.5">
          <div class="mb-2 text-[11.5px] font-650 text-muted">相关事件</div>
          <div class="overflow-hidden rounded-[6px] border border-line">
            <div v-for="event in nodeEvents" :key="event.seq" class="grid min-h-[32px] grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 border-b border-dashed border-line px-2.5 text-[10.5px] last:border-b-0">
              <span class="font-mono text-[10px] text-subtle">{{ event.seq }}</span>
              <strong class="truncate font-mono text-muted">{{ event.type }}</strong>
              <span class="text-[10px] text-subtle">{{ formatEventTime(event.at) }}</span>
            </div>
          </div>
        </section>
      </div>
      <div class="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-4 py-3">
        <button class="btn" @click="copyNodeDiagnostics">复制节点诊断</button>
        <button class="btn btn-primary" @click="nodeDrawerOpen = false">完成</button>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  Activity,
  ArrowLeft,
  CircleAlert,
  Copy,
  Download,
  FileJson,
  FileQuestion,
  FileText,
  GitCommitHorizontal,
  ListTree,
  LoaderCircle,
  RotateCcw,
  SearchX,
  Square,
  TerminalSquare,
  X,
} from 'lucide-vue-next'
import AppShell from '@/components/AppShell.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { subscribeRunEvents } from '@/api/client'
import {
  cancelRun as cancelRunRequest,
  getRun,
  listRunEvents,
  replayRun as replayRunRequest,
} from '@/services/reflowApi'
import { formatDateTime, formatDuration } from '@/shared/format'
import type { NodeRun, RunEvent, RunRecord, WorkflowEdge } from '@/shared/types'

const route = useRoute()
const router = useRouter()
const runId = computed(() => String(route.params.id))
const run = ref<RunRecord>()
const events = ref<RunEvent[]>([])
const loading = ref(true)
const loadError = ref('')
const actionError = ref('')
const actionPending = ref(false)
const activeTab = ref<'nodes' | 'events' | 'raw'>('nodes')
const nodeStatusFilter = ref('')
const eventTypeFilter = ref('')
const nodeDrawerOpen = ref(false)
const selectedNodeId = ref('')
const selectedAttemptNumber = ref(1)
let unsubscribe: (() => void) | undefined

const mainTabs = computed(() => [
  { key: 'nodes' as const, label: '节点执行', icon: ListTree, count: run.value?.nodeRuns.length },
  { key: 'events' as const, label: '事件时间线', icon: Activity, count: events.value.length },
  { key: 'raw' as const, label: '原始 JSON', icon: FileJson },
])

const filteredNodeRuns = computed(() =>
  (run.value?.nodeRuns ?? []).filter(
    (nodeRun) => !nodeStatusFilter.value || nodeRun.status === nodeStatusFilter.value,
  ),
)

const filteredEvents = computed(() =>
  events.value.filter((event) => {
    if (!eventTypeFilter.value) return true
    if (eventTypeFilter.value === 'run') return event.type.startsWith('run.')
    if (eventTypeFilter.value === 'node') return event.type.startsWith('node.')
    return event.type === 'token.delta'
  }),
)

const selectedNode = computed(() =>
  run.value?.nodeRuns.find((nodeRun) => nodeRun.nodeId === selectedNodeId.value),
)
const attempts = computed(() => {
  if (!selectedNode.value) return []
  return (
    selectedNode.value.attempts?.length
      ? selectedNode.value.attempts
      : [
          {
            attempt: selectedNode.value.attempt ?? 1,
            status: selectedNode.value.status,
            input: selectedNode.value.input,
            output: selectedNode.value.output,
            error: selectedNode.value.error,
            durationMs: selectedNode.value.durationMs,
          },
        ]
  )
})
const activeAttempt = computed(
  () => attempts.value.find((attempt) => attempt.attempt === selectedAttemptNumber.value) ?? attempts.value[0],
)
const completedNodes = computed(
  () =>
    run.value?.nodeRuns.filter((nodeRun) =>
      ['succeeded', 'failed', 'skipped', 'cancelled'].includes(nodeRun.status),
    ).length ?? 0,
)
const failedNodes = computed(
  () => run.value?.nodeRuns.filter((nodeRun) => nodeRun.status === 'failed').length ?? 0,
)
const canCancel = computed(() =>
  run.value
    ? ['queued', 'pending', 'running', 'waiting'].includes(run.value.status)
    : false,
)
const definition = computed(() => run.value?.definitionSnapshot)
const branchEdges = computed<WorkflowEdge[]>(() => {
  if (!definition.value || !selectedNode.value) return []
  return definition.value.edges.filter((edge) => edge.source === selectedNode.value?.nodeId)
})
const nodeEvents = computed(() =>
  events.value.filter((event) => event.nodeId === selectedNodeId.value),
)
const diagnosticText = computed(() => {
  if (!run.value) return ''
  const errorNodeId = run.value.error?.nodeId
  const node = errorNodeId
    ? run.value.nodeRuns.find((item) => item.nodeId === errorNodeId)
    : undefined
  return [
    `runId=${run.value.id}`,
    `workflow=${run.value.workflowId}`,
    `version=${run.value.versionId ?? 'preview_snapshot'}`,
    `nodeId=${node?.nodeId ?? '-'}`,
    `errorCode=${run.value.error?.code ?? '-'}`,
    `at=${run.value.finishedAt ?? run.value.createdAt}`,
  ].join('\n')
})
const rawJson = computed(() =>
  JSON.stringify(
    {
      run: run.value,
      events: events.value,
    },
    null,
    2,
  ),
)
const artifacts = computed<Array<{
  name: string
  meta: string
  content: string
  mime: string
}>>(() => [])
const tracePhases = computed(() =>
  (activeAttempt.value?.trace ?? selectedNode.value?.trace ?? []).map((phase) => ({
    name: phase.phase,
    status: phase.status,
    duration: formatDuration(phase.durationMs),
  })),
)

/**
 * 截短运行 ID，保留后缀用于标题与抽屉展示。
 * @param value 完整运行 ID。
 * @param size 保留的最大字符数。
 * @returns 短运行 ID。
 */
function shortRunId(value: string, size = 8) {
  const suffix = value.includes('_') ? value.split('_').pop() ?? value : value
  return `${suffix.slice(0, size)}${suffix.length > size ? '…' : ''}`
}

/**
 * 返回触发方式的中文标签。
 * @param value 运行触发方式。
 * @returns 中文标签。
 */
function triggerLabel(value: RunRecord['trigger']) {
  return {
    manual_trial: '手动试运行',
    manual_preview: '草稿预览',
    api: 'API',
    mcp: 'MCP',
    webhook: 'Webhook',
    schedule: '定时',
    event: '事件',
    replay: '重放',
  }[value]
}

/**
 * 将运行状态和耗时格式化为摘要。
 *
 * @param value 运行记录。
 * @returns 排队中、运行中或格式化耗时。
 */
function durationLabel(value: RunRecord) {
  if (value.status === 'queued') return '排队中'
  if (['pending', 'running', 'waiting'].includes(value.status)) return '运行中'
  return formatDuration(value.durationMs)
}

/**
 * 格式化事件发生时间。
 * @param value ISO 时间字符串。
 * @returns 时:分:秒文本。
 */
function formatEventTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * 根据事件类型返回状态色语义。
 * @param type SSE 事件类型。
 * @returns success、primary、danger 或 neutral。
 */
function eventTone(type: string) {
  if (type.includes('failed') || type.includes('error')) return 'danger'
  if (type.includes('completed') || type.includes('succeeded')) return 'success'
  if (type.includes('started') || type.includes('running')) return 'primary'
  return 'neutral'
}

/**
 * 生成事件的简短中文描述。
 * @param event 运行事件。
 * @returns 便于扫描的事件说明。
 */
function eventDescription(event: RunEvent) {
  if (event.type === 'run.completed') return '运行成功结束，终态输出已持久化'
  if (event.type === 'run.failed') return String(event.payload?.error ? (event.payload.error as Record<string, unknown>).message : '运行失败')
  if (event.type === 'run.started') return '执行器已接收 definition_snapshot'
  if (event.nodeId) return `${event.nodeId} · ${String(event.payload?.title ?? event.status ?? '')}`
  return String(event.status ?? '')
}

/**
 * 格式化事件耗时。
 * @param event 运行事件。
 * @returns 毫秒文本或占位符。
 */
function eventDuration(event: RunEvent) {
  const duration = Number(event.payload?.durationMs ?? 0)
  return duration ? formatDuration(duration) : '—'
}

/**
 * 将任意值格式化为只读 JSON。
 * @param value 待格式化值。
 * @returns 两空格缩进的 JSON 字符串。
 */
function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

/**
 * 打开指定节点的运行态抽屉。
 * @param nodeId 目标节点 ID。
 */
function openNode(nodeId?: string) {
  if (!nodeId || !run.value?.nodeRuns.some((nodeRun) => nodeRun.nodeId === nodeId)) return
  selectedNodeId.value = nodeId
  selectedAttemptNumber.value =
    run.value.nodeRuns.find((nodeRun) => nodeRun.nodeId === nodeId)?.attempts?.at(-1)?.attempt ?? 1
  nodeDrawerOpen.value = true
}

/**
 * 将文本写入系统剪贴板。
 * @param value 待复制文本。
 */
async function copyText(value: string) {
  await navigator.clipboard?.writeText(value)
}

/** 复制当前运行的诊断摘要。 */
function copyDiagnostics() {
  void copyText(diagnosticText.value)
}

/** 复制当前节点与执行尝试的诊断摘要。 */
function copyNodeDiagnostics() {
  if (!selectedNode.value) return
  void copyText(
    [
      `runId=${runId.value}`,
      `nodeId=${selectedNode.value.nodeId}`,
      `attempt=${activeAttempt.value?.attempt ?? 1}`,
      `errorCode=${activeAttempt.value?.error?.code ?? '-'}`,
      `at=${run.value?.finishedAt ?? run.value?.createdAt ?? '-'}`,
    ].join('\n'),
  )
}

/**
 * 取消当前排队中或仍在执行的运行。
 *
 * @returns 请求完成时结束。
 */
async function cancelRun() {
  if (!run.value || actionPending.value) return
  actionPending.value = true
  actionError.value = ''
  try {
    await cancelRunRequest(run.value.id)
    await refreshRun(true)
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : '取消运行失败。'
  } finally {
    actionPending.value = false
  }
}

/**
 * 使用原定义快照重跑当前运行并打开新运行详情。
 *
 * @returns 请求完成时结束。
 */
async function replay() {
  if (!run.value || actionPending.value) return
  actionPending.value = true
  actionError.value = ''
  try {
    const next = await replayRunRequest(run.value.id)
    router.push(`/runs/${next.runId}`)
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : '重放运行失败。'
  } finally {
    actionPending.value = false
  }
}

/**
 * 下载运行输出 artifact。
 * @param artifact 文件名、内容和 MIME 类型。
 */
function downloadArtifact(artifact: { name: string; content: string; mime: string }) {
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = artifact.name
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * 从服务端重新读取运行快照和已落库事件。
 *
 * @param silent 是否用于 SSE/轮询续读，避免闪现加载页。
 * @returns 读取完成时结束。
 */
async function refreshRun(silent = false) {
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    const [nextRun, nextEvents] = await Promise.all([
      getRun(runId.value),
      listRunEvents(runId.value, 0, 1000),
    ])
    run.value = nextRun
    events.value = nextEvents
    const routeNode = route.query.node
    if (!selectedNodeId.value && typeof routeNode === 'string') {
      openNode(routeNode)
    } else if (!selectedNodeId.value) {
      const failed = nextRun.nodeRuns.find((nodeRun) => nodeRun.status === 'failed')
      if (failed) selectedNodeId.value = failed.nodeId
    }
  } catch (error) {
    run.value = undefined
    events.value = []
    loadError.value =
      error instanceof Error ? error.message : '无法读取运行详情。'
  } finally {
    loading.value = false
  }
}

/**
 * 为排队中或运行中的记录建立 SSE 事件订阅。
 */
function connectStream() {
  unsubscribe?.()
  unsubscribe = undefined
  if (
    !run.value ||
    !['queued', 'pending', 'running', 'waiting'].includes(run.value.status)
  ) {
    return
  }
  const afterSeq = events.value.at(-1)?.seq ?? 0
  unsubscribe = subscribeRunEvents({
    runId: runId.value,
    afterSeq,
    onEvent: (event) => {
      if (!events.value.some((item) => item.seq === event.seq)) {
        events.value.push(event)
        events.value.sort((left, right) => left.seq - right.seq)
      }
      if (!event.type.startsWith('token')) void refreshRun(true)
    },
    onError: (error) => {
      actionError.value = error.message
    },
    onEnd: () => {
      void refreshRun(true)
      unsubscribe = undefined
    },
  })
}

watch(
  () => route.params.id,
  () => {
    nodeDrawerOpen.value = false
    selectedNodeId.value = ''
    unsubscribe?.()
    run.value = undefined
    loading.value = true
    void refreshRun().then(connectStream)
  },
  { immediate: true },
)

watch(
  () => route.query.node,
  (nodeId) => {
    if (typeof nodeId === 'string' && run.value) openNode(nodeId)
  },
  { immediate: true },
)

onUnmounted(() => {
  unsubscribe?.()
})
</script>

