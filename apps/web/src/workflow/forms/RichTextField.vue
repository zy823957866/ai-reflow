<template>
  <div class="overflow-hidden rounded-8px border bg-surface transition-[border-color,box-shadow]" :class="focused ? 'border-[#9e95fb] shadow-[0_0_0_3px_rgba(91,77,240,0.1)]' : 'border-line'">
    <div v-if="toolbar" class="flex h-8 items-center gap-0.5 border-b border-line bg-surface-2 px-1.5">
      <button type="button" class="inline-flex h-[23px] items-center gap-1 rounded-[5px] border-0 bg-transparent px-[7px] text-[10px] text-muted hover:bg-surface-3" title="插入变量" @click="insertVariable">
        <Braces :size="13" />
        <span>变量</span>
      </button>
      <button type="button" class="inline-flex h-[23px] items-center gap-1 rounded-[5px] border-0 bg-transparent px-[7px] text-[10px] text-muted hover:bg-surface-3" title="清除格式" @click="clear">清除格式</button>
      <button v-if="disabled" type="button" class="ml-auto inline-flex h-[23px] items-center rounded-[5px] border-0 bg-transparent px-[7px] text-[10px] text-subtle">只读</button>
    </div>
    <div
      ref="editor"
      class="rich-editor min-h-[88px] whitespace-pre-wrap p-2.5 text-[12px] leading-[1.65] text-ink outline-none"
      :contenteditable="disabled ? 'false' : 'true'"
      :data-placeholder="placeholder || '输入内容或插入变量'"
      :aria-disabled="disabled"
      @focus="focused = true"
      @blur="onBlur"
      @input="onInput"
      @paste="onPaste"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Braces } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    modelValue?: unknown
    placeholder?: string
    disabled?: boolean
    toolbar?: boolean
    variables?: Array<{ label: string; value: string }>
  }>(),
  {
    modelValue: () => '',
    placeholder: '',
    disabled: false,
    toolbar: true,
    variables: () => [],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: []
}>()

const editor = ref<HTMLElement>()
const focused = ref(false)

/**
 * 从字符串或文本对象中提取可编辑文本。
 * @param value 编辑器原始值。
 * @returns 纯文本内容。
 */
function textValue(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text)
  return ''
}

/**
 * 将模型值渲染到 contenteditable 区域。
 * @param value 待渲染值。
 */
function render(value = props.modelValue) {
  if (!editor.value) return
  editor.value.textContent = textValue(value)
}

/** 将编辑器内容同步到 v-model。 */
function onInput() {
  emit('update:modelValue', editor.value?.innerText ?? '')
}

/** 处理编辑器失焦并通知父组件提交。 */
function onBlur() {
  focused.value = false
  emit('blur')
}

/**
 * 以纯文本粘贴，避免外部富文本污染节点配置。
 * @param event 粘贴事件。
 */
function onPaste(event: ClipboardEvent) {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  document.execCommand('insertText', false, text)
}

/** 清空编辑器内容。 */
function clear() {
  if (!editor.value) return
  editor.value.textContent = ''
  emit('update:modelValue', '')
}

/** 在当前光标位置插入变量标签。 */
function insertVariable() {
  if (!editor.value) return
  const value =
    props.variables[0]?.value ??
    '{{ $input.question }}'
  const chip = document.createElement('span')
  chip.className = 'inline-flex rounded-[4px] bg-primary-soft px-[5px] py-0.25 font-mono text-[10px] text-primary'
  chip.contentEditable = 'false'
  chip.dataset.path = value
  chip.textContent = props.variables[0]?.label ?? value
  const space = document.createTextNode(' ')
  editor.value.focus()
  const selection = window.getSelection()
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0)
    range.deleteContents()
    range.insertNode(chip)
    range.insertNode(space)
    range.collapse(false)
  } else {
    editor.value.appendChild(chip)
    editor.value.appendChild(space)
  }
  onInput()
}

watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) render(value)
  },
)

onMounted(() => nextTick(() => render()))
</script>

<style scoped>
.rich-editor:empty::before {
  color: var(--ink-3);
  content: attr(data-placeholder);
  pointer-events: none;
}
</style>
