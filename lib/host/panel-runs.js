export const INTERRUPTED_DETAIL = '生成已中断';
/**
 * In-process registry for panel-originated generations (§9.2). Deliberately
 * not a queue: no persistence, no scheduling, no retry, and — as asserted by
 * tests — no filesystem surface at all. After a reload every run is unknown,
 * which surfaces to users as the interrupted detail above while the stored
 * record stays untouched.
 */
export class PanelRunRegistry {
    runs = new Map();
    controllers = new Map();
    completions = new Set();
    register(view, controller) {
        this.runs.set(view.runId, view);
        if (controller)
            this.controllers.set(view.runId, controller);
        return view;
    }
    get(runId) {
        return this.runs.get(runId);
    }
    update(runId, patch) {
        const view = this.runs.get(runId);
        if (!view)
            return null;
        if (patch.status !== undefined)
            view.status = patch.status;
        if (patch.detail !== undefined)
            view.detail = patch.detail;
        if (patch.revisionId !== undefined)
            view.revisionId = patch.revisionId;
        return view;
    }
    getViewOrInterrupted(runId) {
        const view = this.runs.get(runId);
        if (view)
            return view;
        return { runId, libraryId: '', status: 'failed', detail: INTERRUPTED_DETAIL };
    }
    trackCompletion(promise) {
        const tracked = promise.catch(() => undefined).finally(() => this.completions.delete(tracked));
        this.completions.add(tracked);
    }
    /** Abort one in-flight run; false when the run is unknown or already settled. */
    cancel(runId) {
        const controller = this.controllers.get(runId);
        if (!controller)
            return false;
        if (!controller.signal.aborted)
            controller.abort();
        return true;
    }
    /** Plugin dispose path: abort everything in flight, then await quiescence. */
    async disposeAll() {
        for (const controller of this.controllers.values()) {
            if (!controller.signal.aborted)
                controller.abort();
        }
        await Promise.allSettled([...this.completions]);
        this.completions.clear();
    }
}
