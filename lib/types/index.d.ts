import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const name = "@ericwang1358/dsh-chat-mindmap";
export declare const inject: string[];
type InjectedServices = Record<string, unknown> & {
    /** Mirrors the cordis effect seam: factory runs now, its return disposes later. */
    effect<T>(factory: () => T, label?: string): T;
};
interface WebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/**
 * Structural plugin surface. Deliberately NOT extending the cordis Context
 * interface: apply() consumes only these members, and a local effect signature
 * keeps assembly decoupled from host-side Effect generics.
 */
interface PluginContext {
    effect<T>(factory: () => T, label?: string): T;
    tools: {
        register(tool: unknown): unknown;
    };
    webServer: WebServerLike;
    inject?(services: readonly string[], callback: (services: InjectedServices) => void): void;
}
/**
 * Phase 4 integration assembly (S4-W1). Every behavior lives in the frozen
 * Phase 2/3 modules; apply() only wires dependencies and optional services.
 */
export declare function apply(ctx: PluginContext): void;
export {};
