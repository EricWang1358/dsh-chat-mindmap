import type { GenerationRunState } from './generation-locks.js'

export const INTERRUPTED_DETAIL = '生成已中断'

export interface PanelRunView {
  runId: string
  libraryId: string
  status: GenerationRunState
  detail: string
  revisionId?: string
}

export interface PanelRunPatch {
  status?: GenerationRunState
  detail?: string
  revisionId?: string
}

/**
 * In-process registry for panel-originated generations (§9.2). Deliberately
 * not a queue: no persistence, no scheduling, no retry, and — as asserted by
 * tests — no filesystem surface at all. After a reload every run is unknown,
 * which surfaces to users as the interrupted detail above while the stored
 * record stays untouched.
 */
export class PanelRunRegistry {
  private runs = new Map<string, PanelRunView>()
  private controllers = new Map<string, AbortController>()
  private completions = new Set<Promise<unknown>>()

  register(view: PanelRunView, controller?: AbortController): PanelRunView {
    this.runs.set(view.runId, view)
    if (controller) this.controllers.set(view.runId, controller)
    return view
  }

  get(runId: string): PanelRunView | undefined {
    return this.runs.get(runId)
  }

  update(runId: string, patch: PanelRunPatch): PanelRunView | null {
    const view = this.runs.get(runId)
    if (!view) return null
    if (patch.status !== undefined) view.status = patch.status
    if (patch.detail !== undefined) view.detail = patch.detail
    if (patch.revisionId !== undefined) view.revisionId = patch.revisionId
    return view
  }

  getViewOrInterrupted(runId: string): PanelRunView {
    const view = this.runs.get(runId)
    if (view) return view
    return { runId, libraryId: '', status: 'failed', detail: INTERRUPTED_DETAIL }
  }

  trackCompletion(promise: Promise<unknown>): void {
    const tracked = promise.catch(() => undefined).finally(() => this.completions.delete(tracked))
    this.completions.add(tracked)
  }

  /** Plugin dispose path: abort everything in flight, then await quiescence. */
  async disposeAll(): Promise<void> {
    for (const controller of this.controllers.values()) {
      if (!controller.signal.aborted) controller.abort()
    }
    await Promise.allSettled([...this.completions])
    this.completions.clear()
  }
}
