<template>
  <PageHeaderActions>
    <div class="flex items-center gap-2 max-md:flex-wrap">
      <span
        class="inline-flex h-[29px] items-center gap-[5px] rounded-[6px] px-[9px] text-[12px] font-600"
        :class="mcpError ? 'bg-danger-soft text-danger' : loading ? 'bg-[var(--surface-3)] text-subtle' : 'bg-[var(--surface-3)] text-muted'"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="mcpError ? 'bg-danger' : loading ? 'bg-subtle' : 'bg-muted'" />
        {{ mcpError ? '网关状态异常' : loading ? '网关同步中' : 'MCP 网关 · 本机' }}
      </span>
      <button class="btn" @click="openHelp">协议文档</button>
    </div>
  </PageHeaderActions>

  <main class="px-7 pb-16 pt-[26px] max-md:px-4">
        <section class="mb-[18px] flex items-end justify-between gap-[22px] max-md:flex-col max-md:items-start">
          <div>
            <h1 class="m-0 text-[27px] font-[730]">MCP 调用</h1>
            <p class="mb-0 mt-[7px] text-[12px] leading-[1.55] text-subtle">双向 MCP：调用外部工具，也把固定发布版本的工作流暴露给 Claude / Cursor / Codex</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn" @click="settingsOpen = true"><Settings2 :size="14" /> 网关设置</button>
            <button class="btn btn-primary" @click="addOpen = true"><Plus :size="14" /> 添加 Server</button>
          </div>
        </section>

        <section class="surface mb-3 grid grid-cols-1 gap-px overflow-hidden bg-line sm:grid-cols-2 xl:grid-cols-4">
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">已连接 Server</span>
            <div class="flex min-w-0 items-baseline gap-[7px]">
              <strong class="text-[19px] tabular-nums">{{ healthyServers }}</strong>
              <em class="whitespace-nowrap text-[12px] not-italic" :class="serverIssueCount ? 'text-danger' : 'text-subtle'">{{ serverIssueCount }} 异常 / {{ disabledServerCount }} 停用</em>
            </div>
          </div>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">可用工具</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="text-[19px] tabular-nums">{{ totalTools }}</strong><em class="whitespace-nowrap text-[12px] not-italic text-success">{{ writeTools }} 个写操作</em></div>
          </div>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">今日调用</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="text-[19px] tabular-nums">{{ totalCalls.toLocaleString('zh-CN') }}</strong><em class="whitespace-nowrap text-[12px] not-italic text-subtle">{{ serverList.length }} 个 Server</em></div>
          </div>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">平均延迟</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="text-[19px] tabular-nums">{{ averageLatency }}ms</strong><em class="whitespace-nowrap text-[12px] not-italic text-subtle">健康检查样本</em></div>
          </div>
        </section>

        <div class="grid grid-cols-[minmax(0,1fr)_390px] items-start gap-3 max-[1180px]:grid-cols-1">
          <div class="flex min-w-0 flex-col gap-3">
            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div>
                  <h2 class="m-0 text-[14px]">外部 MCP Server <span class="ml-1 text-[12px] font-500 text-subtle">客户端</span></h2>
                  <p class="mb-0 mt-1 text-[12px] text-subtle">streamable-http &gt; sse &gt; stdio（仅本机自托管）</p>
                </div>
                <button class="inline-flex items-center gap-[5px] border-0 bg-transparent p-0 text-[12px]" :class="testingAll ? 'text-subtle' : 'text-primary'" @click="testAllServers">
                  <RefreshCw :size="12" :class="testingAll ? 'animate-spin' : ''" /> 全部同步
                </button>
              </div>

              <div class="flex flex-col">
                <button
                  v-for="server in serverList"
                  :key="server.id"
                  class="grid min-h-[54px] w-full grid-cols-[6px_minmax(0,1fr)_86px_58px_66px_128px] items-center gap-2 border-0 border-b border-line bg-transparent px-3 text-left transition-colors hover:bg-[#fbfbff] last:border-b-0"
                  :class="selectedServerId === server.id ? 'bg-[#fbfbff] shadow-[inset_2px_0_var(--primary)]' : ''"
                  @click="selectedServerId = server.id"
                >
                  <span class="h-1.5 w-1.5 rounded-full" :class="!server.enabled ? 'bg-subtle' : server.status === 'healthy' ? 'bg-success' : server.status === 'degraded' ? 'bg-warning' : server.status === 'offline' ? 'bg-muted' : 'bg-danger'" />
                  <span class="flex min-w-0 flex-col gap-0.5">
                    <strong class="truncate text-[12px]">{{ server.name }}</strong>
                    <small class="truncate font-mono text-[12px] text-subtle">mcp.{{ server.slug }}.*</small>
                  </span>
                  <span class="inline-flex h-[19px] items-center justify-center rounded-[4px] bg-[var(--surface-3)] px-1.5 font-mono text-[12px] text-muted">{{ server.transport }}</span>
                  <span class="inline-flex items-center gap-[3px] text-[12px] text-subtle"><Link2 :size="11" /> {{ server.tools }}</span>
                  <span class="flex flex-col text-[12px]">{{ server.calls.toLocaleString('zh-CN') }}<small class="text-[12px] text-subtle">今日</small></span>
                  <span class="flex items-center justify-end gap-2">
                    <StatusBadge :status="server.enabled ? server.status : 'disabled'" />
                    <button
                      class="h-[18px] w-8 rounded-full p-0.5 transition-colors"
                      :class="server.enabled ? 'bg-success' : 'bg-[#c7ccd6]'"
                      :title="server.enabled ? '停用 Server' : '启用 Server'"
                      @click.stop="toggleServer(server)"
                    ><span class="block h-3.5 w-3.5 rounded-full bg-white transition-transform" :class="server.enabled ? 'translate-x-[14px]' : ''" /></button>
                  </span>
                </button>
              </div>
              <div class="flex items-start gap-[7px] border-t border-line bg-[var(--surface-2)] px-3.5 py-2 text-[12px] leading-[1.5] text-subtle">
                <ShieldCheck :size="14" />
                <span>远端地址强制 allowlist 与凭证引用；SSRF、内网与回环地址根据策略拦截。stdio 只在 worker 中启动。</span>
              </div>
            </section>

            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div>
                  <h2 class="m-0 text-[14px]">工具目录 <span class="ml-1 rounded-[4px] bg-primary-soft px-1.5 py-0.5 text-[12px] font-500 text-primary">{{ selectedServer?.name }}</span></h2>
                  <p class="mb-0 mt-1 font-mono text-[12px] text-subtle">schema hash {{ schemaHash }} · {{ schemaRefreshed }}</p>
                </div>
                <button class="inline-flex items-center gap-[5px] border-0 bg-transparent p-0 text-[12px] text-primary" @click="refreshSchema">
                  <RefreshCw :size="12" /> 刷新 schema
                </button>
              </div>
              <div class="overflow-auto">
                <table class="w-full min-w-[620px] border-collapse [&_th]:h-[35px] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[12px] [&_th]:font-500 [&_th]:text-subtle [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-[12px] [&_td]:text-muted [&_tbody_tr:last-child_td]:border-b-0">
                  <thead>
                    <tr>
                      <th>工具</th>
                      <th>注解</th>
                      <th>调用</th>
                      <th>延迟</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tool in selectedTools" :key="tool.name">
                      <td>
                        <div class="flex min-w-0 flex-col gap-0.5">
                          <strong class="font-mono text-[12px]">{{ tool.name }}</strong>
                          <small class="max-w-[260px] truncate text-[12px] text-subtle">{{ tool.description }}</small>
                        </div>
                      </td>
                      <td>
                        <span class="rounded-[4px] px-1.5 py-0.5 text-[12px]" :class="tool.destructive ? 'bg-warning-soft text-warning' : tool.readOnly ? 'bg-success-soft text-success' : 'bg-[var(--surface-3)] text-subtle'">
                          {{ tool.destructive ? '写操作' : tool.readOnly ? '只读' : '交互' }}
                        </span>
                      </td>
                      <td>{{ tool.calls }}</td>
                      <td>{{ tool.latencyMs }}ms</td>
                      <td>
                        <button class="border-0 bg-transparent p-0 text-[12px] text-primary" @click="openToolConsole(tool)">测试调用</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="flex items-center justify-between gap-2.5 border-t border-line bg-[var(--surface-2)] px-3.5 py-2 text-[12px] text-subtle">
                <span><ShieldCheck :size="13" /> 工具输出视为不可信内容；凭证只通过 secret_ref 注入，不进入事件。</span>
                <button class="border-0 bg-transparent p-0 text-[12px] text-primary" @click="openToolSchema">查看 schema</button>
              </div>
            </section>
          </div>

          <aside class="flex min-w-0 flex-col gap-3">
            <section class="overflow-hidden rounded-8px bg-[var(--code-bg)] text-[#d8dbe5] shadow-sm">
              <div class="flex h-10 items-center justify-between border-b border-white/10 px-3 text-[12px]">
                <div class="flex items-center gap-2"><span class="flex items-center gap-1"><i class="h-[5px] w-[5px] rounded-full bg-[#ff6b6b]" /><i class="h-[5px] w-[5px] rounded-full bg-[#ffd166]" /><i class="h-[5px] w-[5px] rounded-full bg-[#53d18a]" /></span><strong class="font-mono text-[12px]">mcp.json</strong></div>
                <button class="border-0 bg-transparent p-0 text-[12px] text-[#9f97ff]" @click="copyText(clientJson)">复制配置</button>
              </div>
              <pre class="m-0 max-h-[260px] overflow-auto px-3 py-3 font-mono text-[12px] leading-[1.65] text-[#d8dbe5]">{{ clientJson }}</pre>
              <div class="flex min-h-[38px] items-center justify-between gap-2.5 border-t border-white/10 px-3 text-[12px] text-[#939bad]">
                <span>Streamable HTTP · 仅本机</span>
                <div class="flex gap-0.5">
                  <button
                    v-for="client in clientOptions"
                    :key="client"
                    class="h-[19px] rounded-[4px] border-0 px-[5px] text-[12px]"
                    :class="clientTab === client ? 'bg-white/15 text-white' : 'bg-transparent text-[#939bad]'"
                    @click="clientTab = client"
                  >{{ client }}</button>
                </div>
              </div>
            </section>

            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div>
                  <h2 class="m-0 text-[14px]">工作流即工具 <span class="ml-1 rounded-[4px] bg-primary-soft px-1.5 py-0.5 text-[12px] font-500 text-primary">暴露中</span></h2>
                  <p class="mb-0 mt-1 text-[12px] text-subtle">版本绑定不会随草稿修改自动切换</p>
                </div>
                <span class="text-[12px] text-subtle">{{ enabledWorkflowTools }} 已开启</span>
              </div>
              <div class="flex flex-col">
                <div v-for="tool in workflowToolRows" :key="tool.id" class="flex min-h-[49px] items-center justify-between gap-2.5 border-b border-dashed border-line px-3">
                  <div>
                    <strong class="block text-[12px]">{{ tool.name }}</strong>
                    <span class="font-mono text-[12px] text-subtle">v{{ tool.version }} · {{ tool.authMode }} · {{ tool.tokenMask }}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <button class="h-[18px] w-8 rounded-full p-0.5 transition-colors" :class="tool.enabled ? 'bg-success' : 'bg-[#c7ccd6]'" @click="toggleWorkflowTool(tool)">
                      <span class="block h-3.5 w-3.5 rounded-full bg-white transition-transform" :class="tool.enabled ? 'translate-x-[14px]' : ''" />
                    </button>
                    <RouterLink
                      v-if="tool.versionId"
                      :to="{ path: `/workflows/${tool.workflowId}/trial`, query: { versionId: tool.versionId } }"
                      class="icon-btn !h-6 !w-6"
                      title="打开固定版本"
                    >
                      <ExternalLink :size="13" />
                    </RouterLink>
                  </div>
                </div>
              </div>
              <button class="flex min-h-[37px] w-full items-center gap-[5px] border-0 border-t border-line bg-[var(--surface-2)] px-3 text-left text-[12px] text-muted" @click="copyText('http://127.0.0.1:8787/mcp')">
                <Server :size="12" />
                <span class="flex-1 font-mono">POST /mcp · 127.0.0.1:8787</span>
                <Copy :size="12" />
              </button>
            </section>

            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div><h2 class="m-0 text-[14px]">最近调用 <span class="ml-1 text-[12px] font-500 text-subtle">外部运行</span></h2></div>
                <span class="inline-flex items-center gap-[5px] rounded-[5px] bg-[var(--surface-3)] px-1.5 py-1 text-[12px] text-subtle"><span class="h-1.5 w-1.5 rounded-full bg-muted" /> trigger=mcp</span>
              </div>
              <div class="flex flex-col">
                <button
                  v-for="call in recentCalls"
                  :key="call.id"
                  class="grid min-h-[48px] w-full grid-cols-[6px_minmax(0,1fr)_auto_44px] items-center gap-2 border-0 border-b border-dashed border-line bg-transparent px-3 text-left last:border-b-0 hover:bg-[var(--surface-2)]"
                  @click="call.runId && router.push(`/runs/${call.runId}`)"
                >
                  <span class="h-1.5 w-1.5 rounded-full" :class="call.status === 'succeeded' ? 'bg-success' : call.status === 'failed' ? 'bg-danger' : 'bg-warning'" />
                  <span class="flex min-w-0 flex-col gap-0.5">
                    <strong class="truncate font-mono text-[12px]">{{ call.tool }}</strong>
                    <small class="truncate text-[12px] text-subtle">{{ call.client }} · {{ formatDateTime(call.at) }}</small>
                  </span>
                  <StatusBadge :status="call.status" />
                  <span class="text-right text-[12px] text-subtle">{{ call.duration }}</span>
                </button>
              </div>
            </section>
          </aside>
        </div>
  </main>

  <DialogRoot :open="addOpen" @update:open="addOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-80 bg-[rgba(18,20,26,0.28)] backdrop-blur-[2px]" />
      <DialogContent class="fixed left-1/2 top-1/2 z-81 w-[min(620px,calc(100vw-28px))] -translate-1/2 rounded-8px border border-line bg-surface p-[22px] shadow-lg">
        <DialogTitle class="m-0 text-[17px] font-700">添加外部 MCP Server</DialogTitle>
        <DialogDescription class="mb-[13px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
          凭证只保存为 secret_ref；远端地址必须通过 allowlist，stdio 仅允许自托管 worker。
        </DialogDescription>
        <div class="flex flex-col gap-2.5">
          <div class="grid grid-cols-2 gap-[9px] max-[620px]:grid-cols-1">
            <label class="flex flex-col gap-[7px]">
              <span class="text-[12px] font-600 text-muted">名称</span>
              <input v-model="newServer.name" placeholder="例如：Linear" />
            </label>
            <label class="flex flex-col gap-[7px]">
              <span class="text-[12px] font-600 text-muted">slug</span>
              <input v-model="newServer.slug" placeholder="linear" />
            </label>
          </div>
          <label class="flex flex-col gap-[7px]">
            <span class="text-[12px] font-600 text-muted">transport</span>
            <select v-model="newServer.transport">
              <option value="streamable-http">streamable-http</option>
              <option value="sse">sse</option>
              <option value="stdio">stdio（仅本机）</option>
            </select>
          </label>
          <label class="flex flex-col gap-[7px]">
            <span class="text-[12px] font-600 text-muted">{{ newServer.transport === 'stdio' ? 'command' : 'endpoint' }}</span>
            <input
              v-model="newServer.endpoint"
              :placeholder="newServer.transport === 'stdio' ? 'npx -y @example/mcp' : 'https://mcp.example.com'"
            />
          </label>
          <label class="flex flex-col gap-[7px]">
            <span class="text-[12px] font-600 text-muted">凭证引用</span>
            <input v-model="newServer.secretRef" placeholder="secret://workspace/linear" />
            <span class="text-[12px] leading-[1.55] text-subtle">仅引用，不接受明文 API Key。</span>
          </label>
          <label class="flex flex-col gap-[7px]">
            <span class="text-[12px] font-600 text-muted">允许的 host（逗号分隔）</span>
            <input v-model="newServer.allowlist" placeholder="mcp.example.com" />
          </label>
          <div v-if="newServerError" class="flex items-center gap-1.5 rounded-[6px] bg-danger-soft p-2 text-[12px] text-danger">
            <CircleAlert :size="14" /> {{ newServerError }}
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <DialogClose as-child><button class="btn">取消</button></DialogClose>
          <button class="btn btn-primary" @click="addServer">添加并测试</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <div v-if="toolConsoleOpen && activeTool" class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" @click.self="toolConsoleOpen = false">
    <aside class="absolute inset-y-0 right-0 flex w-[min(620px,100vw)] flex-col bg-surface shadow-lg">
      <div class="flex min-h-[62px] items-center justify-between gap-3.5 border-b border-line px-4 py-3">
        <div>
          <h2 class="m-0 text-[16px]">{{ activeTool.name }}</h2>
          <p class="mb-0 mt-1 text-[12px] text-subtle">{{ selectedServer?.name }} · 测试调用，不写入工作流</p>
        </div>
        <button class="icon-btn" @click="toolConsoleOpen = false"><X :size="16" /></button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex items-start gap-2 rounded-[6px] bg-info-soft px-2.5 py-2 text-[12px] leading-[1.5] text-info">
          <Info :size="14" />
          <span>测试调用只验证连接、参数与结果 envelope，不会创建工作流运行或持久化输入。</span>
        </div>
        <div v-if="activeTool.destructive" class="mt-2.5 flex items-start gap-2 rounded-[6px] border border-warning/30 bg-warning-soft p-2.5 text-[12px] leading-[1.5] text-warning">
          <CircleAlert :size="14" />
          <label>
            <input v-model="destructiveConfirmed" type="checkbox" />
            我确认这是写操作；测试结果不会清理远端已产生的副作用。
          </label>
        </div>
        <section class="mt-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="font-mono text-[12px]">arguments</strong>
            <button class="border-0 bg-transparent p-0 text-[12px] text-primary" @click="formatToolArgs">格式化</button>
          </div>
          <textarea v-model="toolArgsText" class="min-h-[170px] resize-y rounded-[6px] bg-[var(--code-bg)] p-2.5 font-mono text-[12px] leading-[1.6] text-[#d8dbe5]" rows="8" spellcheck="false" />
          <div v-if="toolArgError" class="mt-2 flex items-center gap-1.5 rounded-[6px] bg-danger-soft p-2 text-[12px] text-danger"><CircleAlert :size="13" /> {{ toolArgError }}</div>
        </section>
        <button class="btn btn-primary mt-2.5 !h-[34px] w-full text-[12px]" :disabled="toolRunning || (activeTool.destructive && !destructiveConfirmed)" @click="executeTool">
          <LoaderCircle v-if="toolRunning" :size="14" class="animate-spin" />
          <Play v-else :size="14" />
          {{ toolRunning ? '调用中' : '执行测试调用' }}
        </button>

        <section v-if="toolResult" class="mt-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="font-mono text-[12px]">result envelope</strong>
            <span class="text-[12px] text-subtle">{{ toolDuration }} ms</span>
          </div>
          <pre class="m-0 max-h-[260px] overflow-auto rounded-[6px] bg-[var(--code-bg)] p-2.5 font-mono text-[12px] leading-[1.6] text-[#d8dbe5]">{{ toolResult }}</pre>
        </section>

        <section class="mt-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="font-mono text-[12px]">inputSchema</strong>
            <button class="border-0 bg-transparent p-0 text-[12px] text-primary" @click="copyText(toolSchemaText)">复制</button>
          </div>
          <pre class="m-0 max-h-[260px] overflow-auto rounded-[6px] bg-[var(--code-bg)] p-2.5 font-mono text-[12px] leading-[1.6] text-[#d8dbe5]">{{ toolSchemaText }}</pre>
        </section>
      </div>
      <div class="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-4 py-3">
        <button class="btn" @click="toolConsoleOpen = false">关闭</button>
        <button class="btn btn-primary" :disabled="toolRunning" @click="executeTool">执行</button>
      </div>
    </aside>
  </div>

  <DialogRoot :open="settingsOpen" @update:open="settingsOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-80 bg-[rgba(18,20,26,0.28)] backdrop-blur-[2px]" />
      <DialogContent class="fixed left-1/2 top-1/2 z-81 w-[min(470px,calc(100vw-28px))] -translate-1/2 rounded-8px border border-line bg-surface p-[22px] shadow-lg">
        <DialogTitle class="m-0 text-[17px] font-700">MCP 网关设置</DialogTitle>
        <DialogDescription class="mb-[13px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
          本地开发默认监听回环地址。向非回环地址暴露时必须启用访问凭证。
        </DialogDescription>
        <div class="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line">
          <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]"><span class="text-subtle">监听地址</span><strong class="font-mono text-muted">127.0.0.1:8787</strong></div>
          <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]"><span class="text-subtle">协议</span><strong class="text-muted">Streamable HTTP</strong></div>
          <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]"><span class="text-subtle">stdio</span><strong class="text-muted">仅自托管 worker</strong></div>
          <div class="flex min-h-[42px] flex-col gap-0.5 bg-[var(--surface-2)] px-2.5 py-2 text-[12px]"><span class="text-subtle">远端内网访问</span><strong class="text-danger">默认拒绝</strong></div>
        </div>
        <div class="mt-3 flex items-start gap-2 rounded-[6px] bg-warning-soft p-2.5 text-[12px] leading-[1.5] text-warning">
          <ShieldCheck :size="14" />
          <span>OAuth、Resources、Prompts 与自动健康巡检属于 P1，当前未接入。</span>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <DialogClose as-child><button class="btn">关闭</button></DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  CircleAlert,
  Copy,
  ExternalLink,
  Info,
  Link2,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
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
import PageHeaderActions from '@/components/PageHeaderActions.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import {
  callMcpTool,
  createMcpServer,
  getWorkflowMcpExposure,
  listMcpCalls,
  listMcpServers,
  listMcpTools,
  listWorkflows,
  testMcpServer,
  updateMcpServer,
  upsertWorkflowMcpExposure,
  type McpCallDto,
  type McpServerDto,
  type WorkflowMcpExposureDto,
} from '@/services/reflowApi'

interface McpServerItem {
  id: string
  name: string
  slug: string
  endpoint: string
  transport: 'streamable-http' | 'sse' | 'stdio'
  status: McpServerDto['status']
  enabled: boolean
  tools: number
  calls: number
  latencyMs: number
  secretRef: string
  allowlist: string[]
}

interface McpToolItem {
  id: string
  name: string
  title: string
  description: string
  readOnly: boolean
  destructive: boolean
  calls: number
  latencyMs: number
  schema: Record<string, unknown>
  schemaHash: string
  enabled: boolean
}

interface WorkflowToolRow {
  id: string
  workflowId: string
  name: string
  title: string
  description: string
  version: number
  versionId: string
  enabled: boolean
  authMode: WorkflowMcpExposureDto['authMode']
  tokenMask: string
  outputMode: WorkflowMcpExposureDto['outputMode']
  timeoutMs: number
  maxConcurrency: number
}

const router = useRouter()
const serverList = ref<McpServerItem[]>([])
const allServerTools = ref<Record<string, McpToolItem[]>>({})
const selectedServerId = ref('')
const clientTab = ref<'Claude' | 'Cursor' | 'Codex'>('Claude')
const clientOptions: Array<'Claude' | 'Cursor' | 'Codex'> = ['Claude', 'Cursor', 'Codex']
const addOpen = ref(false)
const settingsOpen = ref(false)
const testingAll = ref(false)
const loading = ref(false)
const mcpError = ref('')
const schemaRefreshed = ref('尚未加载工具目录')
const newServer = reactive({
  name: '',
  slug: '',
  transport: 'streamable-http' as McpServerItem['transport'],
  endpoint: '',
  secretRef: '',
  allowlist: '',
})
const newServerError = ref('')
const toolConsoleOpen = ref(false)
const activeToolName = ref('')
const toolArgsText = ref('{}')
const toolArgError = ref('')
const toolRunning = ref(false)
const toolResult = ref('')
const toolDuration = ref(0)
const destructiveConfirmed = ref(false)
const workflowToolRows = ref<WorkflowToolRow[]>([])
const recentCallRows = ref<McpCallDto[]>([])
const recentCalls = computed(() => {
  return recentCallRows.value.map((call) => ({
    id: call.id,
    runId: call.runId ?? '',
    tool: call.toolName,
    client: call.clientId ?? 'unknown',
    status: call.status,
    duration: call.durationMs === undefined ? '—' : `${call.durationMs}ms`,
    at: call.at,
  }))
})
const selectedServer = computed(() => serverList.value.find((server) => server.id === selectedServerId.value))
/**
 * 统计已启用且通过最近健康检查的 Server。
 */
const healthyServers = computed(() =>
  serverList.value.filter((server) => server.enabled && server.status === 'healthy').length,
)
/**
 * 统计已启用但处于降级、离线或错误状态的 Server。
 */
const serverIssueCount = computed(() =>
  serverList.value.filter((server) => server.enabled && server.status !== 'healthy').length,
)
/**
 * 统计已被用户停用的 Server，与异常状态分开展示。
 */
const disabledServerCount = computed(() =>
  serverList.value.filter((server) => !server.enabled).length,
)
const totalTools = computed(() => serverList.value.reduce((total, server) => total + server.tools, 0))
const writeTools = computed(() => Object.values(allServerTools.value)
  .flat()
  .filter((tool) => tool.destructive).length)
const totalCalls = computed(() => serverList.value.reduce((total, server) => total + server.calls, 0))
const averageLatency = computed(() => {
  const values = serverList.value.map((server) => server.latencyMs).filter(Boolean).sort((a, b) => a - b)
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
})
const selectedTools = computed<McpToolItem[]>(() =>
  selectedServerId.value ? allServerTools.value[selectedServerId.value] ?? [] : [],
)
const activeTool = computed(() => selectedTools.value.find((tool) => tool.name === activeToolName.value))
const toolSchemaText = computed(() => JSON.stringify(activeTool.value?.schema ?? {}, null, 2))
const schemaHash = computed(() => activeTool.value?.schemaHash ?? '暂无 schema')
const enabledWorkflowTools = computed(() => workflowToolRows.value.filter((tool) => tool.enabled).length)
const clientJson = computed(() => {
  const config = {
    mcpServers: {
      'ai-reflow': {
        url: 'http://127.0.0.1:8787/mcp',
        headers: {
          Authorization: 'Bearer ${AI_REFLOW_MCP_TOKEN}',
        },
      },
    },
  }
  if (clientTab.value === 'Codex') {
    return JSON.stringify(
      {
        mcpServers: {
          ...config.mcpServers,
          headers: { Authorization: 'Bearer ${AI_REFLOW_MCP_TOKEN}', 'X-Client': 'codex' },
        },
      },
      null,
      2,
    )
  }
  if (clientTab.value === 'Cursor') {
    return JSON.stringify(
      {
        mcpServers: {
          'ai-reflow': {
            url: 'http://127.0.0.1:8787/mcp',
            transport: 'streamable-http',
            env: { AI_REFLOW_MCP_TOKEN: '${env:AI_REFLOW_MCP_TOKEN}' },
          },
        },
      },
      null,
      2,
    )
  }
  return JSON.stringify(config, null, 2)
})

watch(selectedServerId, (serverId) => {
  if (serverId) void loadServerTools(serverId)
})

onMounted(() => {
  void loadPage()
})

/**
 * 将服务端 MCP Server DTO 映射为页面状态。
 *
 * @param server 真实 Server DTO。
 * @returns 页面 Server。
 */
function toServerItem(server: McpServerDto): McpServerItem {
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    endpoint: server.endpoint,
    transport: server.transport,
    status: server.status,
    enabled: server.enabled,
    tools: server.tools,
    calls: server.calls,
    latencyMs: server.latencyMs,
    secretRef: server.secretRef ?? '',
    allowlist: server.allowlist,
  }
}

/**
 * 查询真实 Server、工具缓存、入站暴露与调用审计。
 */
async function loadPage() {
  if (loading.value) return
  loading.value = true
  mcpError.value = ''
  try {
    const [servers, calls] = await Promise.all([
      listMcpServers(),
      listMcpCalls({ direction: 'inbound', limit: 4 }),
    ])
    serverList.value = servers.map(toServerItem)
    recentCallRows.value = calls
    if (!serverList.value.some((server) => server.id === selectedServerId.value)) {
      selectedServerId.value = serverList.value[0]?.id ?? ''
    }
    await Promise.all([
      loadAllToolSummaries(servers),
      loadWorkflowExposures(),
    ])
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : 'MCP 数据加载失败。'
  } finally {
    loading.value = false
  }
}

/**
 * 加载全部 Server 的工具缓存，供真实写操作计数。
 *
 * @param servers 当前 Server 列表。
 */
async function loadAllToolSummaries(servers: McpServerDto[]) {
  const pairs = await Promise.all(servers.map(async (server) => [
    server.id,
    (await listMcpTools(server.id)).map(toToolItem),
  ] as const))
  allServerTools.value = Object.fromEntries(pairs)
}

/**
 * 加载指定 Server 工具缓存。
 *
 * @param serverId Server ID。
 */
async function loadServerTools(serverId: string) {
  try {
    const tools = (await listMcpTools(serverId)).map(toToolItem)
    allServerTools.value = { ...allServerTools.value, [serverId]: tools }
    const server = serverList.value.find((item) => item.id === serverId)
    schemaRefreshed.value = server?.tools
      ? `缓存 ${server.tools} 个工具`
      : '当前 Server 没有工具缓存'
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : '工具目录加载失败。'
  }
}

/**
 * 将工具 DTO 映射为页面工具。
 *
 * @param tool 后端工具缓存 DTO。
 * @returns 页面工具。
 */
function toToolItem(tool: {
  id: string
  name: string
  title: string
  description: string
  readOnly: boolean
  destructive: boolean
  calls: number
  latencyMs: number
  schema: Record<string, unknown>
  schemaHash: string
  enabled: boolean
}): McpToolItem {
  return {
    id: tool.id,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    readOnly: tool.readOnly,
    destructive: tool.destructive,
    calls: tool.calls,
    latencyMs: tool.latencyMs,
    schema: tool.schema,
    schemaHash: tool.schemaHash,
    enabled: tool.enabled,
  }
}

/**
 * 查询每个工作流的入站暴露，只展示已配置项。
 */
async function loadWorkflowExposures() {
  const workflows = await listWorkflows()
  const responses = await Promise.all(workflows.map(async (workflow) => {
    try {
      return await getWorkflowMcpExposure(workflow.id)
    } catch {
      return null
    }
  }))
  workflowToolRows.value = responses
    .filter((response): response is NonNullable<typeof response> => Boolean(response?.exposure))
    .map((response) => toWorkflowToolRow(response.exposure!))
}

/**
 * 将入站暴露 DTO 映射为页面行。
 *
 * @param exposure 入站暴露 DTO。
 * @returns 页面工作流工具。
 */
function toWorkflowToolRow(exposure: WorkflowMcpExposureDto): WorkflowToolRow {
  return {
    id: exposure.id,
    workflowId: exposure.workflowId,
    name: exposure.toolName,
    title: exposure.title,
    description: exposure.description,
    version: exposure.workflowVersion,
    versionId: exposure.workflowVersionId,
    enabled: exposure.enabled,
    authMode: exposure.authMode,
    tokenMask: exposure.authMode === 'none'
      ? '无需认证'
      : exposure.tokenMasked ?? '未配置令牌',
    outputMode: exposure.outputMode,
    timeoutMs: exposure.timeoutMs,
    maxConcurrency: exposure.maxConcurrency,
  }
}

/**
 * 启用或停用 MCP Server，并恢复可重试的降级状态。
 * @param server 目标 MCP Server。
 */
async function toggleServer(server: McpServerItem) {
  mcpError.value = ''
  try {
    await updateMcpServer(server.id, { enabled: !server.enabled })
    await loadPage()
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : 'Server 状态更新失败。'
  }
}

/** 批量执行真实连接测试并刷新工具目录。 */
async function testAllServers() {
  if (testingAll.value) return
  testingAll.value = true
  mcpError.value = ''
  try {
    const results = await Promise.allSettled(
      serverList.value.map((server) => testMcpServer(server.id)),
    )
    const failures = results.filter((result) => result.status === 'rejected').length
    schemaRefreshed.value = failures
      ? `同步完成，${failures} 个 Server 测试失败`
      : '同步完成，工具目录已刷新'
    await loadPage()
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : 'MCP 同步失败。'
  } finally {
    testingAll.value = false
  }
}

/** 刷新工具 schema 摘要并展示同步状态。 */
async function refreshSchema() {
  if (!selectedServer.value || testingAll.value) return
  testingAll.value = true
  mcpError.value = ''
  schemaRefreshed.value = '正在刷新…'
  try {
    await testMcpServer(selectedServer.value.id)
    await loadServerTools(selectedServer.value.id)
    schemaRefreshed.value = '工具目录已刷新'
    await loadPage()
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : 'schema 刷新失败。'
  } finally {
    testingAll.value = false
  }
}

/** 校验表单并添加外部 MCP Server。 */
async function addServer() {
  newServerError.value = ''
  if (!newServer.name.trim() || !newServer.slug.trim() || !newServer.endpoint.trim()) {
    newServerError.value = '名称、slug 与 endpoint / command 必填。'
    return
  }
  if (serverList.value.some((server) => server.slug === newServer.slug.trim())) {
    newServerError.value = 'slug 已存在，请换一个唯一标识。'
    return
  }
  if (newServer.transport === 'stdio') {
    newServerError.value = 'stdio 只允许在自托管 worker 中启动，浏览器端不能直接执行命令。'
    return
  }
  try {
    const created = await createMcpServer({
      name: newServer.name.trim(),
      slug: newServer.slug.trim(),
      transport: newServer.transport,
      endpoint: newServer.endpoint.trim(),
      secretRef: newServer.secretRef.trim() || undefined,
      allowlist: newServer.allowlist
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    })
    addOpen.value = false
    Object.assign(newServer, {
      name: '',
      slug: '',
      transport: 'streamable-http',
      endpoint: '',
      secretRef: '',
      allowlist: '',
    })
    await loadPage()
    selectedServerId.value = created.id
  } catch (error) {
    newServerError.value = error instanceof Error ? error.message : 'MCP Server 创建失败。'
  }
}

/**
 * 打开工具测试控制台并写入对应示例参数。
 * @param tool 目标 MCP 工具。
 */
function openToolConsole(tool: McpToolItem) {
  activeToolName.value = tool.name
  toolArgsText.value = '{}'
  toolResult.value = ''
  toolArgError.value = ''
  destructiveConfirmed.value = false
  toolConsoleOpen.value = true
}

/** 解析并格式化工具 JSON 参数。 */
function formatToolArgs() {
  try {
    toolArgsText.value = JSON.stringify(JSON.parse(toolArgsText.value), null, 2)
    toolArgError.value = ''
  } catch {
    toolArgError.value = 'arguments 必须是合法 JSON。'
  }
}

/** 校验 JSON 参数后执行一次真实 MCP 工具测试调用。 */
async function executeTool() {
  if (!activeTool.value || toolRunning.value) return
  let args: Record<string, unknown>
  try {
    args = JSON.parse(toolArgsText.value) as Record<string, unknown>
    toolArgError.value = ''
  } catch {
    toolArgError.value = 'arguments 必须是合法 JSON。'
    return
  }
  if (!selectedServer.value) return
  if (activeTool.value.destructive && !destructiveConfirmed.value) {
    toolArgError.value = '写操作需要先勾选风险确认。'
    return
  }
  toolRunning.value = true
  toolResult.value = ''
  try {
    const response = await callMcpTool(
      selectedServer.value.id,
      activeTool.value.name,
      args,
    )
    toolDuration.value = response.durationMs
    toolResult.value = JSON.stringify(response, null, 2)
  } catch (error) {
    toolArgError.value = error instanceof Error ? error.message : 'MCP 工具调用失败。'
  } finally {
    toolRunning.value = false
  }
}

/**
 * 切换已入站暴露工作流工具的启用状态。
 *
 * @param tool 当前工作流工具。
 */
async function toggleWorkflowTool(tool: WorkflowToolRow) {
  mcpError.value = ''
  try {
    await upsertWorkflowMcpExposure(tool.workflowId, {
      workflowVersionId: tool.versionId,
      enabled: !tool.enabled,
      toolName: tool.name,
      title: tool.title,
      description: tool.description,
      outputMode: tool.outputMode,
      visibility: 'private',
      authMode: tool.authMode === 'oauth2' ? 'api-key' : tool.authMode,
      timeoutMs: tool.timeoutMs,
      maxConcurrency: tool.maxConcurrency,
    })
    await loadWorkflowExposures()
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : '入站工具状态更新失败。'
  }
}

/** 打开当前 Server 首个工具的 schema 控制台。 */
function openToolSchema() {
  if (selectedTools.value[0]) openToolConsole(selectedTools.value[0])
}

/** 打开 MCP 网关设置和协议说明抽屉。 */
function openHelp() {
  settingsOpen.value = true
}

/**
 * 将文本写入系统剪贴板。
 * @param value 待复制文本。
 */
async function copyText(value: string) {
  await navigator.clipboard?.writeText(value)
}

/**
 * 格式化真实调用时间。
 *
 * @param value ISO 时间。
 * @returns 本地时间文本。
 */
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

watch([selectedServerId, activeToolName], () => {
  toolResult.value = ''
})
</script>

