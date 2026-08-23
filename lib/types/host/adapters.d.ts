import { type RegenerationPromptSource, type SubagentRuntimeLike } from './generation-executor.js';
import type { GenerationLockRegistry } from './generation-locks.js';
import { PanelRunRegistry, type PanelRunView } from './panel-runs.js';
import type { MindmapRecord } from '../library.js';
export type AdapterPromptSource = RegenerationPromptSource & Pick<Partial<MindmapRecord>, 'source'>;
export interface ParentSideEffectProbe {
    parent: unknown;
    emissionCount(): number;
}
/**
 * Proof harness for §2/§20 "panel generation must never write to the chat":
 * the parent agent is a recording proxy; any property access or invocation on
 * it is counted. A full panel run must finish with emissionCount() === 0.
 */
export declare function createParentSideEffectProbe(): ParentSideEffectProbe;
export interface PanelAdapterDeps {
    locks: GenerationLockRegistry;
    registry: PanelRunRegistry;
    runtime: SubagentRuntimeLike;
    promptSourceOf(libraryId: string): Promise<AdapterPromptSource | null>;
    baselineVersionOf(libraryId: string): Promise<number | undefined>;
}
export interface PanelStartInput {
    libraryId: string;
    parent?: unknown;
    instruction?: string;
    supplementalContext?: string;
    label?: string;
    /** External cancellation channel (e.g. user cancel); owned by the caller. */
    controller?: AbortController;
    timeoutMs?: number;
}
/**
 * Panel-originated generation adapter (P2): wires lock → registry → executor
 * → transactional commit without touching any chat surface. The same runId
 * controller is shared with the registry so plugin-level disposeAll() cancels
 * real in-flight work and awaits quiescence.
 */
export declare function createPanelGenerationAdapter(deps: PanelAdapterDeps): {
    start(input: PanelStartInput): Promise<PanelRunView>;
};
export interface ChatJobsLike {
    start(input: {
        libraryId: string;
        title?: string;
    }): Promise<{
        id: string;
    }>;
}
export interface ChatLauncherDeps {
    jobs?: ChatJobsLike;
    runtime?: SubagentRuntimeLike;
}
/**
 * Chat-originated launcher factory (P2): with official Jobs present it only
 * creates the background job and returns immediately (§10.1); without them it
 * reports an explicit capability gap instead of silently degrading (§15).
 * Inline outline execution is intentionally NOT part of this launcher.
 */
export declare function createChatGenerationLauncher(deps: ChatLauncherDeps): {
    capabilities: {
        jobs: boolean;
        forkProvider: boolean;
    };
    launch(input: {
        libraryId: string;
        title?: string;
    }): Promise<{
        mode: "background";
        jobId: string;
    } | {
        mode: "unavailable";
        code: "CAPABILITY_UNAVAILABLE";
    }>;
};
