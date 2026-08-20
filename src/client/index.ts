import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { createElement, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { MindmapDocument, MindmapNode } from '../core.js'

const PLUGIN_ID = '@dsh-external/dsh-chat-mindmap'
const API_BASE = '/@dsh-external/dsh-chat-mindmap'
type ClientContext = Context & { slots: SlotRegistry; sessions: SessionService }
export const inject = ['slots', 'sessions']

type MindMapLike = {
  doExport?: { export(type: string, download: boolean, ...args: unknown[]): Promise<unknown> }
  execCommand?(command: string, ...args: unknown[]): unknown
  resize(): void
  render?(callback?: (() => void) | null, source?: string): void
  reRender?(callback?: (() => void) | null, source?: string): void
  setLayout?(layout: string, notRender?: boolean): void
  setTheme?(theme: string, notRender?: boolean): void
  setThemeConfig?(config: Record<string, unknown>, notRender?: boolean): void
  getData?(withConfig?: boolean): unknown
  on?(event: string, listener: (data?: unknown) => void): void
  off?(event: string, listener: (data?: unknown) => void): void
  destroy?(): void
}
type MindMapCtor = new (options: { el: HTMLElement; data: unknown; layout: string; theme?: string; themeConfig?: Record<string, unknown>; fit?: boolean }) => MindMapLike
type MindmapConfig = { layout: string; density: string; maxNodes: number; theme: string; font: string; instruction: string; language: string; contextLimit: number }

type ThemePreset = { label: string; config: Record<string, unknown> }

const LAYOUT_OPTIONS = [
  ['logicalStructure', '逻辑结构图'],
  ['logicalStructureLeft', '向左逻辑结构图'],
  ['mindMap', '思维导图'],
  ['organizationStructure', '组织结构图'],
  ['catalogOrganization', '目录组织图'],
  ['timeline', '时间轴'],
  ['timeline2', '时间轴 2'],
  ['verticalTimeline', '竖向时间轴'],
  ['verticalTimeline2', '竖向时间轴 2'],
  ['verticalTimeline3', '竖向时间轴 3'],
  ['fishbone', '鱼骨图'],
  ['fishbone2', '鱼骨图 2'],
  ['rightFishbone', '向右鱼骨图'],
  ['rightFishbone2', '向右鱼骨图 2'],
] as const

const THEME_PRESETS: Record<string, ThemePreset> = {
  default: { label: '默认青绿', config: {} },
  classic4: { label: 'Classic 4（经典）', config: { backgroundColor: '#fffdf5', lineColor: '#8b7355', generalizationLineColor: '#8b7355', root: { fillColor: '#8b7355', color: '#fff', borderColor: '#6f5a43' }, second: { fillColor: '#f5ead7', color: '#4a3828', borderColor: '#c9a66b' }, node: { color: '#5c4632', borderColor: 'transparent' } } },
  ocean: { label: '海洋蓝', config: { backgroundColor: '#eff6ff', lineColor: '#2563eb', generalizationLineColor: '#2563eb', root: { fillColor: '#1d4ed8', color: '#fff', borderColor: '#1e40af' }, second: { fillColor: '#dbeafe', color: '#1e3a8a', borderColor: '#60a5fa' }, node: { color: '#1e3a8a', borderColor: 'transparent' } } },
  forest: { label: '森林绿', config: { backgroundColor: '#f0fdf4', lineColor: '#15803d', generalizationLineColor: '#15803d', root: { fillColor: '#166534', color: '#fff', borderColor: '#14532d' }, second: { fillColor: '#dcfce7', color: '#14532d', borderColor: '#4ade80' }, node: { color: '#166534', borderColor: 'transparent' } } },
  sunset: { label: '日落橙', config: { backgroundColor: '#fff7ed', lineColor: '#ea580c', generalizationLineColor: '#ea580c', root: { fillColor: '#c2410c', color: '#fff', borderColor: '#9a3412' }, second: { fillColor: '#ffedd5', color: '#7c2d12', borderColor: '#fb923c' }, node: { color: '#9a3412', borderColor: 'transparent' } } },
  lavender: { label: '薰衣草紫', config: { backgroundColor: '#faf5ff', lineColor: '#9333ea', generalizationLineColor: '#9333ea', root: { fillColor: '#7e22ce', color: '#fff', borderColor: '#6b21a8' }, second: { fillColor: '#f3e8ff', color: '#581c87', borderColor: '#c084fc' }, node: { color: '#6b21a8', borderColor: 'transparent' } } },
  graphite: { label: '石墨灰', config: { backgroundColor: '#f8fafc', lineColor: '#475569', generalizationLineColor: '#475569', root: { fillColor: '#334155', color: '#fff', borderColor: '#1e293b' }, second: { fillColor: '#e2e8f0', color: '#1e293b', borderColor: '#94a3b8' }, node: { color: '#334155', borderColor: 'transparent' } } },
  rose: { label: '玫瑰红', config: { backgroundColor: '#fff1f2', lineColor: '#e11d48', generalizationLineColor: '#e11d48', root: { fillColor: '#be123c', color: '#fff', borderColor: '#9f1239' }, second: { fillColor: '#ffe4e6', color: '#881337', borderColor: '#fb7185' }, node: { color: '#9f1239', borderColor: 'transparent' } } },
  amber: { label: '琥珀金', config: { backgroundColor: '#fffbeb', lineColor: '#d97706', generalizationLineColor: '#d97706', root: { fillColor: '#b45309', color: '#fff', borderColor: '#92400e' }, second: { fillColor: '#fef3c7', color: '#78350f', borderColor: '#fbbf24' }, node: { color: '#92400e', borderColor: 'transparent' } } },
  contrast: { label: '高对比黑白', config: { backgroundColor: '#fff', lineColor: '#111827', generalizationLineColor: '#111827', root: { fillColor: '#111827', color: '#fff', borderColor: '#000' }, second: { fillColor: '#fff', color: '#111827', borderColor: '#111827' }, node: { color: '#111827', borderColor: 'transparent' } } },
}

function themePreset(theme: string): ThemePreset { return THEME_PRESETS[theme] ?? THEME_PRESETS.default }
type MindmapSource = { kind: string; name?: string; attachmentId?: string; sessionId?: string; workspaceId?: string }
type MindmapRecord = { libraryId: string; title: string; current: MindmapDocument; previous?: MindmapDocument; config: MindmapConfig; source?: MindmapSource; archived?: boolean; updatedAt: string }
type MindmapSummary = { libraryId: string; title: string; source?: MindmapSource; config: MindmapConfig; updatedAt: string; hasPrevious: boolean; archived: boolean; nodeCount: number }
type PanelRunView = { runId: string; libraryId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; detail: string; revisionId?: string }
type SessionService = { binding(id: string): { session?: { getSnapshot(): unknown; loadOlder(): Promise<void> } } | undefined }
type ApiPayload<T> = { ok?: boolean; value?: T; error?: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  const payload = await response.json() as ApiPayload<T>
  if (!response.ok || !payload.ok || payload.value === undefined) throw new Error(payload.error ?? '脑图服务请求失败')
  return payload.value
}

const PROGRESSIVE_RENDER_THRESHOLD = 180
function nodeCount(node: MindmapNode): number { let count = 0; const pending = [node]; while (pending.length) { const current = pending.pop()!; count += 1; pending.push(...(current.children ?? [])) }; return count }
function toRenderNode(node: MindmapNode, depth: number, progressive: boolean): MindmapNode {
  return { ...node, ...(progressive && depth >= 1 && (node.children?.length ?? 0) > 0 && typeof node.collapsed === 'undefined' ? { collapsed: true } : {}), children: node.children?.map((child) => toRenderNode(child, depth + 1, progressive)) }
}
function toSimpleMindMapData(node: MindmapNode): unknown { return { data: { text: node.title, id: node.id, ...(node.note ? { note: node.note } : {}), ...(node.collapsed ? { expand: false } : {}) }, children: (node.children ?? []).map(toSimpleMindMapData) } }
function fromSimpleMindMapNode(raw: unknown): MindmapNode | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { id?: unknown; data?: { id?: unknown; text?: unknown; note?: unknown; expand?: unknown }; children?: unknown[] }
  const title = typeof value.data?.text === 'string' ? value.data.text : ''
  if (!title) return null
  return { id: typeof value.id === 'string' ? value.id : typeof value.data?.id === 'string' ? value.data.id : `node-${Math.random().toString(36).slice(2)}`, title, ...(typeof value.data?.note === 'string' ? { note: value.data.note } : {}), ...(typeof value.data?.expand === 'boolean' ? { collapsed: value.data.expand === false } : {}), children: (value.children ?? []).map(fromSimpleMindMapNode).filter((child): child is MindmapNode => child !== null) }
}
function markdown(node: MindmapNode, depth = 0): string { return [`${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`, ...(node.children ?? []).map((child) => markdown(child, depth + 1))].join('\n') }
function downloadBlob(blob: Blob, filename: string): void { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
function safeFilename(title: string, extension: string): string { return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindmap'}.${extension}` }
function svgPreviewHtml(svgUrl: string, title: string): string {
  const escapedTitle = title.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  const encodedUrl = JSON.stringify(svgUrl).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle} · SVG 预览</title><style>html,body{margin:0;min-height:100%;background:#0f172a}body{display:grid;place-items:center;padding:16px;box-sizing:border-box}img{display:block;max-width:100%;max-height:calc(100vh - 32px);background:#fff;border-radius:8px}</style></head><body><img src="${svgUrl}" alt="${escapedTitle} 思维导图"><script>window.addEventListener('beforeunload',()=>URL.revokeObjectURL(${encodedUrl}))</script></body></html>`
}
function asBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value
  if (typeof value !== 'string' || !value.startsWith('data:')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const meta = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  const mime = meta.slice(5).split(';')[0] || 'application/octet-stream'
  try {
    if (meta.endsWith(';base64')) return new Blob([Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))], { type: mime })
    return new Blob([decodeURIComponent(payload)], { type: mime })
  } catch { return null }
}
async function loadMindMap(): Promise<MindMapCtor> { const module = await import('./mindmap.js') as unknown as { default: MindMapCtor }; return module.default }
function panelStyle(): Record<string, string> { return { display: 'flex', flexDirection: 'column', minHeight: '100%', padding: '12px', background: 'var(--dsw-alias-bg-base,#0f172a)', color: 'var(--dsw-alias-label-primary,#f8fafc)', font: '13px/1.45 system-ui,sans-serif' } }
function buttonStyle(): Record<string, string> { return { border: '1px solid var(--dsw-alias-border-l2,#475569)', background: 'var(--dsw-alias-button-tool-bar-fill,#1e293b)', color: 'inherit', borderRadius: '6px', padding: '6px 9px', cursor: 'pointer' } }
function inputStyle(): Record<string, string> { return { display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'inherit' } }
function toolbarLabelStyle(): Record<string, string> { return { color: 'var(--dsw-alias-label-tertiary,#94a3b8)', fontSize: '11px', fontWeight: '600', letterSpacing: '.04em', marginLeft: '4px', textTransform: 'uppercase' } }
function nextPaint(): Promise<void> { return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))) }

type MapActions = {
  undo(): Promise<void>
  redo(): Promise<void>
  expandAll(): Promise<void>
  collapseAll(): Promise<void>
  collapseToLevel(level: number): Promise<void>
  exportPng(): Promise<void>
  openSvgPreview(): Promise<void>
  toggleFullscreen(): Promise<void>
  isFullscreen(): boolean
}

function MapCanvas({ record, onDocumentChange, onXmind, onActions, onFullscreenChange }: { record: MindmapRecord; onDocumentChange: (document: MindmapDocument) => void; onXmind: (blob: Blob | null) => void; onActions: (actions: MapActions | null) => void; onFullscreenChange: (fullscreen: boolean) => void }): ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MindMapLike | null>(null)
  const saveTimer = useRef<number | null>(null)
  const recordRef = useRef(record)
  const [fullscreen, setFullscreen] = useState(false)
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const renderKey = `${record.libraryId}:${record.current.source.generatedAt}`
  const canvasFullscreen = () => window.document.fullscreenElement === fullscreenRef.current
  const runCanvasTask = async (task: () => void): Promise<void> => {
    setRenderState('loading')
    await nextPaint()
    if (!mapRef.current) return
    try { task() } finally { if (mapRef.current) setRenderState('ready') }
  }
  useEffect(() => { recordRef.current = record }, [record])
  useEffect(() => {
    const changed = () => { const active = canvasFullscreen(); setFullscreen(active); onFullscreenChange(active); window.setTimeout(() => mapRef.current?.resize(), 0) }
    window.document.addEventListener('fullscreenchange', changed)
    return () => window.document.removeEventListener('fullscreenchange', changed)
  }, [onFullscreenChange])
  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return () => { alive = false }
    canvas.replaceChildren()
    setRenderState('loading')
    void (async () => {
      try {
        await nextPaint()
        const MindMap = await loadMindMap()
        if (!alive || !canvasRef.current) return
        const sourceRoot = recordRef.current.current.root
        const progressive = nodeCount(sourceRoot) > PROGRESSIVE_RENDER_THRESHOLD
        const renderRoot = toRenderNode(sourceRoot, 0, progressive)
        const instance = new MindMap({ el: canvasRef.current, data: toSimpleMindMapData(renderRoot), layout: recordRef.current.config.layout, theme: 'default', themeConfig: themePreset(recordRef.current.config.theme).config, fit: true })
      mapRef.current = instance
      onActions({
        undo: () => runCanvasTask(() => instance.execCommand?.('BACK')),
        redo: () => runCanvasTask(() => instance.execCommand?.('FORWARD')),
        expandAll: () => runCanvasTask(() => instance.execCommand?.('EXPAND_ALL')),
        collapseAll: () => runCanvasTask(() => instance.execCommand?.('UNEXPAND_ALL')),
        collapseToLevel: (level) => runCanvasTask(() => instance.execCommand?.('UNEXPAND_TO_LEVEL', level)),
        exportPng: async () => {
          const value = await instance.doExport?.export('png', false, recordRef.current.title, false, null, true)
          const blob = asBlob(value)
          if (!blob || blob.type !== 'image/png') throw new Error('PNG 导出失败')
          downloadBlob(blob, safeFilename(recordRef.current.title, 'png'))
        },
        openSvgPreview: async () => {
          // Open synchronously from the button click so browser popup protection does not reject the preview.
          const preview = window.open('', '_blank')
          if (!preview) throw new Error('浏览器阻止了新标签页，请允许弹窗后重试')
          preview.opener = null
          const value = await instance.doExport?.export('svg', false, recordRef.current.title)
          const blob = asBlob(value)
          if (!blob || blob.type !== 'image/svg+xml') { preview.close(); throw new Error('SVG 导出失败') }
          const svgUrl = URL.createObjectURL(blob)
          preview.document.open()
          preview.document.write(svgPreviewHtml(svgUrl, recordRef.current.title))
          preview.document.close()
        },
        toggleFullscreen: async () => {
          const canvas = fullscreenRef.current
          if (!canvas) throw new Error('画布尚未准备完成')
          if (canvasFullscreen()) {
            if (window.document.exitFullscreen) await window.document.exitFullscreen()
            return
          }
          if (!canvas.requestFullscreen) throw new Error('当前浏览器不支持全屏画布')
          await canvas.requestFullscreen()
        },
        isFullscreen: canvasFullscreen,
      })
      const changed = () => {
        const raw = instance.getData?.(false) as { root?: unknown } | undefined
        const root = fromSimpleMindMapNode(raw?.root ?? raw)
        if (root) {
          if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
          const next = { ...recordRef.current.current, root }
          saveTimer.current = window.setTimeout(() => onDocumentChange(next), 700)
        }
      }
      instance.on?.('data_change', changed)
      window.setTimeout(() => instance.resize(), 0)
      const applyAppearance = () => {
        instance.setThemeConfig?.(themePreset(recordRef.current.config.theme).config)
        instance.setLayout?.(recordRef.current.config.layout)
        instance.resize()
      }
      applyAppearance()
      if (instance.doExport) void instance.doExport.export('xmind', false, recordRef.current.title, instance.getData?.(false)).then((value) => { if (alive) onXmind(asBlob(value)) }).catch(() => onXmind(null))
      const cleanup = () => instance.off?.('data_change', changed)
      // attach cleanup to instance for effect teardown
        ;(instance as unknown as { __cleanup?: () => void }).__cleanup = cleanup
        if (alive) setRenderState('ready')
      } catch {
        if (alive) { onXmind(null); setRenderState('failed') }
      }
    })()
    return () => { alive = false; onActions(null); if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); const inst = mapRef.current as unknown as { __cleanup?: () => void } | null; inst?.__cleanup?.(); mapRef.current?.destroy?.(); mapRef.current = null; canvas.replaceChildren() }
  }, [renderKey])
  useEffect(() => {
    const instance = mapRef.current
    if (!instance) return
    instance.setThemeConfig?.(themePreset(record.config.theme).config)
    instance.setLayout?.(record.config.layout)
    instance.reRender?.(() => instance.resize(), 'chat-mindmap: appearance-change')
    if (!instance.reRender) {
      instance.render?.(() => instance.resize(), 'chat-mindmap: appearance-change')
    }
  }, [record.config.layout, record.config.theme])
  return createElement('div', { ref: fullscreenRef, 'aria-busy': renderState === 'loading', style: { position: 'relative', flex: 1, minHeight: '480px', borderRadius: '8px', overflow: 'hidden', background: '#fff' } },
    createElement('style', null, '@keyframes dsh-chat-mindmap-spin { to { transform: rotate(360deg); } }'),
    fullscreen ? createElement('button', { type: 'button', onClick: () => void window.document.exitFullscreen?.(), style: { position: 'absolute', top: '12px', right: '12px', zIndex: 3, ...buttonStyle() }, 'aria-label': '退出全屏画布' }, '退出全屏') : null,
    createElement('div', { ref: canvasRef, style: { width: '100%', height: '100%', minHeight: '480px' } }),
    renderState !== 'ready' ? createElement('div', { role: renderState === 'failed' ? 'alert' : 'status', 'aria-live': 'polite', style: { position: 'absolute', inset: 0, zIndex: 2, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.78)', color: '#e2e8f0', backdropFilter: 'blur(2px)', pointerEvents: 'auto' } },
      renderState === 'loading' ? createElement('div', { style: { display: 'grid', justifyItems: 'center', gap: '12px', textAlign: 'center' } }, createElement('span', { 'aria-hidden': true, style: { width: '32px', height: '32px', border: '3px solid rgba(94,234,212,.28)', borderTopColor: '#5eead4', borderRadius: '50%', animation: 'dsh-chat-mindmap-spin .8s linear infinite' } }), createElement('strong', null, '正在渲染脑图…'), createElement('small', null, '高节点数脑图仅阻塞此画布，不影响其他操作')) : createElement('div', { style: { textAlign: 'center' } }, createElement('strong', null, '脑图渲染失败'), createElement('small', { style: { display: 'block', marginTop: '6px' } }, '请切换其他脑图后重试')),
    ) : null,
  )
}

type MindmapPreviewReference = { libraryId: string; revisionId: string; title: string; nodeCount: number; state: 'available' | 'expired'; capabilityNote?: string }
type MindmapPreviewPayload = { libraryId: string; revisionId: string; title: string; document: MindmapDocument; config: MindmapConfig }

function previewReference(block: ToolCallViewProps['block']): MindmapPreviewReference | null {
  if (!('kind' in block)) return null
  for (const item of block.content) {
    if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'text' || !('text' in item) || typeof item.text !== 'string') continue
    const prefix = 'dsh-chat-mindmap-preview:'
    if (!item.text.startsWith(prefix)) continue
    try {
      const value = JSON.parse(item.text.slice(prefix.length)) as Partial<MindmapPreviewReference>
      if (typeof value.libraryId === 'string' && typeof value.revisionId === 'string' && typeof value.title === 'string' && typeof value.nodeCount === 'number' && (value.state === 'available' || value.state === 'expired')) return value as MindmapPreviewReference
    } catch { /* A generic tool card remains available for malformed old history. */ }
  }
  return null
}

async function svgPreview(mindmap: MindmapDocument, config: MindmapConfig): Promise<string> {
  const host = window.document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1200px;height:800px;pointer-events:none;'
  window.document.body.append(host)
  let instance: MindMapLike | null = null
  try {
    const MindMap = await loadMindMap()
    instance = new MindMap({ el: host, data: toSimpleMindMapData(mindmap.root), layout: config.layout, theme: 'default', themeConfig: themePreset(config.theme).config, fit: true })
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
    const value = await instance.doExport?.export('svg', false, mindmap.title, instance.getData?.(false))
    const blob = asBlob(value)
    if (!blob || blob.type !== 'image/svg+xml') throw new Error('SVG preview export failed')
    return URL.createObjectURL(blob)
  } finally {
    instance?.destroy?.()
    host.remove()
  }
}

function MindmapToolCard({ block }: ToolCallViewProps): ReactElement {
  const reference = previewReference(block)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    setUrl(null)
    setError(null)
    setOpen(false)
    if (!reference || reference.state === 'expired') return () => undefined
    void api<MindmapPreviewPayload>(`/maps/${encodeURIComponent(reference.libraryId)}/revisions/${encodeURIComponent(reference.revisionId)}`).then(async (preview) => {
      const nextUrl = await svgPreview(preview.document, preview.config)
      if (alive) {
        objectUrl = nextUrl
        setUrl(nextUrl)
      } else {
        URL.revokeObjectURL(nextUrl)
      }
    }).catch(() => { if (alive) setError('脑图预览已失效或无法生成') })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [reference?.libraryId, reference?.revisionId, reference?.state])

  if (!reference) return createElement('div', { style: { padding: '8px', opacity: .7 } }, '脑图预览数据不可用')
  if (reference.state === 'expired') return createElement('div', { style: { padding: '8px', opacity: .7 } }, '本图已失效')
  return createElement('section', { style: { padding: '10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', maxWidth: '620px' } },
    createElement('strong', null, reference.title),
    createElement('small', { style: { display: 'block', opacity: .7, marginBottom: '8px' } }, `${reference.nodeCount} 节点 · SVG 预览`),
     reference.capabilityNote ? createElement('small', { style: { display: 'block', opacity: .62, marginBottom: '8px' }, role: 'note' }, reference.capabilityNote) : null,
    error ? createElement('span', { role: 'status' }, error) : url ? createElement('button', { type: 'button', onClick: () => setOpen(true), style: { display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }, 'aria-label': `打开 ${reference.title} SVG 预览` }, createElement('img', { src: url, alt: `${reference.title} 思维导图`, style: { display: 'block', maxWidth: '100%', maxHeight: '360px', background: '#fff', borderRadius: '6px' } })) : createElement('span', { role: 'status' }, '正在生成 SVG 预览…'),
    open && url ? createElement(SvgPreviewDialog, { src: url, alt: `${reference.title} 思维导图`, onClose: () => setOpen(false) }) : null,
  )
}

/**
 * rc.8 intentionally does not export the attachment package's internal
 * ImageLightbox. Keep previewing functional through the platform dialog
 * primitive instead of importing an unsupported private source path.
 */
function SvgPreviewDialog({ src, alt, onClose }: { src: string; alt: string; onClose(): void }): ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreFocusRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); restoreFocusRef.current?.focus() }
  }, [onClose])
  return createPortal(createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': '脑图 SVG 预览', style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center' } },
    createElement('button', { type: 'button', 'aria-label': '关闭预览', onClick: onClose, style: { position: 'absolute', inset: 0, border: 0, background: 'rgba(2,6,23,.78)', cursor: 'default' } }),
    createElement('section', { style: { position: 'relative', zIndex: 1, maxWidth: '92vw', maxHeight: '92vh', padding: '12px', background: 'var(--dsw-alias-bg-base,#0f172a)', borderRadius: '10px' } },
      createElement('img', { src, alt, style: { display: 'block', maxWidth: '88vw', maxHeight: '82vh', background: '#fff' } }),
      createElement('button', { ref: closeRef, type: 'button', onClick: onClose, style: { ...buttonStyle(), marginTop: '8px' } }, '关闭预览'),
    ),
  ), window.document.body)
}

function BrainmapView(props: ConvViewProps & { sessions: SessionService }): ReactElement {
  const sessionId = props.sessionId
  const [maps, setMaps] = useState<MindmapSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [record, setRecord] = useState<MindmapRecord | null>(null)
  const [status, setStatus] = useState('加载图库中…')
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [manualText, setManualText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [xmind, setXmind] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftMaxNodes, setDraftMaxNodes] = useState(360)
  const [mapActions, setMapActions] = useState<MapActions | null>(null)
  const [appearanceUndo, setAppearanceUndo] = useState<Partial<MindmapConfig> | null>(null)
  const [canvasFullscreen, setCanvasFullscreen] = useState(false)
  const [panelRun, setPanelRun] = useState<PanelRunView | null>(null)
  const [capabilityNote, setCapabilityNote] = useState('面板重新生成会直接启动 fork 子代理；状态只显示在脑图面板，不创建聊天 Job 或 SVG 卡。')
  const createControllerRef = useRef<AbortController | null>(null)
  const recordRef = useRef<MindmapRecord | null>(null)
  useEffect(() => { recordRef.current = record }, [record])

  const refresh = () => void api<MindmapSummary[]>(`/maps${showArchived ? '?archived=true' : ''}`).then((next) => { setMaps(next); setSelectedId((prev) => prev ?? next[0]?.libraryId); setStatus(`${next.length} 张${showArchived ? '已归档' : '活动'}脑图`) }).catch((error) => setStatus(String(error)))
  useEffect(refresh, [showArchived])
  useEffect(() => {
    void api<{ capabilityNote?: string }>('/health').then((health) => { if (health.capabilityNote) setCapabilityNote(health.capabilityNote) }).catch(() => undefined)
  }, [])
  useEffect(() => { if (!selectedId) { setRecord(null); return }; void api<MindmapRecord>(`/maps/${encodeURIComponent(selectedId)}`).then(setRecord).catch((error) => setStatus(String(error))) }, [selectedId])
  useEffect(() => {
    if (!panelRun || panelRun.status !== 'running') return
    let active = true
    const poll = () => void api<PanelRunView>(`/panel-runs/${encodeURIComponent(panelRun.runId)}`).then((next) => {
      if (!active) return
      setPanelRun(next); setStatus(next.detail)
      if (next.status === 'completed') { void api<MindmapRecord>(`/maps/${encodeURIComponent(next.libraryId)}`).then((updated) => { if (active) { setRecord(updated); refresh() } }) }
    }).catch((error) => { if (active) setStatus(`重新生成状态读取失败：${String(error)}`) })
    poll()
    const timer = window.setInterval(poll, 1_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [panelRun?.runId, panelRun?.status])

  const persistDocument = (document: MindmapDocument) => {
    const current = recordRef.current
    if (!current) return
    void api<MindmapRecord>(`/maps/${encodeURIComponent(current.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document, rotatePrevious: false }) }).then((next) => { setRecord((prev) => prev ? { ...prev, updatedAt: next.updatedAt, current: next.current, previous: next.previous } : next); setStatus('已自动保存当前手动修改') }).catch((error) => setStatus(String(error)))
  }
  const createMap = () => {
    if (!manualText.trim()) { setStatus('请先输入文本或 Markdown'); return }
    setBusy(true)
    const controller = new AbortController()
    createControllerRef.current = controller
    const title = manualText.split(/\r?\n/)[0]?.replace(/^#\s*/, '')
    void api<{ document: MindmapDocument; libraryId: string }>('/generate', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: manualText, title, source: { kind: 'text', sessionId }, config: { instruction, maxNodes: draftMaxNodes }, save: false }) })
      .then(async (generated) => {
        if (controller.signal.aborted) return
        await api<MindmapRecord>('/maps', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, document: generated.document, source: { kind: 'text', sessionId }, config: { instruction, maxNodes: draftMaxNodes } }) })
        setShowCreate(false); setManualText(''); refresh(); setStatus('已创建脑图')
      })
      .catch((error) => { if (error instanceof DOMException && error.name === 'AbortError') setStatus('已取消创建，未保存任何内容'); else setStatus(String(error)) })
      .finally(() => { if (createControllerRef.current === controller) createControllerRef.current = null; setBusy(false) })
  }
  const regenerate = () => {
    if (!record) return
    if (!props.sessions.binding(sessionId)?.session) { setStatus('当前会话不可用，无法启动 fork 子代理'); return }
    setStatus('正在启动 fork 子代理…')
    void api<PanelRunView>(`/maps/${encodeURIComponent(record.libraryId)}/regenerate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, expectedUpdatedAt: record.updatedAt, instruction }) })
      .then((run) => { setPanelRun(run); setStatus(run.detail) })
      .catch((error) => setStatus(`无法启动重新生成：${String(error)}`))
  }
  const cancelRegenerate = () => {
    if (!panelRun || panelRun.status !== 'running') return
    void api<{ runId: string; status: string }>(`/panel-runs/${encodeURIComponent(panelRun.runId)}`, { method: 'DELETE' })
      .then(() => setStatus('正在取消 fork 子代理…'))
      .catch((error) => setStatus(`取消失败：${String(error)}`))
  }
  const archive = () => { if (!record) return; void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}/archive`, { method: 'POST' }).then(() => { setSelectedId(undefined); refresh() }) }
  const restore = () => { if (!record) return; void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: false }) }).then(() => { setSelectedId(undefined); refresh() }) }
  const remove = () => { if (!record || !window.confirm('删除后不可恢复，确认删除？')) return; void api<{ deleted: boolean }>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'DELETE' }).then(() => { setSelectedId(undefined); refresh() }) }
  const visualConfig = (config: Partial<MindmapConfig>) => {
    if (!record) return
    const before = record
    const rollback = Object.fromEntries(Object.keys(config).map((key) => [key, before.config[key as keyof MindmapConfig]])) as Partial<MindmapConfig>
    setAppearanceUndo(rollback)
    setRecord({ ...record, config: { ...record.config, ...config } })
    setStatus('正在应用外观配置…')
    void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) })
      .then((next) => { setRecord(next); setStatus('外观已立即应用并保存') })
      .catch((error) => { setRecord(before); setStatus(`外观保存失败：${String(error)}`) })
  }
  const undoAppearance = () => {
    if (!record || !appearanceUndo) return
    const undo = appearanceUndo
    const redo = Object.fromEntries(Object.keys(undo).map((key) => [key, record.config[key as keyof MindmapConfig]])) as Partial<MindmapConfig>
    setRecord({ ...record, config: { ...record.config, ...undo } })
    setAppearanceUndo(redo)
    void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: undo }) })
      .then((next) => { setRecord(next); setStatus('已撤销上一次外观设置') })
      .catch((error) => { setStatus(`撤销外观失败：${String(error)}`) })
  }

  return createElement('main', { style: panelStyle() },
    createElement('header', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, createElement('strong', null, '脑图库'), createElement('span', { style: { opacity: .65 } }, `${maps.length} 张`), createElement('span', { role: 'status', style: { opacity: .68, fontSize: '12px' } }, capabilityNote), createElement('button', { type: 'button', onClick: () => setShowArchived((value) => !value), style: buttonStyle() }, showArchived ? '活动脑图' : '归档'), createElement('button', { type: 'button', onClick: () => setShowCreate((value) => !value), style: { ...buttonStyle(), marginLeft: 'auto' } }, '新建')),
    showCreate && createElement('section', { style: { padding: '8px', marginBottom: '8px', border: '1px solid #334155', borderRadius: '8px' } }, createElement('textarea', { rows: 5, value: manualText, placeholder: '粘贴文本或 Markdown（也可以让 Agent 从 PDF/附件生成）', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setManualText(event.target.value), style: { ...inputStyle(), resize: 'vertical' } }), createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } }, '最多节点', createElement('select', { value: draftMaxNodes, onChange: (event: ChangeEvent<HTMLSelectElement>) => setDraftMaxNodes(Number(event.target.value)), style: { ...inputStyle(), width: 'auto' }, 'aria-label': '新脑图最多节点' }, [120, 240, 360, 600, 1_000].map((count) => createElement('option', { key: count, value: count }, `${count}`)))), createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, createElement('button', { type: 'button', disabled: busy, onClick: createMap, style: buttonStyle() }, busy ? '生成中…' : '生成并保存'), createElement('button', { type: 'button', onClick: () => { createControllerRef.current?.abort(); createControllerRef.current = null; setShowCreate(false); setManualText(''); setInstruction(''); setBusy(false); setStatus('已取消创建，未保存任何内容') }, style: buttonStyle() }, '取消'))),
    noteOpen && createElement('section', { style: { padding: '8px', marginBottom: '8px', border: '1px solid #334155', borderRadius: '8px' } }, createElement('textarea', { rows: 3, value: instruction, placeholder: '备注 / 补充（默认只作为下一次生成的附加要求）', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setInstruction(event.target.value), style: { ...inputStyle(), resize: 'vertical' } })),
    createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(140px,220px) minmax(0,1fr)', gap: '12px', flex: 1, minHeight: 0 } },
      createElement('aside', { style: { overflow: 'auto', borderRight: '1px solid #334155', paddingRight: '8px' } }, maps.map((item) => createElement('button', { key: item.libraryId, type: 'button', onClick: () => setSelectedId(item.libraryId), style: { display: 'block', width: '100%', textAlign: 'left', padding: '8px', marginBottom: '5px', border: 0, borderRadius: '6px', background: selectedId === item.libraryId ? '#334155' : 'transparent', color: 'inherit', cursor: 'pointer' } }, createElement('strong', null, item.title), createElement('small', { style: { display: 'block', opacity: .65 } }, `${item.nodeCount} 节点 · ${item.source?.kind ?? 'unknown'}`)))),
      record ? createElement('section', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' } },
        createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l1,#334155)' } }, createElement('strong', { style: { marginRight: '4px' } }, record.title), createElement('details', { style: { position: 'relative' } }, createElement('summary', { style: { ...buttonStyle(), listStyle: 'none', userSelect: 'none' }, 'aria-label': '展开更多操作' }, '更多操作'), createElement('div', { style: { position: 'absolute', zIndex: 4, top: 'calc(100% + 6px)', left: 0, minWidth: '132px', display: 'grid', gap: '5px', padding: '7px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base,#0f172a)', boxShadow: '0 12px 30px rgba(0,0,0,.28)' } }, createElement('button', { type: 'button', onClick: () => downloadBlob(new Blob([JSON.stringify(record.current, null, 2)], { type: 'application/json' }), safeFilename(record.title, 'json')), style: buttonStyle() }, '导出 JSON'), createElement('button', { type: 'button', onClick: () => downloadBlob(new Blob([markdown(record.current.root)], { type: 'text/markdown' }), safeFilename(record.title, 'md')), style: buttonStyle() }, '导出 Markdown'), createElement('button', { type: 'button', disabled: !xmind, onClick: () => xmind && downloadBlob(xmind, safeFilename(record.title, 'xmind')), style: buttonStyle() }, '导出 XMind'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.exportPng().then(() => setStatus('已导出 PNG')).catch((error) => setStatus(`PNG 导出失败：${String(error)}`)), style: buttonStyle() }, '导出 PNG'), createElement('hr', { style: { width: '100%', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1,#334155)' } }), createElement('button', { type: 'button', disabled: panelRun?.status === 'running', onClick: regenerate, style: buttonStyle() }, panelRun?.status === 'running' ? '正在重新生成…' : '重新生成'), record.archived ? createElement('button', { type: 'button', onClick: restore, style: buttonStyle() }, '恢复') : createElement('button', { type: 'button', onClick: archive, style: buttonStyle() }, '归档'), createElement('button', { type: 'button', onClick: remove, style: { ...buttonStyle(), color: '#fca5a5' } }, '删除'))), createElement('span', { style: toolbarLabelStyle() }, '视图'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.openSvgPreview().then(() => setStatus('已在新标签页打开 SVG 预览')).catch((error) => setStatus(`SVG 预览失败：${String(error)}`)), style: buttonStyle(), 'aria-label': '在新网页标签预览 SVG' }, '预览 SVG'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.toggleFullscreen().then(() => setStatus(canvasFullscreen ? '已退出全屏画布' : '已进入全屏画布')).catch((error) => setStatus(`全屏画布失败：${String(error)}`)), style: buttonStyle(), 'aria-label': canvasFullscreen ? '退出全屏画布' : '进入全屏画布' }, canvasFullscreen ? '退出全屏' : '全屏画布'), ),
        createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, createElement('details', { style: { position: 'relative' } }, createElement('summary', { style: { ...buttonStyle(), listStyle: 'none', userSelect: 'none' }, 'aria-label': '展开外观设置' }, `外观 · ${LAYOUT_OPTIONS.find(([value]) => value === record.config.layout)?.[1] ?? '布局'} · ${themePreset(record.config.theme).label} · ${record.config.maxNodes}`), createElement('div', { style: { position: 'absolute', zIndex: 4, top: 'calc(100% + 6px)', left: 0, width: 'min(340px, calc(100vw - 48px))', display: 'grid', gap: '9px', padding: '10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base,#0f172a)', boxShadow: '0 12px 30px rgba(0,0,0,.28)' } }, createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('span', { style: toolbarLabelStyle() }, '布局'), createElement('select', { value: record.config.layout, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ layout: event.target.value }), style: inputStyle(), 'aria-label': '布局' }, LAYOUT_OPTIONS.map(([value, label]) => createElement('option', { key: value, value }, label)))), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('span', { style: toolbarLabelStyle() }, '主题'), createElement('select', { value: record.config.theme, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ theme: event.target.value }), style: inputStyle(), 'aria-label': '主题' }, Object.entries(THEME_PRESETS).map(([value, preset]) => createElement('option', { key: value, value }, preset.label)))), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('span', { style: toolbarLabelStyle() }, '节点容量'), createElement('select', { value: record.config.maxNodes, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ maxNodes: Number(event.target.value) }), style: inputStyle(), 'aria-label': '最多节点' }, [120, 240, 360, 600, 1_000].map((count) => createElement('option', { key: count, value: count }, `${count} 节点`)))))), createElement('button', { type: 'button', disabled: !appearanceUndo, onClick: undoAppearance, style: buttonStyle() }, '撤销外观'), createElement('button', { type: 'button', onClick: () => setNoteOpen((value) => !value), style: buttonStyle() }, noteOpen ? '收起备注' : '备注 / 补充')),
        createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, createElement('span', { style: toolbarLabelStyle() }, '编辑与层级'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.undo().then(() => setStatus('已撤销上一次编辑')), style: buttonStyle() }, '撤销编辑'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.redo().then(() => setStatus('已重做编辑')), style: buttonStyle() }, '重做编辑'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.collapseToLevel(2).then(() => setStatus('已收起至第 2 层')), style: buttonStyle() }, '收起至第 2 层'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.collapseAll().then(() => setStatus('已全部收起')), style: buttonStyle() }, '全部收起'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.expandAll().then(() => setStatus('已全部展开')), style: buttonStyle() }, '全部展开')),
        panelRun?.libraryId === record.libraryId ? createElement('div', { role: 'status', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', borderRadius: '7px', background: panelRun.status === 'failed' ? 'rgba(127,29,29,.38)' : panelRun.status === 'completed' ? 'rgba(6,78,59,.38)' : 'rgba(30,41,59,.72)', border: '1px solid #475569' } }, createElement('strong', null, panelRun.status === 'running' ? 'Fork 子代理运行中' : panelRun.status === 'completed' ? '重新生成完成' : panelRun.status === 'cancelled' ? '重新生成已取消' : '重新生成失败'), createElement('span', { style: { opacity: .78 } }, panelRun.detail), panelRun.status === 'running' ? createElement('button', { type: 'button', onClick: cancelRegenerate, style: { ...buttonStyle(), marginLeft: 'auto' } }, '取消') : null) : null,
        createElement(MapCanvas, { key: `${record.libraryId}:${record.current.source.generatedAt}`, record, onDocumentChange: persistDocument, onXmind: setXmind, onActions: setMapActions, onFullscreenChange: setCanvasFullscreen }))
        : createElement('section', { style: { display: 'grid', placeItems: 'center', minHeight: '480px', opacity: .7 } }, '暂无脑图。可以点击“新建”，或让 Agent 从文本/PDF/附件生成。')),
    createElement('span', { style: { opacity: .7 } }, status),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: `${PLUGIN_ID}-panel`, order: 20, label: () => '脑图', inject: (sessionId: string) => ({ sessions: ctx.sessions, sessionId }) }, BrainmapView as never)), `${PLUGIN_ID}: brainmap view`)
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'present_chat_mindmap' }, MindmapToolCard as never)), `${PLUGIN_ID}: chat SVG preview`)
}
