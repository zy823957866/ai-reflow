import type { ComputedRef, InjectionKey, Ref } from 'vue'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  listKnowledgeBases,
  updateKnowledgeBase,
} from '@/services/reflowApi'
import { notifyError } from '@/shared/toast'
import type { KnowledgeBaseItem } from '../types'
import { apiErrorText } from '../utils/errors'

/** 知识库列表的状态筛选 */
type KnowledgeBaseStatus = 'all' | 'indexing' | 'ready'

/** 通过 provide/inject 共享的知识库上下文 */
interface KnowledgeBaseContext {
  /** 知识库列表 */
  knowledgeBases: Ref<KnowledgeBaseItem[]>
  /** 当前选中的知识库 ID */
  activeKbId: Ref<string>
  /** 当前选中的知识库对象 */
  activeKb: ComputedRef<KnowledgeBaseItem | undefined>
  /** 搜索关键词 */
  query: Ref<string>
  /** 状态筛选 */
  statusFilter: Ref<KnowledgeBaseStatus>
  /** 列表加载中 */
  loading: Ref<boolean>
  /** 加载知识库列表 */
  load: (silent?: boolean) => Promise<void>
  /** 选中指定知识库 */
  select: (id: string) => void
  /** 新建（无 id 时）或更新知识库 */
  save: (value: { name: string; description: string }, id?: string) => Promise<KnowledgeBaseItem>
  /** 保存分块设置 */
  saveChunkSettings: (
    id: string,
    value: { chunkSize: number; overlapSize: number; separator: string },
  ) => Promise<void>
  /** 删除知识库 */
  remove: (knowledgeBase: KnowledgeBaseItem) => Promise<void>
}

/** 知识库上下文的注入 key */
const knowledgeBaseKey: InjectionKey<KnowledgeBaseContext> = Symbol('knowledge-bases')

/**
 * 创建知识库列表状态并通过 provide 注入给后代组件。
 *
 * 页面级组件调用一次，后代组件用 useKnowledgeBases 消费。
 */
export function provideKnowledgeBases() {
  /** 知识库列表 */
  const knowledgeBases = ref<KnowledgeBaseItem[]>([])
  /** 当前选中的知识库 ID */
  const activeKbId = ref('')
  /** 搜索关键词 */
  const query = ref('')
  /** 状态筛选 */
  const statusFilter = ref<KnowledgeBaseStatus>('all')
  /** 列表加载中 */
  const loading = ref(false)
  /** 搜索防抖定时器 */
  let filterTimer: number | undefined
  /** 请求版本号，用于丢弃过期响应 */
  let requestVersion = 0

  /** 当前选中的知识库对象 */
  const activeKb = computed(() =>
    knowledgeBases.value.find((item) => item.id === activeKbId.value),
  )

  /**
   * 加载知识库列表（带搜索与状态筛选）。
   *
   * @param silent 为 true 时静默加载，不改变 loading 状态。
   */
  async function load(silent = false) {
    const version = ++requestVersion
    if (!silent) loading.value = true
    try {
      const items = await listKnowledgeBases({
        search: query.value.trim() || undefined,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      })
      if (version !== requestVersion) return
      knowledgeBases.value = items
      if (!items.some((item) => item.id === activeKbId.value)) {
        activeKbId.value = items[0]?.id ?? ''
      }
    } catch (error) {
      if (version !== requestVersion) return
      notifyError({
        title: '知识库列表加载失败',
        description: apiErrorText(error),
        retry: () => void load(),
      })
    } finally {
      if (version === requestVersion && !silent) loading.value = false
    }
  }

  /**
   * 新建或更新知识库；无 id 时按默认 embedding 配置创建。
   *
   * @param value 名称与描述。
   * @param id 更新时传已有知识库 ID，新建时省略。
   * @returns 保存后的知识库。
   */
  async function save(
    value: { name: string; description: string },
    id?: string,
  ) {
    const saved = id
      ? await updateKnowledgeBase(id, value)
      : await createKnowledgeBase({
          ...value,
          embeddingProvider: 'ollama',
          embeddingModel: 'nomic-embed-text',
          embeddingDimension: 768,
        })
    await load(true)
    activeKbId.value = saved.id
    return saved
  }

  /**
   * 保存知识库的分块设置。
   *
   * @param id 知识库 ID。
   * @param value 分块大小、重叠与分隔符配置。
   */
  async function saveChunkSettings(
    id: string,
    value: { chunkSize: number; overlapSize: number; separator: string },
  ) {
    await updateKnowledgeBase(id, value)
    await load(true)
  }

  /**
   * 删除知识库；若删除的是当前选中项则清空选中。
   *
   * @param knowledgeBase 目标知识库。
   */
  async function remove(knowledgeBase: KnowledgeBaseItem) {
    await deleteKnowledgeBase(knowledgeBase.id)
    if (activeKbId.value === knowledgeBase.id) activeKbId.value = ''
    await load()
  }

  // 搜索关键词或状态筛选变化时，防抖 200ms 后重新加载
  watch([query, statusFilter], () => {
    window.clearTimeout(filterTimer)
    filterTimer = window.setTimeout(() => void load(), 200)
  })

  onScopeDispose(() => window.clearTimeout(filterTimer))

  provide(knowledgeBaseKey, {
    knowledgeBases,
    activeKbId,
    activeKb,
    query,
    statusFilter,
    loading,
    load,
    select: (id) => {
      activeKbId.value = id
    },
    save,
    saveChunkSettings,
    remove,
  })
}

/**
 * 注入知识库上下文；未在 provideKnowledgeBases 的组件树内使用时抛错。
 */
export function useKnowledgeBases() {
  const context = inject(knowledgeBaseKey)
  if (!context) throw new Error('Knowledge base context is missing.')
  return context
}
