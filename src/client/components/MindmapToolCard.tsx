import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useEffect, useState, type ReactElement } from 'react'
import type { MindmapDocument, MindmapNode } from '../../core.js'
import { cardStateOf, CARD_EXPIRED_NOTE, type CardReference, type CardState } from '../card-state.js'
import { getBlobUrlLru } from './blob-url-lru.js'

// ---------------------------------------------------------------------------
// S3-W4 componentized mindmap tool card. The SVG shown here ALWAYS originates
// from a Host-validated snapshot document fetched through the fetcher injected
// via registerSnapshotFetcher() and is exported locally by simple-mind-map.
// Model-provided markup is never rendered: SAST source-contract tests keep
// this file free of raw-HTML escape hatches and embedded frame elements.
// ---------------------------------------------------------------------------

type MindmapConfig = { layout: string; density: string; maxNodes: number; theme: string; font: string; instruction: string; language: string; contextLimit: number }
export type MindmapPreviewPayload = { libraryId: string; revisionId: string; title: string; document: MindmapDocument; config: MindmapConfig }
export type SnapshotFetcher = (libraryId: string, revisionId: string) => Promise<MindmapPreviewPayload>

let snapshotFetcher: SnapshotFetcher | null = null

/** Dependency injection seam (R1-4): apply() wires this to the plugin api(). */
export function registerSnapshotFetcher(fetcher: SnapshotFetcher): () => void {
  snapshotFetcher = fetcher
  return () => {
    if (snapshotFetcher === fetcher) snapshotFetcher = null
  }
}

const PREVIEW_PREFIX = 'dsh-chat-mindmap-preview:'

export function previewReference(block: ToolCallViewProps['block']): CardReference | null {
  if (!('kind' in block)) return null
  for (const item of block.content) {
    if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'text' || !('text' in item) || typeof item.text !== 'string') continue
    if (!item.text.startsWith(PREVIEW_PREFIX)) continue
    try {
      const value = JSON.parse(item.text.slice(PREVIEW_PREFIX.length)) as Partial<CardReference>
      if (typeof value.libraryId === 'string' && typeof value.revisionId === 'string' && typeof value.title === 'string' && typeof value.nodeCount === 'number' && (value.state === 'available' || value.state === 'expired')) return value as CardReference
    } catch {
      // A generic tool card remains available for malformed old history.
    }
  }
  return null
}

type MindMapLike = {
  doExport?: { export(type: string, download: boolean, ...args: unknown[]): Promise<unknown> }
  getData?(withConfig?: boolean): unknown
  destroy?(): void
}
type MindMapCtor = new (options: Record<string, unknown>) => MindMapLike

async function loadMindMap(): Promise<MindMapCtor> {
  const module = await import('../mindmap.js') as unknown as { default: MindMapCtor }
  return module.default
}

function toSimpleMindMapData(node: MindmapNode): unknown {
  return {
    data: { text: node.title, id: node.id, ...(node.note ? { note: node.note } : {}), ...(node.collapsed ? { expand: false } : {}) },
    children: (node.children ?? []).map(toSimpleMindMapData),
  }
}

function asBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value
  if (typeof value !== 'string' || !value.startsWith('data:')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const meta = value.slice(5, comma)
  const payload = value.slice(comma + 1)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  try {
    if (meta.endsWith(';base64')) return new Blob([Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))], { type: mime })
    return new Blob([decodeURIComponent(payload)], { type: mime })
  } catch {
    return null
  }
}

// Verbatim copy of the gallery THEME_PRESETS lookup: the card thumbnail must
// render with the same theme the canvas would choose. Kept local so this
// module stays free of index.ts coupling (no import cycle); Phase 4 deletes
// the remaining duplicate surface together with the legacy inline card path.
const CARD_THEME_PRESETS: Record<string, Record<string, unknown>> = {
  default: {},
  classic4: { backgroundColor: '#fffdf5', lineColor: '#8b7355', generalizationLineColor: '#8b7355', root: { fillColor: '#8b7355', color: '#fff', borderColor: '#6f5a43' }, second: { fillColor: '#f5ead7', color: '#4a3828', borderColor: '#c9a66b' }, node: { color: '#5c4632', borderColor: 'transparent' } },
  ocean: { backgroundColor: '#eff6ff', lineColor: '#2563eb', generalizationLineColor: '#2563eb', root: { fillColor: '#1d4ed8', color: '#fff', borderColor: '#1e40af' }, second: { fillColor: '#dbeafe', color: '#1e3a8a', borderColor: '#60a5fa' }, node: { color: '#1e3a8a', borderColor: 'transparent' } },
  forest: { backgroundColor: '#f0fdf4', lineColor: '#15803d', generalizationLineColor: '#15803d', root: { fillColor: '#166534', color: '#fff', borderColor: '#14532d' }, second: { fillColor: '#dcfce7', color: '#14532d', borderColor: '#4ade80' }, node: { color: '#166534', borderColor: 'transparent' } },
  sunset: { backgroundColor: '#fff7ed', lineColor: '#ea580c', generalizationLineColor: '#ea580c', root: { fillColor: '#c2410c', color: '#fff', borderColor: '#9a3412' }, second: { fillColor: '#ffedd5', color: '#7c2d12', borderColor: '#fb923c' }, node: { color: '#9a3412', borderColor: 'transparent' } },
  lavender: { backgroundColor: '#faf5ff', lineColor: '#9333ea', generalizationLineColor: '#9333ea', root: { fillColor: '#7e22ce', color: '#fff', borderColor: '#6b21a8' }, second: { fillColor: '#f3e8ff', color: '#581c87', borderColor: '#c084fc' }, node: { color: '#6b21a8', borderColor: 'transparent' } },
  graphite: { backgroundColor: '#f8fafc', lineColor: '#475569', generalizationLineColor: '#475569', root: { fillColor: '#334155', color: '#fff', borderColor: '#1e293b' }, second: { fillColor: '#e2e8f0', color: '#1e293b', borderColor: '#94a3b8' }, node: { color: '#334155', borderColor: 'transparent' } },
  rose: { backgroundColor: '#fff1f2', lineColor: '#e11d48', generalizationLineColor: '#e11d48', root: { fillColor: '#be123c', color: '#fff', borderColor: '#9f1239' }, second: { fillColor: '#ffe4e6', color: '#881337', borderColor: '#fb7185' }, node: { color: '#9f1239', borderColor: 'transparent' } },
  amber: { backgroundColor: '#fffbeb', lineColor: '#d97706', generalizationLineColor: '#d97706', root: { fillColor: '#b45309', color: '#fff', borderColor: '#92400e' }, second: { fillColor: '#fef3c7', color: '#78350f', borderColor: '#fbbf24' }, node: { color: '#78350f', borderColor: 'transparent' } },
  contrast: { backgroundColor: '#fff', lineColor: '#111827', generalizationLineColor: '#111827', root: { fillColor: '#111827', color: '#fff', borderColor: '#000' }, second: { fillColor: '#fff', color: '#111827', borderColor: '#111827' }, node: { color: '#111827', borderColor: 'transparent' } },
}

async function renderSvgBlob(document: MindmapDocument, config: MindmapConfig): Promise<Blob | null> {
  const host = window.document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1200px;height:800px;pointer-events:none;'
  window.document.body.append(host)
  let instance: MindMapLike | null = null
  try {
    const MindMap = await loadMindMap()
    instance = new MindMap({ el: host, data: toSimpleMindMapData(document.root), layout: config.layout, theme: 'default', themeConfig: CARD_THEME_PRESETS[config.theme] ?? {}, fit: true })
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
    const value = await instance.doExport?.export('svg', false, document.title, instance.getData?.(false))
    return asBlob(value)
  } catch {
    return null
  } finally {
    instance?.destroy?.()
    host.remove()
  }
}

/** Presentational body: pure function of (reference, url, error). Directly assertable via renderToStaticMarkup. */
export function CardBody(props: { reference: CardReference | null; url: string | null; error: string | null }): ReactElement {
  const state: CardState = cardStateOf(props.reference, props.url, props.error)
  const reference = props.reference
  if (!reference) return <div style={{ padding: '8px', opacity: 0.7 }}>{state.note}</div>
  if (state.kind === 'expired') return <div style={{ padding: '8px', opacity: 0.7 }}>{CARD_EXPIRED_NOTE}</div>
  return (
    <section style={{ padding: '10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', maxWidth: '620px' }}>
      <strong>{reference.title}</strong>
      <small style={{ display: 'block', opacity: 0.7, marginBottom: '8px' }}>{reference.nodeCount} 节点 · SVG 预览</small>
      {reference.capabilityNote ? <small style={{ display: 'block', opacity: 0.62, marginBottom: '8px' }} role='note'>{reference.capabilityNote}</small> : null}
      {state.kind === 'failed' ? <span role='status'>{state.note}</span> : null}
      {state.kind === 'loading' ? <span role='status'>正在生成 SVG 预览…</span> : null}
      {state.kind === 'ready' && props.url ? (
        <button
          type='button'
          style={{ display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }}
          aria-label={'打开 ' + reference.title + ' SVG 预览'}
        >
          <img src={props.url} alt={reference.title + ' 思维导图'} style={{ display: 'block', maxWidth: '100%', maxHeight: '360px', background: 'var(--dsw-alias-bg-base,#fff)', borderRadius: '6px' }} />
        </button>
      ) : null}
    </section>
  )
}

export function MindmapToolCard({ block }: ToolCallViewProps): ReactElement {
  const reference = previewReference(block)
  const key = reference ? reference.libraryId + ':' + reference.revisionId : ''
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setError(null)
    setUrl(null)
    if (!reference || reference.state === 'expired') return () => undefined
    const fetcher = snapshotFetcher
    const lru = getBlobUrlLru()
    const cached = lru.get(key)
    if (cached !== undefined) {
      setUrl(cached)
      return () => undefined
    }
    if (!fetcher) {
      setError('脑图预览通道未就绪')
      return () => undefined
    }
    void fetcher(reference.libraryId, reference.revisionId)
      .then(async (payload) => {
        const blob = await renderSvgBlob(payload.document, payload.config)
        if (!blob) throw new Error('SVG preview export failed')
        // LRU owns the URL lifecycle: unmount must not revoke (R2-2).
        if (!alive) return
        setUrl(lru.put(key, blob))
      })
      .catch(() => {
        if (alive) setError('脑图预览已失效或无法生成')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reference?.state])
  return <CardBody reference={reference} url={url} error={error} />
}
