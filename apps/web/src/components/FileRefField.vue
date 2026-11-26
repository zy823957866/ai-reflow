<template>
  <div class="file-ref-field flex min-w-0 flex-col gap-5px" :data-testid="testId ?? 'attachment-field'">
    <div v-if="refs.length" class="flex min-w-0 flex-col gap-4px">
      <div
        v-for="(file, index) in refs"
        :key="file.id"
        class="flex min-h-34px min-w-0 items-center gap-6px border border-line rounded-6px bg-surface-2 px-7px text-[12px] text-muted"
      >
        <FileText :size="14" class="shrink-0 text-primary" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ file.name }}</span>
        <span class="shrink-0 text-[12px] text-subtle">{{ formatFileSize(file.size) }}</span>
        <button
          type="button"
          class="icon-btn shrink-0"
          :disabled="disabled"
          :aria-label="`移除 ${file.name}`"
          @click="removeRef(index)"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <div
      v-for="task in tasks"
      :key="task.key"
      class="flex min-h-34px min-w-0 items-center gap-6px border border-dashed rounded-6px px-7px text-[12px]"
      :class="task.status === 'failed' ? 'border-[#efbfc1] bg-[#fff7f7] text-danger' : 'border-border-strong bg-surface-2 text-subtle'"
    >
      <LoaderCircle v-if="task.status === 'uploading'" :size="14" class="shrink-0 animate-spin text-primary" />
      <FileText v-else :size="14" class="shrink-0 text-danger" />
      <span class="min-w-0 flex-1 truncate">{{ task.name }}</span>
      <span
        class="h-1 w-[68px] shrink-0 overflow-hidden rounded-full bg-surface-3"
        data-testid="attachment-upload-progress"
        :data-state="task.status"
        :data-progress="task.progress"
      >
        <i class="block h-full rounded-full bg-primary transition-[width]" :style="{ width: `${task.progress}%` }" />
      </span>
      <span class="w-9 shrink-0 text-right text-[12px]">{{ task.progress }}%</span>
      <button
        v-if="task.status === 'failed'"
        type="button"
        class="icon-btn shrink-0"
        :disabled="disabled || !upload"
        :aria-label="`重试 ${task.name}`"
        @click="retryTask(task)"
      >
        <RotateCcw :size="13" />
      </button>
      <button
        type="button"
        class="icon-btn shrink-0"
        :disabled="disabled"
        :aria-label="`取消 ${task.name}`"
        @click="removeTask(task)"
      >
        <X :size="13" />
      </button>
    </div>

    <div v-if="error" class="text-[12px] leading-1.45 text-danger">{{ error }}</div>

    <button
      v-if="multiple || !refs.length"
      type="button"
      class="inline-flex min-h-34px items-center justify-center gap-5px border border-dashed border-border-strong rounded-6px bg-transparent px-9px text-[12px] text-subtle disabled:cursor-not-allowed disabled:opacity-60"
      :disabled="disabled || !upload"
      @click="chooseFiles"
    >
      <UploadCloud :size="14" />
      {{ upload ? (multiple ? '添加文件' : '选择文件') : '上传服务未接入' }}
    </button>
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      :accept="accept"
      :multiple="multiple"
      data-testid="attachment-file-input"
      @change="handleFileInput"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { FileText, LoaderCircle, RotateCcw, UploadCloud, X } from 'lucide-vue-next'
import type { FileRef } from '@/shared/types'
import {
  ATTACHMENT_ACCEPT,
  formatFileSize,
  selectedFileError,
  uploadErrorMessage,
} from '@/shared/files'

interface UploadTask {
  key: string
  name: string
  progress: number
  status: 'uploading' | 'failed'
  file: File
}

const props = withDefaults(defineProps<{
  modelValue?: FileRef | FileRef[] | null
  multiple?: boolean
  disabled?: boolean
  accept?: string
  testId?: string
  upload?: (file: File, onProgress?: (percent: number) => void) => Promise<FileRef>
}>(), {
  modelValue: undefined,
  multiple: false,
  disabled: false,
  accept: ATTACHMENT_ACCEPT,
  testId: undefined,
  upload: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: FileRef | FileRef[] | null]
  busy: [count: number]
  error: [message: string]
}>()

const fileInput = ref<HTMLInputElement>()
const tasks = ref<UploadTask[]>([])
const error = ref('')
const refs = computed(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue
  return props.modelValue ? [props.modelValue] : []
})
const busyCount = computed(() => tasks.value.filter((task) => task.status === 'uploading').length)

watch(busyCount, (count) => emit('busy', count), { immediate: true })

function chooseFiles() {
  if (props.disabled || !props.upload) return
  fileInput.value?.click()
}

/**
 * 处理文件选择并按顺序上传，避免同时占用过多内存和带宽。
 *
 * @param event 文件输入事件。
 */
async function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  for (const file of files) {
    const validation = selectedFileError(file)
    if (validation) {
      setError(validation)
      continue
    }
    const task = reactive<UploadTask>({
      key: `upload_${crypto.randomUUID()}`,
      name: file.name,
      progress: 0,
      status: 'uploading',
      file,
    })
    tasks.value.push(task)
    await uploadTask(task)
  }
}

/**
 * 上传单个文件并追加或替换 FileRef。
 *
 * @param task 上传任务。
 */
async function uploadTask(task: UploadTask) {
  if (!props.upload) return
  task.status = 'uploading'
  task.progress = 0
  error.value = ''
  try {
    const uploaded = await props.upload(task.file, (percent) => {
      task.progress = Math.max(0, Math.min(100, Math.round(percent)))
    })
    if (props.multiple) {
      emit('update:modelValue', [...refs.value, uploaded])
    } else {
      emit('update:modelValue', uploaded)
    }
    removeTask(task)
  } catch (uploadError) {
    task.status = 'failed'
    setError(uploadErrorMessage(uploadError))
  }
}

async function retryTask(task: UploadTask) {
  await uploadTask(task)
}

function removeTask(task: UploadTask) {
  tasks.value = tasks.value.filter((item) => item !== task)
}

function removeRef(index: number) {
  if (props.disabled) return
  if (!props.multiple) {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', refs.value.filter((_, itemIndex) => itemIndex !== index))
}

function setError(message: string) {
  error.value = message
  emit('error', message)
}
</script>
