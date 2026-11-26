<template>
  <PageHeaderActions>
    <div class="flex min-w-0 items-center justify-end gap-2">
      <label class="control-shell flex h-9 w-[min(420px,100%)] items-center gap-2 rounded-7px px-3">
            <Search :size="14" class="shrink-0 text-subtle" />
            <input
              v-model="searchInput"
              class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] shadow-none outline-none"
              placeholder="搜索插件、能力、发布者..."
            />
            <kbd class="rounded-4px border border-line bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[12px] text-subtle">⌘K</kbd>
          </label>
          <button class="icon-btn" title="市场设置" @click="settingsOpen = true"><Settings :size="15" /></button>
    </div>
  </PageHeaderActions>

  <main class="px-7 pt-7 pb-16 max-md:px-4">
        <section class="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="m-0 text-27px font-730 leading-tight text-ink">插件市场</h1>
            <p class="mb-0 mt-2 text-[12px] leading-1.6 text-subtle">
              官方种子目录与已验证插件 · 安装前展示依赖、权限与影响 · 不自动升级
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="management-segment">
              <button :class="{ selected: viewMode === 'discover' }" @click="viewMode = 'discover'">
                <Compass :size="12" /> 发现
              </button>
              <button :class="{ selected: viewMode === 'installed' }" @click="viewMode = 'installed'">
                <PackageCheck :size="12" /> 已安装 <span>{{ installs.length }}</span>
              </button>
            </div>
            <button class="btn" @click="syncCatalog">
              <RefreshCw :size="13" :class="{ 'animate-spin': syncing }" />
              {{ syncing ? '同步中...' : '同步目录' }}
            </button>
          </div>
        </section>

        <section class="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          <button class="surface flex min-h-76px items-center gap-3 p-4 text-left" @click="openInstalledFilter('')">
            <span class="flex h-9 w-9 items-center justify-center rounded-7px bg-primary-soft text-primary"><Store :size="18" /></span>
            <span>
              <span class="block text-[12px] text-subtle">官方目录</span>
              <strong class="mt-1 block text-18px leading-none text-ink">{{ pluginEntries.length }}</strong>
            </span>
          </button>
          <button class="surface flex min-h-76px items-center gap-3 p-4 text-left" @click="openInstalledFilter('all')">
            <span class="flex h-9 w-9 items-center justify-center rounded-7px bg-success-soft text-success"><PackageCheck :size="18" /></span>
            <span>
              <span class="block text-[12px] text-subtle">已安装</span>
              <strong class="mt-1 block text-18px leading-none text-ink">{{ installs.length }}</strong>
            </span>
          </button>
          <button class="surface flex min-h-76px items-center gap-3 p-4 text-left" @click="openInstalledFilter('update_available')">
            <span class="flex h-9 w-9 items-center justify-center rounded-7px bg-primary-soft text-primary"><RefreshCw :size="18" /></span>
            <span>
              <span class="block text-[12px] text-subtle">可更新</span>
              <strong class="mt-1 block text-18px leading-none text-ink">{{ updateCount }}</strong>
            </span>
          </button>
          <button class="surface flex min-h-76px items-center gap-3 p-4 text-left" @click="openInstalledFilter('config_required')">
            <span class="flex h-9 w-9 items-center justify-center rounded-7px bg-warning-soft text-warning"><KeyRound :size="18" /></span>
            <span>
              <span class="block text-[12px] text-subtle">待配置</span>
              <strong class="mt-1 block text-18px leading-none text-ink">{{ configRequiredCount }}</strong>
            </span>
          </button>
          <button class="surface col-span-2 flex min-h-76px items-center gap-3 p-4 text-left md:col-span-1" @click="openInstalledFilter('failed')">
            <span class="flex h-9 w-9 items-center justify-center rounded-7px bg-danger-soft text-danger"><TriangleAlert :size="18" /></span>
            <span>
              <span class="block text-[12px] text-subtle">异常</span>
              <strong class="mt-1 block text-18px leading-none text-ink">{{ failedCount }}</strong>
            </span>
          </button>
        </section>

        <div v-if="pluginError" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-7px border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          <span>{{ pluginError }}</span>
          <button class="border-0 bg-transparent p-0 text-[12px] text-danger underline" @click="loadPage">重试</button>
        </div>

        <section class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              class="inline-flex h-7 items-center gap-1.5 rounded-6px border border-line bg-surface px-2.5 text-[12px] text-muted transition hover:(bg-[var(--surface-2)] text-ink)"
              :class="{ '!border-ink !bg-ink !text-white': kindFilter === 'all' }"
              @click="kindFilter = 'all'"
            >
              全部 <span class="opacity-70">{{ pluginEntries.length }}</span>
            </button>
            <button
              v-for="kind in pluginKinds"
              :key="kind.value"
              class="inline-flex h-7 items-center gap-1.5 rounded-6px border border-line bg-surface px-2.5 text-[12px] text-muted transition hover:(bg-[var(--surface-2)] text-ink)"
              :class="{ '!border-ink !bg-ink !text-white': kindFilter === kind.value }"
              @click="kindFilter = kind.value"
            >
              {{ kind.label }} <span class="opacity-70">{{ kindCount(kind.value) }}</span>
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select v-if="viewMode === 'discover'" v-model="secondaryFilter" class="management-select" aria-label="次级筛选">
              <option value="">全部来源</option>
              <option value="official">官方 / 已验证</option>
              <option value="installed">已安装</option>
              <option value="update">可更新</option>
            </select>
            <select v-else v-model="secondaryFilter" class="management-select" aria-label="安装状态筛选">
              <option value="">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已禁用</option>
              <option value="config_required">需配置</option>
              <option value="update_available">可更新</option>
              <option value="failed">异常</option>
            </select>
            <select v-model="sortMode" class="management-select" aria-label="排序">
              <option value="recommended">推荐</option>
              <option value="updated">最近更新</option>
              <option value="name">名称</option>
              <option value="installs">安装量</option>
            </select>
          </div>
        </section>

        <div
          v-if="!filteredPlugins.length"
          class="surface mt-4 flex min-h-160px flex-col items-center justify-center gap-2 text-subtle"
        >
          <SearchX :size="23" />
          <strong class="text-12px text-ink">{{ loading ? '正在加载插件目录' : '没有匹配插件' }}</strong>
          <span class="text-[12px]">{{ loading ? '正在读取 registry 与安装记录…' : viewMode === 'installed' ? '当前筛选下没有已安装插件。' : '调整关键词或切换类别。' }}</span>
          <button class="btn" @click="clearFilters">清除筛选</button>
        </div>

        <section v-else class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <article
            v-for="entry in filteredPlugins"
            :key="entry.id"
            class="surface flex cursor-pointer flex-col p-4 transition hover:(-translate-y-1px border-[var(--border-strong)] shadow-md)"
            @click="openDetail(entry)"
          >
            <div class="flex items-start gap-3">
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-8px"
                :style="{
                  color: entry.accent === 'violet' ? 'var(--primary)' : entry.accent === 'rose' ? 'var(--danger)' : entry.accent === 'mint' ? 'var(--success)' : entry.accent === 'amber' ? 'var(--warning)' : 'var(--info)',
                  background: entry.accent === 'violet' ? 'var(--primary-soft)' : entry.accent === 'rose' ? 'var(--danger-soft)' : entry.accent === 'mint' ? 'var(--success-soft)' : entry.accent === 'amber' ? 'var(--warning-soft)' : 'var(--info-soft)',
                }"
              >
                <component :is="pluginIcon(entry.icon)" :size="20" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <h2 class="m-0 truncate text-14px font-700 text-ink">{{ entry.name }}</h2>
                  <ShieldCheck v-if="entry.verified" :size="13" class="shrink-0 text-success" />
                </div>
                <span class="mt-1 block truncate text-[12px] text-subtle">
                  {{ kindLabel(entry.kind) }} · {{ entry.publisher }} · {{ entry.latestVersion }}
                </span>
              </div>
              <div class="flex flex-col items-end gap-1">
                <span class="rounded-5px px-2 py-1 text-[12px] font-600" :class="entryAction(entry).badgeClass">
                  {{ entryAction(entry).badge }}
                </span>
                <span v-if="!entry.verified" class="rounded-5px bg-warning-soft px-2 py-1 text-[12px] text-warning">未签名</span>
              </div>
            </div>
            <p class="mb-0 mt-3 line-clamp-2 min-h-30px text-[12px] leading-1.65 text-muted">{{ entry.summary }}</p>
            <div class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="capability in entry.capabilities"
                :key="capability"
                class="rounded-4px border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[12px] text-subtle"
              >
                {{ capability }}
              </span>
            </div>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span class="text-[12px] text-subtle">
                {{ latestVersion(entry)?.verification.license }} · {{ compactNumber(entry.installs) }} 次安装
              </span>
              <button
                class="inline-flex h-7 items-center gap-1 rounded-5px px-2 text-[12px] font-600"
                :class="entryAction(entry).buttonClass"
                @click.stop="runEntryAction(entry)"
              >
                {{ entryAction(entry).label }} <ArrowRight :size="11" />
              </button>
            </div>
          </article>
        </section>

        <section
          v-if="viewMode === 'installed' && installs.length"
          class="mt-6 rounded-8px border border-line bg-surface shadow-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 class="m-0 text-13px font-700 text-ink">已安装生命周期</h2>
              <p class="mb-0 mt-1 text-[12px] text-subtle">禁用与卸载不会删除凭据、历史权限、运行记录或审计事件。</p>
            </div>
            <span class="text-[12px] text-subtle">workspace: Acme demo</span>
          </div>
          <div class="divide-y divide-line">
            <div
              v-for="install in installs"
              :key="install.installId"
              class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <strong class="text-[12px] text-ink">{{ getEntry(install.entryId)?.name ?? install.entryId }}</strong>
                  <StatusBadge :status="install.status" />
                  <span class="rounded-4px bg-[var(--surface-3)] px-1.5 py-0.5 text-[12px] text-subtle">v{{ install.version }}</span>
                </div>
                <span class="mt-1 block text-[12px] text-subtle">
                  {{ install.credentials.length }} 个凭据 · {{ install.affectedWorkflows.length }} 个引用工作流 · 更新 {{ relativeTime(install.updatedAt) }}
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <button class="btn h-7 px-2 text-[12px]" @click="openDetail(getEntry(install.entryId)!)">详情</button>
                <button
                  v-if="hasUpdate(install)"
                  class="btn btn-primary h-7 px-2 text-[12px]"
                  @click="openPlan(getEntry(install.entryId)!, 'upgrade')"
                >
                  查看升级计划
                </button>
                <button
                  v-if="install.status === 'config_required'"
                  class="btn btn-primary h-7 px-2 text-[12px]"
                  @click="openCredential(getEntry(install.entryId)!)"
                >
                  配置凭据
                </button>
                <button
                  v-if="install.enabled"
                  class="btn h-7 px-2 text-[12px]"
                  @click="togglePlugin(install.installId, false)"
                >
                  禁用
                </button>
                <button
                  v-else-if="install.status !== 'failed'"
                  class="btn h-7 px-2 text-[12px]"
                  @click="togglePlugin(install.installId, true)"
                >
                  启用
                </button>
                <button
                  v-if="install.previousVersion"
                  class="btn h-7 px-2 text-[12px]"
                  @click="openPlan(getEntry(install.entryId)!, 'rollback')"
                >
                  回滚
                </button>
                <button class="btn btn-danger h-7 px-2 text-[12px]" @click="uninstall(install.installId)">卸载</button>
              </div>
            </div>
          </div>
        </section>
  </main>

  <DialogRoot :open="Boolean(detailEntry)" @update:open="(open) => !open && (detailEntry = null)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-70 bg-[rgba(18,20,26,0.26)]" />
      <DialogContent class="fixed inset-y-0 right-0 z-71 flex w-[min(720px,100vw)] flex-col bg-surface shadow-lg outline-none">
        <header class="flex min-h-70px items-center justify-between gap-4 border-b border-line px-5">
          <div class="flex min-w-0 items-center gap-3">
            <span
              v-if="detailEntry"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-8px bg-primary-soft text-primary"
            >
              <component :is="pluginIcon(detailEntry.icon)" :size="19" />
            </span>
            <div class="min-w-0">
              <DialogTitle class="truncate text-17px font-700 text-ink">{{ detailEntry?.name }}</DialogTitle>
              <DialogDescription class="mt-1 block truncate text-[12px] text-subtle">
                {{ detailEntry?.publisher }} · {{ kindLabel(detailEntry?.kind ?? 'tool') }} · 最新 v{{ detailEntry?.latestVersion }}
              </DialogDescription>
            </div>
          </div>
          <DialogClose as-child><button class="icon-btn" title="关闭插件详情"><X :size="16" /></button></DialogClose>
        </header>
        <div v-if="detailEntry" class="flex-1 overflow-y-auto px-5 py-4">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center gap-1 rounded-5px px-2 py-1 text-[12px] font-600"
              :class="detailEntry.verified ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
            >
              <ShieldCheck :size="11" />
              {{ detailEntry.verified ? '签名已验证' : '签名缺失' }}
            </span>
            <span class="rounded-5px bg-[var(--surface-3)] px-2 py-1 text-[12px] text-subtle">
              checksum {{ latestVersion(detailEntry)?.verification.checksum }}
            </span>
            <span class="rounded-5px bg-[var(--surface-3)] px-2 py-1 text-[12px] text-subtle">
              {{ latestVersion(detailEntry)?.verification.license }}
            </span>
            <span class="rounded-5px bg-[var(--surface-3)] px-2 py-1 text-[12px] text-subtle">
              {{ latestVersion(detailEntry)?.compatibility }}
            </span>
          </div>
          <p class="mb-0 mt-4 text-[12px] leading-1.7 text-muted">{{ detailEntry.description }}</p>

          <div class="management-segment mt-4">
            <button
              v-for="tab in detailTabs"
              :key="tab.value"
              :class="{ selected: detailTab === tab.value }"
              @click="detailTab = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>

          <div v-if="detailTab === 'overview'" class="mt-4">
            <section class="rounded-7px border border-line bg-[var(--surface-2)] p-4">
              <h3 class="m-0 text-12px font-650 text-ink">能力清单</h3>
              <div class="mt-3 flex flex-wrap gap-1.5">
                <span
                  v-for="capability in detailEntry.capabilities"
                  :key="capability"
                  class="rounded-5px bg-surface px-2 py-1 text-[12px] text-muted"
                >
                  {{ capability }}
                </span>
              </div>
            </section>
            <section class="mt-4">
              <h3 class="mb-2 text-12px font-650 text-ink">提供的工具与节点</h3>
              <div class="space-y-2">
                <div
                  v-for="tool in detailEntry.tools"
                  :key="tool.name"
                  class="rounded-7px border border-line p-3"
                >
                  <div class="flex items-center justify-between gap-2">
                    <strong class="font-mono text-[12px] text-ink">{{ tool.name }}</strong>
                    <span v-if="tool.nodeType" class="rounded-4px bg-primary-soft px-1.5 py-0.5 text-[12px] text-primary">Palette</span>
                  </div>
                  <p class="mb-0 mt-1 text-[12px] leading-1.55 text-muted">{{ tool.description }}</p>
                </div>
                <p v-if="!detailEntry.tools.length" class="text-[12px] text-subtle">该条目不提供工具或节点。</p>
              </div>
            </section>
            <section class="mt-4">
              <h3 class="mb-2 text-12px font-650 text-ink">最近审计</h3>
              <div class="overflow-hidden rounded-7px border border-line">
                <div
                  v-for="event in detailAudit"
                  :key="event.id"
                  class="grid gap-1 border-b border-line px-3 py-2.5 last:border-b-0 sm:grid-cols-[82px_1fr_110px]"
                >
                  <strong class="text-[12px] text-ink">{{ event.action }}</strong>
                  <span class="text-[12px] text-muted">{{ formatAudit(event.metadata) }}</span>
                  <span class="text-[12px] text-subtle">{{ formatDateTime(event.at) }}</span>
                </div>
                <p v-if="!detailAudit.length" class="m-0 px-3 py-4 text-[12px] text-subtle">尚无安装审计事件。</p>
              </div>
            </section>
          </div>

          <div v-else-if="detailTab === 'versions'" class="mt-4">
            <div class="space-y-2">
              <div
                v-for="version in detailEntry.versions"
                :key="version.version"
                class="rounded-7px border border-line p-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <strong class="font-mono text-[12px] text-ink">v{{ version.version }}</strong>
                    <span v-if="version.deprecated" class="rounded-4px bg-warning-soft px-1.5 py-0.5 text-[12px] text-warning">已弃用</span>
                    <span v-if="version.version === detailEntry.latestVersion" class="rounded-4px bg-primary-soft px-1.5 py-0.5 text-[12px] text-primary">最新</span>
                  </div>
                  <span class="text-[12px] text-subtle">{{ formatDate(version.releasedAt) }} · {{ version.size }}</span>
                </div>
                <p class="mb-0 mt-2 text-[12px] leading-1.6 text-muted">{{ version.changelog }}</p>
                <div class="mt-2 flex flex-wrap gap-2 text-[12px] text-subtle">
                  <span>{{ version.compatibility }}</span>
                  <span>{{ version.engine }}</span>
                  <span>schema {{ version.schemaVersion }}</span>
                  <span>{{ version.verification.license }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="detailTab === 'capabilities'" class="mt-4">
            <div class="grid gap-2 sm:grid-cols-2">
              <div class="rounded-7px border border-line p-3">
                <span class="text-[12px] font-600 text-subtle">CAPABILITIES</span>
                <p class="mb-0 mt-2 text-[12px] leading-1.7 text-muted">{{ detailEntry.capabilities.join(' · ') }}</p>
              </div>
              <div class="rounded-7px border border-line p-3">
                <span class="text-[12px] font-600 text-subtle">TOOLS</span>
                <p class="mb-0 mt-2 text-[12px] leading-1.7 text-muted">{{ detailEntry.tools.map((tool) => tool.name).join(' · ') || '无' }}</p>
              </div>
            </div>
          </div>

          <div v-else-if="detailTab === 'permissions'" class="mt-4">
            <div class="space-y-2">
              <div
                v-for="permission in detailEntry.permissions"
                :key="permission.group"
                class="rounded-7px border border-line p-3"
                :class="{ 'border-warning/30 bg-warning-soft': permission.highRisk }"
              >
                <div class="flex items-center justify-between gap-2">
                  <strong class="text-[12px] text-ink">{{ permission.label }}</strong>
                  <span v-if="permission.highRisk" class="rounded-4px bg-warning-soft px-1.5 py-0.5 text-[12px] text-warning">高风险</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="value in permission.values"
                    :key="value"
                    class="rounded-4px bg-surface px-1.5 py-1 font-mono text-[12px] text-muted"
                  >
                    {{ value }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="mt-4">
            <div class="space-y-2">
              <div
                v-for="dependency in latestVersion(detailEntry)?.dependencies ?? []"
                :key="dependency.id"
                class="rounded-7px border border-line p-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <strong class="text-[12px] text-ink">{{ dependency.name }}</strong>
                  <span
                    class="rounded-4px bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[12px] text-subtle"
                  >
                    {{ dependency.version }}
                  </span>
                </div>
              </div>
              <p
                v-if="!(latestVersion(detailEntry)?.dependencies ?? []).length"
                class="rounded-7px border border-line bg-[var(--surface-2)] p-4 text-[12px] text-subtle"
              >
                该版本没有额外插件依赖。
              </p>
            </div>
          </div>
        </div>
        <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[var(--surface-2)] px-5 py-3">
          <span class="text-[12px] text-subtle">
            {{ installFor(detailEntry?.id ?? '') ? `已安装 v${installFor(detailEntry?.id ?? '')?.version}` : '尚未安装' }}
          </span>
          <div class="flex flex-wrap gap-2">
            <button class="btn" @click="openCredential(detailEntry!)" :disabled="!installFor(detailEntry?.id ?? '')">
              <KeyRound :size="13" /> 凭据
            </button>
            <button
              v-if="installFor(detailEntry?.id ?? '')?.status === 'config_required'"
              class="btn btn-primary"
              @click="openCredential(detailEntry!)"
            >
              配置凭据
            </button>
            <button
              v-else-if="planActionFor(detailEntry!)"
              class="btn btn-primary"
              @click="openPlan(detailEntry!, planActionFor(detailEntry!)!)"
            >
              {{ planButtonLabel(detailEntry!) }}
            </button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="Boolean(planEntry)" @update:open="(open) => !open && closePlan()">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-80 bg-[rgba(18,20,26,0.3)]" />
      <DialogContent class="fixed inset-y-0 right-0 z-81 flex w-[min(680px,100vw)] flex-col bg-surface shadow-lg outline-none">
        <header class="flex min-h-64px items-center justify-between gap-4 border-b border-line px-5">
          <div>
            <DialogTitle class="text-16px font-700 text-ink">安装计划 · {{ planEntry?.name }}</DialogTitle>
            <DialogDescription class="mt-1 block text-[12px] text-subtle">
              {{ activePlan?.action }} · {{ activePlan?.fromVersion ?? '未安装' }} → v{{ activePlan?.toVersion }}
            </DialogDescription>
          </div>
          <DialogClose as-child><button class="icon-btn" title="关闭安装计划"><X :size="16" /></button></DialogClose>
        </header>

        <div v-if="activePlan" class="border-b border-line bg-[var(--surface-2)] px-5 py-3">
          <div class="grid grid-cols-5 gap-1">
            <button
              v-for="(step, index) in planSteps"
              :key="step"
              class="flex min-w-0 items-center gap-1.5 rounded-5px px-1 py-1.5 text-left text-[12px]"
              :class="planStep === index ? 'bg-surface text-ink shadow-sm' : 'text-subtle'"
              @click="planStep = index"
            >
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-650"
                :class="planStep >= index ? 'bg-primary text-white' : 'bg-[var(--surface-3)] text-subtle'"
              >
                {{ index + 1 }}
              </span>
              <span class="truncate">{{ step }}</span>
            </button>
          </div>
        </div>

        <div
          v-if="planEntry && planLoading"
          class="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-8 text-muted"
        >
          <LoaderCircle :size="24" class="animate-spin text-primary" />
          <strong class="text-[12px] text-ink">正在计算插件计划</strong>
          <span class="text-[12px] text-subtle">正在读取依赖、权限、凭据与受影响工作流。</span>
        </div>

        <div
          v-else-if="planEntry && !activePlan"
          class="m-5 rounded-7px border border-danger/30 bg-danger-soft p-4 text-[12px] text-danger"
        >
          {{ pluginError || '插件计划没有返回有效结果，请关闭后重试。' }}
        </div>

        <div v-if="activePlan && planEntry" class="flex-1 overflow-y-auto px-5 py-4">
          <section v-if="planStep === 0">
            <h3 class="m-0 text-14px font-700 text-ink">版本与影响</h3>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <div class="rounded-7px border border-line bg-[var(--surface-2)] p-3">
                <span class="text-[12px] text-subtle">动作</span>
                <strong class="mt-1 block text-12px text-ink">{{ actionLabel(activePlan.action) }}</strong>
              </div>
              <div class="rounded-7px border border-line bg-[var(--surface-2)] p-3">
                <span class="text-[12px] text-subtle">版本变化</span>
                <strong class="mt-1 block font-mono text-[12px] text-ink">{{ activePlan.fromVersion ?? 'none' }} → {{ activePlan.toVersion }}</strong>
              </div>
            </div>
            <div class="mt-3 rounded-7px border border-line p-3">
              <div class="flex items-center justify-between gap-2">
                <strong class="text-[12px] text-ink">受影响工作流</strong>
                <span class="text-[12px] text-subtle">{{ activePlan.affectedWorkflowIds.length }} 个</span>
              </div>
              <div class="mt-2 space-y-1">
                <div
                  v-for="workflowId in activePlan.affectedWorkflowIds"
                  :key="workflowId"
                  class="flex items-center justify-between gap-2 rounded-5px bg-[var(--surface-2)] px-2 py-1.5"
                >
                  <span class="text-[12px] text-muted">{{ workflowName(workflowId) }}</span>
                  <span class="font-mono text-[12px] text-subtle">{{ workflowId }}</span>
                </div>
                <p v-if="!activePlan.affectedWorkflowIds.length" class="m-0 text-[12px] text-subtle">没有已发布工作流锁定该版本。</p>
              </div>
            </div>
          </section>

          <section v-else-if="planStep === 1">
            <h3 class="m-0 text-14px font-700 text-ink">依赖解析</h3>
            <p class="mb-0 mt-1 text-[12px] text-subtle">冲突链会直接阻断计划，不允许静默降级。</p>
            <div class="mt-3 space-y-2">
              <div
                v-for="dependency in activePlan.dependencies"
                :key="dependency.id"
                class="rounded-7px border border-line p-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <strong class="text-[12px] text-ink">{{ dependency.name }}</strong>
                  <span
                    class="rounded-4px px-1.5 py-0.5 text-[12px]"
                    :class="dependency.state === 'available' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'"
                  >
                    {{ dependency.state }} · {{ dependency.version }}
                  </span>
                </div>
                <p class="mb-0 mt-1 text-[12px] text-muted">{{ dependency.chain ?? '无需额外操作。' }}</p>
              </div>
              <p
                v-if="!activePlan.dependencies.length"
                class="rounded-7px border border-line bg-[var(--surface-2)] p-4 text-[12px] text-subtle"
              >
                该版本没有插件依赖。
              </p>
            </div>
          </section>

          <section v-else-if="planStep === 2">
            <h3 class="m-0 text-14px font-700 text-ink">权限清单</h3>
            <p class="mb-0 mt-1 text-[12px] text-subtle">权限按安装快照固定，高风险权限必须显式确认。</p>
            <div class="mt-3 space-y-2">
              <div
                v-for="permission in activePlan.permissions"
                :key="permission.group"
                class="rounded-7px border p-3"
                :class="permission.highRisk ? 'border-warning/30 bg-warning-soft' : 'border-line'"
              >
                <div class="flex items-center justify-between gap-2">
                  <strong class="text-[12px] text-ink">{{ permission.label }}</strong>
                  <span v-if="permission.highRisk" class="rounded-4px bg-white/65 px-1.5 py-0.5 text-[12px] text-warning">高风险</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="value in permission.values"
                    :key="value"
                    class="rounded-4px bg-surface px-1.5 py-1 font-mono text-[12px] text-muted"
                  >
                    {{ value }}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section v-else-if="planStep === 3">
            <h3 class="m-0 text-14px font-700 text-ink">凭据检查</h3>
            <p class="mb-0 mt-1 text-[12px] text-subtle">前端只显示 secret_ref 掩码；缺失凭据会阻止插件启用。</p>
            <div class="mt-3 space-y-2">
              <div
                v-for="credential in activePlan.credentials"
                :key="credential.key"
                class="rounded-7px border border-line p-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <strong class="font-mono text-[12px] text-ink">{{ credential.key }}</strong>
                  <span
                    class="rounded-4px px-1.5 py-0.5 text-[12px]"
                    :class="credential.state === 'missing' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'"
                  >
                    {{ credential.state }}
                  </span>
                </div>
                <p class="mb-0 mt-1 font-mono text-[12px] text-subtle">
                  {{ credential.masked ?? `secret_ref://••••••••${credential.key.slice(-4)}` }}
                </p>
              </div>
              <div
                v-if="!activePlan.credentials.length"
                class="rounded-7px border border-line bg-[var(--surface-2)] p-4 text-[12px] text-subtle"
              >
                该插件不需要额外凭据。
              </div>
            </div>
          </section>

          <section v-else>
            <h3 class="m-0 text-14px font-700 text-ink">确认安装</h3>
            <div class="mt-3 grid gap-2 sm:grid-cols-3">
              <div class="rounded-7px border border-line p-3">
                <span class="text-[12px] text-subtle">Checksum</span>
                <strong class="mt-1 block text-[12px]" :class="activePlan.verification.checksum === 'ok' ? 'text-success' : 'text-danger'">
                  {{ activePlan.verification.checksum }}
                </strong>
              </div>
              <div class="rounded-7px border border-line p-3">
                <span class="text-[12px] text-subtle">签名</span>
                <strong class="mt-1 block text-[12px]" :class="activePlan.verification.signature === 'verified' ? 'text-success' : 'text-danger'">
                  {{ activePlan.verification.signature }}
                </strong>
              </div>
              <div class="rounded-7px border border-line p-3">
                <span class="text-[12px] text-subtle">许可证</span>
                <strong class="mt-1 block text-[12px]" :class="activePlan.verification.licenseBlocked ? 'text-danger' : 'text-success'">
                  {{ activePlan.verification.license }}
                </strong>
              </div>
            </div>

            <div v-if="activePlan.blockers.length" class="mt-3 rounded-7px border border-danger/30 bg-danger-soft p-3">
              <div class="flex items-center gap-2 text-danger">
                <Ban :size="14" />
                <strong class="text-[12px]">计划被阻断</strong>
              </div>
              <ul class="mb-0 mt-2 list-disc pl-5 text-[12px] leading-1.65 text-muted">
                <li v-for="blocker in activePlan.blockers" :key="blocker">{{ blocker }}</li>
              </ul>
            </div>

            <div v-if="activePlan.warnings.length" class="mt-3 rounded-7px border border-warning/30 bg-warning-soft p-3">
              <strong class="text-[12px] text-warning">安装前注意</strong>
              <ul class="mb-0 mt-2 list-disc pl-5 text-[12px] leading-1.65 text-muted">
                <li v-for="warning in activePlan.warnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>

            <label
              v-if="activePlan.highRisk"
              class="mt-3 flex items-start gap-2 rounded-7px border border-warning/30 bg-warning-soft p-3 text-[12px] text-muted"
            >
              <input v-model="highRiskConfirmed" type="checkbox" />
              <span>我已审查网络、文件、代码、MCP 与资源权限，并确认继续安装。</span>
            </label>

            <div class="mt-3 rounded-7px border border-line bg-[var(--surface-2)] p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-[12px] text-subtle">planId</span>
                <span class="font-mono text-[12px] text-ink">{{ activePlan.planId }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span class="text-[12px] text-subtle">幂等键</span>
                <span class="font-mono text-[12px] text-ink">{{ activePlan.idempotencyKey }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span class="text-[12px] text-subtle">计划过期</span>
                <span class="text-[12px]" :class="planExpired ? 'text-danger' : 'text-muted'">{{ formatDateTime(activePlan.expiresAt) }}</span>
              </div>
            </div>
          </section>

          <div v-if="pluginError" class="mt-4 rounded-7px border border-danger/30 bg-danger-soft p-3 text-[12px] text-danger">
            {{ pluginError }}
          </div>
        </div>

        <footer v-if="activePlan" class="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[var(--surface-2)] px-5 py-3">
          <div class="flex items-center gap-2">
            <button class="btn" :disabled="planLoading || planStep === 0" @click="planStep -= 1">上一步</button>
            <button v-if="planStep < 4" class="btn" :disabled="planLoading" @click="planStep += 1">下一步</button>
            <button v-if="planExpired" class="btn" :disabled="planLoading" @click="refreshPlan">重新计算</button>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="!activePlan?.canInstall" class="text-[12px] text-danger">缺少有效 checksum、签名、许可证或依赖</span>
            <button
              class="btn btn-primary"
              :disabled="planLoading || !activePlan?.planId || !activePlan.canInstall || planExpired || installing || (activePlan.highRisk && !highRiskConfirmed)"
              @click="confirmInstall"
            >
              <LoaderCircle v-if="installing" :size="14" class="animate-spin" />
              <Download v-else :size="14" />
              {{ installing ? '安装中...' : '确认安装' }}
            </button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="Boolean(credentialEntry)" @update:open="(open) => !open && (credentialEntry = null)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-90 bg-[rgba(18,20,26,0.3)]" />
      <DialogContent class="fixed left-1/2 top-1/2 z-91 w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-8px border border-line bg-surface p-5 shadow-lg outline-none">
        <div class="flex items-start justify-between gap-3">
          <div>
            <DialogTitle class="text-15px font-700 text-ink">配置插件凭据</DialogTitle>
            <DialogDescription class="mt-1 block text-[12px] text-subtle">只接受 secret_ref；明文不会发送到前端或日志。</DialogDescription>
          </div>
          <DialogClose as-child><button class="icon-btn" title="关闭凭据配置"><X :size="15" /></button></DialogClose>
        </div>
        <div v-if="credentialEntry" class="mt-4">
          <label class="field-label" for="plugin-secret-ref">{{ selectedCredential?.key ?? 'secret_ref' }}</label>
          <input
            id="plugin-secret-ref"
            v-model="secretRef"
            class="mt-2 font-mono"
            placeholder="secret_ref://workspace/key"
          />
          <p class="mb-0 mt-2 text-[12px] leading-1.55 text-subtle">
            配置后凭据仍只显示掩码；禁用或卸载不会删除 secret_ref 和历史权限。
          </p>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn" @click="credentialEntry = null">取消</button>
          <button class="btn btn-primary" @click="saveCredential">保存 secret_ref</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="settingsOpen" @update:open="settingsOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-90 bg-[rgba(18,20,26,0.26)]" />
      <DialogContent class="fixed inset-y-0 right-0 z-91 flex w-[min(520px,100vw)] flex-col bg-surface shadow-lg outline-none">
        <header class="flex min-h-64px items-center justify-between border-b border-line px-5">
          <div>
            <DialogTitle class="text-16px font-700 text-ink">市场设置</DialogTitle>
            <DialogDescription class="mt-1 block text-[12px] text-subtle">目录、签名策略和网络 allowlist</DialogDescription>
          </div>
          <DialogClose as-child><button class="icon-btn"><X :size="15" /></button></DialogClose>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <div class="field">
            <label class="field-label">Catalog 源</label>
          <input :value="syncStatus?.source ?? '未加载'" readonly />
          </div>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <div class="rounded-7px border border-line p-3">
              <span class="text-[12px] text-subtle">同步状态</span>
              <strong class="mt-1 block text-[12px]" :class="syncStatus?.state === 'ready' ? 'text-success' : 'text-warning'">{{ syncStatus?.state ?? 'unavailable' }}</strong>
            </div>
            <div class="rounded-7px border border-line p-3">
              <span class="text-[12px] text-subtle">默认策略</span>
              <strong class="mt-1 block text-[12px] text-ink">{{ syncStatus?.entries ?? 0 }} 条目 · {{ syncStatus?.versions ?? 0 }} 版本</strong>
            </div>
          </div>
          <div class="mt-4 field">
            <label class="field-label">签名策略</label>
            <select disabled><option>服务端策略（只读）</option></select>
          </div>
          <div class="mt-4 field">
            <label class="field-label">网络策略</label>
            <textarea rows="4" readonly>{{ syncStatus?.syncedAt ? `最近同步：${syncStatus.syncedAt}\n远程同步尚未接入` : '当前仅启用本地 seed catalog' }}</textarea>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AlertCircle,
  ArrowRight,
  Ban,
  BookOpen,
  CalendarClock,
  Cloud,
  Code2,
  Compass,
  Contact,
  Database,
  Download,
  File,
  Globe,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  PackageCheck,
  Plug,
  RefreshCw,
  Search,
  SearchX,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Store,
  Ticket,
  TriangleAlert,
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
  configurePluginCredentials,
  createPluginInstallPlan,
  getRegistrySyncStatus,
  installPlugin,
  listPluginAudit,
  listPluginInstalls,
  listRegistryEntries,
  listWorkflows,
  rollbackPlugin,
  setPluginInstallEnabled,
  syncRegistry,
  uninstallPlugin,
  upgradePlugin,
  type PluginInstallDto,
  type PluginInstallPlanDto,
  type PluginKindDto,
  type RegistryEntryDto,
} from '@/services/reflowApi'

type PluginEntry = RegistryEntryDto
type PluginInstall = PluginInstallDto
type PluginInstallPlan = PluginInstallPlanDto
type PluginPlanAction = PluginInstallPlanDto['action']
type PluginKind = PluginKindDto

interface RegistrySyncStatus {
  source: string
  state: string
  entries: number
  versions: number
  syncedAt?: string
}

const searchInput = ref('')
const debouncedSearch = ref('')
const viewMode = ref<'discover' | 'installed'>('discover')
const kindFilter = ref<'all' | PluginKind>('all')
const secondaryFilter = ref('')
const sortMode = ref<'recommended' | 'updated' | 'name' | 'installs'>('recommended')
const pluginEntries = ref<PluginEntry[]>([])
const installs = ref<PluginInstall[]>([])
const detailEntry = ref<PluginEntry | null>(null)
const detailTab = ref<'overview' | 'versions' | 'capabilities' | 'permissions' | 'dependencies'>('overview')
const planEntry = ref<PluginEntry | null>(null)
const activePlan = ref<PluginInstallPlan | null>(null)
const planLoading = ref(false)
const planRequestId = ref(0)
const planStep = ref(0)
const highRiskConfirmed = ref(false)
const installing = ref(false)
const pluginError = ref('')
const syncing = ref(false)
const credentialEntry = ref<PluginEntry | null>(null)
const secretRef = ref('')
const settingsOpen = ref(false)
const detailAudit = ref<Awaited<ReturnType<typeof listPluginAudit>>>([])
const syncStatus = ref<RegistrySyncStatus | null>(null)
const workflowNames = ref<Record<string, string>>({})
const loading = ref(false)
let searchTimer: number | undefined

const pluginKinds: Array<{ value: PluginKind; label: string }> = [
  { value: 'tool', label: '工具' },
  { value: 'toolkit', label: '工具包' },
  { value: 'model', label: '模型' },
  { value: 'datasource', label: '数据源' },
  { value: 'trigger', label: '触发器' },
  { value: 'node-pack', label: '节点包' },
]

const detailTabs = [
  { value: 'overview', label: '概览' },
  { value: 'versions', label: '版本' },
  { value: 'capabilities', label: '能力' },
  { value: 'permissions', label: '权限' },
  { value: 'dependencies', label: '依赖' },
] as const

const planSteps = ['版本与影响', '依赖解析', '权限清单', '凭据检查', '确认安装']

/** 可更新数量只统计已安装且目录版本更高的条目。 */
const updateCount = computed(() =>
  installs.value.filter((install) => getEntry(install.entryId)?.latestVersion !== install.version).length,
)

/** 待配置数量来自安装凭据状态，不使用后续页面伪造状态。 */
const configRequiredCount = computed(() =>
  installs.value.filter((install) =>
    install.credentials.some((credential) => credential.state === 'missing'),
  ).length,
)

/** 异常数量包括显式 failed 与签名/凭据导致的 degraded 状态。 */
const failedCount = computed(
  () => installs.value.filter((install) => ['failed', 'degraded'].includes(install.status)).length,
)

/** 当前凭据配置对象始终指向第一条缺失或即将过期凭据。 */
const selectedCredential = computed(() =>
  credentialEntry.value
    ? installFor(credentialEntry.value.id)?.credentials.find(
        (credential) => credential.state === 'missing' || credential.state === 'expiring',
      ) ?? installFor(credentialEntry.value.id)?.credentials[0]
    : undefined,
)

/** 安装计划在五分钟过期后禁用确认并要求重新计算。 */
const planExpired = computed(
  () => Boolean(activePlan.value && Date.parse(activePlan.value.expiresAt) <= Date.now()),
)

/** 按搜索、类别、次级筛选和排序生成目录列表。 */
const filteredPlugins = computed(() => {
  const keyword = debouncedSearch.value.trim().toLowerCase()
  const list = pluginEntries.value.filter((entry) => {
    const install = installFor(entry.id)
    const searchable = [
      entry.name,
      entry.publisher,
      entry.summary,
      entry.description,
      ...entry.capabilities,
      ...entry.tools.map((tool) => tool.name),
    ]
      .join(' ')
      .toLowerCase()
    const matchesSearch = !keyword || searchable.includes(keyword)
    const matchesKind = kindFilter.value === 'all' || entry.kind === kindFilter.value
    if (!matchesSearch || !matchesKind) return false
    if (viewMode.value === 'installed' && !install) return false
    if (viewMode.value === 'discover') {
      if (secondaryFilter.value === 'official' && (!entry.verified || !entry.publisher.includes('Reflow'))) return false
      if (secondaryFilter.value === 'installed' && !install) return false
      if (secondaryFilter.value === 'update' && (!install || entry.latestVersion === install.version)) return false
    }
    if (viewMode.value === 'installed' && secondaryFilter.value) {
      if (secondaryFilter.value === 'update_available') return install ? hasUpdate(install) : false
      if (secondaryFilter.value === 'failed') return ['failed', 'degraded'].includes(install?.status ?? '')
      if (secondaryFilter.value === 'config_required') {
        return install?.credentials.some((credential) => credential.state === 'missing') ?? false
      }
      return install?.status === secondaryFilter.value
    }
    return true
  })
  return list.sort((a, b) => {
    if (sortMode.value === 'updated') return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (sortMode.value === 'name') return a.name.localeCompare(b.name, 'zh-CN')
    if (sortMode.value === 'installs') return b.installs - a.installs
    const installedOrder =
      Number(Boolean(installFor(b.id))) - Number(Boolean(installFor(a.id)))
    return installedOrder || b.installs - a.installs
  })
})

watch(searchInput, (value) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    debouncedSearch.value = value
  }, 300)
})

watch(viewMode, () => {
  secondaryFilter.value = viewMode.value === 'installed' ? 'all' : ''
})

onUnmounted(() => {
  if (searchTimer) window.clearTimeout(searchTimer)
})

/**
 * 加载真实 registry、安装记录、同步状态与工作流名称映射。
 */
async function loadPage() {
  if (loading.value) return
  loading.value = true
  pluginError.value = ''
  try {
    const [entries, currentInstalls, status, workflows] = await Promise.all([
      listRegistryEntries({ kind: 'plugin', limit: 100 }),
      listPluginInstalls(),
      getRegistrySyncStatus(),
      listWorkflows(),
    ])
    pluginEntries.value = entries
    installs.value = currentInstalls
    syncStatus.value = status
    workflowNames.value = Object.fromEntries(
      workflows.map((workflow) => [workflow.id, workflow.name]),
    )
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : '插件市场加载失败。'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadPage()
})

/**
 * 按 entry_id 获取目录条目。
 *
 * @param entryId registry entry_id。
 * @returns 目录条目或 undefined。
 */
function getEntry(entryId: string): PluginEntry | undefined {
  return pluginEntries.value.find((entry) => entry.id === entryId)
}

/**
 * 获取指定插件的 workspace 安装记录。
 *
 * @param entryId registry entry_id。
 * @returns 安装记录或 undefined。
 */
function installFor(entryId: string): PluginInstall | undefined {
  return installs.value.find((install) => install.entryId === entryId)
}

/**
 * 按外部安装 ID 获取安装记录。
 *
 * @param installId 外部安装 ID。
 * @returns 安装记录或 undefined。
 */
function installById(installId: string): PluginInstall | undefined {
  return installs.value.find((install) => install.installId === installId)
}

/**
 * 判断目录最新版本是否高于已安装版本。
 *
 * @param install 当前安装。
 * @returns 是否存在可用升级。
 */
function hasUpdate(install: PluginInstall): boolean {
  const latest = getEntry(install.entryId)?.latestVersion
  return Boolean(latest && latest !== install.version)
}

/** 重新读取持久化的插件 registry 与安装状态。 */
async function reloadInstalls() {
  await loadPage()
}

/**
 * 打开插件详情并加载对应安装审计。
 *
 * @param entry 目录条目。
 */
async function openDetail(entry: PluginEntry) {
  detailEntry.value = entry
  detailTab.value = 'overview'
  detailAudit.value = []
  const install = installFor(entry.id)
  if (!install) return
  try {
    detailAudit.value = await listPluginAudit(install.installId)
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : '插件审计加载失败。'
  }
}

/**
 * 打开安装、升级或回滚计划；任何写操作前都必须由服务端生成 planId。
 *
 * @param entry 目录条目。
 * @param action 服务端允许的计划动作。
 */
async function openPlan(entry: PluginEntry, action: PluginPlanAction) {
  const install = installFor(entry.id)
  const version = action === 'rollback' ? install?.previousVersion : entry.latestVersion
  if (!version) {
    pluginError.value = '当前安装没有可回滚的 previousVersion。'
    return
  }
  pluginError.value = ''
  highRiskConfirmed.value = false
  planEntry.value = entry
  activePlan.value = null
  planLoading.value = true
  planStep.value = 0
  const requestId = ++planRequestId.value
  try {
    const plan = await createPluginInstallPlan({
      entryId: entry.id,
      action,
      version,
    })
    if (requestId !== planRequestId.value || planEntry.value?.id !== entry.id) return
    activePlan.value = plan
  } catch (error) {
    if (requestId !== planRequestId.value) return
    pluginError.value = error instanceof Error ? error.message : '插件计划计算失败。'
  } finally {
    if (requestId === planRequestId.value) planLoading.value = false
  }
}

/**
 * 关闭安装计划并清空临时确认状态，避免旧请求回写已关闭弹窗。
 */
function closePlan() {
  planRequestId.value += 1
  planEntry.value = null
  activePlan.value = null
  planLoading.value = false
  pluginError.value = ''
  highRiskConfirmed.value = false
  planStep.value = 0
}

/**
 * 重新计算已过期计划，旧 planId 不复用。
 */
async function refreshPlan() {
  const entry = planEntry.value
  if (!activePlan.value || !entry) return
  const action = activePlan.value.action
  const version = activePlan.value.toVersion
  pluginError.value = ''
  planLoading.value = true
  const requestId = ++planRequestId.value
  try {
    const plan = await createPluginInstallPlan({
      entryId: entry.id,
      action,
      version,
    })
    if (requestId !== planRequestId.value) return
    activePlan.value = plan
    highRiskConfirmed.value = false
    planStep.value = 4
  } catch (error) {
    if (requestId !== planRequestId.value) return
    pluginError.value = error instanceof Error ? error.message : '插件计划重新计算失败。'
  } finally {
    if (requestId === planRequestId.value) planLoading.value = false
  }
}

/**
 * 提交 planId、幂等键与高风险确认，并分发到安装、升级或回滚端点。
 */
async function confirmInstall() {
  if (!activePlan.value || installing.value) return
  installing.value = true
  pluginError.value = ''
  try {
    if (activePlan.value.action === 'install') {
      await installPlugin({
        planId: activePlan.value.planId,
        idempotencyKey: activePlan.value.idempotencyKey,
        highRiskConfirmed: highRiskConfirmed.value,
      })
    } else {
      const installId = activePlan.value.installId
      if (!installId) throw new Error('计划缺少 installId，请重新计算。')
      if (activePlan.value.action === 'upgrade') {
        await upgradePlugin(installId, {
          planId: activePlan.value.planId,
          idempotencyKey: activePlan.value.idempotencyKey,
          highRiskConfirmed: highRiskConfirmed.value,
        })
      } else {
        await rollbackPlugin(installId, {
          planId: activePlan.value.planId,
          idempotencyKey: activePlan.value.idempotencyKey,
          highRiskConfirmed: highRiskConfirmed.value,
        })
      }
    }
    await reloadInstalls()
    activePlan.value = null
    detailEntry.value = null
    viewMode.value = 'installed'
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : '插件生命周期操作失败。'
  } finally {
    installing.value = false
  }
}

/**
 * 根据当前安装状态选择卡片主操作。
 *
 * @param entry 目录条目。
 */
function runEntryAction(entry: PluginEntry) {
  const install = installFor(entry.id)
  if (!install) {
    void openPlan(entry, 'install')
    return
  }
  if (install.credentials.some((credential) => credential.state === 'missing')) {
    openCredential(entry)
    return
  }
  if (hasUpdate(install)) {
    void openPlan(entry, 'upgrade')
    return
  }
  void openDetail(entry)
}

/**
 * 返回卡片状态徽标和主操作文案。
 *
 * @param entry 目录条目。
 * @returns 展示状态与按钮样式。
 */
function entryAction(entry: PluginEntry) {
  const install = installFor(entry.id)
  if (!install) {
    return {
      badge: '可安装',
      badgeClass: 'bg-[var(--surface-3)] text-subtle',
      label: '查看计划',
      buttonClass: 'bg-primary text-white',
    }
  }
  if (install.status === 'config_required') {
    return {
      badge: '需配置',
      badgeClass: 'bg-warning-soft text-warning',
      label: '配置凭据',
      buttonClass: 'bg-warning-soft text-warning',
    }
  }
  if (hasUpdate(install)) {
    return {
      badge: '可更新',
      badgeClass: 'bg-primary-soft text-primary',
      label: '升级计划',
      buttonClass: 'bg-primary-soft text-primary',
    }
  }
  if (install.status === 'failed' || install.status === 'degraded') {
    return {
      badge: '异常',
      badgeClass: 'bg-danger-soft text-danger',
      label: '诊断',
      buttonClass: 'bg-danger-soft text-danger',
    }
  }
  return {
    badge: install.enabled ? '已启用' : '已禁用',
    badgeClass: install.enabled ? 'bg-success-soft text-success' : 'bg-[var(--surface-3)] text-subtle',
    label: '详情',
    buttonClass: 'bg-[var(--surface-3)] text-muted',
  }
}

/**
 * 根据安装状态选择可执行的服务端计划动作。
 *
 * @param entry 目录条目。
 * @returns 计划动作或 null。
 */
function planActionFor(entry: PluginEntry): PluginPlanAction | null {
  const install = installFor(entry.id)
  if (!install) return 'install'
  if (hasUpdate(install)) return 'upgrade'
  if (install.previousVersion) return 'rollback'
  return null
}

/**
 * 返回详情页主按钮文案。
 *
 * @param entry 目录条目。
 * @returns 中文操作文案。
 */
function planButtonLabel(entry: PluginEntry): string {
  const action = planActionFor(entry)
  if (action === 'install') return '查看安装计划'
  if (action === 'upgrade') return '查看升级计划'
  if (action === 'rollback') return '查看回滚计划'
  return '详情'
}

/**
 * 打开凭据配置弹窗，只允许 secret_ref 输入。
 *
 * @param entry 目录条目。
 */
function openCredential(entry: PluginEntry) {
  if (!installFor(entry.id)) {
    pluginError.value = '请先安装插件，再配置凭据。'
    return
  }
  credentialEntry.value = entry
  secretRef.value = 'secret_ref://'
}

/**
 * 保存 secret_ref，不处理或回显明文凭据。
 */
async function saveCredential() {
  if (!credentialEntry.value || !selectedCredential.value) return
  const install = installFor(credentialEntry.value.id)
  if (!install) return
  pluginError.value = ''
  try {
    await configurePluginCredentials(install.installId, [{
      key: selectedCredential.value.key,
      secretRef: secretRef.value,
      authType: selectedCredential.value.authType,
    }])
    await reloadInstalls()
    credentialEntry.value = null
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : '凭据配置失败。'
  }
}

/**
 * 启用或禁用插件，凭据和权限快照保持不变。
 *
 * @param installId 外部安装 ID。
 * @param enabled 目标启停状态。
 */
async function togglePlugin(installId: string, enabled: boolean) {
  pluginError.value = ''
  try {
    await setPluginInstallEnabled(installId, enabled)
    await reloadInstalls()
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : '插件状态更新失败。'
  }
}

/**
 * 卸载前展示引用工作流与历史保留说明。
 *
 * @param installId 外部安装 ID。
 */
async function uninstall(installId: string) {
  const install = installById(installId)
  const entry = install ? getEntry(install.entryId) : undefined
  if (!install || !entry) return
  const confirmed = window.confirm(
    `卸载「${entry.name}」会影响 ${install.affectedWorkflows.length} 个工作流。\n运行历史、凭据 secret_ref 和审计记录将保留，是否继续？`,
  )
  if (!confirmed) return
  pluginError.value = ''
  try {
    await uninstallPlugin(installId)
    await reloadInstalls()
    detailEntry.value = null
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : '插件卸载失败。'
  }
}

/** 从指标卡进入已安装列表并应用状态筛选。 */
function openInstalledFilter(filter: string) {
  if (!filter) {
    viewMode.value = 'discover'
    secondaryFilter.value = ''
    return
  }
  viewMode.value = 'installed'
  secondaryFilter.value = filter
}

/** 清空市场筛选与关键词。 */
function clearFilters() {
  searchInput.value = ''
  debouncedSearch.value = ''
  kindFilter.value = 'all'
  secondaryFilter.value = viewMode.value === 'installed' ? 'all' : ''
}

/** 统计指定插件类型的目录条目数量。 */
function kindCount(kind: PluginKind): number {
  return pluginEntries.value.filter((entry) => entry.kind === kind).length
}

/** 中文插件类型标签。 */
function kindLabel(kind: PluginKind): string {
  return pluginKinds.find((item) => item.value === kind)?.label ?? kind
}

/** 返回指定插件的最新版本元数据。 */
function latestVersion(entry: PluginEntry | undefined) {
  return entry?.versions.find((version) => version.version === entry.latestVersion) ?? entry?.versions[0]
}

/** 将计划动作转换为中文。 */
function actionLabel(action: PluginPlanAction): string {
  const labels: Record<PluginPlanAction, string> = {
    install: '安装',
    upgrade: '升级',
    rollback: '回滚',
  }
  return labels[action]
}

/** 根据插件 icon 字段返回 Lucide 组件。 */
function pluginIcon(icon: string) {
  const icons = {
    contact: Contact,
    database: Database,
    globe: Globe,
    sparkles: Sparkles,
    clock: CalendarClock,
    file: File,
    message: MessageSquare,
    ticket: Ticket,
    shield: Shield,
    cloud: Cloud,
    code: Code2,
    book: BookOpen,
    plug: Plug,
  }
  return icons[icon as keyof typeof icons] ?? Plug
}

/** 将工作流 ID 映射为工作流名称。 */
function workflowName(workflowId: string): string {
  return workflowNames.value[workflowId] ?? workflowId
}

/** 格式化审计 metadata，并确保密钥不会进入展示文本。 */
function formatAudit(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ')
}

/** 格式化日期。 */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/**
 * 格式化带时分的时间。
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

/**
 * 将 ISO 时间转换为相对时间。
 *
 * @param value ISO 时间。
 * @returns 相对时间文本。
 */
function relativeTime(value: string): string {
  const delta = Date.now() - Date.parse(value)
  const minutes = Math.max(0, Math.floor(delta / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 以千位单位压缩安装量。 */
function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

/** 调用真实 registry 同步端点；P1 未接入时保留服务端错误。 */
async function syncCatalog() {
  if (syncing.value) return
  syncing.value = true
  pluginError.value = ''
  try {
    await syncRegistry()
    await loadPage()
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : 'Registry 同步失败。'
  } finally {
    syncing.value = false
  }
}
</script>
