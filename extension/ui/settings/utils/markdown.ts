import React from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { TODO_MARKDOWN_ALLOWED_TAGS, TODO_MARKDOWN_ALLOWED_ATTRS } from '../constants'

/**
 * Escape HTML special characters
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Create custom renderer for todo markdown
const todoMarkdownRenderer = new marked.Renderer()

todoMarkdownRenderer.link = (href, title, text) => {
  const safeHref = href || '#'
  const safeTitle = title ? ` title="${title}"` : ''
  return `<a href="${safeHref}"${safeTitle} target="_blank" rel="noreferrer">${text}</a>`
}

todoMarkdownRenderer.code = (code, infostring) => {
  const lang = (infostring || '').trim()
  const className = lang ? ` class="todo-md-code language-${lang}"` : ' class="todo-md-code"'
  return `<pre class="todo-md-pre"><code${className}>${escapeHtml(code)}</code></pre>`
}

// Configure marked options
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
  renderer: todoMarkdownRenderer
})

/**
 * Render markdown description with sanitization
 * @param desc - The markdown description
 * @param clamp - Whether to clamp the content (default: true)
 * @returns React element with rendered markdown
 */
export function renderTodoDescription(desc: string, clamp: boolean = true): React.ReactElement {
  const raw = marked.parse(desc)
  const safe = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: TODO_MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: TODO_MARKDOWN_ALLOWED_ATTRS
  })
  const className = clamp ? 'todo-md todo-md-clamp' : 'todo-md'
  return React.createElement('div', {
    className,
    dangerouslySetInnerHTML: { __html: safe }
  })
}
