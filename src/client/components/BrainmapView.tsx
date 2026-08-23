import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createElement, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { buildMindmap, type MindmapDocument, type MindmapNode } from '../../core.js'
import { ApiError, api, listQueryOf } from '../api.js'
import { svgPreviewHtml } from '../preview/artifact-html.js'
import { DswButton, DswStateDot } from './ui/primitives.js'
import { LAYOUT_OPTIONS, THEME_PRESETS, shellThemeConfig, shellIsDark } from '../canvas-theme.js'
import { createT, resolveLocale } from '../locale.js'

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
type PanelRunView = { runId: string; libraryId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; detail: string; noteLength?: number; childId?: string; revisionId?: string }
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
function panelStyle(): Record<string, string> { return { display: 'flex', flexDirection: 'column', width: '100%', minWidth: '0', height: '100%', minHeight: '0', flex: '1 1 0', overflow: 'hidden', padding: '0', background: 'var(--dsw-alias-bg-base,#f7f8fa)', color: 'var(--dsw-alias-label-primary,#202124)', font: '13px/1.45 system-ui,sans-serif' } }
function buttonStyle(): Record<string, string> { return { border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', background: 'var(--dsw-alias-button-tool-bar-fill,#fff)', color: 'inherit', borderRadius: '4px', padding: '5px 8px', cursor: 'pointer', transition: 'all .18s ease', fontSize: '13px' } }
function inputStyle(): Record<string, string> { return { display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', background: 'var(--dsw-alias-bg-base,#fff)', color: 'inherit' } }
function zoomButtonStyle(): Record<string, string> { return { border: '0', background: 'transparent', color: 'inherit', borderRadius: '4px', minWidth: '28px', padding: '4px 5px', cursor: 'pointer', font: 'inherit' } }
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
      '[data-toolbar-regenerate]:hover:not(:disabled){filter:brightness(1.12);transform:translateY(-1px)}',
      '[data-toolbar-regenerate]:active:not(:disabled){transform:translateY(0)}',
      'button:hover:not(:disabled){filter:brightness(.96)}',
      'button:disabled{opacity:.45;cursor:not-allowed}',
      'aside{transition:width .22s ease,padding .22s ease}',
      '.item:hover{filter:brightness(.97)}',
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
export function EmptyState({ kind, localeId }: { kind: EmptyKind; localeId?: string }): ReactElement {
  const t = createT(localeId)
  const icon = kind === 'capability' ? '\u26A0\uFE0F' : kind === 'workspace' ? '\uD83D\uDDC2\uFE0F' : '\uD83E\uDDF6'
  const titleKey = kind === 'capability' ? 'empty.capability.title' : kind === 'workspace' ? 'empty.workspace.title' : 'empty.session.title'
  const bodyKey = kind === 'capability' ? 'empty.capability.body' : kind === 'workspace' ? 'empty.workspace.body' : 'empty.session.body'
  return createElement('section', { style: { display: 'grid', placeItems: 'center', minHeight: '480px', gap: '10px' } },
    createElement('span', { style: { fontSize: '42px', opacity: .35 } }, icon),
    createElement('strong', { style: { fontSize: '16px' } }, t(titleKey)),
    createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#94a3b8)', maxWidth: '320px', textAlign: 'center' } }, t(bodyKey)))
}

export const regenerateUnavailableWhileRunning = (panelRun: PanelRunView | null | undefined): boolean => panelRun !== undefined && panelRun !== null && panelRun.status === 'running'

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

function BrainmapView(props: ConvViewProps & { sessions: SessionService }): ReactElement {
  const sessionId = props.sessionId
  const [maps, setMaps] = useState<MindmapSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [record, setRecord] = useState<MindmapRecord | null>(null)
  const [galleryState, setGalleryState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [status, setStatus] = useState('正在打开脑图库…')
  const [showCreate, setShowCreate] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [scope, setScope] = useState<'session' | 'workspace'>('session')
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
  useEffect(() => { recordRef.current = record }, [record])
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
    const key = scope + ':' + (showArchived ? 'archived' : 'active')
    const request = !force && galleryRequestRef.current?.key === key
      ? galleryRequestRef.current.promise
      : api<MindmapSummary[]>(listQueryOf(scope, sessionId, showArchived))
    galleryRequestRef.current = { key, promise: request }
    void request.then((next) => {
      if (!active) return
      setMaps(next)
      setSelectedId((prev) => prev && next.some((item) => item.libraryId === prev) ? prev : next[0]?.libraryId)
      setGalleryState('ready')
      setStatus(`${next.length} 张${showArchived ? '已归档' : '活动'}脑图（${scope === 'workspace' ? '全部工作区' : '本会话'}）`)
    }).catch((error) => {
      if (!active) return
      if (galleryRequestRef.current?.promise === request) galleryRequestRef.current = null
      setGalleryState('failed')
      setStatus(`图库加载失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => { active = false }
  }, [scope, showArchived])
  useEffect(() => refresh(), [refresh])
  useEffect(() => { if (!selectedId) { setRecord(null); setInstruction(''); return }; void api<MindmapRecord>(`/maps/${encodeURIComponent(selectedId)}?sessionId=${encodeURIComponent(sessionId ?? '')}`).then((next) => { setRecord(next); setInstruction(next.config.instruction ?? '') }).catch((error) => setStatus(String(error))) }, [selectedId])
  useEffect(() => {
    if (!panelRun || panelRun.status !== 'running') return
    let active = true
    const poll = () => void api<PanelRunView>(`/panel-runs/${encodeURIComponent(panelRun.runId)}`).then((next) => {
      if (!active) return
      setPanelRun(next); setStatus(next.detail)
      if (next.status === 'completed') { void api<MindmapRecord>(`/maps/${encodeURIComponent(next.libraryId)}`).then((updated) => { if (active) { setRecord(updated); void refresh(true) } }) }
    }).catch((error) => { if (active) setStatus(`重新生成状态读取失败：${String(error)}`) })
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
    void api<MindmapRecord>(`/maps/${encodeURIComponent(current.libraryId)}`, { method: 'PATCH', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document, rotatePrevious: false, expectedRecordVersion: current.recordVersion }) }).then((next) => {
      if (!shouldApplyAutosave(seq, autosaveSeq.current, controller.signal.aborted)) return
      setRecord((prev) => prev ? { ...prev, updatedAt: next.updatedAt, current: next.current, previous: next.previous, recordVersion: next.recordVersion } : next)
      setStatus('已自动保存当前手动修改')
    }).catch((error) => {
      if (controller.signal.aborted || !shouldApplyAutosave(seq, autosaveSeq.current, false)) return
      if (error instanceof ApiError && error.code === 'MINDMAP_CONFLICT') {
        setStatus('检测到版本冲突：本次修改未写入，已刷新最新内容')
        void api<MindmapRecord>(`/maps/${encodeURIComponent(current.libraryId)}`).then((latest) => setRecord(latest)).catch(() => undefined)
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
    if (!panelRun || panelRun.status !== 'running') return
    void api<{ runId: string; status: string }>(`/panel-runs/${encodeURIComponent(panelRun.runId)}`, { method: 'DELETE' })
      .then(() => setStatus('正在取消 fork 子代理…'))
      .catch((error) => setStatus(`取消失败：${String(error)}`))
  }
  const visualConfig = (config: Partial<MindmapConfig>) => {
    if (!record) return
    const before = record
    setRecord({ ...record, config: { ...record.config, ...config } })
    setStatus('正在应用外观配置…')
    void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config, expectedRecordVersion: record.recordVersion }) })
      .then((next) => { setRecord(next); setStatus('外观已立即应用并保存') })
      .catch((error) => {
        setRecord(before)
        if (error instanceof ApiError && error.code === 'MINDMAP_CONFLICT') { void api<MindmapRecord>('/maps/' + encodeURIComponent(record.libraryId)).then((latest) => setRecord(latest)).catch(() => undefined); setStatus('外观保存遇到版本冲突，已刷新'); return }
        setStatus('外观保存失败：' + (error instanceof Error ? error.message : String(error)))
      })
  }
  const selectNode = (node: SelectedNode | null) => {
    setSelectedNode(node)
    setNodeDraft(node)
    if (node) setInspectorOpen(true)
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
  return createElement('main', { style: panelStyle() },
    createElement('header', { style: { height: '48px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '7px', padding: '0 14px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2c3445)', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#111827))' } }, createElement('button', { type: 'button', onClick: () => setSidebarOpen((open) => !open), style: buttonStyle(), 'aria-label': sidebarOpen ? '收起脑图库' : '展开脑图库', title: sidebarOpen ? '收起脑图库' : '展开脑图库' }, sidebarOpen ? '‹' : '☰'), createElement('button', { type: 'button', onClick: () => setScope('session'), style: { ...buttonStyle(), borderColor: scope === 'session' ? 'var(--dsw-alias-brand-primary,#14b8a6)' : undefined }, 'aria-pressed': scope === 'session', title: '只显示当前会话的脑图' }, '本会话'), createElement('button', { type: 'button', onClick: () => setScope('workspace'), style: { ...buttonStyle(), borderColor: scope === 'workspace' ? 'var(--dsw-alias-brand-primary,#14b8a6)' : undefined }, 'aria-pressed': scope === 'workspace', title: '显示当前工作区的全部脑图' }, '全部'), narrowLayout && maps.length > 0 ? createElement('select', { value: selectedId ?? '', onChange: (event: ChangeEvent<HTMLSelectElement>) => setSelectedId(event.target.value), style: { ...inputStyle(), width: 'auto', maxWidth: '38%' }, 'aria-label': '选择脑图' }, maps.map((item) => createElement('option', { key: item.libraryId, value: item.libraryId }, item.title))) : null, createElement('strong', { style: { marginRight: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, record?.title ?? '脑图'), galleryState === 'loading' ? createElement('small', { role: 'status', style: { color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, '读取图库…') : null, galleryState === 'failed' ? createElement('button', { type: 'button', onClick: () => void refresh(true), style: buttonStyle() }, '重试') : null, createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.undo(), style: buttonStyle(), title: '撤销 Ctrl+Z', 'aria-label': '撤销 Ctrl+Z' }, '↶'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.redo(), style: buttonStyle(), title: '重做 Ctrl+Shift+Z', 'aria-label': '重做 Ctrl+Shift+Z' }, '↷'), createElement('button', { type: 'button', onClick: () => setInspectorOpen((open) => !open), style: buttonStyle(), title: '节点属性', 'aria-label': '打开节点属性' }, '☷'), createElement(DswButton, { variant: 'primary', disabled: regenerateUnavailableWhileRunning(panelRun) || !record, onClick: () => { setRegenDraft(instruction); setRegenOpen(true) }, title: '重新生成（fork 子代理）', 'aria-label': '重新生成脑图', 'data-toolbar-regenerate': 'true' }, '\u2726 重新生成'), createElement('details', { style: { position: 'relative' } }, createElement('summary', { style: { ...buttonStyle(), listStyle: 'none', userSelect: 'none' }, 'aria-label': '更多操作' }, '···'), createElement('div', { style: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 5, display: 'grid', gap: '5px', minWidth: '142px', padding: '7px', border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', borderRadius: '4px', background: 'var(--dsw-alias-bg-base,#fff)', boxShadow: '0 10px 24px var(--dsw-shadow-lv3,rgba(0,0,0,.14))' } }, createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.expandAll(), style: buttonStyle() }, '全部展开'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.collapseAll(), style: buttonStyle() }, '全部折叠'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.collapseToLevel(2), style: buttonStyle() }, '折叠至第 2 层'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.openSvgPreview(), style: buttonStyle() }, '预览 SVG'), createElement('hr', { style: { width: '100%', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1,#2c3445)' } }), createElement('button', { type: 'button', onClick: () => downloadBlob(new Blob([JSON.stringify(record?.current, null, 2)], { type: 'application/json' }), safeFilename(record?.title ?? 'mindmap', 'json')), style: buttonStyle() }, '导出 JSON'), createElement('button', { type: 'button', onClick: () => record && downloadBlob(new Blob([markdown(record.current.root)], { type: 'text/markdown' }), safeFilename(record.title, 'md')), style: buttonStyle() }, '导出 Markdown'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.exportXmind(), style: buttonStyle() }, '导出 XMind'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.exportPng(), style: buttonStyle() }, '导出 PNG'), createElement('hr', { style: { width: '100%', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1,#2c3445)' } }), ...(record?.previous ? [createElement('button', { key: 'restore', type: 'button', onClick: restorePrevious, style: buttonStyle() }, '恢复重新生成前版本')] : []), createElement('button', { key: 'archive', type: 'button', onClick: archiveCurrent, style: buttonStyle() }, '归档'), createElement('button', { key: 'delete', type: 'button', onClick: deleteCurrent, style: buttonStyle() }, '删除'))), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.toggleFullscreen(), style: buttonStyle(), title: '全屏画布', 'aria-label': '全屏画布' }, '⛶')),
    showCreate && createElement('section', { style: { padding: '8px', marginBottom: '8px', border: '1px solid var(--dsw-alias-border-l1,#334155)', borderRadius: '8px' } }, createElement('textarea', { rows: 5, value: manualText, placeholder: '粘贴文本或 Markdown（也可以让 Agent 从 PDF/附件生成）', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setManualText(event.target.value), style: { ...inputStyle(), resize: 'vertical' } }), createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } }, '最多节点', createElement('select', { value: draftMaxNodes, onChange: (event: ChangeEvent<HTMLSelectElement>) => setDraftMaxNodes(Number(event.target.value)), style: { ...inputStyle(), width: 'auto' }, 'aria-label': '新脑图最多节点' }, [120, 240, 360, 600, 1_000].map((count) => createElement('option', { key: count, value: count }, `${count}`)))), createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, createElement('button', { type: 'button', disabled: createPhase !== 'idle', onClick: createMap, style: buttonStyle() }, createPhase === 'generating' ? '生成草稿中…' : createPhase === 'saving' ? '保存中…' : '生成并保存'), createPhase === 'generating' ? createElement('button', { type: 'button', onClick: () => { createControllerRef.current?.abort(); setStatus('正在取消未保存草稿…') }, style: buttonStyle() }, '取消') : createElement('button', { type: 'button', disabled: createPhase === 'saving', onClick: () => { setShowCreate(false); setManualText(''); setInstruction(''); setStatus(createPhase === 'saving' ? '脑图正在保存；保存完成后会显示在图库中' : '已取消创建，未保存任何内容') }, style: buttonStyle() }, createPhase === 'saving' ? '保存中' : '取消'))),
    createElement('div', { ref: workspaceRef, style: { display: 'grid', gridTemplateColumns: sidebarOpen ? (workspaceWidth > 0 && workspaceWidth < 900 ? '56px minmax(0,1fr)' : '228px minmax(0,1fr)') : '0px minmax(0,1fr)', position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#23262d))' } },
      createElement('aside', { style: { overflow: sidebarOpen ? 'auto' : 'hidden', padding: workspaceWidth > 0 && workspaceWidth < 900 ? '8px 4px' : '12px 9px', borderRight: '1px solid var(--dsw-alias-border-l1,#2c3445)', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#171e2e))' } }, createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' } }, createElement('strong', null, '脑图库'), createElement('button', { type: 'button', onClick: () => setShowCreate((value) => !value), style: { ...buttonStyle(), marginLeft: 'auto' }, 'aria-label': '新建脑图' }, '＋')), createElement('input', { value: search, placeholder: '搜索脑图', onChange: (event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value), style: { ...inputStyle(), marginBottom: '10px' }, 'aria-label': '搜索脑图' }), maps.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((item) => createElement('button', { key: item.libraryId, type: 'button', onClick: () => setSelectedId(item.libraryId), title: item.title, style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 7px', marginBottom: '1px', border: 0, borderLeft: selectedId === item.libraryId ? '3px solid var(--dsw-alias-brand-primary,#14b8a6)' : '3px solid transparent', borderRadius: 0, background: selectedId === item.libraryId ? 'var(--dsw-alias-interactive-bg-hover,rgba(20,184,166,.10))' : 'transparent', color: 'inherit', cursor: 'pointer' } }, createElement('strong', { style: { display: 'block', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title), createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, `${item.nodeCount} nodes · ${item.source?.kind?.toUpperCase() ?? 'MAP'}`))), createElement('button', { type: 'button', onClick: () => setShowArchived((value) => !value), style: { ...buttonStyle(), marginTop: '10px' } }, showArchived ? '查看活动脑图' : '查看归档脑图')),
       record ? createElement('section', { style: { minWidth: 0, minHeight: 0, flex: '1 1 0', display: 'flex', flexDirection: 'column', gap: 0 } },
        panelRun?.libraryId === record.libraryId ? createElement('div', { role: 'status', style: { /* @token-exempt-line TODO(W3): status tint palette awaits official feedback tokens */ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', borderRadius: '7px', background: panelRun.status === 'failed' ? 'rgba(127,29,29,.38)' : panelRun.status === 'completed' ? 'rgba(6,78,59,.38)' : 'rgba(30,41,59,.72)', border: '1px solid #475569' } }, createElement('strong', null, panelRun.status === 'running' ? [createElement(DswStateDot, { key: 'dot', tone: 'running', label: '运行中' }), ' Fork 子代理运行中'] : panelRun.status === 'completed' ? [createElement(DswStateDot, { key: 'dot', tone: 'ok', label: '完成' }), ' 重新生成完成'] : panelRun.status === 'cancelled' ? '重新生成已取消' : '重新生成失败'), createElement('span', { style: { opacity: .78 } }, panelRun.detail, panelRun.noteLength ? ` · 已传入 ${panelRun.noteLength} 字备注` : null), panelRun.childId ? createElement('code', { style: { opacity: .62, fontSize: '11px' } }, `子代理 ${panelRun.childId}`) : null, panelRun.status === 'running' ? createElement('button', { type: 'button', onClick: cancelRegenerate, style: { ...buttonStyle(), marginLeft: 'auto' } }, '取消') : null) : null,
      createElement('div', { style: { display: 'flex', flexDirection: 'column', position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' } }, createElement(MapCanvas, { key: mountKeyOf(record), record, onDocumentChange: persistDocument, onActions: setMapActions, onFullscreenChange: () => undefined, onNodeSelect: selectNode }), createElement('div', { style: { position: 'absolute', right: '16px', bottom: '16px', zIndex: 2, display: 'flex', alignItems: 'center', gap: '2px', padding: '3px 5px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 78%, transparent)', borderRadius: '999px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1,#171e2e) 86%, transparent)', boxShadow: 'var(--dsw-shadow-lv3,0 4px 14px rgba(0,0,0,.12))', backdropFilter: 'blur(8px)' } }, createElement('button', { type: 'button', disabled: !mapActions, onClick: () => mapActions?.zoomOut(), style: zoomButtonStyle(), 'aria-label': '缩小画布' }, '−'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => mapActions?.zoomIn(), style: zoomButtonStyle(), 'aria-label': '放大画布' }, '＋'))))
        : createElement(EmptyState, { kind: galleryState === 'failed' ? 'capability' : scope === 'workspace' ? 'workspace' : 'session', localeId: resolveLocale(undefined, typeof navigator !== 'undefined' ? navigator.language : undefined) })),
    inspectorOpen ? createElement('aside', { style: { position: 'absolute', top: '16px', right: '16px', bottom: '16px', zIndex: 4, width: 'min(300px, calc(100% - 276px))', overflow: 'auto', boxSizing: 'border-box', padding: '16px', border: '1px solid var(--dsw-alias-border-l1,#2c3445)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#171e2e))', boxShadow: 'var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.30))' } }, createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '16px' } }, createElement('strong', null, '节点属性'), createElement('button', { type: 'button', onClick: cancelNodeDraft, style: { ...buttonStyle(), marginLeft: 'auto' }, 'aria-label': '收起节点属性' }, '×')), nodeDraft ? createElement('div', { style: { display: 'grid', gap: '12px' } }, createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, '标题'), createElement('input', { value: nodeDraft.title, onChange: (event: ChangeEvent<HTMLInputElement>) => setNodeDraft({ ...nodeDraft, title: event.target.value }), style: inputStyle(), 'aria-label': '节点标题' })), createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, `备注 · ${nodeDraft.note.length} 字`), createElement('textarea', { rows: 8, value: nodeDraft.note, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setNodeDraft({ ...nodeDraft, note: event.target.value }), placeholder: '添加节点备注', style: { ...inputStyle(), resize: 'vertical' }, 'aria-label': '节点备注' })), createElement('div', { style: { display: 'flex', gap: '6px' } }, createElement('button', { type: 'button', onClick: saveNode, style: { /* @token-exempt-line TODO(W3): on-brand text pair awaits official tokens */ ...buttonStyle(), background: '#14b8a6', color: '#fff', borderColor: '#14b8a6' } }, '保存'), createElement('button', { type: 'button', onClick: cancelNodeDraft, style: buttonStyle() }, '取消'))) : createElement('div', { style: { display: 'grid', gap: '12px' } }, createElement('p', { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)', margin: 0 } }, '选择一个节点以编辑标题和备注。'), record ? createElement('section', { style: { display: 'grid', gap: '9px', paddingTop: '10px', borderTop: '1px solid #e8eaed' } }, createElement('strong', null, '脑图样式'), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, '结构'), createElement('select', { value: record.config.layout, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ layout: event.target.value }), style: inputStyle(), 'aria-label': '脑图结构' }, LAYOUT_OPTIONS.map(([value, label]) => createElement('option', { key: value, value }, label)))), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', { style: { color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, '主题'), createElement('select', { value: record.config.theme, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ theme: event.target.value }), style: inputStyle(), 'aria-label': '脑图主题' }, Object.entries(THEME_PRESETS).map(([value, preset]) => createElement('option', { key: value, value }, preset.label)))) ) : null)) : null,
    regenOpen && record ? createElement(RegenerateModal, { record, panelRunning: regenerateUnavailableWhileRunning(panelRun), sessionAvailable: Boolean(props.sessions.binding(sessionId)?.session), draft: regenDraft, onDraftChange: setRegenDraft, onClose: () => setRegenOpen(false), onConfirm: () => regenerate(regenDraft) }) : null,
    createElement('span', { role: 'status', style: { position: 'absolute', left: '244px', bottom: '8px', zIndex: 3, maxWidth: 'calc(100% - 280px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 6px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px', pointerEvents: 'none' } }, status),
  )
}
export { BrainmapView }
