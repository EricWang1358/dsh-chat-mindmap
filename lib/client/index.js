import { getBlobUrlLru } from './components/blob-url-lru.js';
import { MindmapToolCard, registerSnapshotFetcher } from './components/MindmapToolCard.js';
import { BrainmapView } from './components/BrainmapView.js';
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
    // R1-4 dependency injection: the card module never touches this private api().
    const fetcherDispose = registerSnapshotFetcher((libraryId, revisionId) => api(`/maps/${encodeURIComponent(libraryId)}/revisions/${encodeURIComponent(revisionId)}`));
    ctx.effect(() => fetcherDispose, `${PLUGIN_ID}: snapshot fetcher`);
    // R2-2: plugin unload revokes every thumbnail URL the module-scoped LRU owns.
    ctx.effect(() => () => { getBlobUrlLru().disposeAll(); }, `${PLUGIN_ID}: thumbnail LRU dispose`);
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'present_chat_mindmap' }, MindmapToolCard)), `${PLUGIN_ID}: chat SVG preview`);
}
