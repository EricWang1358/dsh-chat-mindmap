import { saveMindmap, type MindmapConfig, type MindmapRecord, type MindmapSource } from '../library.js';
import type { GenerationLockRegistry } from './generation-locks.js';
import { type SubagentRuntimeLike } from './generation-executor.js';
export interface JobOutcomeLike {
    status: 'completed' | 'killed' | 'failed';
    detail?: string;
    output?: string;
}
export interface MindmapJobHooksLike {
    cancel(reason?: string): void;
    done: Promise<JobOutcomeLike>;
}
export interface MindmapJobSpecLike {
    kind: string;
    label: string;
    outputLimitBytes?: number;
    owner?: unknown;
    run(): MindmapJobHooksLike;
}
/** Structural contract for the official ctx.jobs producer surface. */
export interface MindmapJobRegistryLike {
    start(spec: MindmapJobSpecLike): string;
}
export declare const TIMEOUT_OUTPUT = "mindmap failed: code=GENERATION_TIMEOUT. Generation exceeded 180 seconds.";
/** Canonical slim source validation; the frozen legacy parser in index.ts is superseded at integration switchover (D-S3-5). Shared with REST V2 routes. */
export declare function parseLaunchSource(value: unknown): MindmapSource | undefined;
/** Canonical partial config validation for NEW maps only (D-S3-6). Shared with REST V2 routes. */
export declare function parseLaunchConfig(value: unknown): Partial<MindmapConfig> | undefined;
export interface LaunchInput {
    context?: string;
    title?: string;
    libraryId?: string;
    source?: MindmapSource;
    config?: Partial<MindmapConfig>;
    instruction?: string;
}
export declare function parseLaunchInput(value: unknown): LaunchInput;
/**
 * Existing maps keep their own per-map configuration (product constraint:
 * global/partial settings only ever affect new maps, D-S3-6); new maps merge
 * the compiled-in defaults with caller overrides.
 */
export declare function effectiveConfig(existing: MindmapRecord | null, override: Partial<MindmapConfig> | undefined): MindmapConfig;
export interface ChatMindmapToolDeps {
    locks: GenerationLockRegistry;
    jobs?: MindmapJobRegistryLike;
    runtime?: SubagentRuntimeLike;
    loadRecord?(id: string): Promise<MindmapRecord | null>;
    save?(input: Parameters<typeof saveMindmap>[0]): Promise<MindmapRecord>;
    logger?(line: string): void;
    timeoutMs?: number;
    /** Resolves the caller agent's workspace key; undefined when unresolvable. Read-only. */
    workspaceKeyOfAgent?(agent: unknown): string | undefined;
}
export declare const PREVIEW_PAYLOAD_PREFIX = "dsh-chat-mindmap-preview:";
export interface PresentInput {
    libraryId: string;
    revisionId: string;
}
export declare function parsePresentInput(value: unknown): PresentInput;
export interface PresentationValue {
    libraryId: string;
    revisionId: string;
    title: string;
    nodeCount: number;
    state: 'available' | 'expired';
}
export declare function previewPayloadText(value: PresentationValue): string;
/**
 * Phase 3 chat tools factory. Wiring into apply() belongs to the integration
 * switchover (S3 adjudication (b)); tests drive this factory directly.
 */
export declare function createChatMindmapTools(deps: ChatMindmapToolDeps): {
    generate: import("@deepseek-ai/dsh-tools").ToolDefinition;
    present: import("@deepseek-ai/dsh-tools").ToolDefinition;
};
