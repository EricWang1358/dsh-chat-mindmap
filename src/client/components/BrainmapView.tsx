import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createElement, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react'
import { buildMindmap, type MindmapDocument, type MindmapNode } from '../../core.js'
import { ApiError, api, listQueryOf } from '../api.js'
import { svgPreviewHtml } from '../preview/artifact-html.js'
import { DswButton, DswStateDot } from './ui/primitives.js'
import { LAYOUT_OPTIONS, THEME_PRESETS, shellThemeConfig, shellIsDark } from '../canvas-theme.js'
import { createT, resolveLocale } from '../locale.js'
import { consumeMindmapTarget } from './mindmap-navigation.js'
import { MindmapGuide } from './MindmapGuide.js'
import { OnboardingPreference } from './onboarding-preference.js'

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
  view?: { enlarge(): void; narrow(): void }
}
type MindMapCtor = new (options: { el: HTMLElement; data: unknown; layout: string; theme?: string; themeConfig?: Record<string, unknown>; fit?: boolean; customInnerElsAppendTo?: HTMLElement }) => MindMapLike
type MindmapConfig = { layout: string; density: string; maxNodes: number; theme: string; font: string; instruction: string; language: string; contextLimit: number }

type MindmapSource = { kind: string; name?: string; attachmentId?: string; sessionId?: string; workspaceId?: string }
type MindmapRecord = { libraryId: string; title: string; current: MindmapDocument; previous?: MindmapDocument; config: MindmapConfig; source?: MindmapSource; archived?: boolean; updatedAt: string; recordVersion?: number }
type MindmapSummary = { libraryId: string; title: string; source?: MindmapSource; config: MindmapConfig; updatedAt: string; hasPrevious: boolean; archived: boolean; nodeCount: number }
type PanelRunView = { runId: string; libraryId: string; status: 'accepted' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'; detail: string; noteLength?: number; childId?: string; revisionId?: string }
type SessionService = { binding(id: string): { session?: { getSnapshot(): unknown; loadOlder(): Promise<void> } } | undefined }

const DEFAULT_RENDER_COLLAPSE_DEPTH = 2
function toRenderNode(node: MindmapNode, depth: number): MindmapNode {
  const hasChildren = (node.children?.length ?? 0) > 0
  // Always collapse deeper branches in the render-only copy. Persisted expand
  // state must not force a full expensive first layout after map switching.
  const collapseForInitialRender = depth >= DEFAULT_RENDER_COLLAPSE_DEPTH && hasChildren
  return { ...node, ...(collapseForInitialRender ? { collapsed: true } : {}), children: node.children?.map((child) => toRenderNode(child, depth + 1)) }
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
async function loadMindMap(): Promise<MindMapCtor> { const module = await import('../mindmap.js') as unknown as { default: MindMapCtor }; return module.default }
type ChromeStyle = Record<string, string | number>
type MindmapScope = 'session' | 'workspace'
type ActivePopover = 'more' | null

/** Web approximation of a dark frosted-glass surface, layered over DSH tokens. */
function glassSurfaceStyle(emphasis: 'quiet' | 'strong' = 'quiet'): ChromeStyle {
  return {
    border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 68%, var(--dsw-alias-label-primary,#e2e8f0) 12%)',
    borderRadius: '14px',
    background: emphasis === 'strong'
      ? 'linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1,#171e2e) 78%, transparent), color-mix(in srgb, var(--dsw-alias-bg-base,#111827) 88%, transparent))'
      : 'color-mix(in srgb, var(--dsw-alias-bg-layer-1,#171e2e) 76%, transparent)',
    boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 12%, transparent), var(--dsw-shadow-lv3,0 12px 30px rgba(0,0,0,.18))',
    backdropFilter: 'blur(18px) saturate(135%)',
    WebkitBackdropFilter: 'blur(18px) saturate(135%)',
  }
}

function panelStyle(): ChromeStyle { return { display: 'flex', flexDirection: 'column', width: '100%', minWidth: '0', height: '100%', minHeight: '0', flex: '1 1 0', overflow: 'hidden', position: 'relative', isolation: 'isolate', padding: '0', background: 'linear-gradient(145deg, color-mix(in srgb, var(--dsw-alias-bg-layer-2,#23262d) 92%, var(--dsw-alias-bg-base,#111827)), var(--dsw-alias-bg-base,#111827))', color: 'var(--dsw-alias-label-primary,#e2e8f0)', font: '13px/1.45 system-ui,sans-serif' } }
function buttonStyle(): ChromeStyle { return { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#475569) 86%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-button-tool-bar-fill,#1e293b) 82%, transparent)', color: 'inherit', borderRadius: '10px', padding: '6px 9px', cursor: 'pointer', transition: 'transform .18s ease, filter .18s ease, background .18s ease', fontSize: '13px', lineHeight: '18px' } }
function inputStyle(): ChromeStyle { return { display: 'block', width: '100%', boxSizing: 'border-box', padding: '8px 9px', borderRadius: '10px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#475569) 86%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-bg-base,#111827) 78%, transparent)', color: 'inherit' } }
function zoomButtonStyle(): ChromeStyle { return { border: '0', background: 'transparent', color: 'inherit', borderRadius: '8px', minWidth: '30px', minHeight: '30px', padding: '4px 6px', cursor: 'pointer', font: 'inherit' } }
function compactButtonStyle(selected = false): ChromeStyle { return { ...buttonStyle(), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minHeight: '32px', padding: '6px 9px', borderColor: selected ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 74%, var(--dsw-alias-border-l2,#475569))' : 'color-mix(in srgb, var(--dsw-alias-border-l2,#475569) 86%, transparent)', background: selected ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 16%, var(--dsw-alias-button-tool-bar-fill,#1e293b))' : 'color-mix(in srgb, var(--dsw-alias-button-tool-bar-fill,#1e293b) 82%, transparent)', fontWeight: selected ? '650' : '560', whiteSpace: 'nowrap' } }
function nextPaint(): Promise<void> { return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))) }

type SelectedNode = { id: string; title: string; note: string }
type MapActions = {
  undo(): Promise<void>
  redo(): Promise<void>
  expandAll(): Promise<void>
  collapseAll(): Promise<void>
  collapseToLevel(level: number): Promise<void>
  exportPng(): Promise<void>
  openSvgPreview(): Promise<void>
  exportXmind(): Promise<void>
  toggleFullscreen(): Promise<void>
  isFullscreen(): boolean
  zoomIn(): void
  zoomOut(): void
  saveNode(node: SelectedNode): void
}
/** R16 guard: remount key excludes layout/theme so appearance changes never rebuild the instance. */
export function mountKeyOf(record: { libraryId: string; current: { source: { generatedAt: string } } }): string {
  return record.libraryId + ':' + record.current.source.generatedAt
}

/** §13.4 autosave fencing: only the newest, un-aborted PATCH may touch state. */
export function shouldApplyAutosave(seq: number, latestSeq: number, aborted: boolean): boolean {
  return !aborted && seq === latestSeq
}

function MapCanvas({ record, onDocumentChange, onActions, onFullscreenChange, onNodeSelect }: { record: MindmapRecord; onDocumentChange: (document: MindmapDocument) => void; onActions: (actions: MapActions | null) => void; onFullscreenChange: (fullscreen: boolean) => void; onNodeSelect: (node: SelectedNode | null) => void }): ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  // SimpleMindMap creates its contenteditable element outside the SVG. Keep it
  // inside this canvas, which remains within the fullscreen element.
  const mapRef = useRef<MindMapLike | null>(null)
  const saveTimer = useRef<number | null>(null)
  const resizeRaf = useRef<number | null>(null)


  const recordRef = useRef(record)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenNode, setFullscreenNode] = useState<SelectedNode | null>(null)
  const [shellDark, setShellDark] = useState(shellIsDark)
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const renderKey = mountKeyOf(record)
  const canvasFullscreen = () => window.document.fullscreenElement === fullscreenRef.current
  const runCanvasTask = async (task: () => void): Promise<void> => {
    setRenderState('loading')
    await nextPaint()
    if (!mapRef.current) return
    try {
      task()
      // SimpleMindMap schedules the SVG update synchronously/asynchronously
      // depending on its layout. Keep the canvas-only blocker until the browser
      // has had a full post-command paint opportunity, not just until command return.
      await nextPaint()
    } finally { if (mapRef.current) setRenderState('ready') }
  }
  useEffect(() => { recordRef.current = record }, [record])

  useEffect(() => {
    const sync = () => setShellDark(shellIsDark())
    const observer = new MutationObserver(sync)
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', sync)
    sync()
    return () => { observer.disconnect(); window.matchMedia?.('(prefers-color-scheme: dark)').removeEventListener?.('change', sync) }
  }, [])
  useEffect(() => {
    const changed = () => { const active = canvasFullscreen(); setFullscreen(active); onFullscreenChange(active); window.setTimeout(() => mapRef.current?.resize(), 0) }
    window.document.addEventListener('fullscreenchange', changed)
    return () => window.document.removeEventListener('fullscreenchange', changed)
  }, [onFullscreenChange])
  useEffect(() => {
    const viewport = fullscreenRef.current
    if (!viewport) return
    let lastSize = ''
    let resizeListener: (() => void) | null = null
    const scheduleResize = (width: number, height: number) => {
      // Observe only the host viewport. Renderer-owned DOM must never feed
      // its own size back into the layout and create an expansion loop.
      if (width < 1 || height < 1) return
      const size = `${Math.round(width)}x${Math.round(height)}`
      if (lastSize === size) return
      lastSize = size
      if (resizeRaf.current !== null) window.cancelAnimationFrame(resizeRaf.current)
      resizeRaf.current = window.requestAnimationFrame(() => {
        resizeRaf.current = null
        mapRef.current?.resize()
      })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) scheduleResize(entry.contentRect.width, entry.contentRect.height)
    })
    observer?.observe(viewport)
    resizeListener = () => scheduleResize(viewport.clientWidth, viewport.clientHeight)
    window.addEventListener('resize', resizeListener)
    resizeListener()
    return () => {
      observer?.disconnect()
      if (resizeListener) window.removeEventListener('resize', resizeListener)
      if (resizeRaf.current !== null) window.cancelAnimationFrame(resizeRaf.current)
      resizeRaf.current = null
    }
  }, [])

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
        const renderRoot = toRenderNode(sourceRoot, 0)
        const instance = new MindMap({ el: canvasRef.current, data: toSimpleMindMapData(renderRoot), layout: recordRef.current.config.layout, theme: 'default', themeConfig: shellThemeConfig(recordRef.current.config.theme, shellDark).config, fit: true, customInnerElsAppendTo: canvasRef.current })
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
        exportXmind: async () => {
          // §13.4: XMind is produced ONLY on explicit user action, never on mount.
          const value = await instance.doExport?.export('xmind', false, recordRef.current.title, instance.getData?.(false))
          const blob = asBlob(value)
          if (!blob) throw new Error('XMind 导出失败')
          downloadBlob(blob, safeFilename(recordRef.current.title, 'xmind'))
        },
        toggleFullscreen: async () => {          const canvas = fullscreenRef.current
          if (!canvas) throw new Error('画布尚未准备完成')
          if (canvasFullscreen()) {
            if (window.document.exitFullscreen) await window.document.exitFullscreen()
            return
          }
          if (!canvas.requestFullscreen) throw new Error('当前浏览器不支持全屏画布')
          await canvas.requestFullscreen()
        },
        isFullscreen: canvasFullscreen,
        zoomIn: () => instance.view?.enlarge(),
        zoomOut: () => instance.view?.narrow(),
        saveNode: (node) => {
          const active = (instance as unknown as { renderer?: { activeNodeList?: Array<{ getData?(key?: string): unknown }> } }).renderer?.activeNodeList?.find((item) => item.getData?.('id') === node.id)
          if (!active) return
          instance.execCommand?.('SET_NODE_TEXT', active, node.title)
          instance.execCommand?.('SET_NODE_NOTE', active, node.note)
          setFullscreenNode(node)
        },
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
      const selected = (raw?: unknown) => {
        const node = raw as { getData?(key?: string): unknown } | undefined
        const id = node?.getData?.('id')
        const title = node?.getData?.('text')
        if (typeof id !== 'string' || typeof title !== 'string') { onNodeSelect(null); setFullscreenNode(null); return }
        const note = node?.getData?.('note')
        const next = { id, title, note: typeof note === 'string' ? note : '' }
        onNodeSelect(next)
        if (canvasFullscreen()) setFullscreenNode(next)
      }
      const clearSelected = () => { onNodeSelect(null); setFullscreenNode(null) }
      instance.on?.('node_active', selected)
      instance.on?.('draw_click', clearSelected)
      instance.on?.('data_change', changed)
      window.setTimeout(() => instance.resize(), 0)
      const applyAppearance = () => {
        instance.setThemeConfig?.(shellThemeConfig(recordRef.current.config.theme, shellDark).config)
        instance.setLayout?.(recordRef.current.config.layout)
        instance.resize()
      }
      applyAppearance()
      const cleanup = () => { instance.off?.('data_change', changed); instance.off?.('node_active', selected); instance.off?.('draw_click', clearSelected) }
      // attach cleanup to instance for effect teardown
        ;(instance as unknown as { __cleanup?: () => void }).__cleanup = cleanup
        await nextPaint()
        if (alive) setRenderState('ready')
      } catch {
        if (alive) setRenderState('failed')
      }
    })()
    return () => { alive = false; onActions(null); if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); const inst = mapRef.current as unknown as { __cleanup?: () => void } | null; inst?.__cleanup?.(); mapRef.current?.destroy?.(); mapRef.current = null; canvas.replaceChildren() }
  }, [renderKey])
  useEffect(() => {
    const instance = mapRef.current
    if (!instance) return
    instance.setThemeConfig?.(shellThemeConfig(record.config.theme, shellDark).config)
    instance.setLayout?.(record.config.layout)
    instance.reRender?.(() => instance.resize(), 'chat-mindmap: appearance-change')
    if (!instance.reRender) {
      instance.render?.(() => instance.resize(), 'chat-mindmap: appearance-change')
    }
  }, [record.config.layout, record.config.theme, shellDark])
  return createElement('div', { ref: fullscreenRef, 'aria-busy': renderState === 'loading', style: { position: 'relative', width: '100%', minWidth: 0, minHeight: 0, flex: '1 1 0', borderRadius: '4px', overflow: 'hidden', background: shellDark ? 'var(--dsw-alias-bg-layer-2,#24262c)' : 'var(--dsw-alias-bg-base,#f9fafb)' } },
    createElement('style', null, [
      '@keyframes dsh-chat-mindmap-spin { to { transform: rotate(360deg); } }',
      '[data-chat-mindmap-root] button:disabled{opacity:.45;cursor:not-allowed}',
    ].join('\n')),
    fullscreen ? createElement('div', { style: { position: 'absolute', top: '12px', left: '12px', right: '12px', zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'none' } },
      createElement('span', { style: { padding: '5px 8px', borderRadius: '4px', background: 'color-mix(in srgb, var(--dsw-alias-bg-base,#0f172a) 84%, transparent)', color: 'var(--dsw-alias-label-primary,#e2e8f0)', pointerEvents: 'auto' } }, '全屏编辑：双击节点直接改名，或使用右侧节点属性'),
      createElement('button', { type: 'button', onClick: () => void window.document.exitFullscreen?.(), style: { marginLeft: 'auto', zIndex: 5, pointerEvents: 'auto', ...buttonStyle() }, 'aria-label': '退出全屏画布' }, '退出全屏'),
    ) : null,
    createElement('div', { ref: canvasRef, style: { position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 } }),
    fullscreen && fullscreenNode ? createElement('form', { onSubmit: (event: Event) => { event.preventDefault(); const title = fullscreenNode.title.trim(); if (!title) return; const active = (mapRef.current as unknown as { renderer?: { activeNodeList?: Array<{ getData?(key?: string): unknown }> } } | null)?.renderer?.activeNodeList?.find((item) => item.getData?.('id') === fullscreenNode.id); if (!active) return; mapRef.current?.execCommand?.('SET_NODE_TEXT', active, title); mapRef.current?.execCommand?.('SET_NODE_NOTE', active, fullscreenNode.note); setFullscreenNode({ ...fullscreenNode, title }) }, style: { position: 'absolute', top: '58px', right: '12px', zIndex: 4, display: 'grid', gap: '7px', width: 'min(320px, calc(100vw - 32px))', padding: '12px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#94a3b8) 70%, transparent)', borderRadius: '8px', background: 'color-mix(in srgb, var(--dsw-alias-bg-base,#0f172a) 94%, transparent)', color: 'var(--dsw-alias-label-primary,#e2e8f0)', boxShadow: 'var(--dsw-shadow-lv3,0 12px 30px rgba(0,0,0,.36))' } },
      createElement('strong', null, '节点属性'),
      createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', null, '标题'), createElement('input', { value: fullscreenNode.title, onChange: (event: ChangeEvent<HTMLInputElement>) => setFullscreenNode({ ...fullscreenNode, title: event.target.value }), style: { ...inputStyle(), background: 'var(--dsw-alias-button-tool-bar-fill,#fff)', color: 'var(--dsw-alias-label-primary,#111827)' }, 'aria-label': '全屏节点标题' })),
      createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', null, '备注'), createElement('textarea', { rows: 4, value: fullscreenNode.note, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setFullscreenNode({ ...fullscreenNode, note: event.target.value }), style: { ...inputStyle(), background: 'var(--dsw-alias-button-tool-bar-fill,#fff)', color: 'var(--dsw-alias-label-primary,#111827)', resize: 'vertical' }, 'aria-label': '全屏节点备注' })),
      createElement('div', { style: { display: 'flex', gap: '6px' } }, createElement('button', { type: 'submit', style: { ...buttonStyle(), /* @token-exempt-line */ background: '#14b8a6', borderColor: '#14b8a6', color: '#fff' } }, '保存节点'), createElement('button', { type: 'button', onClick: () => setFullscreenNode(null), style: buttonStyle() }, '收起')),
    ) : null,
    renderState !== 'ready' ? createElement('div', { role: renderState === 'failed' ? 'alert' : 'status', 'aria-live': 'polite', style: { position: 'absolute', inset: 0, zIndex: 2, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--dsw-alias-bg-base,#0f172a) 78%, transparent)', color: 'var(--dsw-alias-label-primary,#e2e8f0)', backdropFilter: 'blur(2px)', pointerEvents: 'auto' } },
      renderState === 'loading' ? createElement('div', { style: { display: 'grid', justifyItems: 'center', gap: '12px', textAlign: 'center' } }, createElement('span', { 'aria-hidden': true, style: { width: '32px', height: '32px', border: '3px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 28%, transparent)', borderTopColor: 'var(--dsw-alias-brand-primary,#5eead4)', borderRadius: '50%', animation: 'dsh-chat-mindmap-spin .8s linear infinite' } }), createElement('strong', null, '正在渲染脑图…'), createElement('small', null, '高节点数脑图仅阻塞此画布，不影响其他操作')) : createElement('div', { style: { textAlign: 'center' } }, createElement('strong', null, '脑图渲染失败'), createElement('small', { style: { display: 'block', marginTop: '6px' } }, '请切换其他脑图后重试')),
    ) : null,
  )
}
export type EmptyKind = 'session' | 'workspace' | 'capability'

/** §13.1: the three mandated empty states. */
export function EmptyState({ kind, localeId, onCreate, onOpenGuide }: { kind: EmptyKind; localeId?: string; onCreate?(): void; onOpenGuide?(): void }): ReactElement {
  const t = createT(localeId)
  const icon = kind === 'capability' ? '\u26A0\uFE0F' : kind === 'workspace' ? '\uD83D\uDDC2\uFE0F' : '\uD83E\uDDF6'
  const titleKey = kind === 'capability' ? 'empty.capability.title' : kind === 'workspace' ? 'empty.workspace.title' : 'empty.session.title'
  const bodyKey = kind === 'capability' ? 'empty.capability.body' : kind === 'workspace' ? 'empty.workspace.body' : 'empty.session.body'
  if (kind !== 'session') {
    return createElement('section', { style: { display: 'grid', placeItems: 'center', minHeight: '480px', gap: '10px' } },
      createElement('span', { style: { fontSize: '42px', opacity: .35 } }, icon),
      createElement('strong', { style: { fontSize: '16px' } }, t(titleKey)),
      createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)', maxWidth: '320px', textAlign: 'center' } }, t(bodyKey)))
  }
  return createElement('section', { 'data-mm-empty-session': 'true', style: { width: 'min(620px, calc(100% - 32px))', margin: '28px auto', padding: 'clamp(22px,4vw,34px)', boxSizing: 'border-box', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 68%, var(--dsw-alias-label-primary,#e2e8f0) 12%)', borderRadius: '20px', background: 'linear-gradient(145deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1,#171e2e) 86%, transparent), color-mix(in srgb, var(--dsw-alias-bg-base,#111827) 92%, transparent))', boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 14%, transparent), var(--dsw-shadow-lv3,0 18px 46px rgba(0,0,0,.22))', backdropFilter: 'blur(18px) saturate(135%)', WebkitBackdropFilter: 'blur(18px) saturate(135%)' } },
    createElement('div', { style: { display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '18px', alignItems: 'start' } },
      createElement('div', { 'aria-hidden': true, style: { position: 'relative', width: '58px', height: '58px', borderRadius: '18px', overflow: 'hidden', background: 'linear-gradient(145deg, color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 28%, transparent), color-mix(in srgb, var(--dsw-alias-bg-layer-2,#23262d) 88%, transparent))', border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 42%, transparent)', boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 24%, transparent)' } },
        createElement('span', { style: { position: 'absolute', left: '12px', top: '24px', width: '33px', height: '1px', background: 'var(--dsw-alias-brand-primary,#14b8a6)', transform: 'rotate(-28deg)', transformOrigin: 'left center', opacity: .8 } }),
        createElement('span', { style: { position: 'absolute', left: '12px', top: '30px', width: '33px', height: '1px', background: 'var(--dsw-alias-brand-primary,#14b8a6)', transform: 'rotate(26deg)', transformOrigin: 'left center', opacity: .65 } }),
        createElement('i', { style: { position: 'absolute', left: '8px', top: '24px', width: '9px', height: '9px', borderRadius: '50%', background: 'var(--dsw-alias-brand-primary,#14b8a6)', boxShadow: '0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 14%, transparent)' } }),
        createElement('i', { style: { position: 'absolute', right: '8px', top: '13px', width: '11px', height: '11px', borderRadius: '50%', background: 'color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 84%, transparent)' } }),
        createElement('i', { style: { position: 'absolute', right: '8px', bottom: '12px', width: '9px', height: '9px', borderRadius: '50%', background: 'color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 62%, transparent)' } })),
      createElement('div', { style: { minWidth: 0 } },
        createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-brand-primary,#14b8a6)', fontWeight: '650', letterSpacing: '.02em', marginBottom: '5px' } }, t('empty.session.kicker')),
        createElement('strong', { style: { display: 'block', fontSize: '20px', letterSpacing: '-.025em', lineHeight: 1.2 } }, t(titleKey)),
        createElement('small', { style: { display: 'block', marginTop: '7px', maxWidth: '480px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', lineHeight: 1.55 } }, t(bodyKey)))),
    createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '22px', paddingTop: '16px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 60%, transparent)' } },
      createElement('button', { type: 'button', onClick: onOpenGuide, disabled: !onOpenGuide, style: { border: 0, padding: '8px 2px', background: 'transparent', color: 'var(--dsw-alias-label-secondary,#94a3b8)', cursor: onOpenGuide ? 'pointer' : 'default', font: 'inherit' }, 'data-mm-action': 'true' }, t('empty.session.guideAction')),
      createElement('button', { type: 'button', onClick: onCreate, disabled: !onCreate, style: { ...compactButtonStyle(true), padding: '8px 12px', background: 'var(--dsw-alias-brand-primary,#14b8a6)', borderColor: 'var(--dsw-alias-brand-primary,#14b8a6)', color: 'var(--dsw-alias-bg-base,#111827)' }, 'data-mm-onboarding-create': 'true', 'data-mm-action': 'true' }, t('empty.session.primary'))))
}

export const regenerateUnavailableWhileRunning = (panelRun: PanelRunView | null | undefined): boolean => panelRun !== undefined && panelRun !== null && (panelRun.status === 'running' || panelRun.status === 'accepted')

type RegenerateModalProps = { record: MindmapRecord; panelRunning: boolean; sessionAvailable: boolean; draft: string; onDraftChange: (next: string) => void; onClose: () => void; onConfirm: () => void }

/** §13.2 regenerate modal: supplemental note, source-unavailable hint, confirm. */
function RegenerateModal({ record, panelRunning, sessionAvailable, draft, onDraftChange, onClose, onConfirm }: RegenerateModalProps): ReactElement {
  const sourceMissing = !record.source || record.source.kind === 'unknown'
  return createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': '重新生成脑图', onClick: onClose, style: { position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--dsw-alias-bg-base,#0f172a) 55%, transparent)' } },
    createElement('form', { onSubmit: (event: Event) => { event.preventDefault(); if (!panelRunning && sessionAvailable) onConfirm() }, onClick: (event: Event) => event.stopPropagation(), style: { display: 'grid', gap: '10px', width: 'min(440px, calc(100vw - 48px))', padding: '16px', border: '1px solid var(--dsw-alias-border-l1,#2c3445)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#171e2e))' } },
      createElement('strong', null, '重新生成：' + record.title),
      createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', null, '补充要求（可选）'), createElement('textarea', { rows: 3, value: draft, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onDraftChange(event.target.value), placeholder: '例如：更精简、突出方法步骤、补充例子', style: { ...inputStyle(), resize: 'vertical' }, 'aria-label': '重新生成补充要求' })),
      sourceMissing ? createElement('small', { role: 'note', style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, '来源不可用：本图没有可复解析的来源，重新生成只能基于当前大纲与备注。') : null,
      !sessionAvailable ? createElement('small', { role: 'alert' }, '当前会话不可用：无法启动 fork 子代理。') : null,
      createElement('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
        createElement(DswButton, { onClick: onClose }, '取消'),
        createElement(DswButton, { variant: 'primary', type: 'submit', disabled: panelRunning || !sessionAvailable, 'data-primary-regenerate': 'true' }, panelRunning ? '生成中…' : '确认生成'))))
}

function PopoverSectionLabel({ children }: { children: ReactNode }): ReactElement {
  return createElement('small', { style: { padding: '6px 7px 3px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px', fontWeight: '650', letterSpacing: '.02em' } }, children)
}

function PopoverAction({ label, selected = false, checked, selectionKind, disabled = false, tone = 'default', onSelect }: { label: string; selected?: boolean; checked?: boolean; selectionKind?: 'radio' | 'checkbox'; disabled?: boolean; tone?: 'default' | 'danger'; onSelect(): void }): ReactElement {
  const color = tone === 'danger' ? 'var(--dsw-alias-danger,var(--dsw-alias-label-primary,#e2e8f0))' : 'inherit'
  return createElement('button', { type: 'button', ...(selectionKind === undefined ? {} : { 'aria-pressed': checked === true }), disabled, onClick: onSelect, style: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: '1px solid transparent', borderRadius: '9px', background: selected ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 15%, transparent)' : 'transparent', color, padding: '7px 8px', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', font: 'inherit' }, 'data-mm-action': 'true' },
    createElement('span', null, label),
    selected || checked === true ? createElement('span', { 'aria-hidden': true, style: { color: 'var(--dsw-alias-brand-primary,#14b8a6)', fontWeight: '700' } }, '✓') : null,
  )
}

function MenuDivider(): ReactElement { return createElement('div', { role: 'separator', style: { height: '1px', margin: '5px 3px', background: 'color-mix(in srgb, var(--dsw-alias-border-l1,#334155) 84%, transparent)' } }) }

function ScopePicker({ scope, showArchived, onScopeChange, onArchiveToggle }: { scope: MindmapScope; showArchived: boolean; onScopeChange(scope: MindmapScope): void; onArchiveToggle(): void }): ReactElement {
  const title = scope === 'session' ? '本会话' : '整个工作区'
  const nextTitle = scope === 'session' ? '整个工作区' : '本会话'
  return createElement('div', { role: 'group', 'aria-label': '脑图范围', style: { display: 'flex', alignItems: 'center', gap: '5px' } },
    createElement('button', { type: 'button', onClick: () => onScopeChange(scope === 'session' ? 'workspace' : 'session'), title: `切换到${nextTitle}`, 'aria-label': `切换脑图范围，当前${title}${showArchived ? '，已归档' : '，活动'}`, style: { ...compactButtonStyle(true), flex: '0 0 150px', width: '150px', justifyContent: 'space-between' }, 'data-mm-action': 'true' }, [createElement('span', { key: 'label', style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontWeight: '500' } }, '范围'), createElement('strong', { key: 'value', style: { fontWeight: '650' } }, title), createElement('span', { key: 'swap', 'aria-hidden': true, style: { opacity: .66, fontSize: '12px' } }, '⇄')]),
    createElement('button', { type: 'button', onClick: onArchiveToggle, title: showArchived ? '查看活动脑图' : '查看已归档脑图', 'aria-label': showArchived ? '查看活动脑图' : '查看已归档脑图', 'aria-pressed': showArchived, style: { ...compactButtonStyle(showArchived), minWidth: '32px', padding: '6px' }, 'data-mm-action': 'true' }, '◷'),
  )
}

type MorePanelProps = {
  onClose(): void
  mapActions: MapActions | null
  record: MindmapRecord
  onRestore(): void
  onArchive(): void
  onDelete(): void
}

function MorePanel({ onClose, mapActions, record, onRestore, onArchive, onDelete }: MorePanelProps): ReactElement {
  const choose = (action: () => void) => () => { action(); onClose() }
  return createElement('aside', { 'data-mm-glass': 'true', 'aria-label': '更多脑图操作', style: { ...glassSurfaceStyle('strong'), minWidth: 0, height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '12px', display: 'grid', alignContent: 'start', gap: '3px' } },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' } }, createElement('div', null, createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px' } }, '工作台'), createElement('strong', { style: { display: 'block', marginTop: '1px' } }, '更多操作')), createElement('button', { type: 'button', onClick: onClose, style: { ...compactButtonStyle(), marginLeft: 'auto', minWidth: '32px', padding: '6px' }, 'aria-label': '收起更多脑图操作', title: '收起更多脑图操作', 'data-mm-action': 'true' }, '×')),
    createElement(PopoverSectionLabel, null, '画布'),
    createElement(PopoverAction, { label: '全部展开', disabled: !mapActions, onSelect: choose(() => void mapActions?.expandAll()) }),
    createElement(PopoverAction, { label: '全部折叠', disabled: !mapActions, onSelect: choose(() => void mapActions?.collapseAll()) }),
    createElement(PopoverAction, { label: '折叠至第 2 层', disabled: !mapActions, onSelect: choose(() => void mapActions?.collapseToLevel(2)) }),
    createElement(PopoverAction, { label: '预览 SVG', disabled: !mapActions, onSelect: choose(() => void mapActions?.openSvgPreview()) }),
    createElement(MenuDivider),
    createElement(PopoverSectionLabel, null, '导出'),
    createElement(PopoverAction, { label: '导出 JSON', onSelect: choose(() => downloadBlob(new Blob([JSON.stringify(record.current, null, 2)], { type: 'application/json' }), safeFilename(record.title, 'json'))) }),
    createElement(PopoverAction, { label: '导出 Markdown', onSelect: choose(() => downloadBlob(new Blob([markdown(record.current.root)], { type: 'text/markdown' }), safeFilename(record.title, 'md'))) }),
    createElement(PopoverAction, { label: '导出 XMind', disabled: !mapActions, onSelect: choose(() => void mapActions?.exportXmind()) }),
    createElement(PopoverAction, { label: '导出 PNG', disabled: !mapActions, onSelect: choose(() => void mapActions?.exportPng()) }),
    createElement(MenuDivider),
    createElement(PopoverSectionLabel, null, '整理'),
    ...(record.previous ? [createElement(PopoverAction, { key: 'restore', label: '恢复重新生成前版本', onSelect: choose(onRestore) })] : []),
    createElement(PopoverAction, { label: '归档', onSelect: choose(onArchive) }),
    createElement(PopoverAction, { label: '删除脑图', tone: 'danger', onSelect: choose(onDelete) }),
  )
}

type NodeInspectorProps = {
  record: MindmapRecord
  nodeDraft: SelectedNode | null
  onDraftChange(next: SelectedNode): void
  onSave(): void
  onClose(): void
  onVisualConfig(config: Partial<MindmapConfig>): void
}

function NodeInspector({ record, nodeDraft, onDraftChange, onSave, onClose, onVisualConfig }: NodeInspectorProps): ReactElement {
  return createElement('aside', { 'data-mm-glass': 'true', 'aria-label': '节点属性和脑图样式', style: { ...glassSurfaceStyle('strong'), minWidth: 0, height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '16px', display: 'grid', alignContent: 'start', gap: '14px' } },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      createElement('div', { style: { minWidth: 0 } }, createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px' } }, '编辑器'), createElement('strong', { style: { display: 'block', marginTop: '1px' } }, '节点属性')),
      createElement('button', { type: 'button', onClick: onClose, style: { ...compactButtonStyle(), marginLeft: 'auto', minWidth: '32px', padding: '6px' }, 'aria-label': '收起节点属性', title: '收起节点属性', 'data-mm-action': 'true' }, '×'),
    ),
    nodeDraft ? createElement('div', { style: { display: 'grid', gap: '11px' } },
      createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, '标题'), createElement('input', { value: nodeDraft.title, onChange: (event: ChangeEvent<HTMLInputElement>) => onDraftChange({ ...nodeDraft, title: event.target.value }), style: inputStyle(), 'aria-label': '节点标题' })),
      createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, `备注（${nodeDraft.note.length} 字）`), createElement('textarea', { rows: 8, value: nodeDraft.note, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onDraftChange({ ...nodeDraft, note: event.target.value }), placeholder: '添加节点备注', style: { ...inputStyle(), resize: 'vertical' }, 'aria-label': '节点备注' })),
      createElement('div', { style: { display: 'flex', gap: '7px' } }, createElement('button', { type: 'button', onClick: onSave, style: { ...compactButtonStyle(true), flex: '1 1 0', background: 'var(--dsw-alias-brand-primary,#14b8a6)', borderColor: 'var(--dsw-alias-brand-primary,#14b8a6)', color: 'var(--dsw-alias-bg-base,#0f172a)' }, 'data-mm-action': 'true' }, '保存节点'), createElement('button', { type: 'button', onClick: onClose, style: compactButtonStyle(), 'data-mm-action': 'true' }, '取消')),
    ) : createElement('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary,#94a3b8)', lineHeight: '1.6' } }, '选择一个节点，即可编辑标题和备注。'),
    createElement('details', { open: !nodeDraft, style: { paddingTop: '13px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#334155) 84%, transparent)' } },
      createElement('summary', { style: { cursor: 'pointer', fontWeight: '650', listStyle: 'none' } }, '脑图样式'),
      createElement('div', { style: { display: 'grid', gap: '10px', marginTop: '12px' } },
        createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, '结构'), createElement('select', { value: record.config.layout, onChange: (event: ChangeEvent<HTMLSelectElement>) => onVisualConfig({ layout: event.target.value }), style: inputStyle(), 'aria-label': '脑图结构' }, LAYOUT_OPTIONS.map(([value, label]) => createElement('option', { key: value, value }, label)))),
        createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, '主题'), createElement('select', { value: record.config.theme, onChange: (event: ChangeEvent<HTMLSelectElement>) => onVisualConfig({ theme: event.target.value }), style: inputStyle(), 'aria-label': '脑图主题' }, Object.entries(THEME_PRESETS).map(([value, preset]) => createElement('option', { key: value, value }, preset.label)))),
      ),
    ),
  )
}

const MINDMAP_CHROME_CSS = [
  '[data-chat-mindmap-root] [data-mm-action]:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}',
  '[data-chat-mindmap-root] [data-mm-action]:active:not(:disabled){transform:translateY(0)}',
  '[data-chat-mindmap-root] button:focus-visible,[data-chat-mindmap-root] input:focus-visible,[data-chat-mindmap-root] textarea:focus-visible,[data-chat-mindmap-root] select:focus-visible{outline:2px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 75%, transparent);outline-offset:2px}',
  '[data-chat-mindmap-root] [data-mm-sidebar-item]:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 10%, transparent)}',
  '@media (prefers-reduced-transparency: reduce){[data-chat-mindmap-root] [data-mm-glass]{background:var(--dsw-alias-bg-layer-1,#171e2e)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}[data-chat-mindmap-root] [data-mm-guide-overlay]{background:var(--dsw-alias-bg-base,#111827)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}}',
  '@media (prefers-reduced-motion: reduce){[data-chat-mindmap-root] *{transition:none!important}}',
].join('\n')

function useOnboardingSeen(onboarding: OnboardingPreference): boolean {
  const [seen, setSeen] = useState(() => onboarding.seen)
  useEffect(() => {
    const update = () => setSeen(onboarding.seen)
    update()
    return onboarding.subscribe(update)
  }, [onboarding])
  return seen
}

function BrainmapView(props: ConvViewProps & { sessions: SessionService; onboarding: OnboardingPreference }): ReactElement {
  const sessionId = props.sessionId
  const onboardingSeen = useOnboardingSeen(props.onboarding)
  const previousOnboardingSeen = useRef(onboardingSeen)
  const [guideRequested, setGuideRequested] = useState(false)
  const [maps, setMaps] = useState<MindmapSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [record, setRecord] = useState<MindmapRecord | null>(null)
  const [galleryState, setGalleryState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [status, setStatus] = useState('正在打开脑图库…')
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [scope, setScope] = useState<MindmapScope>('session')
  const [activePopover, setActivePopover] = useState<ActivePopover>(null)
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenDraft, setRegenDraft] = useState('')
  const [manualText, setManualText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [createPhase, setCreatePhase] = useState<'idle' | 'generating' | 'saving'>('idle')
  const [draftMaxNodes, setDraftMaxNodes] = useState(360)
  const [mapActions, setMapActions] = useState<MapActions | null>(null)
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null)
  const [nodeDraft, setNodeDraft] = useState<SelectedNode | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const narrowLayout = workspaceWidth > 0 && workspaceWidth < 900
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [panelRun, setPanelRun] = useState<PanelRunView | null>(null)
  const createControllerRef = useRef<AbortController | null>(null)
  const autosaveSeq = useRef(0)
  const autosaveAbort = useRef<AbortController | null>(null)
  const galleryRequestRef = useRef<{ key: string; promise: Promise<MindmapSummary[]> } | null>(null)
  const recordRef = useRef<MindmapRecord | null>(null)
  // Live mirrors of state used by long-lived async callbacks (the regenerate
  // poll) so a stale closure cannot apply a stale panelRun, a stale refresh,
  // or a stale record against a newer generation or after the user switched
  // to a different mindmap.
  const panelRunRef = useRef<PanelRunView | null>(null)
  const refreshRef = useRef<((force?: boolean) => void) | null>(null)
  useEffect(() => {
    if (previousOnboardingSeen.current && !onboardingSeen) setGuideRequested(true)
    previousOnboardingSeen.current = onboardingSeen
  }, [onboardingSeen])
  useEffect(() => { recordRef.current = record }, [record])
  useEffect(() => { panelRunRef.current = panelRun }, [panelRun])
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const update = () => setWorkspaceWidth(Math.round(workspace.getBoundingClientRect().width))
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(workspace)
    window.addEventListener('resize', update)
    update()
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  useEffect(() => { setSelectedNode(null); setNodeDraft(null) }, [record?.libraryId, record?.current.source.generatedAt])

  const refresh = useCallback((force = false) => {
    let active = true
    setGalleryState('loading')
    setStatus('正在读取脑图库…')
    const key = scope + ':' + (showArchived ? 'archived' : 'active') + ':' + (sessionId ?? '')
    const request = !force && galleryRequestRef.current?.key === key
      ? galleryRequestRef.current.promise
      : api<MindmapSummary[]>(listQueryOf(scope, sessionId, showArchived))
    galleryRequestRef.current = { key, promise: request }
    void request.then((next) => {
      if (!active) return
      setMaps(next)
      const targetId = consumeMindmapTarget(String(sessionId))
      setSelectedId((prev) => targetId && next.some((item) => item.libraryId === targetId) ? targetId : prev && next.some((item) => item.libraryId === prev) ? prev : next[0]?.libraryId)
      setGalleryState('ready')
      setStatus(`${next.length} 张${showArchived ? '已归档' : '活动'}脑图（${scope === 'workspace' ? '全部工作区' : '本会话'}）`)
    }).catch((error) => {
      if (!active) return
      if (galleryRequestRef.current?.promise === request) galleryRequestRef.current = null
      setGalleryState('failed')
      setStatus(`图库加载失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => { active = false }
  }, [scope, showArchived, sessionId])
  useEffect(() => { refreshRef.current = refresh }, [refresh])
  useEffect(() => refresh(), [refresh])
  useEffect(() => {
    let active = true
    if (!selectedId) { setRecord(null); setInstruction(''); return () => { active = false } }
    setRecord(null)
    void api<MindmapRecord>(`/maps/${encodeURIComponent(selectedId)}?sessionId=${encodeURIComponent(sessionId ?? '')}`).then((next) => { if (active) { setRecord(next); setInstruction(next.config.instruction ?? '') } }).catch((error) => { if (active) setStatus(String(error)) })
    return () => { active = false }
  }, [selectedId, sessionId])
  useEffect(() => {
    // The 202 from /regenerate returns the view while its status is still
    // 'accepted' (the server only flips it to 'running' inside the async
    // settle). Polling must start as soon as a runId exists, otherwise the
    // transition to 'running' and the eventual completion/failure are never
    // observed and the original mindmap is never refreshed.
    if (!panelRun || (panelRun.status !== 'running' && panelRun.status !== 'accepted')) return
    let active = true
    // Lock onto the libraryId this run was started for: the user may switch
    // to a different mindmap while the subagent is still running, and the
    // completion callback must not overwrite an unrelated record that was
    // loaded into state after the run was started.
    const targetLibraryId = panelRun.libraryId
    const targetRunId = panelRun.runId
    const poll = () => void api<PanelRunView>(`/panel-runs/${encodeURIComponent(targetRunId)}?sessionId=${encodeURIComponent(sessionId ?? '')}`).then((next) => {
      if (!active) return
      // Drop late responses for runs the user has already abandoned (cancel,
      // or started a newer run for the same record).
      if (panelRunRef.current?.runId !== targetRunId) return
      setPanelRun(next)
      // Only echo the run's detail to the global status when the user is
      // still on the same record that the run belongs to; otherwise the
      // banner above the canvas already conveys the run's state.
      if (recordRef.current?.libraryId === targetLibraryId) setStatus(next.detail)
      if (next.status === 'completed' && next.libraryId === targetLibraryId) { void api<MindmapRecord>(`/maps/${encodeURIComponent(next.libraryId)}?sessionId=${encodeURIComponent(sessionId ?? '')}`).then((updated) => { if (active && panelRunRef.current?.runId === targetRunId && recordRef.current?.libraryId === targetLibraryId) { setRecord(updated); void refreshRef.current?.(true) } }) }
    }).catch((error) => { if (active && panelRunRef.current?.runId === targetRunId && recordRef.current?.libraryId === targetLibraryId) setStatus(`重新生成状态读取失败：${String(error)}`) })
    poll()
    const timer = window.setInterval(poll, 1_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [panelRun?.runId, panelRun?.status])

  const persistDocument = (document: MindmapDocument) => {
    const current = recordRef.current
    if (!current) return
    const seq = ++autosaveSeq.current
    autosaveAbort.current?.abort()
    const controller = new AbortController()
    autosaveAbort.current = controller
    void api<MindmapRecord>(`/maps/${encodeURIComponent(current.libraryId)}`, { method: 'PATCH', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, document, rotatePrevious: false, expectedRecordVersion: current.recordVersion }) }).then((next) => {
      if (!shouldApplyAutosave(seq, autosaveSeq.current, controller.signal.aborted)) return
      setRecord((prev) => prev ? { ...prev, updatedAt: next.updatedAt, current: next.current, previous: next.previous, recordVersion: next.recordVersion } : next)
      setStatus('已自动保存当前手动修改')
    }).catch((error) => {
      if (controller.signal.aborted || !shouldApplyAutosave(seq, autosaveSeq.current, false)) return
      if (error instanceof ApiError && error.code === 'MINDMAP_CONFLICT') {
        setStatus('检测到版本冲突：本次修改未写入，已刷新最新内容')
        void api<MindmapRecord>(`/maps/${encodeURIComponent(current.libraryId)}?sessionId=${encodeURIComponent(sessionId ?? '')}`).then((latest) => setRecord(latest)).catch(() => undefined)
        return
      }
      setStatus(error instanceof Error ? error.message : String(error))
    })
  }
  const createMap = () => {
    if (!manualText.trim() || createPhase !== 'idle') return
    const controller = new AbortController()
    createControllerRef.current = controller
    const title = manualText.split(/\r?\n/)[0]?.replace(/^#\s*/, '')
    setCreatePhase('generating')
    setStatus('正在生成未保存草稿…')
    const generatedDocument = buildMindmap(manualText, title ?? '', { maxNodes: draftMaxNodes })
    void (async () => {
      try {
        if (controller.signal.aborted) return
        setCreatePhase('saving')
        setStatus('正在保存脑图…')
        await api<MindmapRecord>('/maps?sessionId=' + encodeURIComponent(sessionId ?? ''), { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, document: generatedDocument, source: { kind: 'text', sessionId }, config: { instruction, maxNodes: draftMaxNodes } }) })
        setShowCreate(false); setManualText(''); setInstruction(''); void refresh(true); setStatus('已创建脑图')
      } catch (error) {
        if (controller.signal.aborted) setStatus('已取消创建，未保存任何内容'); else setStatus(error instanceof Error ? '创建失败：' + error.message : '创建失败：' + String(error))
      } finally {
        if (createControllerRef.current === controller) createControllerRef.current = null
        setCreatePhase('idle')
      }
    })()
  }
  const regenerate = (noteText?: string) => {
    if (!record) return
    if (!props.sessions.binding(sessionId)?.session) { setRegenOpen(true); setStatus('当前会话不可用，无法启动 fork 子代理'); return }
    const note = noteText?.trim() || ''
    setStatus(note ? `正在启动 fork 子代理，附带 ${note.length} 字备注…` : '正在启动 fork 子代理…')
    void api<PanelRunView>(`/maps/${encodeURIComponent(record.libraryId)}/regenerate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, expectedRecordVersion: record.recordVersion, ...(note ? { instruction: note } : {}) }) })
      .then((run) => { setPanelRun(run); setStatus(run.detail); setRegenOpen(false) })
      .catch((error) => setStatus(error instanceof Error ? '无法启动重新生成：' + error.message : '无法启动重新生成'))
  }
  const restorePrevious = () => {
    if (!record?.previous) return
    void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}/restore-previous`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, expectedRecordVersion: record.recordVersion }) })
      .then((next) => { setRecord(next); void refresh(true); setStatus('已与上一版本互换') })
      .catch((error) => setStatus('恢复失败：' + (error instanceof Error ? error.message : String(error))))
  }
  const archiveCurrent = () => {
    if (!record) return
    if (!window.confirm('归档这张脑图？归档后可在“已归档”列表找回。')) return
    void api<MindmapRecord>('/maps/' + encodeURIComponent(record.libraryId) + '/archive?sessionId=' + encodeURIComponent(sessionId ?? ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true, expectedRecordVersion: record.recordVersion }) })
      .then(() => { setRecord(null); void refresh(true); setStatus('已归档当前脑图') })
      .catch((error) => setStatus('归档失败：' + (error instanceof Error ? error.message : String(error))))
  }
  const deleteCurrent = () => {
    if (!record) return
    if (!window.confirm('删除这张脑图？关联聊天卡将显示失效。')) return
    void api<{ deleted: boolean }>('/maps/' + encodeURIComponent(record.libraryId) + '?sessionId=' + encodeURIComponent(sessionId ?? '') + '&expectedRecordVersion=' + String(record.recordVersion ?? 1), { method: 'DELETE' })
      .then(() => { setRecord(null); void refresh(true); setStatus('已删除脑图') })
      .catch((error) => setStatus('删除失败：' + (error instanceof Error ? error.message : String(error))))
  }
  const cancelRegenerate = () => {
    if (!panelRun || (panelRun.status !== 'running' && panelRun.status !== 'accepted')) return
    void api<{ runId: string; status: string }>(`/panel-runs/${encodeURIComponent(panelRun.runId)}?sessionId=${encodeURIComponent(sessionId ?? '')}`, { method: 'DELETE' })
      .then(() => setStatus('正在取消 fork 子代理…'))
      .catch((error) => setStatus(`取消失败：${String(error)}`))
  }
  const visualConfig = (config: Partial<MindmapConfig>) => {
    if (!record) return
    const before = record
    setRecord({ ...record, config: { ...record.config, ...config } })
    setStatus('正在应用外观配置…')
    void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, config, expectedRecordVersion: record.recordVersion }) })
      .then((next) => { setRecord(next); setStatus('外观已立即应用并保存') })
      .catch((error) => {
        setRecord(before)
        if (error instanceof ApiError && error.code === 'MINDMAP_CONFLICT') { void api<MindmapRecord>('/maps/' + encodeURIComponent(record.libraryId) + '?sessionId=' + encodeURIComponent(sessionId ?? '')).then((latest) => setRecord(latest)).catch(() => undefined); setStatus('外观保存遇到版本冲突，已刷新'); return }
        setStatus('外观保存失败：' + (error instanceof Error ? error.message : String(error)))
      })
  }
  const selectNode = (node: SelectedNode | null) => {
    setSelectedNode(node)
    setNodeDraft(node)
    if (node) { setActivePopover(null); setInspectorOpen(true) }
  }
  const saveNode = () => {
    if (!selectedNode || !nodeDraft || !mapActions) return
    const title = nodeDraft.title.trim()
    if (!title) { setStatus('节点标题不能为空'); return }
    mapActions.saveNode({ ...nodeDraft, title })
    setSelectedNode({ ...nodeDraft, title })
    setNodeDraft({ ...nodeDraft, title })
    setStatus('节点修改已应用，正在自动保存')
  }
  const cancelNodeDraft = () => {
    setNodeDraft(selectedNode)
    setInspectorOpen(false)
  }
  const selectedSummary = maps.find((item) => item.libraryId === selectedId)
  const filteredMaps = maps.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const scopeLabel = scope === 'workspace' ? '整个工作区' : '本会话'
  const currentTitle = record?.title ?? selectedSummary?.title ?? '脑图工作台'
  const currentMeta = record
    ? `${selectedSummary?.nodeCount ?? '…'} 个节点${record.archived ? '，已归档' : ''}`
    : galleryState === 'loading' ? '正在读取图库' : `${maps.length} 张脑图`
  const sidebarCompact = narrowLayout && !showCreate
  const sidebarColumn = sidebarOpen ? (sidebarCompact ? '64px' : 'minmax(216px,248px)') : ''
  const inspectorVisible = inspectorOpen && record !== null
  const moreVisible = activePopover === 'more' && record !== null
  const utilityVisible = inspectorVisible || moreVisible
  const utilityColumn = inspectorVisible
    ? narrowLayout ? 'minmax(240px,34vw)' : 'minmax(280px,320px)'
    : narrowLayout ? 'minmax(208px,28vw)' : 'minmax(216px,236px)'
  const workspaceColumns = sidebarOpen
    ? utilityVisible ? `${sidebarColumn} minmax(0,1fr) ${utilityColumn}` : `${sidebarColumn} minmax(0,1fr)`
    : utilityVisible ? `minmax(0,1fr) ${utilityColumn}` : 'minmax(0,1fr)'
  const chooseScope = (nextScope: MindmapScope) => {
    if (nextScope === scope) return
    setSelectedId(undefined)
    setSearch('')
    setSelectedNode(null)
    setNodeDraft(null)
    setInspectorOpen(false)
    setActivePopover(null)
    setScope(nextScope)
    setStatus(nextScope === 'workspace' ? '正在显示整个工作区的脑图' : '正在显示本会话的脑图')
  }
  const toggleArchived = () => {
    const next = !showArchived
    setSelectedId(undefined)
    setInspectorOpen(false)
    setActivePopover(null)
    setShowArchived(next)
    setStatus(next ? '正在查看已归档脑图' : '正在查看活动脑图')
  }
  const toggleMorePopover = () => {
    setInspectorOpen(false)
    setActivePopover(activePopover === 'more' ? null : 'more')
  }
  const toggleInspector = () => {
    setActivePopover(null)
    setInspectorOpen((open) => !open)
  }
  const openCreateFromGuide = () => {
    props.onboarding.markSeen()
    setGuideRequested(false)
    setActivePopover(null)
    setInspectorOpen(false)
    setSidebarOpen(true)
    setShowCreate(true)
    setStatus('已打开从文本创建；也可回到聊天让 Agent 根据上下文生成')
  }
  const openGuide = () => {
    props.onboarding.replay()
    setGuideRequested(true)
    setActivePopover(null)
    setInspectorOpen(false)
  }
  const dismissGuide = () => {
    props.onboarding.markSeen()
    setGuideRequested(false)
  }
  const openInspectorFromGuide = () => {
    if (!record) return
    dismissGuide()
    setActivePopover(null)
    setInspectorOpen(true)
    setStatus('节点属性已打开：选择节点后即可编辑标题和备注')
  }
  const openMoreFromGuide = () => {
    if (!record) return
    dismissGuide()
    setInspectorOpen(false)
    setActivePopover('more')
    setStatus('更多操作已打开：可导出 PNG、Markdown、JSON 或 XMind')
  }
  const selectMap = (libraryId: string) => {
    setActivePopover(null)
    setInspectorOpen(false)
    setSelectedId(libraryId)
  }
  const guideOpen = guideRequested || (galleryState === 'ready' && scope === 'session' && maps.length === 0 && !onboardingSeen)

  return createElement('main', { 'data-chat-mindmap-root': 'true', style: panelStyle() },
    createElement('style', null, MINDMAP_CHROME_CSS),
    createElement('header', { 'data-mm-glass': 'true', style: { ...glassSurfaceStyle('quiet'), height: '60px', minHeight: '60px', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: '14px', padding: '0 16px', borderTop: 0, borderRight: 0, borderLeft: 0, borderRadius: 0, borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 80%, transparent)', boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 4%, transparent)' } },
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
        createElement('button', { type: 'button', onClick: () => setSidebarOpen((open) => !open), style: { ...compactButtonStyle(), minWidth: '32px', padding: '6px' }, 'aria-label': sidebarOpen ? '收起脑图库' : '展开脑图库', title: sidebarOpen ? '收起脑图库' : '展开脑图库', 'data-mm-action': 'true' }, sidebarOpen ? '‹' : '☰'),
        createElement(ScopePicker, { scope, showArchived, onScopeChange: chooseScope, onArchiveToggle: toggleArchived }),
      ),
      createElement('div', { style: { minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px' } },
        createElement('div', { style: { minWidth: 0, display: 'grid', gap: '1px' } },
          createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${scopeLabel} · ${currentMeta}`),
          createElement('strong', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', letterSpacing: '-.01em' } }, currentTitle),
        ),
        narrowLayout && maps.length > 0 ? createElement('select', { value: selectedId ?? '', onChange: (event: ChangeEvent<HTMLSelectElement>) => selectMap(event.target.value), style: { ...inputStyle(), width: 'auto', maxWidth: '42%', minWidth: 0, padding: '5px 7px' }, 'aria-label': '选择脑图' }, maps.map((item) => createElement('option', { key: item.libraryId, value: item.libraryId }, item.title))) : null,
        galleryState === 'loading' ? createElement('small', { role: 'status', style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)', whiteSpace: 'nowrap' } }, '更新中') : null,
        galleryState === 'failed' ? createElement('button', { type: 'button', onClick: () => void refresh(true), style: compactButtonStyle(), 'data-mm-action': 'true' }, '重试') : null,
      ),
      createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px', minWidth: 0 } },
        createElement('div', { role: 'group', 'aria-label': '画布历史操作', 'data-mm-glass': 'true', style: { ...glassSurfaceStyle(), borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '1px', padding: '2px' } },
          createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.undo(), style: zoomButtonStyle(), title: '撤销 Ctrl+Z', 'aria-label': '撤销 Ctrl+Z', 'data-mm-action': 'true' }, '↶'),
          createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.redo(), style: zoomButtonStyle(), title: '重做 Ctrl+Shift+Z', 'aria-label': '重做 Ctrl+Shift+Z', 'data-mm-action': 'true' }, '↷'),
        ),
        createElement('button', { type: 'button', disabled: !record, onClick: toggleInspector, style: compactButtonStyle(inspectorVisible), title: '节点属性和脑图样式', 'aria-label': '打开节点属性', 'aria-pressed': inspectorVisible, 'data-mm-action': 'true' }, '属性'),
        createElement(DswButton, { variant: 'primary', disabled: regenerateUnavailableWhileRunning(panelRun) || !record, onClick: () => { setActivePopover(null); setRegenDraft(instruction); setRegenOpen(true) }, title: '重新生成（fork 子代理）', 'aria-label': '重新生成脑图', 'data-toolbar-regenerate': 'true', 'data-mm-action': 'true', style: { ...compactButtonStyle(true), background: 'var(--dsw-alias-brand-primary,#14b8a6)', borderColor: 'var(--dsw-alias-brand-primary,#14b8a6)', color: 'var(--dsw-alias-bg-base,#111827)' } }, '重新生成'),
        createElement('button', { type: 'button', disabled: !record, onClick: toggleMorePopover, style: compactButtonStyle(moreVisible), 'aria-label': '更多脑图操作', 'aria-pressed': moreVisible, 'data-mm-action': 'true' }, '更多'),
        createElement('button', { type: 'button', onClick: openGuide, style: compactButtonStyle(guideOpen), 'aria-label': '打开脑图使用指南', 'aria-pressed': guideOpen, 'data-mm-action': 'true' }, '指南'),
        createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.toggleFullscreen(), style: { ...compactButtonStyle(), minWidth: '32px', padding: '6px' }, title: '全屏画布', 'aria-label': '全屏画布', 'data-mm-action': 'true' }, '⛶'),
      ),
    ),
    createElement('div', { ref: workspaceRef, style: { display: 'grid', gridTemplateColumns: workspaceColumns, gap: '10px', boxSizing: 'border-box', padding: '10px 12px 12px', position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' } },
      sidebarOpen ? createElement('aside', { 'data-mm-glass': 'true', 'aria-label': '脑图库', style: { ...glassSurfaceStyle(), minWidth: 0, minHeight: 0, overflow: 'auto', boxSizing: 'border-box', padding: sidebarCompact ? '8px 6px' : '12px', display: 'grid', alignContent: 'start', gap: '10px' } },
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 } },
          sidebarCompact ? null : createElement('div', { style: { minWidth: 0, marginRight: 'auto' } }, createElement('strong', { style: { display: 'block', fontSize: '13px' } }, '脑图库'), createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px', marginTop: '1px' } }, `${scopeLabel} ${showArchived ? '已归档' : '活动'}`)),
          createElement('button', { type: 'button', onClick: () => { setActivePopover(null); setShowCreate((value) => !value) }, style: { ...compactButtonStyle(showCreate), ...(sidebarCompact ? { width: '100%' } : {}) }, title: showCreate ? '收起新建脑图' : '新建脑图', 'aria-label': showCreate ? '收起新建脑图' : '新建脑图', 'aria-pressed': showCreate, 'data-mm-action': 'true' }, sidebarCompact ? '＋' : showCreate ? '收起' : '新建'),
        ),
        showCreate ? createElement('section', { style: { ...glassSurfaceStyle('strong'), padding: '10px', display: 'grid', gap: '9px' }, 'aria-label': '新建脑图' },
          createElement('div', null, createElement('strong', { style: { fontSize: '13px' } }, '从文本创建'), createElement('small', { style: { display: 'block', marginTop: '2px', color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, '粘贴文本或 Markdown，生成后会保存到当前范围。')),
          createElement('textarea', { rows: 5, value: manualText, placeholder: '粘贴文本或 Markdown', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setManualText(event.target.value), style: { ...inputStyle(), resize: 'vertical' }, 'aria-label': '新脑图文本' }),
          createElement('label', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, createElement('small', null, '节点上限'), createElement('select', { value: draftMaxNodes, onChange: (event: ChangeEvent<HTMLSelectElement>) => setDraftMaxNodes(Number(event.target.value)), style: { ...inputStyle(), width: 'auto', padding: '5px 7px' }, 'aria-label': '新脑图最多节点' }, [120, 240, 360, 600, 1_000].map((count) => createElement('option', { key: count, value: count }, `${count}`)))),
          createElement('div', { style: { display: 'flex', gap: '7px' } },
            createElement('button', { type: 'button', disabled: createPhase !== 'idle', onClick: createMap, style: { ...compactButtonStyle(true), flex: '1 1 0', background: 'var(--dsw-alias-brand-primary,#14b8a6)', borderColor: 'var(--dsw-alias-brand-primary,#14b8a6)', color: 'var(--dsw-alias-bg-base,#111827)' }, 'data-mm-action': 'true' }, createPhase === 'generating' ? '生成草稿中' : createPhase === 'saving' ? '保存中' : '生成并保存'),
            createPhase === 'generating'
              ? createElement('button', { type: 'button', onClick: () => { createControllerRef.current?.abort(); setStatus('正在取消未保存草稿…') }, style: compactButtonStyle(), 'data-mm-action': 'true' }, '取消')
              : createElement('button', { type: 'button', disabled: createPhase === 'saving', onClick: () => { setShowCreate(false); setManualText(''); setInstruction(''); setStatus(createPhase === 'saving' ? '脑图正在保存；保存完成后会显示在图库中' : '已取消创建，未保存任何内容') }, style: compactButtonStyle(), 'data-mm-action': 'true' }, '取消'),
          ),
        ) : null,
        sidebarCompact ? null : createElement('input', { value: search, placeholder: '搜索脑图', onChange: (event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value), style: inputStyle(), 'aria-label': '搜索脑图' }),
        createElement('div', { style: { display: 'grid', gap: sidebarCompact ? '5px' : '4px' } },
          filteredMaps.map((item, index) => createElement('button', { key: item.libraryId, type: 'button', onClick: () => selectMap(item.libraryId), title: item.title, 'aria-label': `打开脑图：${item.title}`, 'aria-current': selectedId === item.libraryId ? 'page' : undefined, 'data-mm-sidebar-item': 'true', style: { display: 'block', minWidth: 0, width: '100%', textAlign: 'left', padding: sidebarCompact ? '9px 4px' : '8px 9px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#334155) 74%, transparent)', borderLeft: selectedId === item.libraryId ? '3px solid var(--dsw-alias-brand-primary,#14b8a6)' : '3px solid transparent', borderRadius: '10px', background: selectedId === item.libraryId ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 13%, transparent)' : 'transparent', color: 'inherit', cursor: 'pointer', transition: 'background .18s ease, transform .18s ease' } },
            sidebarCompact
              ? createElement('span', { style: { display: 'block', textAlign: 'center', color: selectedId === item.libraryId ? 'var(--dsw-alias-brand-primary,#14b8a6)' : 'var(--dsw-alias-label-secondary,#94a3b8)', fontWeight: '700' } }, String(index + 1))
              : [createElement('strong', { key: 'title', style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' } }, item.title), createElement('small', { key: 'meta', style: { display: 'block', marginTop: '2px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' } }, `${item.nodeCount} 个节点 · ${item.source?.kind?.toUpperCase() ?? 'MAP'}`)],
          )),
          galleryState === 'ready' && filteredMaps.length === 0 ? createElement('small', { style: { padding: sidebarCompact ? '8px 2px' : '12px 6px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#94a3b8)', lineHeight: '1.5' } }, search.trim() ? '没有匹配的脑图' : '这里还没有脑图') : null,
        ),
      ) : null,
      createElement('section', { 'data-mm-glass': 'true', 'aria-label': '脑图画布', style: { ...glassSurfaceStyle('strong'), display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' } },
        record && panelRun?.libraryId === record.libraryId ? createElement('div', { role: 'status', style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 8px 0', padding: '8px 10px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#475569) 72%, transparent)', borderRadius: '10px', background: panelRun.status === 'failed' || panelRun.status === 'timed_out' ? 'color-mix(in srgb, var(--dsw-alias-danger,var(--dsw-alias-label-primary,#e2e8f0)) 14%, transparent)' : panelRun.status === 'completed' ? 'color-mix(in srgb, var(--dsw-alias-success,var(--dsw-alias-brand-primary,#14b8a6)) 14%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-bg-layer-2,#23262d) 74%, transparent)' } },
          createElement('strong', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } }, panelRun.status === 'accepted' || panelRun.status === 'running' ? [createElement(DswStateDot, { key: 'dot', tone: 'running', label: '运行中' }), '正在重新生成'] : panelRun.status === 'completed' ? [createElement(DswStateDot, { key: 'dot', tone: 'ok', label: '完成' }), '重新生成完成'] : panelRun.status === 'cancelled' ? '重新生成已取消' : panelRun.status === 'timed_out' ? '重新生成超时' : '重新生成失败'),
          createElement('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, panelRun.detail, panelRun.noteLength ? ` · 已传入 ${panelRun.noteLength} 字备注` : null),
          (panelRun.status === 'running' || panelRun.status === 'accepted') ? createElement('button', { type: 'button', onClick: cancelRegenerate, style: { ...compactButtonStyle(), marginLeft: 'auto' }, 'data-mm-action': 'true' }, '取消') : null,
        ) : null,
        record ? createElement('div', { style: { display: 'flex', flexDirection: 'column', position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' } },
          createElement(MapCanvas, { key: mountKeyOf(record), record, onDocumentChange: persistDocument, onActions: setMapActions, onFullscreenChange: () => undefined, onNodeSelect: selectNode }),
          createElement('div', { 'data-mm-glass': 'true', style: { ...glassSurfaceStyle(), position: 'absolute', right: '16px', bottom: '16px', zIndex: 2, display: 'flex', alignItems: 'center', gap: '1px', padding: '3px', borderRadius: '999px' } },
            createElement('button', { type: 'button', disabled: !mapActions, onClick: () => mapActions?.zoomOut(), style: zoomButtonStyle(), 'aria-label': '缩小画布', 'data-mm-action': 'true' }, '−'),
            createElement('button', { type: 'button', disabled: !mapActions, onClick: () => mapActions?.zoomIn(), style: zoomButtonStyle(), 'aria-label': '放大画布', 'data-mm-action': 'true' }, '＋'),
          ),
        ) : createElement('div', { style: { display: 'grid', placeItems: 'center', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'auto' } }, createElement(EmptyState, { kind: galleryState === 'failed' ? 'capability' : scope === 'workspace' ? 'workspace' : 'session', localeId: resolveLocale(undefined, typeof navigator !== 'undefined' ? navigator.language : undefined), onCreate: galleryState === 'ready' && scope === 'session' ? openCreateFromGuide : undefined, onOpenGuide: galleryState === 'ready' && scope === 'session' ? openGuide : undefined })),
      ),
      utilityVisible && record ? inspectorVisible
        ? createElement(NodeInspector, { record, nodeDraft, onDraftChange: (next) => setNodeDraft(next), onSave: saveNode, onClose: cancelNodeDraft, onVisualConfig: visualConfig })
        : createElement(MorePanel, { mapActions, record, onClose: () => setActivePopover(null), onRestore: restorePrevious, onArchive: archiveCurrent, onDelete: deleteCurrent })
        : null,
    ),
    regenOpen && record ? createElement(RegenerateModal, { record, panelRunning: regenerateUnavailableWhileRunning(panelRun), sessionAvailable: Boolean(props.sessions.binding(sessionId)?.session), draft: regenDraft, onDraftChange: setRegenDraft, onClose: () => setRegenOpen(false), onConfirm: () => regenerate(regenDraft) }) : null,
    createElement(MindmapGuide, { open: guideOpen, localeId: resolveLocale(undefined, typeof navigator !== 'undefined' ? navigator.language : undefined), hasMap: record !== null, onDismiss: dismissGuide, onCreate: openCreateFromGuide, onOpenInspector: openInspectorFromGuide, onOpenMore: openMoreFromGuide }),
    createElement('span', { role: 'status', 'data-mm-glass': 'true', style: { ...glassSurfaceStyle(), position: 'absolute', left: sidebarOpen ? (sidebarCompact ? '84px' : '272px') : '20px', bottom: '18px', zIndex: 3, maxWidth: 'min(520px, calc(100% - 48px))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '5px 9px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px', pointerEvents: 'none' } }, status),
  )
}
export { BrainmapView }
