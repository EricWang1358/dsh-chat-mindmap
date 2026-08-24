import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MindmapToolCard } from './components/MindmapToolCard.js'
import { BrainmapView } from './components/BrainmapView.js'
import { MindmapSettingsCard, type CardSettings } from './components/MindmapSettingsCard.js'
import { MINDMAP_VIEW_ID } from './components/mindmap-navigation.js'
import { OnboardingPreference } from './components/onboarding-preference.js'

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
  const onboarding = new OnboardingPreference()
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: MINDMAP_VIEW_ID, order: 20, label: () => '脑图', inject: (sessionId: string) => ({ sessions: ctx.sessions, sessionId, onboarding }) }, BrainmapView as never)), `${PLUGIN_ID}: brainmap view`)
  // W5 settings page: registered only when the official settings surface is
  // present; its absence degrades to no card with compiled defaults (§15).
  ctx.inject?.(['settingsScope'], (serviceCtx) => {
    const binder = serviceCtx.settingsScope as unknown as { bind(spec: { namespace: string }): unknown }
    const scope = binder.bind({ namespace: 'chat-mindmap' }) as SettingsScope<CardSettings>
    onboarding.attach(scope)
    const disposeSlot = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: `${PLUGIN_ID}-settings`, order: 50, label: () => '脑图', inject: () => ({ scope }) }, MindmapSettingsCard as never))
    serviceCtx.effect(() => () => { onboarding.detach(scope); disposeSlot?.() }, 'chat-mindmap: settings tab')
  })
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'present_chat_mindmap' }, MindmapToolCard as never)), `${PLUGIN_ID}: chat mindmap link`)
}
