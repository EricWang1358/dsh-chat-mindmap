import { buildStrictOutlineDocument, validateAgentOutlineResult, type AgentOutlineResult } from '../domain/generation.js'
import { mindmapNodeNotesForPrompt, mindmapToMarkdown } from '../core.js'
import type { MindmapDocument } from '../core.js'
import type { MindmapConfig, MindmapRecord, MindmapSource } from '../library.js'
import { saveMindmap } from '../library.js'
import { DomainError } from '../domain/errors.js'

/**
 * Canonical regeneration prompt composition (P3 adjudication,
 * docs/plans/S2_DESIGN_DELTA_REVIEW.md). This module is the single normative
 * copy; the frozen legacy duplicate in src/index.ts must be switched over and
 * deleted during the integration phase. The output format is pinned byte for
 * byte by the HTTP golden assertion in tests/index.test.mjs.
 */
export type RegenerationPromptSource = Pick<MindmapRecord, 'title' | 'current' | 'config'>

export function buildRegenerationPrompt(record: RegenerationPromptSource | null | undefined, instruction?: string): { text: string; noteLength: number } {
  if (!record) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
  const note = instruction?.trim() || record.config.instruction?.trim() || ''
  const noteSection = note ? `\n\n<panel-note>\n${note}\n</panel-note>` : ''
  const outline = mindmapToMarkdown(record.current.root)
  const contextBudget = Math.max(4_000, Math.floor(record.config.contextLimit || 80_000))
  const framingLength = 1_200 + record.title.length + String(record.config.maxNodes).length
  const noteBudget = Math.max(0, contextBudget - outline.length - framingLength - note.length)
  const nodeNoteReference = mindmapNodeNotesForPrompt(record.current.root, noteBudget)
  // F-1 (S2 review, closed at the S4 integration switchover): when EVERY node
  // note exceeded the prompt budget the omission hint vanished because the
  // notes array was empty. The zero-attached case now states that explicitly.
  const nodeNoteSection = nodeNoteReference.notes.length
    ? `\n\n<node-notes format="json">\n${JSON.stringify(nodeNoteReference.notes)}\n</node-notes>${nodeNoteReference.omitted ? `\n有 ${nodeNoteReference.omitted} 条过长或超出提示预算的节点备注未附带。` : ''}`
    : nodeNoteReference.omitted
      ? `\n\n注意：本图共 ${nodeNoteReference.omitted} 条节点备注，全部因超出提示预算而未附带；请仅依据脑图大纲本身重建层级。`
      : ''
  return {
    text: `将下面已有脑图转换为结构清晰、可编辑的 Markdown 层级大纲。只输出符合 schema 的 title 和 outline。不要调用工具，不要解释过程，不要编造来源。节点备注是附加参考：应吸收其事实、范围和约束，但绝不能把备注文字当作节点标题逐字输出。\n\n当前标题：${record.title}\n当前脑图 Markdown：\n${outline}${nodeNoteSection}\n\n最多节点：${record.config.maxNodes}${noteSection}\n\n如果没有 panel-note，则保持原主题和层级信息，必要时改善结构。`,
    noteLength: note.length,
  }
}

// ---------------------------------------------------------------------------
// Generation orchestration primitives (S2, docs/plans/S2_PLAN_v3.md).
// The constants below are the canonical copies; frozen duplicates in
// src/index.ts are superseded and get deleted at the integration switchover.
// ---------------------------------------------------------------------------

/** ADR-008: compile-time stability policy. Never exposed as a user setting. */
export const GENERATION_MAX_TOKENS = 6000

/** §18 hard timeout: 180 seconds ± 2. Inject a short value in tests only. */
export const GENERATION_TIMEOUT_MS = 180_000

export const OUTLINE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'outline'],
  properties: { title: { type: 'string' }, outline: { type: 'string' } },
} as const

export const OUTLINE_PERSONA =
  '只把给定脑图内容整理为严格 Markdown 层级大纲。不得调用任何工具、技能、子代理或外部服务；不要解释过程。'

export interface SubagentRunLike {
  id: string
  result: Promise<{ stopReason: string; structured?: unknown; output?: unknown; diagnostic?: string }>
  dispose(): Promise<void>
}

export interface SubagentRuntimeLike {
  getProvider(name: string): unknown
  start(name: string, request: Record<string, unknown>): Promise<SubagentRunLike>
}

/** §8.2 provider ladder: fork → spawn(only with supplemental context) → null. */
export function selectProvider(runtime: Pick<SubagentRuntimeLike, 'getProvider'> | undefined, supplementalContext?: string): 'fork' | 'spawn' | null {
  if (!runtime) return null
  if (runtime.getProvider('fork')) return 'fork'
  if (runtime.getProvider('spawn') && typeof supplementalContext === 'string' && supplementalContext.trim().length > 0) return 'spawn'
  return null
}

function safeDiagnostic(value: unknown): string {
  const text = typeof value === 'string' && value.trim().length > 0 ? value : value instanceof Error ? value.message : 'generation failed'
  return text.slice(0, 500)
}

function textFromSubagentOutput(output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (!Array.isArray(output)) return ''
  return output
    .map((block) => {
      if (typeof block === 'string') return block
      if (typeof block === 'object' && block !== null && 'type' in block && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string') return (block as { text: string }).text
      return ''
    })
    .join('')
    .trim()
}

/** Accept only exact JSON or a fenced JSON object when structured_output is unavailable. */
function parseTextOutline(output: unknown): unknown {
  const text = textFromSubagentOutput(output)
  if (!text) return undefined
  const candidate = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try { return JSON.parse(candidate) as unknown } catch { return undefined }
}

function unwrapStructured(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === undefined || value === null) return undefined
  if (typeof value === 'string' || Array.isArray(value)) return parseTextOutline(value)
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.title === 'string' && typeof record.outline === 'string') return record
  if (typeof record.title === 'string' && typeof record.content === 'string') return { title: record.title, outline: record.content }
  for (const key of ['data', 'value', 'result', 'output', 'content']) {
    const nested = unwrapStructured(record[key], depth + 1)
    if (nested !== undefined) return nested
  }
  return undefined
}

function outlineCandidates(result: { structured?: unknown; output?: unknown }): unknown[] {
  const candidates: unknown[] = []
  for (const value of [result.structured, result.output]) {
    const candidate = unwrapStructured(value)
    if (candidate !== undefined && !candidates.includes(candidate)) candidates.push(candidate)
  }
  return candidates
}

function validatedOutlineOf(result: { structured?: unknown; output?: unknown }): AgentOutlineResult {
  let lastError: unknown
  for (const candidate of outlineCandidates(result)) {
    try { return validateAgentOutlineResult(candidate) } catch (error) { lastError = error }
  }
  if (lastError) throw lastError
  return validateAgentOutlineResult(undefined)
}

export interface OutlineCompleted {
  kind: 'completed'
  document: MindmapDocument
  title: string
  truncated: boolean
  childId: string
  provider: 'fork' | 'spawn'
}

export interface OutlineFailed {
  kind: 'failed'
  diagnostic: string
}

export interface OutlineTimedOut {
  kind: 'timed_out'
  diagnostic: string
}

export interface OutlineCancelled {
  kind: 'cancelled'
}

export type OutlineResult = OutlineCompleted | OutlineFailed | OutlineTimedOut | OutlineCancelled

/**
 * Shared §9/§18 control scaffolding for one outline attempt: hard timeout,
 * deterministic classification, and settlement even when the controller was
 * aborted before the runtime attached its own signal handling (DEV-S2-4).
 * The whole attempt races an abort promise, so cancellation wins wherever the
 * attempt is suspended; non-abort errors propagate to the caller.
 */
export async function runWithGenerationControl<T>(
  opts: { timeoutMs?: number; controller?: AbortController },
  attempt: (ctx: { signal: AbortSignal; timedOut: () => boolean }) => Promise<T>,
): Promise<{ settled: true; value: T } | { settled: false; kind: 'cancelled' | 'timed_out' }> {
  const controller = opts.controller ?? new AbortController()
  // The timeout flag decides classification even when an external abort
  // races it, so timed_out and cancelled never flip-flop.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, opts.timeoutMs ?? GENERATION_TIMEOUT_MS)
  let abortReject!: (error: Error) => void
  const abortedPromise = new Promise<never>((_resolve, reject) => {
    abortReject = reject
  })
  abortedPromise.catch(() => undefined)
  const onAbort = (): void => abortReject(new Error('generation aborted'))
  if (controller.signal.aborted) onAbort()
  else controller.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const raced = await Promise.race([attempt({ signal: controller.signal, timedOut: () => timedOut }), abortedPromise])
    if (controller.signal.aborted) return { settled: false, kind: timedOut ? 'timed_out' : 'cancelled' }
    return { settled: true, value: raced }
  } catch (error) {
    if (controller.signal.aborted) return { settled: false, kind: timedOut ? 'timed_out' : 'cancelled' }
    throw error
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Runs one regeneration outline attempt (panel flavor): the prompt is always
 * composed by buildRegenerationPrompt (P3 single copy); the result must pass
 * the strict outline pipeline (§8.4). Runtime outcome problems are returned
 * as values, never thrown, so callers can map them to terminal run states
 * deterministically.
 */
export async function runOutlineGeneration(
  services: { runtime: SubagentRuntimeLike },
  input: { record: RegenerationPromptSource; instruction?: string; supplementalContext?: string; parent?: unknown; label?: string },
  opts: { timeoutMs?: number; controller?: AbortController } = {},
): Promise<OutlineResult> {
  const provider = selectProvider(services.runtime, input.supplementalContext)
  if (!provider) throw new DomainError('CAPABILITY_UNAVAILABLE', 'generation providers unavailable')
  const { text } = buildRegenerationPrompt(input.record, input.instruction)
  let disposed = false
  let run: SubagentRunLike | undefined
  const disposeOnce = async (): Promise<void> => {
    if (disposed || !run) return
    disposed = true
    try {
      await run.dispose()
    } catch {
      // R9: rc8 dispose idempotency is unverified; swallow cleanup errors.
    }
  }
  try {
    const outcome = await runWithGenerationControl(opts, async (ctx) => {
      run = await services.runtime.start(provider, {
        label: input.label ?? '重新构建脑图',
        prompt: [{ type: 'text', text }],
        parent: input.parent,
        signal: ctx.signal,
        outputSchema: OUTLINE_OUTPUT_SCHEMA,
        maxDepth: 1,
        toolFilter: { allow: [] },
        persona: OUTLINE_PERSONA,
      })
      return await run.result
    })
    if (!outcome.settled) return outcome.kind === 'timed_out' ? { kind: 'timed_out', diagnostic: 'generation timed out' } : { kind: 'cancelled' }
    const result = outcome.value
    if (outlineCandidates(result).length === 0 && result.stopReason !== 'completed') return { kind: 'failed', diagnostic: safeDiagnostic(result.diagnostic || ('subagent stopped: ' + result.stopReason)) }
    const validated = validatedOutlineOf(result)
    const strict = buildStrictOutlineDocument(validated, { maxNodes: input.record.config.maxNodes, contextLimit: input.record.config.contextLimit })
    return { kind: 'completed', document: strict.document, title: strict.document.title, truncated: strict.truncated, childId: run!.id, provider }
  } catch (error) {
    return { kind: 'failed', diagnostic: safeDiagnostic(error) }
  } finally {
    await disposeOnce()
  }
}

/**
 * Chat-source prompt composition (§10.1/§8.3): the chat entry always turns
 * SOURCE MATERIAL into an outline. Fork additionally inherits completed
 * conversation turns; the current-turn increment travels as the context
 * material below. Single canonical copy lives here (§4.1).
 */
export function buildSourceOutlinePrompt(
  input: { context?: string; title?: string; instruction?: string; sourceKind?: string; config: Pick<MindmapConfig, 'maxNodes' | 'density' | 'language'> },
): string {
  const context = typeof input.context === 'string' ? input.context.trim() : ''
  const material = context.length > 0
    ? '<source-material>\n' + context + '\n</source-material>'
    : '<source-material>当前会话已完成回合中的相关内容（不含本回合；附件原文不在此列）。</source-material>'
  const requestedTitle = input.title && input.title.trim().length > 0
    ? '- 根标题建议：' + input.title.trim() + '（若与材料主题冲突，以材料为准）'
    : '- 根标题：从材料中提炼简洁主题'
  const instructionLine = input.instruction && input.instruction.trim().length > 0 ? '\n- 附加要求：' + input.instruction.trim() : ''
  return [
    '将下面来源材料整理为结构清晰、可编辑的 Markdown 层级大纲。只输出符合 schema 的 title 和 outline。',
    '不要调用任何工具、技能或子代理；不要解释过程；不得编造材料中不存在的内容。',
    '',
    material,
    '',
    '约束：',
    '- 来源边界：仅使用上述材料，不得引入材料之外的事实（来源类型：' + (input.sourceKind ?? 'chat') + '）。',
    '- 最多节点：' + input.config.maxNodes,
    '- 密度：' + input.config.density,
    '- 语言：' + input.config.language,
    requestedTitle + instructionLine,
  ].join('\n')
}

export interface SourceOutlineInput {
  context?: string
  title?: string
  instruction?: string
  sourceKind?: string
  config: Pick<MindmapConfig, 'maxNodes' | 'contextLimit' | 'density' | 'language'>
  parent?: unknown
  label?: string
}

/**
 * Chat-flavor outline runner (§10.1): source material → strict outline via
 * the same provider ladder, schema, persona, tool filter and §9 control
 * scaffolding as the panel runner. DomainErrors from validation propagate so
 * callers can surface stable error codes; runtime-level problems still come
 * back as values.
 */
export async function runSourceOutlineGeneration(
  services: { runtime: SubagentRuntimeLike },
  input: SourceOutlineInput,
  opts: { timeoutMs?: number; controller?: AbortController } = {},
): Promise<OutlineResult> {
  const provider = selectProvider(services.runtime, input.context)
  if (!provider) throw new DomainError('CAPABILITY_UNAVAILABLE', 'generation providers unavailable')
  const text = buildSourceOutlinePrompt({ context: input.context, title: input.title, instruction: input.instruction, sourceKind: input.sourceKind, config: input.config })
  let disposed = false
  let run: SubagentRunLike | undefined
  const disposeOnce = async (): Promise<void> => {
    if (disposed || !run) return
    disposed = true
    try {
      await run.dispose()
    } catch {
      // R9: rc8 dispose idempotency is unverified; swallow cleanup errors.
    }
  }
  try {
    const outcome = await runWithGenerationControl(opts, async (ctx) => {
      run = await services.runtime.start(provider, {
        label: input.label ?? (input.title ? '生成脑图：' + input.title : '生成脑图'),
        prompt: [{ type: 'text', text }],
        parent: input.parent,
        signal: ctx.signal,
        outputSchema: OUTLINE_OUTPUT_SCHEMA,
        maxDepth: 1,
        toolFilter: { allow: [] },
        persona: OUTLINE_PERSONA,
      })
      return await run.result
    })
    if (!outcome.settled) return outcome.kind === 'timed_out' ? { kind: 'timed_out', diagnostic: 'generation timed out' } : { kind: 'cancelled' }
    const result = outcome.value
    if (outlineCandidates(result).length === 0 && result.stopReason !== 'completed') return { kind: 'failed', diagnostic: safeDiagnostic(result.diagnostic || ('subagent stopped: ' + result.stopReason)) }
    const validated = validatedOutlineOf(result)
    const strict = buildStrictOutlineDocument(validated, { maxNodes: input.config.maxNodes, contextLimit: input.config.contextLimit })
    return { kind: 'completed', document: strict.document, title: strict.document.title, truncated: strict.truncated, childId: run!.id, provider }
  } catch (error) {
    if (error instanceof DomainError) throw error
    return { kind: 'failed', diagnostic: safeDiagnostic(error) }
  } finally {
    await disposeOnce()
  }
}

export interface CommitGenerationInput {
  libraryId: string
  document: MindmapDocument
  title: string
  config: MindmapConfig
  source?: MindmapSource
  workspaceKey?: string
  /** Record version observed when the generation was accepted (§9.1). */
  baselineRecordVersion?: number
}

export interface CommitDependencies {
  /** Injectable for deterministic ordering tests; defaults to real storage. */
  save?: (args: Parameters<typeof saveMindmap>[0]) => Promise<MindmapRecord>
}

/**
 * §9.1 commit boundary: the fully constructed record is persisted through the
 * library's compare-and-swap in one atomic write, and the completed outcome is
 * only returned after the save resolved — "completed ⇒ record readable".
 * Absent baselines (pre-allocated fresh maps) rely on the generation lock and
 * omit expectedRecordVersion; see risk R11.
 */
export async function commitGenerationOutcome(input: CommitGenerationInput, deps: CommitDependencies = {}): Promise<MindmapRecord> {
  const save = deps.save ?? saveMindmap
  return save({
    libraryId: input.libraryId,
    title: input.title,
    document: input.document,
    config: input.config,
    ...(input.source ? { source: input.source } : {}),
    ...(input.workspaceKey ? { workspaceKey: input.workspaceKey } : {}),
    rotatePrevious: true,
    ...(typeof input.baselineRecordVersion === 'number' ? { expectedRecordVersion: input.baselineRecordVersion } : {}),
  })
}
