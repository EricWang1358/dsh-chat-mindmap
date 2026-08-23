import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { getBlobUrlLru } from './components/blob-url-lru.js'
import { MindmapToolCard, registerSnapshotFetcher } from './components/MindmapToolCard.js'
import { BrainmapView } from './components/BrainmapView.js'
import { MindmapSettingsCard } from './components/MindmapSettingsCard.js'
import { api } from './api.js'

const PLUGIN_ID = '@ericwang1358/dsh-chat-mindmap'
type SessionService = { binding(id: string): unknown }
type ClientContext = Context & { slots: SlotRegistry; sessions: SessionService; inject?: (services: readonly string[], callback: (services: Record<string, unknown> & { effect(make: () => unknown, label?: string): void }) => void) => void }

export const inject = ['slots', 'sessions']

/**
 * Client assembly only (§5): view composition lives in components/.
 * G0-4 anchor: the toolview renderer below reads durable result content
 * (the preview payload carried beside the pruned callId head).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: `${PLUGIN_ID}-panel`, order: 20, label: () => '脑图', inject: (sessionId: string) => ({ sessions: ctx.sessions, sessionId }) }, BrainmapView as never)), `${PLUGIN_ID}: brainmap view`)
  // W5 settings page: registered only when the official settings surface is
  // present; its absence degrades to no card with compiled defaults (§15).
  ctx.inject?.(['settingsScope'], (serviceCtx) => {
    const binder = serviceCtx.settingsScope as unknown as { bind(spec: { namespace: string }): unknown }
    const scope = binder.bind({ namespace: 'chat-mindmap' }) as never
    const disposeSlot = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: `${PLUGIN_ID}-settings`, order: 50, label: () => '脑图', inject: () => ({ scope }) }, MindmapSettingsCard as never))
    serviceCtx.effect(() => () => { disposeSlot?.() }, 'chat-mindmap: settings tab')
  })
  // R1-4 dependency injection: the card module never touches this private api().
  const fetcherDispose = registerSnapshotFetcher((libraryId, revisionId) => api(`/maps/${encodeURIComponent(libraryId)}/revisions/${encodeURIComponent(revisionId)}`))
  ctx.effect(() => fetcherDispose, `${PLUGIN_ID}: snapshot fetcher`)
  // R2-2: plugin unload revokes every thumbnail URL the module-scoped LRU owns.
  ctx.effect(() => () => { getBlobUrlLru().disposeAll() }, `${PLUGIN_ID}: thumbnail LRU dispose`)
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'present_chat_mindmap' }, MindmapToolCard as never)), `${PLUGIN_ID}: chat SVG preview`)
}