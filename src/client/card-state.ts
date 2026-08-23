/**
 * Pure state resolution for the mindmap tool card (S3-W4). Priority order:
 * expired > failed > loading > ready. No React, no DOM, no I/O — directly
 * unit-testable and reused by the static render assertions in card.test.mjs.
 */

export type CardReference = {
  libraryId: string
  revisionId: string
  title: string
  nodeCount: number
  state: 'available' | 'expired'
  capabilityNote?: string
}

export type CardState = { kind: 'expired' | 'failed' | 'loading' | 'ready'; note?: string }

export const CARD_MISSING_NOTE = '脑图预览数据不可用'
export const CARD_EXPIRED_NOTE = '本图已失效'

export function cardStateOf(reference: CardReference | null | undefined, url: string | null | undefined, error: string | null | undefined): CardState {
  if (!reference) return { kind: 'failed', note: CARD_MISSING_NOTE }
  if (reference.state === 'expired') return { kind: 'expired', note: CARD_EXPIRED_NOTE }
  if (error) return { kind: 'failed', note: error }
  if (!url) return { kind: 'loading' }
  return { kind: 'ready' }
}
