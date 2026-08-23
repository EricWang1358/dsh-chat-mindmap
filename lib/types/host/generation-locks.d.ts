export type GenerationRunState = 'accepted' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
export type GenerationTerminalState = Exclude<GenerationRunState, 'accepted' | 'running'>;
export interface GenerationLockEntry {
    readonly libraryId: string;
    readonly runId: string;
    state: GenerationRunState;
}
/**
 * In-process mutual exclusion per libraryId (technical design §9.1). Locks
 * live only for the lifetime of a generation attempt: acquired in the
 * accepted state, advanced through running, and released once a terminal
 * state is reached and cleanup finished. Nothing here touches disk.
 */
export declare class GenerationLockRegistry {
    private locks;
    tryAcquire(libraryId: string, runId: string): GenerationLockEntry | null;
    transition(libraryId: string, next: GenerationRunState): void;
    release(libraryId: string): boolean;
    stateOf(libraryId: string): GenerationRunState | undefined;
}
