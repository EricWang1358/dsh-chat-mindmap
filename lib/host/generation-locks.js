import { DomainError } from '../domain/errors.js';
const TERMINAL_STATES = ['completed', 'failed', 'timed_out', 'cancelled'];
/**
 * In-process mutual exclusion per libraryId (technical design §9.1). Locks
 * live only for the lifetime of a generation attempt: acquired in the
 * accepted state, advanced through running, and released once a terminal
 * state is reached and cleanup finished. Nothing here touches disk.
 */
export class GenerationLockRegistry {
    locks = new Map();
    tryAcquire(libraryId, runId) {
        if (this.locks.has(libraryId))
            return null;
        const entry = { libraryId, runId, state: 'accepted' };
        this.locks.set(libraryId, entry);
        return entry;
    }
    transition(libraryId, next) {
        const entry = this.locks.get(libraryId);
        const legal = Boolean(entry) && ((entry.state === 'accepted' && next === 'running') || (entry.state === 'running' && TERMINAL_STATES.includes(next)));
        if (!legal)
            throw new DomainError('INVALID_REQUEST', 'invalid generation state transition');
        entry.state = next;
    }
    release(libraryId) {
        return this.locks.delete(libraryId);
    }
    stateOf(libraryId) {
        return this.locks.get(libraryId)?.state;
    }
    /** Read-only census for the dispose-to-zero invariant (S3-W6, R2-2). */
    size() {
        return this.locks.size;
    }
    /** Plugin dispose path: drop every live lock without transitions. */
    disposeAll() {
        this.locks.clear();
    }
}
