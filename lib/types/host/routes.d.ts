import { SessionId } from '@deepseek-ai/dsh-session';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { saveMindmap, updateMindmap, type MindmapRecord } from '../library.js';
import type { PanelRunRegistry, PanelRunView } from './panel-runs.js';
export declare const PLUGIN_ROUTE_PREFIXES: readonly ["/@ericwang1358/dsh-chat-mindmap", "/@dsh-external/dsh-chat-mindmap"];
export declare const ROUTES_VERSION = 5;
export declare const PLUGIN_ROUTE_NAME = "@ericwang1358/dsh-chat-mindmap";
export interface MindmapCapabilities {
    jobs: boolean;
    subagents: boolean;
    fork: boolean;
    settings: boolean;
    toolCard: boolean;
}
export interface PanelStartRequest {
    libraryId: string;
    sessionId: string;
    instruction?: string;
    supplementalContext?: string;
    expectedRecordVersion: number;
}
export interface MindmapRouteDeps {
    webServer: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    /** Live-agent registry fencing every mutation; absent → all mutations are SESSION_UNAVAILABLE. */
    agents?: {
        get(id: ReturnType<typeof SessionId>): unknown;
    };
    panelRuns: PanelRunRegistry;
    /** Panel generation starter (integration wires the S2 adapter); absent → regenerate reports CAPABILITY_UNAVAILABLE. */
    startPanelRun?(request: PanelStartRequest): Promise<PanelRunView> | PanelRunView;
    capabilities?: Partial<MindmapCapabilities>;
    loadRecord?(id: string): Promise<MindmapRecord | null>;
    listRecords?(filters: {
        workspaceId?: string;
        sessionId?: string;
        archived?: boolean;
    }): Promise<unknown>;
    saveRecord?(input: Parameters<typeof saveMindmap>[0]): Promise<MindmapRecord>;
    patchRecord?(id: string, patch: Parameters<typeof updateMindmap>[1]): Promise<MindmapRecord | null>;
    restoreRecord?(id: string, options?: {
        expectedRecordVersion?: number;
    }): Promise<MindmapRecord | null>;
    deleteRecord?(id: string, options?: {
        expectedRecordVersion?: number;
    }): Promise<boolean>;
    logger?(line: string): void;
    workspaceKeyOfSession?(sessionId: string): string | undefined;
}
/**
 * REST V2 assembly. Integration wires this with one call inside apply();
 * tests drive it against a capturing fake webServer.
 */
export declare function registerMindmapRoutes(deps: MindmapRouteDeps): () => void;
