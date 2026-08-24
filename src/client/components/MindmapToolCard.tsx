import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useState, type ReactElement } from 'react'
import { cardStateOf, CARD_EXPIRED_NOTE, type CardReference } from '../card-state.js'
import { openMindmap } from './mindmap-navigation.js'

// Model-provided markup is never rendered. The durable reference below is the
// only data read from a completed tool result.
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

export function CardBody(props: { reference: CardReference | null; error: string | null; onOpen?(): void }): ReactElement {
  const state = cardStateOf(props.reference, 'open-link', props.error)
  const reference = props.reference
  if (!reference) return <div style={{ padding: '8px', opacity: 0.7 }}>{state.note}</div>
  if (reference.state === 'expired') return <div style={{ padding: '8px', opacity: 0.7 }}>{CARD_EXPIRED_NOTE}</div>
  return (
    <section style={{ padding: '10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', maxWidth: '620px' }}>
      <strong>{reference.title}</strong>
      <small style={{ display: 'block', opacity: 0.7, marginBottom: '8px' }}>{reference.nodeCount} 节点 · 在脑图库中编辑</small>
      {reference.capabilityNote ? <small style={{ display: 'block', opacity: 0.62, marginBottom: '8px' }} role='note'>{reference.capabilityNote}</small> : null}
      {props.error ? <span role='status' style={{ display: 'block', marginBottom: '8px' }}>{props.error}</span> : null}
      <button type='button' style={{ padding: '6px 10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '6px', cursor: 'pointer' }} aria-label={'打开 ' + reference.title + ' 脑图'} onClick={props.onOpen}>打开脑图</button>
    </section>
  )
}

export function MindmapToolCard({ block, sessionId }: ToolCallViewProps): ReactElement {
  const reference = previewReference(block)
  const [error, setError] = useState<string | null>(null)
  return <CardBody reference={reference} error={error} onOpen={() => {
    if (!reference || !openMindmap(String(sessionId), reference.libraryId)) setError('未找到会话的“脑图”标签，请刷新页面后重试')
  }} />
}
