<template>
  <PageHeaderActions>
    <div class="flex items-center gap-2 max-md:flex-wrap">
      <span class="inline-flex h-[29px] items-center gap-[5px] rounded-[6px] bg-success-soft px-[9px] text-[12px] text-success max-[620px]:hidden"><KeyRound :size="13" /> 密钥仅以 secret_ref 保存</span>
      <Button @click="openCreate"><Plus :size="14" /> 新建连接</Button>
    </div>
  </PageHeaderActions>

  <main class="px-7 pb-16 pt-[26px] max-md:px-4">
        <section class="mb-[18px] flex items-end justify-between gap-[22px] max-md:flex-col max-md:items-start">
          <div>
            <h1 class="m-0 text-[27px] font-[730]">模型与密钥</h1>
            <p class="mb-0 mt-[7px] text-[12px] leading-[1.55] text-subtle">{{ modelList.length }} 个 Workspace 级连接 · 密钥只在 worker 读取，前端仅展示名称与末四位</p>
          </div>
          <div class="flex items-center gap-2">
            <Select v-model="providerFilter">
              <SelectTrigger class="h-[34px] w-auto min-w-[112px] px-[9px] text-[12px]" aria-label="按 provider 筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部 Provider</SelectItem>
                <SelectItem v-for="provider in providers" :key="provider" :value="provider">{{ provider }}</SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="statusFilter">
              <SelectTrigger class="h-[34px] w-auto min-w-[112px] px-[9px] text-[12px]" aria-label="按连接状态筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="healthy">健康</SelectItem>
                <SelectItem value="degraded">降级</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <div v-if="loadError" class="mb-3 flex items-start gap-2 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-[12px] leading-[1.5] text-danger">
          <CircleAlert :size="14" />
          <span class="min-w-0 flex-1">{{ loadError }}</span>
          <Button variant="link" size="xs" class="text-[12px] font-600" @click="loadModels()">重试</Button>
        </div>
        <div v-if="actionError" class="mb-3 flex items-start gap-2 rounded-[7px] border border-[#efbfc1] bg-danger-soft px-3 py-2.5 text-[12px] leading-[1.5] text-danger">
          <CircleAlert :size="14" />
          <span class="min-w-0 flex-1">{{ actionError }}</span>
          <Button variant="ghost" size="icon-sm" class="!h-6 !w-6 text-subtle" title="关闭错误提示" @click="actionError = ''"><X :size="12" /></Button>
        </div>

        <section class="surface mb-3 grid grid-cols-1 gap-px overflow-hidden bg-line sm:grid-cols-2 xl:grid-cols-4">
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">可用连接</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="text-[19px] tabular-nums">{{ healthyCount }}</strong><em class="whitespace-nowrap text-[12px] not-italic text-success">共 {{ modelList.length }} 个</em></div>
          </div>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">默认模型</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="max-w-[110px] truncate text-[14px]">{{ defaultModel?.model ?? '—' }}</strong><em class="whitespace-nowrap text-[12px] not-italic text-success">{{ defaultModel?.provider }}</em></div>
          </div>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">平均测试延迟</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="text-[19px] tabular-nums">{{ averageLatency }}ms</strong><em class="whitespace-nowrap text-[12px] not-italic text-success">基于最近测试</em></div>
          </div>
          <div class="flex min-w-0 min-h-[78px] flex-col justify-center gap-[7px] bg-surface px-4 py-[13px]">
            <span class="text-[12px] text-subtle">Usage 聚合</span>
            <div class="flex min-w-0 items-baseline gap-[7px]"><strong class="text-[19px] tabular-nums">—</strong><em class="whitespace-nowrap text-[12px] not-italic text-subtle">接口尚未接入</em></div>
          </div>
        </section>

        <div class="grid grid-cols-[minmax(0,1fr)_350px] items-start gap-3 max-[1180px]:grid-cols-1">
          <section class="min-w-0">
            <div class="flex min-h-[38px] items-center justify-between gap-2.5">
              <div class="flex flex-col gap-0.5">
                <strong class="text-[12px]">模型连接</strong>
                <span class="text-[12px] text-subtle">能力不匹配的连接不能进入 LLM / Agent 节点</span>
              </div>
              <Button variant="link" size="xs" class="gap-[5px] text-[12px] disabled:text-subtle" :disabled="testingAll || loading || !modelList.length" @click="testAll">
                <RefreshCw :size="12" :class="testingAll ? 'animate-spin' : ''" />
                {{ testingAll ? '测试中' : '测试全部' }}
              </Button>
            </div>

            <div class="grid grid-cols-2 gap-2.5 max-[800px]:grid-cols-1">
              <article
                v-for="connection in filteredModels"
                :key="connection.id"
                class="surface min-w-0 cursor-pointer p-3 transition-[border-color,box-shadow] hover:border-border-strong"
                :class="selectedModelId === connection.id ? 'border-primary shadow-[0_0_0_2px_rgba(91,77,240,0.08)]' : ''"
                @click="selectedModelId = connection.id"
              >
                <div class="flex items-start gap-2">
                  <span class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-700" :class="providerMarkClass(connection.provider)">
                    {{ providerInitial(connection.provider) }}
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col gap-0.75">
                    <strong class="truncate text-[12px]">{{ connection.name }}</strong>
                    <span class="truncate text-[12px] text-subtle">{{ providerLabel(connection.provider) }} · <span class="font-mono">{{ connection.model }}</span></span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span v-if="connection.isDefault" class="inline-flex h-[18px] items-center rounded-[4px] bg-success-soft px-[5px] text-[12px] font-600 text-success">默认</span>
                    <Button variant="ghost" size="icon-sm" class="!h-[25px] !w-[25px]" title="查看连接详情" @click.stop="openDetail(connection)">
                      <MoreHorizontal :size="15" />
                    </Button>
                  </div>
                </div>

                <div class="mt-[7px] flex min-h-[37px] items-center gap-[7px] text-[12px] text-subtle">
                  <StatusBadge :status="connection.status" />
                  <span>{{ connection.latencyMs }}ms</span>
                  <span>{{ connection.contextWindow.toLocaleString('zh-CN') }} ctx</span>
                  <Button variant="link" size="xs" class="ml-auto text-[12px]" :class="connection.testing ? 'text-subtle' : ''" @click.stop="testConnection(connection)">
                    {{ connection.testing ? '测试中…' : '测试连接' }}
                  </Button>
                </div>

                <div class="flex flex-wrap gap-1">
                  <span v-for="capability in connection.capabilities" :key="capability" class="inline-flex h-5 items-center rounded-[4px] border border-line bg-[var(--surface-2)] px-1.5 text-[12px] text-subtle">
                    {{ capabilityLabel(capability) }}
                  </span>
                </div>

                <div class="mt-[7px] flex min-h-8 items-center gap-[5px] rounded-[5px] bg-[var(--surface-3)] px-[7px] text-[12px] text-subtle">
                  <KeyRound :size="12" />
                  <span class="flex-1 font-mono">{{ connection.credentialMask }}</span>
                  <span :class="connection.credentialStatus === 'valid' ? 'text-success' : 'text-warning'">
                    {{ connection.credentialStatus === 'valid' ? '有效' : '待更新' }}
                  </span>
                </div>

                <div class="mt-[9px] flex min-h-8 items-end justify-between gap-[7px] border-t border-dashed border-line pt-2 text-[12px] text-subtle">
                  <span>使用量聚合尚未接入</span>
                  <div class="flex gap-[7px]">
                    <Button variant="link" size="xs" class="text-[12px]" @click.stop="openDetail(connection)">详情</Button>
                    <Button variant="link" size="xs" class="text-[12px]" @click.stop="openEdit(connection)">编辑</Button>
                    <Button v-if="!connection.isDefault" variant="link" size="xs" class="text-[12px]" @click.stop="setDefault(connection)">设为默认</Button>
                  </div>
                </div>
              </article>
            </div>
            <div v-if="!filteredModels.length" class="surface flex min-h-[120px] flex-col items-center justify-center gap-[7px] text-[12px] text-subtle">
              <SearchX :size="20" />
              <span>{{ loading ? '正在加载模型连接…' : '没有匹配的模型连接。' }}</span>
            </div>
          </section>

          <aside class="flex flex-col gap-2.5 max-[1180px]:grid max-[1180px]:grid-cols-2 max-[800px]:grid-cols-1">
            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div><h2 class="m-0 text-[14px]">Fallback 路由</h2><p class="mb-0 mt-1 text-[12px] text-subtle">全局默认顺序 · 节点可覆盖</p></div>
                <Info :size="14" />
              </div>
              <div class="flex flex-col">
                <div v-for="(connection, index) in fallbackConnections" :key="connection.id" class="grid min-h-[42px] grid-cols-[22px_minmax(0,1fr)_24px_24px] items-center gap-1 border-b border-dashed border-line px-[9px]">
                  <span class="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary-soft text-[12px] text-primary">{{ index + 1 }}</span>
                  <span class="flex min-w-0 flex-col gap-0.5">
                    <strong class="truncate text-[12px]">{{ connection.model }}</strong>
                    <small class="text-[12px] text-subtle">{{ providerLabel(connection.provider) }} · fallback</small>
                  </span>
                  <Button variant="ghost" size="icon-sm" class="!h-[23px] !w-[23px]" :disabled="index === 0" title="上移" @click="moveFallback(connection.id, -1)">
                    <ArrowUp :size="12" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" class="!h-[23px] !w-[23px]" title="下移" @click="moveFallback(connection.id, 1)">
                    <ArrowDown :size="12" />
                  </Button>
                </div>
              </div>
              <div class="flex items-start gap-1.5 border-t border-line bg-[var(--surface-2)] px-2.5 py-2 text-[12px] leading-[1.5] text-subtle">
                <CircleAlert :size="13" />
                <span>fallback 失败会保留每次尝试的错误码；写工具不会自动重试。</span>
              </div>
            </section>

            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div><h2 class="m-0 text-[14px]">成本来源</h2><p class="mb-0 mt-1 text-[12px] text-subtle">手动维护估算价，不伪造实时价格</p></div>
                <FileJson :size="14" />
              </div>
              <div class="grid grid-cols-2 gap-px bg-line">
                <div class="flex min-h-[49px] flex-col justify-center gap-0.5 bg-surface px-2.5 py-[7px]"><span class="text-[12px] text-subtle">输入 token</span><strong class="text-[12px]">—</strong></div>
                <div class="flex min-h-[49px] flex-col justify-center gap-0.5 bg-surface px-2.5 py-[7px]"><span class="text-[12px] text-subtle">输出 token</span><strong class="text-[12px]">—</strong></div>
                <div class="flex min-h-[49px] flex-col justify-center gap-0.5 bg-surface px-2.5 py-[7px]"><span class="text-[12px] text-subtle">估算费用</span><strong class="text-[12px]">—</strong></div>
                <div class="flex min-h-[49px] flex-col justify-center gap-0.5 bg-surface px-2.5 py-[7px]"><span class="text-[12px] text-subtle">来源</span><strong class="truncate text-[12px]">usage API 待接入</strong></div>
              </div>
            </section>

            <section class="surface overflow-hidden">
              <div class="flex min-h-14 items-center justify-between gap-3.5 border-b border-line px-3.5 py-2.5">
                <div><h2 class="m-0 text-[14px]">Skills <span class="inline-flex h-4 items-center rounded-[3px] bg-warning-soft px-1 text-[12px] text-warning">P1</span></h2><p class="mb-0 mt-1 text-[12px] text-subtle">声明式能力包，不改节点 I/O schema</p></div>
                <Button variant="ghost" size="icon" disabled><Plus :size="13" /></Button>
              </div>
              <div class="flex flex-col">
                <div v-for="skill in skills" :key="skill.id" class="flex min-h-[45px] items-center gap-[7px] border-b border-dashed border-line px-2.5">
                  <span class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-primary-soft text-primary"><Sparkles :size="14" /></span>
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong class="text-[12px]">{{ skill.name }}</strong>
                    <small class="truncate text-[12px] text-subtle">v{{ skill.version }} · {{ skill.type }} · {{ skill.publisher }}</small>
                  </span>
                  <StatusBadge :status="skill.status" />
                </div>
              </div>
              <div class="border-t border-line bg-[var(--surface-2)] px-2.5 py-2 text-[12px] leading-[1.5] text-subtle">Skills 目录与沙箱测试尚未接入；当前仅展示能力契约。</div>
            </section>
          </aside>
        </div>
  </main>

  <Dialog v-model:open="createOpen">
      <DialogContent class="w-[min(620px,calc(100vw-28px))]">
        <DialogTitle class="m-0 text-[17px] font-700">{{ editingModelId ? '编辑模型连接' : '新建模型连接' }}</DialogTitle>
        <DialogDescription class="mb-[13px] mt-1.5 text-[12px] leading-[1.6] text-subtle">
          Workspace 级连接。凭证只接受安全引用，创建后不可回显明文；编辑时留空表示保留现有引用。
        </DialogDescription>
        <div class="flex flex-col gap-[11px]">
          <div class="grid grid-cols-2 gap-[9px] max-[620px]:grid-cols-1">
            <div class="flex flex-col gap-[7px]">
              <Label for="model-connection-name">名称</Label>
              <Input id="model-connection-name" v-model="newConnection.name" placeholder="例如：OpenAI 生产" />
            </div>
            <div class="flex flex-col gap-[7px]">
              <Label>Provider</Label>
              <Select v-model="newConnection.provider">
                <SelectTrigger aria-label="Provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="provider in providers" :key="provider" :value="provider">{{ provider }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div class="flex flex-col gap-[7px]">
            <Label for="model-connection-base-url">Base URL（可选）</Label>
            <Input id="model-connection-base-url" v-model="newConnection.baseUrl" placeholder="留空使用 provider 默认地址" />
          </div>
          <div class="grid grid-cols-2 gap-[9px] max-[620px]:grid-cols-1">
            <div class="flex flex-col gap-[7px]">
              <Label for="model-connection-model">默认模型</Label>
              <Input id="model-connection-model" v-model="newConnection.model" placeholder="gpt-4.1-mini" />
            </div>
            <div class="flex flex-col gap-[7px]">
              <Label for="model-connection-context">上下文窗口</Label>
              <Input id="model-connection-context" v-model.number="newConnection.contextWindow" type="number" min="1024" step="1024" />
            </div>
          </div>
          <div class="flex flex-col gap-[7px]">
            <Label>能力</Label>
            <CheckboxGroup v-model="newConnection.capabilities" class="flex flex-wrap gap-[7px]">
              <Label v-for="capability in capabilityOptions" :key="capability" class="flex h-[27px] cursor-pointer items-center gap-[5px] rounded-[5px] border border-line px-[7px] font-normal text-muted">
                <Checkbox :value="capability" />
                {{ capabilityLabel(capability) }}
              </Label>
            </CheckboxGroup>
          </div>
          <div class="flex flex-col gap-[7px]">
            <Label for="model-connection-secret">凭证引用</Label>
            <Input
              id="model-connection-secret"
              :model-value="connectionSecretRef"
              :placeholder="editingModelId ? '留空保留现有凭据引用' : 'secret://workspace/openai'"
              @update:model-value="setConnectionSecretRef"
            />
            <span class="text-[12px] leading-[1.55] text-subtle">不接受明文 API Key；实际内容仅 worker 可读。</span>
          </div>
          <div v-if="newConnectionError" class="flex items-center gap-1.5 rounded-[6px] bg-danger-soft p-2 text-[12px] text-danger">
            <CircleAlert :size="14" /> {{ newConnectionError }}
          </div>
        </div>
        <DialogFooter class="mt-5">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button :disabled="saving" @click="saveConnection">{{ saving ? '保存中…' : editingModelId ? '保存并测试' : '创建连接并测试' }}</Button>
        </DialogFooter>
      </DialogContent>
  </Dialog>

  <Dialog :open="Boolean(detailModel)" @update:open="(open) => !open && (detailModelId = '')">
    <DialogContent
      v-if="detailModel"
      class="left-auto top-0 flex h-full max-h-none w-[min(600px,100vw)] translate-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0"
      :show-close="false"
    >
      <div class="flex min-h-[62px] items-center justify-between gap-3.5 border-b border-line px-4 py-3">
        <div>
          <DialogTitle class="text-[16px]">{{ detailModel.name }}</DialogTitle>
          <DialogDescription class="mt-1">{{ providerLabel(detailModel.provider) }} · <span class="font-mono">{{ detailModel.model }}</span></DialogDescription>
        </div>
        <Button variant="ghost" size="icon" @click="detailModelId = ''"><X :size="16" /></Button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <div class="flex min-h-10 items-center gap-2 text-[12px] text-subtle">
          <StatusBadge :status="detailModel.status" />
          <span>{{ detailModel.latencyMs }}ms</span>
          <span>{{ detailModel.contextWindow.toLocaleString('zh-CN') }} 上下文</span>
          <Button variant="link" size="xs" class="ml-auto text-[12px]" @click="testConnection(detailModel)">测试连接</Button>
        </div>

        <section class="mb-3.5">
          <div class="mb-[7px] text-[12px] font-650 text-muted">能力与约束</div>
          <div class="mb-2 flex flex-wrap gap-[5px]">
            <span v-for="capability in detailModel.capabilities" :key="capability" class="inline-flex h-5 items-center rounded-[4px] border border-line bg-[var(--surface-2)] px-1.5 text-[12px] text-subtle">{{ capabilityLabel(capability) }}</span>
          </div>
          <div class="overflow-hidden rounded-[6px] border border-line">
            <div class="flex min-h-8 items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] text-[12px]"><span class="text-subtle">baseUrl</span><strong class="truncate font-mono text-[12px] text-muted">{{ detailModel.baseUrl }}</strong></div>
            <div class="flex min-h-8 items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] text-[12px]"><span class="text-subtle">凭证</span><strong class="truncate font-mono text-[12px] text-muted">{{ detailModel.credentialMask }}</strong></div>
            <div class="flex min-h-8 items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] text-[12px]"><span class="text-subtle">密钥状态</span><strong class="text-[12px] text-muted">{{ detailModel.credentialStatus === 'valid' ? '有效' : '需更新' }}</strong></div>
            <div class="flex min-h-8 items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] text-[12px]"><span class="text-subtle">默认连接</span><strong class="text-[12px] text-muted">{{ detailModel.isDefault ? '是' : '否' }}</strong></div>
            <div class="flex min-h-8 items-center justify-between gap-2.5 px-[9px] text-[12px]"><span class="text-subtle">最近更新</span><strong class="text-[12px] text-muted">{{ formatDateTime(detailModel.updatedAt) }}</strong></div>
          </div>
        </section>

        <section class="mb-3.5">
          <div class="mb-[7px] text-[12px] font-650 text-muted">已发布工作流引用</div>
          <div class="overflow-hidden rounded-[6px] border border-line">
            <div v-for="reference in workflowReferences" :key="reference.id" class="flex min-h-[43px] items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] last:border-b-0">
              <span class="flex flex-col gap-0.5"><strong class="text-[12px]">{{ reference.name }}</strong><small class="text-[12px] text-subtle">v{{ reference.version }} · {{ reference.nodes }} 个节点</small></span>
              <span class="whitespace-nowrap rounded-[4px] bg-success-soft px-[5px] py-0.5 text-[12px] text-success">版本固定</span>
            </div>
            <div v-if="referencesLoading" class="flex min-h-[43px] items-center justify-center text-[12px] text-subtle">正在读取发布版本引用…</div>
            <div v-else-if="!workflowReferences.length" class="flex min-h-[43px] items-center justify-center text-[12px] text-subtle">发布版本中未找到该连接的节点引用。</div>
          </div>
          <p class="mb-0 mt-1.5 text-[12px] leading-[1.5] text-subtle">连接或默认模型变化不会自动修改已发布版本；需显式发布新版本。</p>
        </section>

        <section class="mb-3.5">
          <div class="mb-[7px] text-[12px] font-650 text-muted">估算成本</div>
          <div class="overflow-hidden rounded-[6px] border border-line">
            <div class="flex min-h-8 items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] text-[12px]"><span class="text-subtle">输入 / 1M tokens</span><strong class="text-muted">—</strong></div>
            <div class="flex min-h-8 items-center justify-between gap-2.5 border-b border-dashed border-line px-[9px] text-[12px]"><span class="text-subtle">输出 / 1M tokens</span><strong class="text-muted">—</strong></div>
            <div class="flex min-h-8 items-center justify-between gap-2.5 px-[9px] text-[12px]"><span class="text-subtle">价格来源</span><strong class="text-muted">价格接口尚未接入</strong></div>
          </div>
        </section>

        <section class="mb-3.5">
          <div class="mb-[7px] text-[12px] font-650 text-muted">最近测试</div>
          <div class="overflow-hidden rounded-[6px] border border-line">
            <div v-if="testResults[detailModel.id]" class="flex min-h-[33px] items-center gap-1.5 px-[9px] text-[12px] text-success"><CheckCircle2 :size="13" /><span class="flex-1 text-muted">供应商模型列表读取成功</span><small class="text-[12px] text-subtle">{{ testResults[detailModel.id].latencyMs }}ms · {{ testResults[detailModel.id].models.length }} 个模型</small></div>
            <div v-else class="flex min-h-[33px] items-center justify-center px-[9px] text-[12px] text-subtle">尚无本次会话的真实测试结果。</div>
          </div>
        </section>
      </div>
      <div class="flex justify-end gap-2 border-t border-line bg-[var(--surface-2)] px-4 py-3">
        <Button variant="destructive" :disabled="detailModel.isDefault" @click="removeConnection(detailModel)">
          删除连接
        </Button>
        <Button v-if="!detailModel.isDefault" variant="outline" @click="setDefault(detailModel)">设为默认</Button>
        <Button variant="outline" @click="openEdit(detailModel)">编辑</Button>
        <Button @click="detailModelId = ''">完成</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleAlert,
  FileJson,
  Info,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  SearchX,
  Sparkles,
  X,
} from 'lucide-vue-next'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai-reflow/ui'
import PageHeaderActions from '@/components/PageHeaderActions.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { ApiError } from '@/api/client'
import { formatDateTime } from '@/shared/format'
import {
  createModelConnection,
  deleteModelConnection,
  listModelConnections,
  listSkills,
  listWorkflows,
  testModelConnection,
  updateModelConnection,
  getWorkflowVersion,
  type ModelConnectionDto,
  type ModelTestResponse,
  type SkillDto,
} from '@/services/reflowApi'

interface ModelConnectionItem extends ModelConnectionDto {
  testing?: boolean
}

interface ModelWorkflowReference {
  id: string
  name: string
  version: number
  nodes: number
}

const providers = ['openai', 'anthropic', 'azure-openai', 'custom']
const capabilityOptions = ['text', 'vision', 'tools', 'structured', 'embedding', 'rerank']
const modelList = ref<ModelConnectionItem[]>([])
const skills = ref<SkillDto[]>([])
const providerFilter = ref('all')
const statusFilter = ref('all')
const selectedModelId = ref('')
const detailModelId = ref('')
const testingAll = ref(false)
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const actionError = ref('')
const createOpen = ref(false)
const editingModelId = ref('')
const newConnectionError = ref('')
const fallbackOrder = ref<string[]>([])
const workflowReferences = ref<ModelWorkflowReference[]>([])
const referencesLoading = ref(false)
const testResults = ref<Record<string, ModelTestResponse>>({})
const newConnection = reactive({
  name: '',
  provider: 'openai',
  baseUrl: '',
  model: 'gpt-4.1-mini',
  contextWindow: 128000,
  capabilities: ['text', 'tools', 'structured'] as string[],
  secretRef: '',
})
const connectionSecretRef = computed(() => newConnection.secretRef)

const filteredModels = computed(() =>
  modelList.value.filter((model) => {
    if (providerFilter.value !== 'all' && model.provider !== providerFilter.value) return false
    if (statusFilter.value !== 'all' && model.status !== statusFilter.value) return false
    return true
  }),
)
const healthyCount = computed(() => modelList.value.filter((model) => model.status === 'healthy').length)
const defaultModel = computed(() => modelList.value.find((model) => model.isDefault))
const averageLatency = computed(() => {
  const measured = modelList.value.filter((model) => model.latencyMs > 0)
  if (!measured.length) return 0
  return Math.round(
    measured.reduce((total, model) => total + model.latencyMs, 0) / measured.length,
  )
})
const fallbackConnections = computed(() =>
  fallbackOrder.value
    .map((id) => modelList.value.find((model) => model.id === id))
    .filter((model): model is ModelConnectionItem => Boolean(model)),
)
const detailModel = computed(() => modelList.value.find((model) => model.id === detailModelId.value))

/**
 * 将供应商稳定标识转换为展示名称。
 *
 * @param provider 供应商标识。
 * @returns 用户可读的供应商名称。
 */
function providerLabel(provider: string) {
  return {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    'azure-openai': 'Azure OpenAI',
    custom: 'Custom',
  }[provider.toLowerCase()] ?? provider
}

/**
 * 生成模型供应商标记。
 *
 * @param provider 供应商标识。
 * @returns 两字符缩写。
 */
function providerInitial(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'openai') return 'OA'
  if (normalized === 'anthropic') return 'AN'
  if (normalized === 'azure-openai') return 'AZ'
  return normalized.slice(0, 2).toUpperCase()
}

/**
 * 将模型供应商映射为原子品牌色类。
 *
 * @param provider 供应商标识。
 * @returns 供应商标记的背景与前景色类名。
 */
function providerMarkClass(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'anthropic') return 'bg-[#fff0f1] text-danger'
  if (normalized === 'azure-openai' || normalized === 'custom') return 'bg-info-soft text-info'
  return 'bg-primary-soft text-primary'
}

/**
 * 返回模型能力的中文标签。
 *
 * @param capability 能力枚举值。
 * @returns 中文标签或原值。
 */
function capabilityLabel(capability: string) {
  return {
    text: '文本',
    vision: '视觉',
    tools: '工具',
    structured: '结构化',
    embedding: '向量',
    rerank: '重排',
  }[capability] ?? capability
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
 * 加载模型连接并同步默认 fallback 顺序。
 *
 * @param silent 为 true 时只刷新数据，不清空当前列表。
 */
async function loadModels(silent = false) {
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    const items = await listModelConnections()
    modelList.value = items.map((item) => ({
      ...item,
      testing: modelList.value.find((existing) => existing.id === item.id)?.testing,
    }))
    if (!modelList.value.some((item) => item.id === selectedModelId.value)) {
      selectedModelId.value = modelList.value[0]?.id ?? ''
    }
    if (detailModelId.value && !detailModel.value) detailModelId.value = ''
    const defaultItem = modelList.value.find((item) => item.isDefault)
    fallbackOrder.value = defaultItem?.fallbackOrder.length
      ? defaultItem.fallbackOrder.filter((id) =>
          modelList.value.some((item) => item.id === id && !item.isDefault),
        )
      : modelList.value.filter((item) => !item.isDefault).map((item) => item.id)
  } catch (error) {
    loadError.value = errorText(error)
  } finally {
    if (!silent) loading.value = false
  }
}

/**
 * 加载 P1 Skills 目录；缺失项不生成本地占位数据。
 */
async function loadSkillsCatalog() {
  try {
    skills.value = await listSkills()
  } catch {
    skills.value = []
  }
}

/**
 * 调用真实供应商 endpoint 测试单个模型连接。
 *
 * @param connection 模型连接。
 */
async function testConnection(connection: ModelConnectionItem) {
  if (connection.testing) return
  actionError.value = ''
  connection.testing = true
  try {
    const result = await testModelConnection(connection.id)
    testResults.value[connection.id] = result
    connection.status = 'healthy'
    connection.latencyMs = result.latencyMs
  } catch (error) {
    connection.status = 'failed'
    actionError.value = errorText(error)
  } finally {
    connection.testing = false
    await loadModels(true)
  }
}

/**
 * 批量测试所有已启用模型连接。
 */
async function testAll() {
  if (testingAll.value) return
  testingAll.value = true
  actionError.value = ''
  const results = await Promise.allSettled(
    modelList.value
      .filter((connection) => connection.enabled)
      .map((connection) => testConnection(connection)),
  )
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length) {
    actionError.value = `${failures.length} 个模型连接测试失败，请查看连接状态。`
  }
  testingAll.value = false
  await loadModels(true)
}

/**
 * 打开模型连接详情并加载真实发布版本引用。
 *
 * @param connection 模型连接。
 */
async function openDetail(connection: ModelConnectionItem) {
  detailModelId.value = connection.id
  await loadWorkflowReferences(connection.id)
}

/**
 * 统计发布版本中引用指定模型连接的节点。
 *
 * @param modelConnectionId 外部模型连接 ID。
 */
async function loadWorkflowReferences(modelConnectionId: string) {
  referencesLoading.value = true
  workflowReferences.value = []
  try {
    const workflows = await listWorkflows()
    const candidates = workflows.filter(
      (workflow) => workflow.publishedVersion && workflow.publishedVersionId,
    )
    const loaded = await Promise.allSettled(
      candidates.map(async (workflow) => {
        const version = await getWorkflowVersion(workflow.id, workflow.publishedVersionId!)
        const referencedNodes = version.definition.nodes.filter(
          (node) => node.config.modelConnectionId === modelConnectionId,
        ).length
        return referencedNodes
          ? {
              id: workflow.id,
              name: workflow.name,
              version: workflow.publishedVersion ?? version.version,
              nodes: referencedNodes,
            }
          : null
      }),
    )
    workflowReferences.value = loaded
      .filter(
        (result): result is PromiseFulfilledResult<ModelWorkflowReference | null> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((item): item is ModelWorkflowReference => Boolean(item))
  } finally {
    referencesLoading.value = false
  }
}

/**
 * 将指定连接设为默认并持久化。
 *
 * @param connection 模型连接。
 */
async function setDefault(connection: ModelConnectionItem) {
  actionError.value = ''
  try {
    await updateModelConnection(connection.id, { isDefault: true })
    await loadModels(true)
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 调整全局备用模型顺序并持久化到默认连接。
 *
 * @param id 模型连接 ID。
 * @param direction -1 上移，1 下移。
 */
async function moveFallback(id: string, direction: -1 | 1) {
  const index = fallbackOrder.value.indexOf(id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= fallbackOrder.value.length) return
  const target = defaultModel.value
  if (!target) return
  const order = [...fallbackOrder.value]
  const [item] = order.splice(index, 1)
  order.splice(next, 0, item)
  actionError.value = ''
  try {
    await updateModelConnection(target.id, { fallbackOrder: order })
    fallbackOrder.value = order
    target.fallbackOrder = order
  } catch (error) {
    actionError.value = errorText(error)
  }
}

/**
 * 重置模型连接表单并进入新建模式。
 */
function openCreate() {
  editingModelId.value = ''
  newConnectionError.value = ''
  Object.assign(newConnection, {
    name: '',
    provider: 'openai',
    baseUrl: '',
    model: 'gpt-4.1-mini',
    contextWindow: 128000,
    capabilities: ['text', 'tools', 'structured'],
    secretRef: '',
  })
  createOpen.value = true
}

/** 更新模型连接凭证引用。 */
function setConnectionSecretRef(value: string | number) {
  newConnection.secretRef = String(value)
}

/**
 * 用真实连接数据填充编辑表单。
 *
 * @param connection 待编辑连接。
 */
function openEdit(connection: ModelConnectionItem) {
  editingModelId.value = connection.id
  newConnectionError.value = ''
  Object.assign(newConnection, {
    name: connection.name,
    provider: connection.provider,
    baseUrl: connection.baseUrl === 'provider default' ? '' : connection.baseUrl,
    model: connection.model,
    contextWindow: connection.contextWindow,
    capabilities: [...connection.capabilities],
    secretRef: '',
  })
  createOpen.value = true
}

/**
 * 校验表单并创建或更新模型连接。
 */
async function saveConnection() {
  newConnectionError.value = ''
  actionError.value = ''
  if (!newConnection.name.trim() || !newConnection.model.trim()) {
    newConnectionError.value = '名称与默认模型必填。'
    return
  }
  if (!editingModelId.value && !newConnection.secretRef.trim()) {
    newConnectionError.value = '新建连接时必须提供 secret:// 凭据引用。'
    return
  }
  if (!newConnection.capabilities.length) {
    newConnectionError.value = '至少选择一项模型能力。'
    return
  }
  if (!/^secret:\/\/[a-zA-Z0-9._/-]+$/.test(newConnection.secretRef || 'secret://placeholder')) {
    newConnectionError.value = '凭据必须使用 secret:// 引用。'
    return
  }
  saving.value = true
  try {
    const input = {
      name: newConnection.name.trim(),
      provider: newConnection.provider,
      baseUrl: newConnection.baseUrl.trim() || null,
      defaultModel: newConnection.model.trim(),
      contextWindow: newConnection.contextWindow,
      capabilities: [...newConnection.capabilities],
      fallbackOrder: fallbackOrder.value,
    }
    const connection = editingModelId.value
      ? await updateModelConnection(editingModelId.value, {
          ...input,
          ...(newConnection.secretRef.trim()
            ? { secretRef: newConnection.secretRef.trim() }
            : {}),
        })
      : await createModelConnection({
          ...input,
          secretRef: newConnection.secretRef.trim(),
        })
    createOpen.value = false
    selectedModelId.value = connection.id
    await loadModels()
    try {
      await testModelConnection(connection.id)
    } catch (error) {
      actionError.value = `连接已保存，但真实测试未通过：${errorText(error)}`
      await loadModels(true)
    }
  } catch (error) {
    newConnectionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

/**
 * 二次确认后删除模型连接。
 *
 * @param connection 模型连接。
 */
async function removeConnection(connection: ModelConnectionItem) {
  if (connection.isDefault) {
    actionError.value = '默认模型连接不能直接删除，请先切换默认连接。'
    return
  }
  if (!window.confirm(`删除“${connection.name}”？服务端会检查工作流引用。`)) return
  actionError.value = ''
  try {
    await deleteModelConnection(connection.id)
    detailModelId.value = ''
    await loadModels()
  } catch (error) {
    actionError.value = errorText(error)
  }
}

onMounted(async () => {
  await Promise.all([loadModels(), loadSkillsCatalog()])
})
</script>
