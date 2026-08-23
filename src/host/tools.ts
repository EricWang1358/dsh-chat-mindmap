import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { countMindmapNodes } from '../core.js'
import { DomainError } from '../domain/errors.js'
import { reserveLibraryId, LEGACY_UNSCOPED_WORKSPACE } from '../domain/records.js'
import { DEFAULT_MINDMAP_CONFIG } from '../domain/settings.js'
import { getMindmap, saveMindmap, type MindmapConfig, type MindmapRecord, type MindmapSource } from '../library.js'
import { revisionIdOf } from '../revisions.js'
import type { GenerationLockRegistry } from './generation-locks.js'
import { commitGenerationOutcome, runSourceOutlineGeneration, selectProvider, type SubagentRuntimeLike } from './generation-executor.js'
import { LIBRARY_ID_MAX_LENGTH, LIBRARY_ID_PATTERN, REVISION_ID_MAX_LENGTH, REVISION_ID_PATTERN } from './id-patterns.js'

// ---------------------------------------------------------------------------
// Chat tool surface (Phase 3, docs/plans/S3_PLAN_v3.md §W1). The launcher is
// fully asynchronous (§10.1/§10.3): it starts an owned background job and
// returns immediately; completion flows back through the official tool-jobs
// notification path and the §10.1 compact output template.
// ---------------------------------------------------------------------------

export interface JobOutcomeLike {
  status: 'completed' | 'killed' | 'failed'
  detail?: string
  output?: string
}

export interface MindmapJobHooksLike {
  cancel(reason?: string): void
  done: Promise<JobOutcomeLike>
}

export interface MindmapJobSpecLike {
  kind: string
  label: string
  outputLimitBytes?: number
  owner?: unknown
  run(): MindmapJobHooksLike
}

/** Structural contract for the official ctx.jobs producer surface. */
export interface MindmapJobRegistryLike {
  start(spec: MindmapJobSpecLike): string
}

const CONTEXT_MAX_LENGTH = 200_000
const TITLE_MAX_LENGTH = 120
const INSTRUCTION_MAX_LENGTH = 4_000

/** Static, model-safe failure copy per stable error code (§16). */
const FAILURE_DETAIL: Record<string, string> = {
  INVALID_AGENT_OUTLINE: 'Subagent returned an invalid outline.',
  MINDMAP_CONFLICT: 'The mind map changed during generation; nothing was overwritten.',
  STORAGE_FAILED: 'Saving the generated mind map failed.',
  CAPABILITY_UNAVAILABLE: 'Generation providers are unavailable.',
  MINDMAP_NOT_FOUND: 'The mind map to replace no longer exists.',
  GENERATION_FAILED: 'Generation failed.',
}

export const TIMEOUT_OUTPUT = 'mindmap failed: code=GENERATION_TIMEOUT. Generation exceeded 180 seconds.'

function failureOutput(code: string): string {
  return 'mindmap failed: code=' + code + '. ' + (FAILURE_DETAIL[code] ?? FAILURE_DETAIL.GENERATION_FAILED)
}

function cancelledOutput(libraryId: string): string {
  return 'mindmap cancelled: libraryId=' + libraryId + '. No map was changed.'
}

function completionOutput(libraryId: string, revisionId: string, title: string, nodeCount: number): string {
  return 'mindmap completed: libraryId=' + libraryId + ' revisionId=' + revisionId + ' title=' + JSON.stringify(title) + ' nodes=' + nodeCount + '.\nCall present_chat_mindmap with libraryId and revisionId.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new DomainError('INVALID_REQUEST', field + ' must be a string of at most ' + maxLength + ' characters')
  return value
}

const SOURCE_KINDS = new Set(['text', 'pdf', 'image', 'document', 'chat', 'unknown'])

/** Canonical slim source validation; the frozen legacy parser in index.ts is superseded at integration switchover (D-S3-5). */
function parseLaunchSource(value: unknown): MindmapSource | undefined {
  if (typeof value === 'undefined') return undefined
  if (!isRecord(value)) throw new DomainError('INVALID_REQUEST', 'source must be an object')
  const kind = optionalString(value.kind, 'source.kind', 32)
  if (!kind || !SOURCE_KINDS.has(kind)) throw new DomainError('INVALID_REQUEST', 'source.kind is invalid')
  const source: MindmapSource = { kind: kind as MindmapSource['kind'] }
  for (const key of ['name', 'attachmentId', 'sessionId', 'workspaceId'] as const) {
    const parsed = optionalString(value[key], 'source.' + key, 500)
    if (parsed) source[key] = parsed
  }
  return source
}

const DENSITIES = new Set(['compact', 'standard', 'detailed'])

/** Canonical partial config validation for NEW maps only (D-S3-6). */
function parseLaunchConfig(value: unknown): Partial<MindmapConfig> | undefined {
  if (typeof value === 'undefined') return undefined
  if (!isRecord(value)) throw new DomainError('INVALID_REQUEST', 'config must be an object')
  const config: Partial<MindmapConfig> = {}
  for (const key of ['layout', 'theme', 'font', 'language'] as const) {
    const parsed = optionalString(value[key], 'config.' + key, 100)
    if (parsed !== undefined) config[key] = parsed
  }
  const instruction = optionalString(value.instruction, 'config.instruction', INSTRUCTION_MAX_LENGTH)
  if (instruction !== undefined) config.instruction = instruction
  if (typeof value.density !== 'undefined') {
    if (typeof value.density !== 'string' || !DENSITIES.has(value.density)) throw new DomainError('INVALID_REQUEST', 'config.density is invalid')
    config.density = value.density as MindmapConfig['density']
  }
  for (const key of ['maxNodes', 'contextLimit'] as const) {
    if (typeof value[key] !== 'undefined') {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new DomainError('INVALID_REQUEST', 'config.' + key + ' must be a finite number')
      config[key] = value[key]
    }
  }
  return config
}

export interface LaunchInput {
  context?: string
  title?: string
  libraryId?: string
  source?: MindmapSource
  config?: Partial<MindmapConfig>
  instruction?: string
}

export function parseLaunchInput(value: unknown): LaunchInput {
  if (!isRecord(value)) throw new DomainError('INVALID_REQUEST', 'arguments must be an object')
  let context = optionalString(value.context, 'context', CONTEXT_MAX_LENGTH)
  if (context !== undefined && context.trim().length === 0) context = undefined
  const title = optionalString(value.title, 'title', TITLE_MAX_LENGTH)
  let libraryId = optionalString(value.libraryId, 'libraryId', LIBRARY_ID_MAX_LENGTH)
  if (libraryId !== undefined && !LIBRARY_ID_PATTERN.test(libraryId)) throw new DomainError('INVALID_REQUEST', 'libraryId is invalid')
  if (libraryId !== undefined && libraryId.trim().length === 0) libraryId = undefined
  const instruction = optionalString(value.instruction, 'instruction', INSTRUCTION_MAX_LENGTH)
  return {
    context,
    title,
    libraryId,
    source: parseLaunchSource(value.source),
    config: parseLaunchConfig(value.config),
    instruction,
  }
}

/**
 * Existing maps keep their own per-map configuration (product constraint:
 * global/partial settings only ever affect new maps, D-S3-6); new maps merge
 * the compiled-in defaults with caller overrides.
 */
export function effectiveConfig(existing: MindmapRecord | null, override: Partial<MindmapConfig> | undefined): MindmapConfig {
  if (existing) return existing.config
  return { ...DEFAULT_MINDMAP_CONFIG, ...(override ?? {}) }
}

export interface ChatMindmapToolDeps {
  locks: GenerationLockRegistry
  jobs?: MindmapJobRegistryLike
  runtime?: SubagentRuntimeLike
  loadRecord?(id: string): Promise<MindmapRecord | null>
  save?(input: Parameters<typeof saveMindmap>[0]): Promise<MindmapRecord>
  logger?(line: string): void
  timeoutMs?: number
  /** Resolves the caller agent's workspace key; undefined when unresolvable. Read-only. */
  workspaceKeyOfAgent?(agent: unknown): string | undefined
}

interface AgentRef { id?: string }

function executeLaunch(deps: ChatMindmapToolDeps, rawArgs: unknown, exec?: { agent?: unknown }): Promise<{ kind: 'background'; jobId: string; libraryId: string }> {
  const loadRecord = deps.loadRecord ?? getMindmap
  const logger = deps.logger
  const log = (line: string): void => {
    try {
      logger?.(line)
    } catch {
      // A broken sink must never break settlement.
    }
  }
  const input = parseLaunchInput(rawArgs)
  const agent = (exec?.agent ?? undefined) as AgentRef | undefined
  const agentId = typeof agent?.id === 'string' ? agent.id : undefined
  const libraryId = input.libraryId ?? reserveLibraryId()
  return (async () => {
    const existing = await loadRecord(libraryId)
    if (input.libraryId && !existing) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
    const lock = deps.locks.tryAcquire(libraryId, 'chat-' + randomUUID().replaceAll('-', '').slice(0, 12))
    if (!lock) throw new DomainError('MINDMAP_BUSY', 'a generation for this mindmap is already running')
    try {
      if (!deps.jobs) throw new DomainError('CAPABILITY_UNAVAILABLE', 'background jobs unavailable')
      if (!deps.runtime || !selectProvider(deps.runtime, input.context)) throw new DomainError('CAPABILITY_UNAVAILABLE', 'generation providers unavailable')
      const config = effectiveConfig(existing, input.config)
      const controller = new AbortController()
      const runJobBody = async (): Promise<JobOutcomeLike> => {
        try {
          deps.locks.transition(libraryId, 'running')
          const outcome = await runSourceOutlineGeneration(
            { runtime: deps.runtime! },
            {
              context: input.context,
              title: input.title,
              instruction: input.instruction,
              sourceKind: input.source?.kind,
              config: { maxNodes: config.maxNodes, contextLimit: config.contextLimit, density: config.density, language: config.language },
              parent: agent,
              label: input.title ? '生成脑图：' + input.title : undefined,
            },
            { timeoutMs: deps.timeoutMs, controller },
          )
          if (outcome.kind === 'timed_out') {
            log('chat generation timed out for ' + libraryId)
            return { status: 'failed', detail: 'timed out', output: TIMEOUT_OUTPUT }
          }
          if (outcome.kind === 'cancelled') return { status: 'killed', detail: 'cancelled', output: cancelledOutput(libraryId) }
          if (outcome.kind === 'failed') {
            log('chat generation failed for ' + libraryId + ': ' + outcome.diagnostic)
            return { status: 'failed', output: failureOutput('GENERATION_FAILED') }
          }
          try {
            const saved = await commitGenerationOutcome(
              {
                libraryId,
                document: outcome.document,
                title: outcome.title,
                config,
                source: input.source ?? { kind: 'chat', ...(agentId ? { sessionId: agentId.slice(0, 500) } : {}) },
                ...(existing ? { baselineRecordVersion: existing.recordVersion } : {}),
              },
              deps.save ? { save: deps.save } : {},
            )
            return { status: 'completed', output: completionOutput(libraryId, revisionIdOf(saved.current), saved.title ?? outcome.document.title, countMindmapNodes(saved.current.root)) }
          } catch (error) {
            const code = error instanceof DomainError ? error.code : 'STORAGE_FAILED'
            log('chat commit failed for ' + libraryId + ': ' + (error instanceof Error ? error.message : String(error)))
            return { status: 'failed', output: failureOutput(code) }
          }
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'GENERATION_FAILED'
          log('chat generation error for ' + libraryId + ': ' + (error instanceof Error ? error.message : String(error)))
          return { status: 'failed', output: failureOutput(code) }
        } finally {
          // §9.1: the lock lives from acceptance until the attempt reached a
          // terminal state and cleanup finished, for every settlement path.
          deps.locks.release(libraryId)
        }
      }
      const jobId = deps.jobs.start({
        kind: 'mindmap',
        label: '脑图生成：' + (input.title?.trim() || input.source?.name || input.source?.kind || '会话内容'),
        outputLimitBytes: 2048,
        owner: agent,
        run: () => ({
          cancel: (_reason?: string) => controller.abort(),
          done: runJobBody(),
        }),
      })
      return { kind: 'background' as const, jobId, libraryId }
    } catch (error) {
      deps.locks.release(libraryId)
      throw error
    }
  })()
}

const LAUNCH_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    kind: { type: 'string' as const },
    jobId: { type: 'string' as const },
    libraryId: { type: 'string' as const },
  },
}

// ---------------------------------------------------------------------------
// present_chat_mindmap (§10.2): no model inference, no write side effects.
// The durable dsh-chat-mindmap-preview payload is exactly five keys — the
// shape pinned by gate0 G0-4-fixture strict deepEqual (R1-2).
// ---------------------------------------------------------------------------

export const PREVIEW_PAYLOAD_PREFIX = 'dsh-chat-mindmap-preview:'

export interface PresentInput {
  libraryId: string
  revisionId: string
}

export function parsePresentInput(value: unknown): PresentInput {
  if (!isRecord(value)) throw new DomainError('INVALID_REQUEST', 'arguments must be an object')
  const libraryId = optionalString(value.libraryId, 'libraryId', LIBRARY_ID_MAX_LENGTH)
  const revisionId = optionalString(value.revisionId, 'revisionId', REVISION_ID_MAX_LENGTH)
  if (!libraryId || !LIBRARY_ID_PATTERN.test(libraryId)) throw new DomainError('INVALID_REQUEST', 'libraryId is invalid')
  if (!revisionId || !REVISION_ID_PATTERN.test(revisionId)) throw new DomainError('INVALID_REQUEST', 'revisionId is invalid')
  return { libraryId, revisionId }
}

export interface PresentationValue {
  libraryId: string
  revisionId: string
  title: string
  nodeCount: number
  state: 'available' | 'expired'
}

async function executePresent(deps: ChatMindmapToolDeps, rawArgs: unknown, exec?: { agent?: unknown }): Promise<PresentationValue> {
  const input = parsePresentInput(rawArgs)
  const record = await (deps.loadRecord ?? getMindmap)(input.libraryId)
  if (!record) return { libraryId: input.libraryId, revisionId: input.revisionId, title: 'Mind map', nodeCount: 0, state: 'expired' }
  // Workspace fence (§10.2): legacy-unscoped records stay globally readable;
  // anything scoped requires the caller to resolve into the same workspace.
  // A mismatch degrades to the generic expired shape — zero title/node leak.
  const callerWorkspace = deps.workspaceKeyOfAgent?.(exec?.agent)
  const mismatched = typeof record.workspaceKey === 'string' && record.workspaceKey !== LEGACY_UNSCOPED_WORKSPACE && callerWorkspace !== undefined && callerWorkspace !== record.workspaceKey
  if (mismatched) return { libraryId: input.libraryId, revisionId: input.revisionId, title: 'Mind map', nodeCount: 0, state: 'expired' }
  const document = revisionIdOf(record.current) === input.revisionId ? record.current : record.previous && revisionIdOf(record.previous) === input.revisionId ? record.previous : null
  if (!document) return { libraryId: input.libraryId, revisionId: input.revisionId, title: record.title, nodeCount: 0, state: 'expired' }
  return { libraryId: input.libraryId, revisionId: input.revisionId, title: document.title, nodeCount: countMindmapNodes(document.root), state: 'available' }
}

export function previewPayloadText(value: PresentationValue): string {
  return PREVIEW_PAYLOAD_PREFIX + JSON.stringify({ libraryId: value.libraryId, revisionId: value.revisionId, title: value.title, nodeCount: value.nodeCount, state: value.state })
}

function presentationSentence(value: PresentationValue): string {
  return value.state === 'available'
    ? '已定位脑图「' + value.title + '」（' + value.nodeCount + ' 节点），客户端正在渲染只读 SVG 预览。'
    : '该脑图引用已失效或当前工作区不可访问，请重新生成后再试。'
}

const PRESENT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    libraryId: { type: 'string' as const },
    revisionId: { type: 'string' as const },
    title: { type: 'string' as const },
    nodeCount: { type: 'integer' as const },
    state: { type: 'string' as const },
  },
}

/**
 * Phase 3 chat tools factory. Wiring into apply() belongs to the integration
 * switchover (S3 adjudication (b)); tests drive this factory directly.
 */
export function createChatMindmapTools(deps: ChatMindmapToolDeps) {
  const generate = defineTool({
    name: 'generate_chat_mindmap',
    description: 'Start a background mind map generation job and return immediately with {kind:"background", jobId, libraryId}. You are notified when the job finishes; read its output with job_output and then call present_chat_mindmap with the returned libraryId and revisionId. Do not poll or wait for completion.',
    parameters: {
      context: { type: 'string', description: 'Extracted text or Markdown outline of the current-turn material. Optional: fork inherits completed conversation turns.' },
      title: { type: 'string', description: 'Optional suggested root title.' },
      libraryId: { type: 'string', description: 'Existing mind map id whose current version this generation replaces. Omit to create a new map.' },
      source: { type: 'json', description: 'Source metadata such as kind, name, attachmentId, sessionId, and workspaceId.' },
      config: { type: 'json', description: 'Partial generation settings for NEW maps; existing maps keep their own settings.' },
      instruction: { type: 'string', description: 'Optional extra requirements for the outline.' },
    },
    output: {
      schema: LAUNCH_SCHEMA,
      render: (_args: unknown, value: { jobId: string; libraryId: string }) => [{ type: 'text' as const, text: 'Background mind map job started: jobId=' + value.jobId + ' libraryId=' + value.libraryId + '. You will be notified when it finishes.' }],
    },
    timeoutMs: 10_000,
    execute: async (rawArgs: unknown, exec: { agent?: unknown }) => executeLaunch(deps, rawArgs, exec),
  })
  const present = defineTool({
    name: 'present_chat_mindmap',
    description: 'Render a previously generated mind map as a read-only SVG preview card. Pass the libraryId and revisionId returned by generate_chat_mindmap or the job output. This tool never modifies the map.',
    parameters: {
      libraryId: { type: 'string', required: true, description: 'Persistent mind map library ID.' },
      revisionId: { type: 'string', required: true, description: 'Immutable revision ID returned by generation.' },
    },
    output: {
      schema: PRESENT_SCHEMA,
      render: (_args: unknown, value: PresentationValue) => [
        { type: 'text' as const, text: previewPayloadText(value) },
        { type: 'text' as const, text: presentationSentence(value) },
      ],
    },
    timeoutMs: 15_000,
    execute: async (rawArgs: unknown, exec: { agent?: unknown }) => executePresent(deps, rawArgs, exec),
  })
  return { generate, present }
}
