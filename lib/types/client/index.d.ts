import type { Context } from '@deepseek-ai/cordis';
import type { ConversationSnapshot, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client';
type ClientContext = Context & {
    slots: SlotRegistry;
    sessions: SessionService;
};
export declare const inject: string[];
type SessionService = {
    binding(id: string): {
        session?: {
            getSnapshot(): ConversationSnapshot;
            loadOlder(): Promise<void>;
        };
    } | undefined;
};
export declare function apply(ctx: ClientContext): void;
export {};
