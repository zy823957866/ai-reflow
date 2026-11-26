import { createApp, h } from 'vue'
import WorkflowDesigner from './WorkflowDesigner.vue'
import type {
  WorkflowDesignerHandle,
  WorkflowDesignerProps,
} from '@/shared/types'

/**
 * 在指定 DOM 容器内挂载工作流设计器。
 * @param el 宿主机容器。
 * @param props 设计器属性。
 * @returns 命令式设计器句柄。
 */
export function mountWorkflowDesigner(
  el: HTMLElement,
  props: WorkflowDesignerProps,
): WorkflowDesignerHandle {
  const host = document.createElement('div')
  host.style.width = '100%'
  host.style.height = '100%'
  el.replaceChildren(host)
  let exposed: Partial<WorkflowDesignerHandle> = {}
  const app = createApp({
    render: () =>
      h(WorkflowDesigner, {
        ...props,
        ref: (instance: unknown) => {
          exposed = (instance ?? {}) as Partial<WorkflowDesignerHandle>
        },
      }),
  })
  app.mount(host)
  return {
    flushSave: async () => {
      await exposed.flushSave?.()
    },
    undo: () => exposed.undo?.(),
    redo: () => exposed.redo?.(),
    fitView: () => exposed.fitView?.(),
    focusNode: (nodeId: string) => exposed.focusNode?.(nodeId),
    getDefinition: () =>
      exposed.getDefinition?.() ?? {
        schemaVersion: '1.0',
        name: '',
        nodes: [],
        edges: [],
      },
    destroy: () => {
      exposed.destroy?.()
      app.unmount()
      el.replaceChildren()
    },
  }
}
