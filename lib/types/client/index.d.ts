import type { Context } from '@deepseek-ai/cordis';
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client';
type SessionService = {
    binding(id: string): unknown;
};
type ClientContext = Context & {
    slots: SlotRegistry;
    sessions: SessionService;
};
export declare const inject: string[];
/**
 * Client assembly only (§5): view composition lives in components/.
 * G0-4 anchor: the toolview renderer below reads durable result content
 * (the preview payload carried beside the pruned callId head).
 */
export declare function apply(ctx: ClientContext): void;
export {};
