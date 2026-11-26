import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

/**
 * 将 Agent Markdown 渲染为经过净化的 HTML。
 *
 * 模型输出始终按不可信内容处理，禁用原始 HTML 和危险属性。
 *
 * @param source 模型流式 Markdown。
 * @returns 可安全写入 v-html 的 HTML。
 */
export function renderAgentMarkdown(source: string) {
  const raw = markdown.render(source ?? '')
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcdoc'],
  })
}
