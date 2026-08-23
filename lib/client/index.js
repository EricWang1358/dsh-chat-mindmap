import { getBlobUrlLru } from './components/blob-url-lru.js';
import { MindmapToolCard, registerSnapshotFetcher } from './components/MindmapToolCard.js';
import { BrainmapView } from './components/BrainmapView.js';
import { MindmapSettingsCard } from './components/MindmapSettingsCard.js';
import { api } from './api.js';
const PLUGIN_ID = '@ericwang1358/dsh-chat-mindmap';
export const inject = ['slots', 'sessions'];
/**
 * Client assembly only (§5): view composition lives in components/.
 * G0-4 anchor: the toolview renderer below reads durable result content
 * (the preview payload carried beside the pruned callId head).
 */
export function apply(ctx) {
    ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: `${PLUGIN_ID}-panel`, order: 20, label: () => '脑图', inject: (sessionId) => ({ sessions: ctx.sessions, sessionId }) }, BrainmapView)), `${PLUGIN_ID}: brainmap view`);
    // W5 settings page: registered only when the official settings surface is
    // present; its absence degrades to no card with compiled defaults (§15).
    ctx.inject?.(['settingsScope'], (serviceCtx) => {
        const binder = serviceCtx.settingsScope;
        const scope = binder.bind({ namespace: 'chat-mindmap' });
        const disposeSlot = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: `${PLUGIN_ID}-settings`, order: 50, label: () => '脑图', inject: () => ({ scope }) }, MindmapSettingsCard));
        serviceCtx.effect(() => () => { disposeSlot?.(); }, 'chat-mindmap: settings tab');
    });
    // R1-4 dependency injection: the card module never touches this private api().
    const fetcherDispose = registerSnapshotFetcher((libraryId, revisionId) => api(`/maps/${encodeURIComponent(libraryId)}/revisions/${encodeURIComponent(revisionId)}`));
    ctx.effect(() => fetcherDispose, `${PLUGIN_ID}: snapshot fetcher`);
    // R2-2: plugin unload revokes every thumbnail URL the module-scoped LRU owns.
    ctx.effect(() => () => { getBlobUrlLru().disposeAll(); }, `${PLUGIN_ID}: thumbnail LRU dispose`);
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'present_chat_mindmap' }, MindmapToolCard)), `${PLUGIN_ID}: chat SVG preview`);
}
