<template>
  <div class="schema-form flex flex-col gap-2px">
    <template v-for="group in groups" :key="group.name">
      <section v-if="group.fields.length" class="form-group border-b border-line px-16px pb-17px pt-14px last:border-b-0">
        <button
          v-if="isCollapsible(group.name)"
          type="button"
          class="group-header mb-13px flex items-center gap-5px border-0 bg-transparent p-0 text-[12px] font-[650] uppercase tracking-[0.02em] text-subtle"
          @click="toggleGroup(group.name)"
        >
          <ChevronDown :size="14" class="transition-transform duration-150" :class="isCollapsed(group.name) ? '-rotate-90' : ''" />
          <span>{{ group.name }}</span>
        </button>
        <div v-else class="group-title mb-13px text-[12px] font-[650] uppercase tracking-[0.02em] text-subtle">{{ group.name }}</div>
        <div v-show="!isCollapsed(group.name)" class="group-fields flex flex-col gap-16px">
          <div
            v-for="field in group.fields"
            :key="field.key"
            class="field-row flex flex-col gap-7px"
            :class="errorFor(field.key) ? 'border border-[#f2b8ba] rounded-7px bg-[#fff7f7] p-8px' : ''"
            :data-field-key="field.key"
          >
            <div class="flex items-center gap-5px">
              <span>{{ field.label }}</span>
              <span v-if="field.required" class="text-danger">*</span>
              <span v-if="field.sensitive" class="ml-1px rounded-3px bg-warning-soft px-4px py-1px text-[12px] font-600 text-warning">敏感</span>
              <button
                v-if="field.variable"
                type="button"
                class="variable-button ml-auto inline-flex border-0 bg-transparent p-2px text-primary"
                title="插入变量"
                @click="insertVariable(field.key)"
              >
                <Braces :size="12" />
              </button>
            </div>

            <template v-if="field.widget === 'richtext'">
              <RichTextField
                :model-value="value(field.key)"
                :placeholder="field.placeholder"
                :disabled="disabled"
                :variables="variableOptions"
                @update:model-value="update(field.key, $event)"
                @blur="$emit('flush')"
              />
            </template>

            <template v-else-if="field.widget === 'textarea'">
              <textarea
                class="h-auto min-h-76px resize-y px-10px py-9px text-12px leading-1.6"
                :value="textValue(field.key)"
                :placeholder="field.placeholder"
                :rows="field.rows ?? 4"
                :disabled="disabled"
                @input="update(field.key, ($event.target as HTMLTextAreaElement).value)"
                @blur="$emit('flush')"
              />
            </template>

            <template v-else-if="field.widget === 'number'">
              <div class="relative flex items-center">
                <input
                  class="h-35px pl-10px pr-68px font-mono text-[12px]"
                  type="number"
                  :value="value(field.key)"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step"
                  :disabled="disabled"
                  @input="update(field.key, Number(($event.target as HTMLInputElement).value))"
                  @blur="$emit('flush')"
                />
                <span v-if="field.max" class="absolute right-10px text-[12px] text-subtle">{{ value(field.key) }} / {{ field.max }}</span>
              </div>
            </template>

            <template v-else-if="field.widget === 'boolean'">
              <button
                type="button"
                class="switch relative h-21px w-38px border rounded-full p-0 transition-[background,border-color] duration-150"
                :class="Boolean(value(field.key)) ? 'border-primary bg-primary' : 'border-border-strong bg-surface-3'"
                :disabled="disabled"
                @click="update(field.key, !value(field.key))"
              >
                <span
                  class="absolute left-3px top-3px h-13px w-13px rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-150"
                  :class="Boolean(value(field.key)) ? 'translate-x-17px' : ''"
                />
              </button>
            </template>

            <template v-else-if="field.widget === 'select'">
              <select
                class="h-35px px-10px text-12px"
                :value="value(field.key)"
                :disabled="disabled"
                @change="update(field.key, ($event.target as HTMLSelectElement).value)"
                @blur="$emit('flush')"
              >
                <option
                  v-for="option in field.options ?? []"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </template>

            <template v-else-if="field.widget === 'multiselect'">
              <div class="flex flex-wrap gap-5px">
                <button
                  v-for="option in optionsFor(field)"
                  :key="option.value"
                  type="button"
                  class="h-27px border rounded-5px bg-surface px-8px text-[12px] text-muted"
                  :class="isSelected(field.key, option.value) ? 'border-[#c3bdf9] bg-primary-soft text-primary' : 'border-line'"
                  :disabled="disabled"
                  @click="toggleMulti(field, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
              <button v-if="!optionsFor(field).length && field.widget === 'multiselect'" type="button" class="h-28px w-full border border-dashed border-border-strong rounded-6px bg-transparent text-[12px] text-subtle" disabled>
                未接入选项服务
              </button>
            </template>

            <template v-else-if="field.widget === 'json' || field.widget === 'schema'">
              <div class="code-control overflow-hidden border border-line rounded-7px bg-[#fbfbfd]">
                <div class="code-toolbar flex h-30px items-center justify-between border-b border-line px-9px font-mono text-[12px] text-subtle">
                  <span>{{ field.widget === 'schema' ? 'JSON Schema' : 'JSON' }}</span>
                  <button type="button" class="border-0 bg-transparent text-[12px] text-subtle" :disabled="disabled" @click="formatJson(field.key)">格式化</button>
                </div>
                <textarea
                  class="code-area min-h-122px w-full resize-y border-0 rounded-0 bg-transparent p-10px font-mono text-[12px] leading-1.6 text-muted"
                  spellcheck="false"
                  :value="jsonText(field.key)"
                  :disabled="disabled"
                  @input="updateJson(field.key, ($event.target as HTMLTextAreaElement).value)"
                  @blur="$emit('flush')"
                />
              </div>
            </template>

            <template v-else-if="field.widget === 'code'">
              <div class="code-control dark overflow-hidden border border-[#252937] rounded-7px bg-[var(--code-bg)]">
                <div class="code-toolbar flex h-30px items-center justify-between border-b border-[#2a2e3a] px-9px font-mono text-[12px] text-[#9199aa]">
                  <span>{{ field.language === 'sql' ? 'SQL' : 'JavaScript' }}</span>
                  <span class="h-1.5 w-1.5 rounded-full bg-success" />
                </div>
                <textarea
                  class="code-area min-h-122px w-full resize-y border-0 rounded-0 bg-transparent p-10px font-mono text-[12px] leading-1.6 text-[#d8dbe5]"
                  spellcheck="false"
                  :value="textValue(field.key)"
                  :placeholder="field.placeholder"
                  :disabled="disabled"
                  @input="update(field.key, ($event.target as HTMLTextAreaElement).value)"
                  @blur="$emit('flush')"
                />
              </div>
            </template>

            <template v-else-if="field.widget === 'keyvalue'">
              <div class="kv-list flex flex-col gap-6px">
                <div v-for="(item, index) in keyValueRows(field.key)" :key="index" class="kv-row flex items-center gap-5px">
                  <input
                    class="h-30px min-w-0 px-8px font-mono text-[12px]"
                    :value="item.key"
                    placeholder="key"
                    :disabled="disabled"
                    @input="updateKeyValue(field.key, index, 'key', ($event.target as HTMLInputElement).value)"
                  />
                  <input
                    class="h-30px min-w-0 px-8px font-mono text-[12px]"
                    :value="item.value"
                    placeholder="value"
                    :disabled="disabled"
                    @input="updateKeyValue(field.key, index, 'value', ($event.target as HTMLInputElement).value)"
                  />
                  <button type="button" class="icon-btn" :disabled="disabled" @click="removeKeyValue(field.key, index)">
                    <X :size="13" />
                  </button>
                </div>
                <button type="button" class="add-row inline-flex h-28px items-center justify-center gap-4px border border-dashed border-border-strong rounded-6px bg-transparent text-[12px] text-subtle" :disabled="disabled" @click="addKeyValue(field.key)">
                  <Plus :size="13" /> 添加字段
                </button>
              </div>
            </template>

            <template v-else-if="field.widget === 'tags'">
              <input
                class="h-35px px-10px text-12px"
                :value="commaValue(field.key)"
                :placeholder="field.placeholder || '用逗号分隔'"
                :disabled="disabled"
                @input="update(field.key, ($event.target as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean))"
                @blur="$emit('flush')"
              />
            </template>

            <template v-else-if="field.widget === 'file'">
              <div class="file-control flex h-40px items-center gap-8px border border-dashed border-border-strong rounded-7px bg-surface-2 px-10px text-[12px] text-subtle">
                <FileUp :size="15" />
                <span class="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis">{{ fileName(field.key) || '选择一个文件' }}</span>
                <button type="button" class="border-0 bg-transparent text-[12px] text-primary" :disabled="disabled || !services?.uploadFile" @click="chooseFile(field.key)">
                  {{ services?.uploadFile ? '上传' : '未接入' }}
                </button>
                <input
                  :ref="(el) => setFileInput(field.key, el as HTMLInputElement | null)"
                  type="file"
                  hidden
                  @change="uploadFile(field.key, $event)"
                />
              </div>
            </template>

            <template v-else-if="field.widget === 'conditions' || field.widget === 'list'">
              <div class="structured-list flex flex-col gap-6px">
                <div v-for="(item, index) in listRows(field.key)" :key="index" class="list-row flex items-center gap-5px">
                  <span class="list-index mono inline-flex h-20px w-20px shrink-0 items-center justify-center rounded-4px bg-surface-3 text-[12px] text-subtle">{{ index + 1 }}</span>
                  <input
                    class="h-30px min-w-0 px-8px font-mono text-[12px]"
                    :value="listLabel(item)"
                    :disabled="disabled"
                    @input="updateList(field.key, index, ($event.target as HTMLInputElement).value)"
                  />
                  <button type="button" class="icon-btn" :disabled="disabled" @click="removeList(field.key, index)">
                    <X :size="13" />
                  </button>
                </div>
                <button type="button" class="add-row inline-flex h-28px items-center justify-center gap-4px border border-dashed border-border-strong rounded-6px bg-transparent text-[12px] text-subtle" :disabled="disabled" @click="addList(field.key)">
                  <Plus :size="13" /> 添加项
                </button>
              </div>
            </template>

            <template v-else-if="field.widget === 'model-picker' || field.widget === 'mcp-server' || field.widget === 'workflow-picker'">
              <select
                class="h-35px px-10px text-12px"
                :value="value(field.key)"
                :disabled="disabled || !optionsFor(field).length"
                @change="update(field.key, ($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>{{ optionsFor(field).length ? '请选择' : '未接入选项服务' }}</option>
                <option
                  v-for="option in optionsFor(field)"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </template>

            <template v-else-if="field.widget === 'node-picker'">
              <input
                class="h-35px px-10px text-12px"
                :value="commaValue(field.key)"
                :placeholder="field.placeholder || '上游节点 ID'"
                :disabled="disabled"
                @input="update(field.key, ($event.target as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean))"
                @blur="$emit('flush')"
              />
            </template>

            <template v-else>
              <input
                class="h-35px px-10px text-12px"
                :value="value(field.key)"
                :placeholder="field.placeholder"
                :disabled="disabled"
                @input="update(field.key, ($event.target as HTMLInputElement).value)"
                @blur="$emit('flush')"
              />
            </template>

            <div v-if="field.help" class="text-[12px] leading-1.55 text-subtle">{{ field.help }}</div>
            <div v-if="errorFor(field.key)" class="text-[12px] leading-1.45 text-danger">{{ errorFor(field.key) }}</div>
          </div>
        </div>
      </section>
    </template>
    <div v-if="!fields.length" class="readonly-fallback m-16px flex items-start gap-8px rounded-7px bg-surface-3 p-10px text-[12px] leading-1.55 text-subtle">
      <Info :size="15" />
      <span>未注册表单。当前只展示 Manifest 只读信息。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Braces,
  ChevronDown,
  FileUp,
  Info,
  Plus,
  X,
} from 'lucide-vue-next'
import type {
  DesignerServices,
  ManifestField,
  NodeManifest,
  SelectOption,
} from '@/shared/types'
import RichTextField from './RichTextField.vue'

const props = defineProps<{
  fields: ManifestField[]
  modelValue: Record<string, unknown>
  manifest?: NodeManifest
  disabled?: boolean
  services?: DesignerServices
  options?: Record<string, SelectOption[]>
  errors?: Array<{ field?: string; message: string }>
}>()

const emit = defineEmits<{
  'update-field': [key: string, value: unknown]
  'update-mode': [key: string, value: string]
  flush: []
  commit: [payload: Record<string, unknown>]
}>()

const collapsed = ref(new Set<string>())
const fileInputs = new Map<string, HTMLInputElement>()
const variableOptions = computed(() => [
  { label: '$input.question', value: '{{ $input.question }}' },
  { label: '$node.n_kb.output.context', value: '{{ $node.n_kb.output.context }}' },
  { label: '$node.n_llm.output.text', value: '{{ $node.n_llm.output.text }}' },
])

const groups = computed(() => {
  const result: Array<{ name: string; fields: ManifestField[] }> = []
  for (const field of props.fields) {
    const name = field.group ?? '基础配置'
    let group = result.find((item) => item.name === name)
    if (!group) {
      group = { name, fields: [] }
      result.push(group)
    }
    group.fields.push(field)
  }
  return result
})

/**
 * 读取字段当前值。
 * @param key 字段键。
 * @returns 字段值。
 */
function value(key: string) {
  return props.modelValue?.[key]
}

/**
 * 将字段值安全转换为文本或数字控件值。
 * @param key 字段键。
 * @returns 可编辑文本或数字。
 */
function textValue(key: string): string | number {
  const current = value(key)
  if (typeof current === 'string' || typeof current === 'number') return current
  if (current === null || current === undefined) return ''
  try {
    return JSON.stringify(current)
  } catch {
    return String(current)
  }
}

/**
 * 将数组值转换为逗号分隔文本。
 * @param key 字段键。
 * @returns 逗号分隔文本。
 */
function commaValue(key: string): string {
  const current = value(key)
  return Array.isArray(current) ? current.join(', ') : String(textValue(key))
}

/**
 * 更新字段并同步完整配置快照。
 * @param key 字段键。
 * @param next 新值。
 */
function update(key: string, next: unknown) {
  if (props.disabled) return
  emit('update-field', key, next)
  emit('commit', { ...props.modelValue, [key]: next })
}

/**
 * 查找字段错误。
 * @param key 字段键。
 * @returns 错误文案。
 */
function errorFor(key: string) {
  return props.errors?.find((item) => item.field === key)?.message
}

/**
 * 解析并返回下拉选项。
 * @param field 当前 Manifest 字段。
 * @returns 可选选项。
 */
function optionsFor(field: ManifestField): SelectOption[] {
  if (props.options?.[field.key]) return props.options[field.key]
  if (field.widget === 'model-picker') {
    return props.options?.modelConnectionId ?? []
  }
  if (field.widget === 'mcp-server') {
    return props.options?.serverId ?? []
  }
  if (field.widget === 'workflow-picker') {
    return props.options?.workflowId ?? []
  }
  if (field.widget === 'multiselect' && field.key === 'knowledgeBaseId') {
    return props.options?.knowledgeBaseId ?? []
  }
  return field.options ?? []
}

/**
 * 判断多选字段是否包含指定选项。
 * @param key 字段键。
 * @param candidate 待检查选项。
 * @returns 是否选中。
 */
function isSelected(key: string, candidate: string) {
  const current = value(key)
  return Array.isArray(current) ? current.includes(candidate) : current === candidate
}

/**
 * 切换多选字段中的选项。
 * @param field 当前字段。
 * @param candidate 待切换选项。
 */
function toggleMulti(field: ManifestField, candidate: string) {
  const current = Array.isArray(value(field.key)) ? [...(value(field.key) as string[])] : []
  const index = current.indexOf(candidate)
  if (index >= 0) current.splice(index, 1)
  else current.push(candidate)
  update(field.key, current)
}

/**
 * 判断配置分组是否允许折叠。
 * @param name 分组名称。
 * @returns 是否可折叠。
 */
function isCollapsible(name: string) {
  return name === '高级设置' || name === '限制'
}

/**
 * 切换配置分组折叠状态。
 * @param name 分组名称。
 */
function toggleGroup(name: string) {
  if (collapsed.value.has(name)) collapsed.value.delete(name)
  else collapsed.value.add(name)
  collapsed.value = new Set(collapsed.value)
}

/**
 * 判断配置分组是否已折叠。
 * @param name 分组名称。
 * @returns 是否折叠。
 */
function isCollapsed(name: string) {
  return collapsed.value.has(name)
}

/**
 * 序列化 JSON 字段用于编辑。
 * @param key 字段键。
 * @returns JSON 文本。
 */
function jsonText(key: string) {
  const current = value(key)
  if (typeof current === 'string') return current
  try {
    return JSON.stringify(current ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

/**
 * 解析 JSON 字段并回写配置。
 * @param key 字段键。
 * @param text 用户编辑文本。
 */
function updateJson(key: string, text: string) {
  try {
    update(key, JSON.parse(text))
  } catch {
    update(key, text)
  }
}

/**
 * 格式化 JSON 字段内容。
 * @param key 字段键。
 */
function formatJson(key: string) {
  try {
    update(key, JSON.stringify(JSON.parse(jsonText(key)), null, 2))
  } catch {
    // Keep invalid input visible; validation reports the field.
  }
}

/**
 * 将键值对象或数组归一化为可编辑行。
 * @param key 字段键。
 * @returns 键值行。
 */
function keyValueRows(key: string) {
  const current = value(key)
  if (Array.isArray(current)) {
    return current.map((item) =>
      typeof item === 'object' && item
        ? { key: Object.keys(item)[0] ?? '', value: Object.values(item)[0] ?? '' }
        : { key: '', value: String(item) },
    )
  }
  if (current && typeof current === 'object') {
    return Object.entries(current as Record<string, unknown>).map(([entryKey, entryValue]) => ({
      key: entryKey,
      value: entryValue,
    }))
  }
  return []
}

/**
 * 将键值行序列化回对象配置。
 * @param key 字段键。
 * @param rows 键值行。
 */
function serializeKeyValue(key: string, rows: Array<{ key: string; value: unknown }>) {
  const result: Record<string, unknown> = {}
  rows.forEach((row) => {
    if (row.key) result[row.key] = row.value
  })
  update(key, result)
}

/**
 * 更新指定键值行。
 * @param key 字段键。
 * @param index 行索引。
 * @param part 待更新部分。
 * @param next 新值。
 */
function updateKeyValue(key: string, index: number, part: 'key' | 'value', next: string) {
  const rows = keyValueRows(key).map((row, rowIndex) => (rowIndex === index ? { ...row, [part]: next } : row))
  serializeKeyValue(key, rows)
}

/**
 * 追加空键值行。
 * @param key 字段键。
 */
function addKeyValue(key: string) {
  serializeKeyValue(key, [...keyValueRows(key), { key: '', value: '' }])
}

/**
 * 删除指定键值行。
 * @param key 字段键。
 * @param index 行索引。
 */
function removeKeyValue(key: string, index: number) {
  serializeKeyValue(key, keyValueRows(key).filter((_, rowIndex) => rowIndex !== index))
}

/**
 * 读取结构化列表。
 * @param key 字段键。
 * @returns 列表项。
 */
function listRows(key: string) {
  const current = value(key)
  return Array.isArray(current) ? current : []
}

/**
 * 将列表项转换为可编辑标签。
 * @param item 列表项。
 * @returns 标签文本。
 */
function listLabel(item: unknown) {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>
    return String(record.label ?? record.id ?? record.left ?? JSON.stringify(item))
  }
  return String(item ?? '')
}

/**
 * 更新指定列表项。
 * @param key 字段键。
 * @param index 行索引。
 * @param next 新标签。
 */
function updateList(key: string, index: number, next: string) {
  const rows = listRows(key).map((item, rowIndex) => {
    if (rowIndex !== index) return item
    if (typeof item === 'string') return next
    if (item && typeof item === 'object') return { ...(item as Record<string, unknown>), label: next }
    return next
  })
  update(key, rows)
}

/**
 * 添加新的列表项。
 * @param key 字段键。
 */
function addList(key: string) {
  update(key, [...listRows(key), { id: `item_${listRows(key).length + 1}`, label: `分支 ${listRows(key).length + 1}` }])
}

/**
 * 删除指定列表项。
 * @param key 字段键。
 * @param index 行索引。
 */
function removeList(key: string, index: number) {
  update(key, listRows(key).filter((_, rowIndex) => rowIndex !== index))
}

/**
 * 在文本字段末尾插入首个变量引用。
 * @param key 字段键。
 */
function insertVariable(key: string) {
  update(key, `${value(key) ?? ''}${variableOptions.value[0].value}`)
}

/**
 * 缓存文件输入控件引用。
 * @param key 字段键。
 * @param input 文件输入控件。
 */
function setFileInput(key: string, input: HTMLInputElement | null) {
  if (input) fileInputs.set(key, input)
}

/**
 * 打开指定字段的文件选择器。
 * @param key 字段键。
 */
function chooseFile(key: string) {
  fileInputs.get(key)?.click()
}

/**
 * 上传文件并将文件引用写入字段。
 * @param key 字段键。
 * @param event 文件选择事件。
 */
async function uploadFile(key: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !props.services?.uploadFile) return
  const fileRef = await props.services.uploadFile(file)
  update(key, fileRef)
  emit('commit', { ...props.modelValue, [key]: fileRef })
}

/**
 * 返回已上传文件的名称。
 * @param key 字段键。
 * @returns 文件名。
 */
function fileName(key: string) {
  const current = value(key)
  if (current && typeof current === 'object' && 'name' in current) {
    return String((current as { name: unknown }).name)
  }
  return ''
}
</script>
