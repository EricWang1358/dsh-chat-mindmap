import { countMindmapNodes } from '../core.js';
import { DomainError } from '../domain/errors.js';
import { commitGenerationOutcome, runOutlineGeneration } from './generation-executor.js';
import { revisionIdOf } from '../revisions.js';
import { randomUUID } from 'node:crypto';
/**
 * Proof harness for §2/§20 "panel generation must never write to the chat":
 * the parent agent is a recording proxy; any property access or invocation on
 * it is counted. A full panel run must finish with emissionCount() === 0.
 */
export function createParentSideEffectProbe() {
    const calls = [];
    const passthrough = () => (...args) => {
        calls.push(String(args.length));
        return undefined;
    };
    const parent = new Proxy(function () { }, {
        get(_target, prop) {
            if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf' || prop === 'then')
                return () => '';
            return passthrough();
        },
        apply() {
            calls.push('apply');
            return undefined;
        },
    });
    return { parent, emissionCount: () => calls.length };
}
function safeDetail(value) {
    const text = typeof value === 'string' && value.trim().length > 0 ? value : value instanceof Error ? value.message : 'generation failed';
    return text.slice(0, 500);
}
/**
 * Panel-originated generation adapter (P2): wires lock → registry → executor
 * → transactional commit without touching any chat surface. The same runId
 * controller is shared with the registry so plugin-level disposeAll() cancels
 * real in-flight work and awaits quiescence.
 */
export function createPanelGenerationAdapter(deps) {
    let sequence = 0;
    return {
        /**
         * S4-W1 (D-S4-1): §11 requires POST /maps/:id/regenerate to answer with a
         * runId immediately so the client can poll and cancel. begin() hands back
         * the synchronously registered view plus the completion promise; start()
         * keeps the S2 golden contract of awaiting full settlement.
         */
        begin(input) {
            const runId = `panel-${Date.now().toString(36)}-${(++sequence).toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
            const entry = deps.locks.tryAcquire(input.libraryId, runId);
            if (!entry)
                throw new DomainError('MINDMAP_BUSY', 'a generation for this mindmap is already running');
            const controller = input.controller ?? new AbortController();
            const view = deps.registry.register({ runId, libraryId: input.libraryId, status: 'accepted', detail: '' }, controller);
            const done = this.settle(input, runId, view, controller);
            deps.registry.trackCompletion(done);
            return { view, done };
        },
        async start(input) {
            return this.begin(input).done;
        },
        settle(input, runId, view, controller) {
            const work = (async () => {
                try {
                    const source = await deps.promptSourceOf(input.libraryId);
                    if (!source)
                        throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
                    const baseline = await deps.baselineVersionOf(input.libraryId);
                    deps.locks.transition(input.libraryId, 'running');
                    deps.registry.update(runId, { status: 'running', detail: input.label ? `${input.label}…` : 'generating outline…' });
                    const outcome = await runOutlineGeneration({ runtime: deps.runtime }, { record: source, instruction: input.instruction, supplementalContext: input.supplementalContext, parent: input.parent, label: input.label }, { timeoutMs: input.timeoutMs, controller });
                    if (outcome.kind !== 'completed') {
                        deps.registry.update(runId, { status: outcome.kind, detail: safeDetail('diagnostic' in outcome ? outcome.diagnostic : outcome.kind) });
                        return view;
                    }
                    const saved = await commitGenerationOutcome({
                        libraryId: input.libraryId,
                        document: outcome.document,
                        title: outcome.title || source.title,
                        config: source.config,
                        ...(source.source ? { source: source.source } : {}),
                        baselineRecordVersion: baseline,
                    });
                    deps.registry.update(runId, { status: 'completed', detail: `${countMindmapNodes(saved.current.root)} nodes`, revisionId: revisionIdOf(saved.current) });
                    return view;
                }
                catch (error) {
                    deps.registry.update(runId, { status: 'failed', detail: safeDetail(error) });
                    return view;
                }
                finally {
                    deps.locks.release(input.libraryId);
                }
            })();
            return work;
        },
    };
}
/**
 * Chat-originated launcher factory (P2): with official Jobs present it only
 * creates the background job and returns immediately (§10.1); without them it
 * reports an explicit capability gap instead of silently degrading (§15).
 * Inline outline execution is intentionally NOT part of this launcher.
 */
export function createChatGenerationLauncher(deps) {
    return {
        capabilities: {
            jobs: Boolean(deps.jobs),
            forkProvider: Boolean(deps.runtime?.getProvider?.('fork')),
        },
        async launch(input) {
            if (!deps.jobs)
                return { mode: 'unavailable', code: 'CAPABILITY_UNAVAILABLE' };
            const job = await deps.jobs.start({ libraryId: input.libraryId, ...(input.title ? { title: input.title } : {}) });
            return { mode: 'background', jobId: job.id };
        },
    };
}
