import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildMindmap } from './core.js';
export declare const name = "@ericwang1358/dsh-chat-mindmap";
export declare const inject: string[];
interface PluginContext extends Context {
    webServer: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
}
export declare function apply(ctx: PluginContext): void;
export { buildMindmap };
