import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createElement, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import type { MindmapDocument, MindmapNode } from '../core.js'

const PLUGIN_ID = '@dsh-external/dsh-chat-mindmap'
const API_BASE = '/@dsh-external/dsh-chat-mindmap'
type ClientContext = Context & { slots: SlotRegistry; sessions: SessionService }
export const inject = ['slots', 'sessions']

type MindMapLike = {
  doExport?: { export(type: string, download: boolean, ...args: unknown[]): Promise<unknown> }
  resize(): void
  getData?(withConfig?: boolean): unknown
  on?(event: string, listener: (data?: unknown) => void): void
  off?(event: string, listener: (data?: unknown) => void): void
  destroy?(): void
}
type MindMapCtor = new (options: { el: HTMLElement; data: unknown; layout: string; theme?: string; fit?: boolean }) => MindMapLike
type MindmapConfig = { layout: string; density: string; maxNodes: number; theme: string; font: string; instruction: string; language: string; contextLimit: number }
type MindmapSource = { kind: string; name?: string; attachmentId?: string; sessionId?: string; workspaceId?: string }
type MindmapRecord = { libraryId: string; title: string; current: MindmapDocument; previous?: MindmapDocument; config: MindmapConfig; source?: MindmapSource; archived?: boolean; updatedAt: string }
type MindmapSummary = { libraryId: string; title: string; source?: MindmapSource; config: MindmapConfig; updatedAt: string; hasPrevious: boolean; archived: boolean; nodeCount: number }
type SessionService = { binding(id: string): { session?: { getSnapshot(): ConversationSnapshot; loadOlder(): Promise<void> } } | undefined }
type ApiPayload<T> = { ok?: boolean; value?: T; error?: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  const payload = await response.json() as ApiPayload<T>
  if (!response.ok || !payload.ok || payload.value === undefined) throw new Error(payload.error ?? '脑图服务请求失败')
  return payload.value
}

function countNodes(node: MindmapNode): number { return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0) }
function toSimpleMindMapData(node: MindmapNode): unknown { return { data: { text: node.title, id: node.id, ...(node.note ? { note: node.note } : {}) }, children: (node.children ?? []).map(toSimpleMindMapData) } }
function fromSimpleMindMapNode(raw: unknown): MindmapNode | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { id?: unknown; data?: { id?: unknown; text?: unknown; note?: unknown }; children?: unknown[] }
  const title = typeof value.data?.text === 'string' ? value.data.text : ''
  if (!title) return null
  return { id: typeof value.id === 'string' ? value.id : typeof value.data?.id === 'string' ? value.data.id : `node-${Math.random().toString(36).slice(2)}`, title, ...(typeof value.data?.note === 'string' ? { note: value.data.note } : {}), children: (value.children ?? []).map(fromSimpleMindMapNode).filter((child): child is MindmapNode => child !== null) }
}
function markdown(node: MindmapNode, depth = 0): string { return [`${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`, ...(node.children ?? []).map((child) => markdown(child, depth + 1))].join('\n') }
function downloadBlob(blob: Blob, filename: string): void { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
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
function snapshotText(snapshot: ConversationSnapshot, maxChars = 80_000): string {
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
  const result = lines.join('\n')
  return result.length > maxChars ? `${result.slice(0, maxChars)}\n[上下文已截断，避免重新生成浪费 token]` : result
}
function panelStyle(): Record<string, string> { return { display: 'flex', flexDirection: 'column', minHeight: '100%', padding: '12px', background: 'var(--dsw-alias-bg-base,#0f172a)', color: 'var(--dsw-alias-label-primary,#f8fafc)', font: '13px/1.45 system-ui,sans-serif' } }
function buttonStyle(): Record<string, string> { return { border: '1px solid var(--dsw-alias-border-l2,#475569)', background: 'var(--dsw-alias-button-tool-bar-fill,#1e293b)', color: 'inherit', borderRadius: '6px', padding: '6px 9px', cursor: 'pointer' } }
function inputStyle(): Record<string, string> { return { display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'inherit' } }

function MapCanvas({ record, onDocumentChange, onXmind }: { record: MindmapRecord; onDocumentChange: (document: MindmapDocument) => void; onXmind: (blob: Blob | null) => void }): ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MindMapLike | null>(null)
  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return () => { alive = false }
    canvas.replaceChildren()
    void loadMindMap().then((MindMap) => {
      if (!alive || !canvasRef.current) return
      const instance = new MindMap({ el: canvasRef.current, data: toSimpleMindMapData(record.current.root), layout: record.config.layout, theme: record.config.theme, fit: true })
      mapRef.current = instance
      const changed = () => {
        const raw = instance.getData?.(false) as { root?: unknown } | undefined
        const root = fromSimpleMindMapNode(raw?.root ?? raw)
        if (root) {
          if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
          const next = { ...record.current, root }
          saveTimer.current = window.setTimeout(() => onDocumentChange(next), 700)
        }
      }
      instance.on?.('data_change', changed)
      window.setTimeout(() => instance.resize(), 0)
      if (instance.doExport) void instance.doExport.export('xmind', false, record.title, instance.getData?.(false)).then((value) => { if (alive) onXmind(asBlob(value)) }).catch(() => onXmind(null))
    }).catch(() => onXmind(null))
    return () => { alive = false; if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); mapRef.current?.destroy?.(); mapRef.current = null; canvas.replaceChildren() }
  }, [record.libraryId])
  return createElement('div', { ref: canvasRef, style: { flex: 1, minHeight: '480px', borderRadius: '8px', overflow: 'hidden', background: '#fff' } })
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
  const sessionText = props.useSession((snapshot) => snapshotText(snapshot))

  const refresh = () => void api<MindmapSummary[]>(`/maps${showArchived ? '?archived=true' : ''}`).then((next) => { setMaps(next); if (!selectedId && next[0]) setSelectedId(next[0].libraryId); setStatus(`${next.length} 张${showArchived ? '已归档' : '活动'}脑图`) }).catch((error) => setStatus(String(error)))
  useEffect(refresh, [showArchived])
  useEffect(() => { if (!selectedId) { setRecord(null); return }; void api<MindmapRecord>(`/maps/${encodeURIComponent(selectedId)}`).then(setRecord).catch((error) => setStatus(String(error))) }, [selectedId])

  const persistDocument = (document: MindmapDocument) => {
    if (!record) return
    void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document, rotatePrevious: false }) }).then((next) => { setRecord((current) => current ? { ...current, updatedAt: next.updatedAt, current: next.current, previous: next.previous } : next); setStatus('已自动保存当前手动修改') }).catch((error) => setStatus(String(error)))
  }
  const createMap = () => {
    if (!manualText.trim()) { setStatus('请先输入文本或 Markdown'); return }
    setBusy(true)
    void api<{ document: MindmapDocument; libraryId: string }>('/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: manualText, title: manualText.split(/\r?\n/)[0]?.replace(/^#\s*/, ''), source: { kind: 'text', sessionId }, config: { instruction } }) }).then(() => { setShowCreate(false); setManualText(''); refresh(); setStatus('已创建脑图') }).catch((error) => setStatus(String(error))).finally(() => setBusy(false))
  }
  const regenerate = () => {
    if (!record) return
    const prompt = `请重新生成脑图「${record.title}」。调用 generate_chat_mindmap 时传入 libraryId=${record.libraryId}。请重新读取并提供源材料；当前手动编辑后的脑图 JSON 作为重生成基点如下：\n${JSON.stringify(record.current)}\n配置：${JSON.stringify({ ...record.config, instruction })}\n上下文应按需要截断，避免浪费 token。完成后用新结果覆盖 current，保留一个 previous。`
    const session = props.sessions.binding(sessionId)?.session
    if (!session) { setStatus('当前会话不可用，请在 Agent 对话中重新提供源材料'); return }
    void session
    props.inputActions.setDraft(prompt)
    setStatus('已把重新生成指令放入输入框；请发送，让 Agent 重新读取源材料并调用工具。')
  }
  const archive = () => { if (!record) return; void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}/archive`, { method: 'POST' }).then(() => { setSelectedId(undefined); refresh() }) }
  const restore = () => { if (!record) return; void api<MindmapRecord>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: false }) }).then(() => { setSelectedId(undefined); refresh() }) }
  const remove = () => { if (!record || !window.confirm('删除后不可恢复，确认删除？')) return; void api<{ deleted: boolean }>(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'DELETE' }).then(() => { setSelectedId(undefined); refresh() }) }
  const visualConfig = (config: Partial<MindmapConfig>) => { if (!record) return; void api<MindmapRecord>(`/maps/${record.libraryId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) }).then(setRecord) }

  return createElement('main', { style: panelStyle() },
    createElement('header', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, createElement('strong', null, '脑图库'), createElement('span', { style: { opacity: .65 } }, `${maps.length} 张`), createElement('button', { type: 'button', onClick: () => setShowArchived((value) => !value), style: buttonStyle() }, showArchived ? '活动脑图' : '归档'), createElement('button', { type: 'button', onClick: () => setShowCreate((value) => !value), style: { ...buttonStyle(), marginLeft: 'auto' } }, '新建')),
    showCreate && createElement('section', { style: { padding: '8px', marginBottom: '8px', border: '1px solid #334155', borderRadius: '8px' } }, createElement('textarea', { rows: 5, value: manualText, placeholder: '粘贴文本或 Markdown（也可以让 Agent 从 PDF/附件生成）', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setManualText(event.target.value), style: { ...inputStyle(), resize: 'vertical' } }), createElement('button', { type: 'button', disabled: busy, onClick: createMap, style: buttonStyle() }, busy ? '生成中…' : '生成并保存')),
    noteOpen && createElement('section', { style: { padding: '8px', marginBottom: '8px', border: '1px solid #334155', borderRadius: '8px' } }, createElement('textarea', { rows: 3, value: instruction, placeholder: '备注 / 补充（默认只作为下一次生成的附加要求）', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setInstruction(event.target.value), style: { ...inputStyle(), resize: 'vertical' } })),
    createElement('div', { style: { display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: '10px', flex: 1, minHeight: 0 } },
      createElement('aside', { style: { overflow: 'auto', borderRight: '1px solid #334155', paddingRight: '8px' } }, maps.map((item) => createElement('button', { key: item.libraryId, type: 'button', onClick: () => setSelectedId(item.libraryId), style: { display: 'block', width: '100%', textAlign: 'left', padding: '8px', marginBottom: '5px', border: 0, borderRadius: '6px', background: selectedId === item.libraryId ? '#334155' : 'transparent', color: 'inherit', cursor: 'pointer' } }, createElement('strong', null, item.title), createElement('small', { style: { display: 'block', opacity: .65 } }, `${item.nodeCount} 节点 · ${item.source?.kind ?? 'unknown'}`)))),
      record ? createElement('section', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' } },
        createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' } }, createElement('strong', null, record.title), createElement('button', { type: 'button', onClick: () => downloadBlob(new Blob([JSON.stringify(record.current, null, 2)], { type: 'application/json' }), `${record.title}.json`), style: buttonStyle() }, 'JSON'), createElement('button', { type: 'button', onClick: () => downloadBlob(new Blob([markdown(record.current.root)], { type: 'text/markdown' }), `${record.title}.md`), style: buttonStyle() }, 'Markdown'), createElement('button', { type: 'button', disabled: !xmind, onClick: () => xmind && downloadBlob(xmind, `${record.title}.xmind`), style: buttonStyle() }, 'XMind'), createElement('button', { type: 'button', onClick: regenerate, style: buttonStyle() }, '重新生成'), record.archived ? createElement('button', { type: 'button', onClick: restore, style: buttonStyle() }, '恢复') : createElement('button', { type: 'button', onClick: archive, style: buttonStyle() }, '归档'), createElement('button', { type: 'button', onClick: remove, style: { ...buttonStyle(), color: '#fca5a5' } }, '删除')),
        createElement('div', { style: { display: 'flex', gap: '6px' } }, createElement('select', { value: record.config.layout, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ layout: event.target.value }), style: inputStyle() }, createElement('option', { value: 'logicalStructure' }, '逻辑结构'), createElement('option', { value: 'logicalStructureLeft' }, '左逻辑结构'), createElement('option', { value: 'mindMap' }, '中心发散')), createElement('select', { value: record.config.theme, onChange: (event: ChangeEvent<HTMLSelectElement>) => visualConfig({ theme: event.target.value }), style: inputStyle() }, createElement('option', { value: 'default' }, '默认主题'), createElement('option', { value: 'classic4' }, 'Classic 4')), createElement('button', { type: 'button', onClick: () => setNoteOpen((value) => !value), style: buttonStyle() }, noteOpen ? '收起备注' : '备注 / 补充')),
        createElement(MapCanvas, { record, onDocumentChange: persistDocument, onXmind: setXmind }))
        : createElement('section', { style: { display: 'grid', placeItems: 'center', minHeight: '480px', opacity: .7 } }, '暂无脑图。可以点击“新建”，或让 Agent 从文本/PDF/附件生成。')),
    createElement('span', { style: { opacity: .7 } }, status),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: `${PLUGIN_ID}-panel`, order: 20, label: () => '脑图', inject: (sessionId) => ({ sessions: ctx.sessions, sessionId }) }, BrainmapView as never)), `${PLUGIN_ID}: brainmap view`)
}
