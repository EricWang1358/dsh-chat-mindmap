import { DomainError } from '../domain/errors.js'

export type GenerationRunState = 'accepted' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'
export type GenerationTerminalState = Exclude<GenerationRunState, 'accepted' | 'running'>

export interface GenerationLockEntry {
  readonly libraryId: string
  readonly runId: string
  state: GenerationRunState
}

const TERMINAL_STATES: readonly string[] = ['completed', 'failed', 'timed_out', 'cancelled']

/**
 * In-process mutual exclusion per libraryId (technical design §9.1). Locks
 * live only for the lifetime of a generation attempt: acquired in the
 * accepted state, advanced through running, and released once a terminal
 * state is reached and cleanup finished. Nothing here touches disk.
 */
export class GenerationLockRegistry {
  private locks = new Map<string, GenerationLockEntry>()

  tryAcquire(libraryId: string, runId: string): GenerationLockEntry | null {
    if (this.locks.has(libraryId)) return null
    const entry: GenerationLockEntry = { libraryId, runId, state: 'accepted' }
    this.locks.set(libraryId, entry)
    return entry
  }

  transition(libraryId: string, next: GenerationRunState): void {
    const entry = this.locks.get(libraryId)
    const legal = Boolean(entry) && ((entry!.state === 'accepted' && next === 'running') || (entry!.state === 'running' && TERMINAL_STATES.includes(next)))
    if (!legal) throw new DomainError('INVALID_REQUEST', 'invalid generation state transition')
    entry!.state = next
  }

  release(libraryId: string): boolean {
    return this.locks.delete(libraryId)
  }

  stateOf(libraryId: string): GenerationRunState | undefined {
    return this.locks.get(libraryId)?.state
  }
}
