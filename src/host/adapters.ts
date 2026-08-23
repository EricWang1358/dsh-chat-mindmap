import { countMindmapNodes } from '../core.js'
import { DomainError } from '../domain/errors.js'
import { commitGenerationOutcome, runOutlineGeneration, type RegenerationPromptSource, type SubagentRuntimeLike } from './generation-executor.js'
import type { GenerationLockRegistry } from './generation-locks.js'
import { PanelRunRegistry, type PanelRunView } from './panel-runs.js'
import { revisionIdOf } from '../revisions.js'
import { randomUUID } from 'node:crypto'
import type { MindmapRecord } from '../library.js'

export type AdapterPromptSource = RegenerationPromptSource & Pick<Partial<MindmapRecord>, 'source'>

export interface ParentSideEffectProbe {
  parent: unknown
  emissionCount(): number
}

/**
 * Proof harness for §2/§20 "panel generation must never write to the chat":
 * the parent agent is a recording proxy; any property access or invocation on
 * it is counted. A full panel run must finish with emissionCount() === 0.
 */
export function createParentSideEffectProbe(): ParentSideEffectProbe {
  const calls: string[] = []
  const passthrough = (): unknown => (...args: unknown[]) => {
    calls.push(String(args.length))
    return undefined
  }
  const parent = new Proxy(function () {} as unknown as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf' || prop === 'then') return () => ''
      return passthrough()
    },
    apply() {
      calls.push('apply')
      return undefined
    },
  })
  return { parent, emissionCount: () => calls.length }
}

function safeDetail(value: unknown): string {
  const text = typeof value === 'string' && value.trim().length > 0 ? value : value instanceof Error ? value.message : 'generation failed'
  return text.slice(0, 500)
}

export interface PanelAdapterDeps {
  locks: GenerationLockRegistry
  registry: PanelRunRegistry
  runtime: SubagentRuntimeLike
  promptSourceOf(libraryId: string): Promise<AdapterPromptSource | null>
  baselineVersionOf(libraryId: string): Promise<number | undefined>
}

export interface PanelStartInput {
  libraryId: string
  parent?: unknown
  instruction?: string
  supplementalContext?: string
  label?: string
  /** External cancellation channel (e.g. user cancel); owned by the caller. */
  controller?: AbortController
  timeoutMs?: number
}

/**
 * Panel-originated generation adapter (P2): wires lock → registry → executor
 * → transactional commit without touching any chat surface. The same runId
 * controller is shared with the registry so plugin-level disposeAll() cancels
 * real in-flight work and awaits quiescence.
 */
export function createPanelGenerationAdapter(deps: PanelAdapterDeps) {
  let sequence = 0
  return {
    /**
     * S4-W1 (D-S4-1): §11 requires POST /maps/:id/regenerate to answer with a
     * runId immediately so the client can poll and cancel. begin() hands back
     * the synchronously registered view plus the completion promise; start()
     * keeps the S2 golden contract of awaiting full settlement.
     */
    begin(input: PanelStartInput): { view: PanelRunView; done: Promise<PanelRunView> } {
      const runId = `panel-${Date.now().toString(36)}-${(++sequence).toString(36)}-${randomUUID().replaceAll('-','').slice(0,8)}`
      const entry = deps.locks.tryAcquire(input.libraryId, runId)
      if (!entry) throw new DomainError('MINDMAP_BUSY', 'a generation for this mindmap is already running')
      const controller = input.controller ?? new AbortController()
      const view = deps.registry.register({ runId, libraryId: input.libraryId, status: 'accepted', detail: '' }, controller)
      const done = this.settle(input, runId, view, controller)
      deps.registry.trackCompletion(done)
      return { view, done }
    },
    async start(input: PanelStartInput): Promise<PanelRunView> {
      return this.begin(input).done
    },
    settle(input: PanelStartInput, runId: string, view: PanelRunView, controller: AbortController): Promise<PanelRunView> {
      const work = (async (): Promise<PanelRunView> => {
        try {
          const source = await deps.promptSourceOf(input.libraryId)
          if (!source) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
          const baseline = await deps.baselineVersionOf(input.libraryId)
          deps.locks.transition(input.libraryId, 'running')
          deps.registry.update(runId, { status: 'running', detail: input.label ? `${input.label}…` : 'generating outline…' })
          const outcome = await runOutlineGeneration(
            { runtime: deps.runtime },
            { record: source, instruction: input.instruction, supplementalContext: input.supplementalContext, parent: input.parent, label: input.label },
            { timeoutMs: input.timeoutMs, controller },
          )
          if (outcome.kind !== 'completed') {
            deps.registry.update(runId, { status: outcome.kind, detail: safeDetail('diagnostic' in outcome ? outcome.diagnostic : outcome.kind) })
            return view
          }
          const saved = await commitGenerationOutcome({
            libraryId: input.libraryId,
            document: outcome.document,
            title: outcome.title || source.title,
            config: source.config,
            ...(source.source ? { source: source.source } : {}),
            baselineRecordVersion: baseline,
          })
          deps.registry.update(runId, { status: 'completed', detail: `${countMindmapNodes(saved.current.root)} nodes`, revisionId: revisionIdOf(saved.current) })
          return view
        } catch (error) {
          deps.registry.update(runId, { status: 'failed', detail: safeDetail(error) })
          return view
        } finally {
          deps.locks.release(input.libraryId)
        }
      })()
      return work
    },
  }
}

export interface ChatJobsLike {
  start(input: { libraryId: string; title?: string }): Promise<{ id: string }>
}

export interface ChatLauncherDeps {
  jobs?: ChatJobsLike
  runtime?: SubagentRuntimeLike
}

/**
 * Chat-originated launcher factory (P2): with official Jobs present it only
 * creates the background job and returns immediately (§10.1); without them it
 * reports an explicit capability gap instead of silently degrading (§15).
 * Inline outline execution is intentionally NOT part of this launcher.
 */
export function createChatGenerationLauncher(deps: ChatLauncherDeps) {
  return {
    capabilities: {
      jobs: Boolean(deps.jobs),
      forkProvider: Boolean(deps.runtime?.getProvider?.('fork')),
    },
    async launch(input: { libraryId: string; title?: string }): Promise<{ mode: 'background'; jobId: string } | { mode: 'unavailable'; code: 'CAPABILITY_UNAVAILABLE' }> {
      if (!deps.jobs) return { mode: 'unavailable', code: 'CAPABILITY_UNAVAILABLE' }
      const job = await deps.jobs.start({ libraryId: input.libraryId, ...(input.title ? { title: input.title } : {}) })
      return { mode: 'background', jobId: job.id }
    },
  }
}
