import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import type { MindmapDocument, MindmapNode } from '../core.js'

const PLUGIN_ID = '@dsh-external/dsh-chat-mindmap'
const API_BASE = '/@dsh-external/dsh-chat-mindmap'

type ClientContext = Context & { slots: SlotRegistry }
export const inject = ['slots']

type MindMapLike = {
  doExport?: { export(type: string, download: boolean, name: string): Promise<unknown> }
  resize(): void
  destroy?(): void
}

type MindMapCtor = new (options: {
  el: HTMLElement
  data: unknown
  layout: string
  readonly?: boolean
  fit?: boolean
}) => MindMapLike

function countNodes(node: MindmapNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0)
}

function toSimpleMindMapData(node: MindmapNode): unknown {
  return {
    root: {
      data: { text: node.title, ...(node.note ? { note: node.note } : {}) },
      children: (node.children ?? []).map(toSimpleMindMapData),
    },
  }
}

function markdown(node: MindmapNode, depth = 0): string {
  return [
    `${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`,
    ...(node.children ?? []).map((child) => markdown(child, depth + 1)),
  ].join('\n')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function generate(context: string, title: string): Promise<MindmapDocument> {
  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context, title }),
  })
  const payload = await response.json() as {
    ok?: boolean
    value?: { document: MindmapDocument }
    error?: string
  }
  if (!response.ok || !payload.ok || !payload.value) {
    throw new Error(payload.error ?? '生成失败')
  }
  return payload.value.document
}

async function loadMindMap(): Promise<MindMapCtor> {
  const module = await import('simple-mind-map/full.js') as unknown as { default: MindMapCtor }
  return module.default
}

function panelStyle(): Record<string, string> {
  return {
    display: 'block',
    padding: '12px',
    border: '1px solid var(--dsw-alias-border-l2,#334155)',
    borderRadius: '10px',
    background: 'var(--dsw-alias-bg-surface,#111827)',
    color: 'var(--dsw-alias-label-primary,#f8fafc)',
    font: '13px/1.45 system-ui,sans-serif',
  }
}

function buttonStyle(): Record<string, string> {
  return {
    border: '1px solid var(--dsw-alias-border-l2,#475569)',
    background: 'var(--dsw-alias-button-tool-bar-fill,#1e293b)',
    color: 'inherit',
    borderRadius: '6px',
    padding: '6px 9px',
    cursor: 'pointer',
  }
}

function inputStyle(): Record<string, string> {
  return {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    margin: '6px 0',
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid #475569',
    background: '#0f172a',
    color: 'inherit',
  }
}

function snapshotText(snapshot: ConversationSnapshot): string {
  const lines: string[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user') {
      const text = node.content.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map((block) => block.text).join('')
      if (text.trim()) lines.push(`用户：${text}`)
    } else if (node.kind === 'assistant') {
      const text = node.blocks.filter((block): block is { kind: 'text'; text: string } => block.kind === 'text').map((block) => block.text).join('')
      if (text.trim()) lines.push(`助手：${text}`)
    }
  }
  return lines.join('\n')
}

function MindmapPanel(props: ConvViewProps): ReactElement {
  const sessionText = props.useSession(snapshotText)
  const [title, setTitle] = useState('')
  const [context, setContext] = useState(sessionText)
  const [mapDocument, setMapDocument] = useState<MindmapDocument | null>(null)
  const [xmindBlob, setXmindBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('当前会话可一键带入，也可以手动粘贴上下文。')
  const canvasRef = useRef<HTMLDivElement>(null)
  const mindMapRef = useRef<MindMapLike | null>(null)

  useEffect(() => {
    if (!context && sessionText) setContext(sessionText)
  }, [context, sessionText])

  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas || !mapDocument) return () => { alive = false }

    canvas.replaceChildren()
    setXmindBlob(null)
    void loadMindMap().then((MindMap) => {
      if (!alive || !canvasRef.current) return
      const instance = new MindMap({
        el: canvasRef.current,
        data: toSimpleMindMapData(mapDocument.root),
        layout: 'logicalStructure',
        fit: true,
      })
      mindMapRef.current = instance
      window.setTimeout(() => instance.resize(), 0)
      if (instance.doExport) {
        return instance.doExport.export('xmind', false, mapDocument.title)
      }
      return null
    }).then((value) => {
      if (!alive || !(value instanceof Blob)) return
      setXmindBlob(value)
    }).catch((error: unknown) => {
      if (alive) setStatus(`脑图已生成，但渲染器失败：${error instanceof Error ? error.message : String(error)}`)
    })

    return () => {
      alive = false
      mindMapRef.current?.destroy?.()
      mindMapRef.current = null
      canvas.replaceChildren()
    }
  }, [mapDocument])

  const generateMap = (): void => {
    if (!context.trim()) {
      setStatus('请先输入聊天记录或 Markdown 大纲。')
      return
    }
    setBusy(true)
    setStatus('生成中…')
    void generate(context, title).then((next) => {
      setMapDocument(next)
      setStatus(`已生成 ${countNodes(next.root)} 个节点。`)
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error))
    }).finally(() => setBusy(false))
  }

  const exportJson = (): void => {
    if (!mapDocument) return
    downloadBlob(new Blob([JSON.stringify(mapDocument, null, 2)], { type: 'application/json' }), 'chat-mindmap.json')
  }

  const exportMarkdown = (): void => {
    if (!mapDocument) return
    downloadBlob(new Blob([markdown(mapDocument.root)], { type: 'text/markdown;charset=utf-8' }), 'chat-mindmap.md')
  }

  const exportXmind = (): void => {
    if (xmindBlob) downloadBlob(xmindBlob, 'chat-mindmap.xmind')
  }

  return createElement('section', { style: panelStyle() },
    createElement('strong', null, '聊天思维导图'),
    createElement('p', { style: { opacity: 0.72 } }, 'Agent Tool 和本面板共用同一个 Host 生成器。当前版本由调用者提供上下文，不读取私有会话数据库。'),
    createElement('input', {
      value: title,
      placeholder: '根节点标题（可选）',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value),
      style: inputStyle(),
    }),
    createElement('textarea', {
      value: context,
      placeholder: '# 主题\\n## 关键观点\\n### 证据\\n\\n或粘贴聊天记录…',
      rows: 7,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setContext(event.target.value),
      style: { ...inputStyle(), resize: 'vertical' },
    }),
    createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0' } },
      createElement('button', { type: 'button', disabled: busy, onClick: generateMap, style: buttonStyle() }, busy ? '生成中…' : '生成脑图'),
      createElement('button', { type: 'button', disabled: !mapDocument, onClick: exportJson, style: buttonStyle() }, '导出 JSON'),
      createElement('button', { type: 'button', disabled: !mapDocument, onClick: exportMarkdown, style: buttonStyle() }, '导出 Markdown'),
      createElement('button', { type: 'button', disabled: !xmindBlob, onClick: exportXmind, style: buttonStyle() }, '导出 XMind'),
    ),
    createElement('span', { style: { display: 'block', margin: '6px 0', opacity: 0.8 } }, status),
    createElement('div', {
      ref: canvasRef,
      style: { display: mapDocument ? 'block' : 'none', minHeight: '360px', height: '48vh', margin: '8px 0', borderRadius: '8px', overflow: 'hidden', background: '#fff' },
    }),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: `${PLUGIN_ID}-panel`,
    order: 120,
    label: () => '聊天脑图',
  }, MindmapPanel as never)), `${PLUGIN_ID}: conversation panel`)
}
