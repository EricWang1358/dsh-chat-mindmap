import type { GenerationRunState } from './generation-locks.js';
export declare const INTERRUPTED_DETAIL = "\u751F\u6210\u5DF2\u4E2D\u65AD";
export interface PanelRunView {
    runId: string;
    libraryId: string;
    status: GenerationRunState;
    detail: string;
    sessionId?: string;
    revisionId?: string;
}
export interface PanelRunPatch {
    status?: GenerationRunState;
    detail?: string;
    revisionId?: string;
}
/**
 * In-process registry for panel-originated generations (§9.2). Deliberately
 * not a queue: no persistence, no scheduling, no retry, and — as asserted by
 * tests — no filesystem surface at all. After a reload every run is unknown,
 * which surfaces to users as the interrupted detail above while the stored
 * record stays untouched.
 */
export declare class PanelRunRegistry {
    private runs;
    private controllers;
    private completions;
    register(view: PanelRunView, controller?: AbortController): PanelRunView;
    get(runId: string): PanelRunView | undefined;
    /** Read-only census for the dispose-to-zero invariant (S3-W6, R2-2). */
    size(): number;
    update(runId: string, patch: PanelRunPatch): PanelRunView | null;
    getViewOrInterrupted(runId: string): PanelRunView;
    trackCompletion(promise: Promise<unknown>): void;
    /** Abort one in-flight run; false when the run is unknown or already settled. */
    cancel(runId: string): boolean;
    /** Plugin dispose path: abort everything in flight, then await quiescence. */
    disposeAll(): Promise<void>;
}
