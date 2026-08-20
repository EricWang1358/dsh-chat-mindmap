import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SessionId, type JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { buildMindmap, buildMindmapFromOutline, countMindmapNodes, mindmapToMarkdown, validateMindmapDocument, type MindmapBuildOptions, type MindmapDocument } from './core.js'
import { revisionIdOf } from './revisions.js'
import {
  archiveMindmap,
  deleteMindmap,
  getMindmap,
  listMindmaps,
  saveMindmap,
  updateMindmap,
  type MindmapConfig,
  type MindmapSource,
} from './library.js'

export const name = '@dsh-external/dsh-chat-mindmap'
export const inject = ['tools', 'webServer']

interface GenerateInput {
  context: string
  title?: string
  libraryId?: string
  source?: MindmapSource
  config?: Partial<MindmapConfig>
  save?: boolean
}

interface PatchInput {
  title?: string
  document?: MindmapDocument
  config?: Partial<MindmapConfig>
  archived?: boolean
  rotatePrevious?: boolean
}

interface CreateMapInput {
  title?: string
  document: MindmapDocument
  config?: Partial<MindmapConfig>
  source?: MindmapSource
}

interface RegenerateInput {
  sessionId: string
  expectedUpdatedAt: string
  instruction?: string
}

interface PanelServices {
  agents: AgentRegistry
  subagents: SubagentRuntime
}

interface PanelRunView {
  runId: string
  libraryId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  detail: string
  childId?: string
  revisionId?: string
}

interface PresentInput {
  libraryId: string
  revisionId: string
}

interface PluginContext extends Context {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

const RESULT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    title: { type: 'string' as const },
    document: { type: 'json' as const },
    markdown: { type: 'string' as const },
    nodeCount: { type: 'integer' as const },
    libraryId: { type: 'string' as const },
    revisionId: { type: 'string' as const },
    saved: { type: 'boolean' as const },
  },
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
    capabilityNote: { type: 'string' as const },
  },
}

class InputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'InputError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asJsonValue(document: MindmapDocument): JsonValue {
  return JSON.parse(JSON.stringify(document)) as JsonValue
}

function parseString(value: unknown, field: string, maxLength: number, required = false): string | undefined {
  if (typeof value === 'undefined') {
    if (required) throw new InputError(`${field} must be a string`)
    return undefined
  }
  if (typeof value !== 'string' || value.length > maxLength) throw new InputError(`${field} must be a string of at most ${maxLength} characters`)
  if (required && value.trim().length === 0) throw new InputError(`${field} must be a non-empty string`)
  return value
}

function parseSource(value: unknown): MindmapSource | undefined {
  if (typeof value === 'undefined') return undefined
  if (!isRecord(value)) throw new InputError('source must be an object')
  const kinds = new Set<MindmapSource['kind']>(['text', 'pdf', 'image', 'document', 'chat', 'unknown'])
  const kind = parseString(value.kind, 'source.kind', 32, true)!
  if (!kinds.has(kind as MindmapSource['kind'])) throw new InputError('source.kind is invalid')
  const source: MindmapSource = { kind: kind as MindmapSource['kind'] }
  for (const key of ['name', 'attachmentId', 'sessionId', 'workspaceId'] as const) {
    const parsed = parseString(value[key], `source.${key}`, 500)
    if (parsed) source[key] = parsed
  }
  if (typeof value.metadata !== 'undefined') {
    if (!isRecord(value.metadata)) throw new InputError('source.metadata must be an object')
    const metadata: Record<string, string> = {}
    for (const [key, item] of Object.entries(value.metadata)) {
      if (Object.keys(metadata).length >= 32) break
      metadata[key.slice(0, 100)] = parseString(item, `source.metadata.${key}`, 500, true)!
    }
    source.metadata = metadata
  }
  return source
}

function parseConfig(value: unknown): Partial<MindmapConfig> | undefined {
  if (typeof value === 'undefined') return undefined
  if (!isRecord(value)) throw new InputError('config must be an object')
  const config: Partial<MindmapConfig> = {}
  for (const key of ['layout', 'theme', 'font', 'instruction', 'language'] as const) {
    const parsed = parseString(value[key], `config.${key}`, key === 'instruction' ? 4_000 : 100)
    if (parsed !== undefined) config[key] = parsed
  }
  if (typeof value.density !== 'undefined') {
    if (value.density !== 'compact' && value.density !== 'standard' && value.density !== 'detailed') throw new InputError('config.density is invalid')
    config.density = value.density
  }
  for (const key of ['maxNodes', 'contextLimit'] as const) {
    if (typeof value[key] !== 'undefined') {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new InputError(`config.${key} must be a number`)
      config[key] = value[key]
    }
  }
  return config
}

function parseGenerateInput(value: unknown): GenerateInput {
  if (!isRecord(value)) throw new InputError('request body must be an object')
  return {
    context: parseString(value.context, 'context', 200_000, true)!,
    title: parseString(value.title, 'title', 120),
    libraryId: parseString(value.libraryId, 'libraryId', 100),
    source: parseSource(value.source),
    config: parseConfig(value.config),
    save: typeof value.save === 'undefined' ? undefined : value.save === true || value.save === false ? value.save : (() => { throw new InputError('save must be a boolean') })(),
  }
}

function parseCreateMapInput(value: unknown): CreateMapInput {
  if (!isRecord(value)) throw new InputError('request body must be an object')
  let document: MindmapDocument
  try {
    document = validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 })
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : 'invalid document')
  }
  return {
    title: parseString(value.title, 'title', 120),
    document,
    config: parseConfig(value.config),
    source: parseSource(value.source),
  }
}

function parsePatchInput(value: unknown): PatchInput {
  if (!isRecord(value)) throw new InputError('request body must be an object')
  let document: MindmapDocument | undefined
  if (typeof value.document !== 'undefined') {
    try {
      document = validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 })
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : 'invalid document')
    }
  }
  const patch: PatchInput = {
    title: parseString(value.title, 'title', 120),
    document,
    config: parseConfig(value.config),
    archived: typeof value.archived === 'undefined' ? undefined : value.archived === true || value.archived === false ? value.archived : (() => { throw new InputError('archived must be a boolean') })(),
    rotatePrevious: typeof value.rotatePrevious === 'undefined' ? undefined : value.rotatePrevious === true || value.rotatePrevious === false ? value.rotatePrevious : (() => { throw new InputError('rotatePrevious must be a boolean') })(),
  }
  if (typeof patch.title === 'undefined' && typeof patch.document === 'undefined' && typeof patch.config === 'undefined' && typeof patch.archived === 'undefined') throw new InputError('patch must include an editable field')
  return patch
}

function parseRegenerateInput(value: unknown): RegenerateInput {
  if (!isRecord(value)) throw new InputError('request body must be an object')
  return { sessionId: parseString(value.sessionId, 'sessionId', 180, true)!, expectedUpdatedAt: parseString(value.expectedUpdatedAt, 'expectedUpdatedAt', 64, true)!, instruction: parseString(value.instruction, 'instruction', 4_000) }
}

function parsePresentInput(value: unknown): PresentInput {
  if (!isRecord(value)) throw new InputError('request body must be an object')
  return {
    libraryId: parseString(value.libraryId, 'libraryId', 100, true)!,
    revisionId: parseString(value.revisionId, 'revisionId', 100, true)!,
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (settled) return
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > 256_000) {
        fail(new InputError('request body too large', 413))
        return
      }
      body += chunk
    })
    req.on('end', () => {
      if (settled) return
      try {
        const parsed = body ? JSON.parse(body) : {}
        settled = true
        resolve(parsed)
      } catch {
        fail(new InputError('invalid JSON'))
      }
    })
    req.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
  })
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function errorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof InputError) return { status: error.status, message: error.message }
  if (error instanceof Error && error.message === 'invalid library id') return { status: 400, message: error.message }
  return { status: 500, message: 'mindmap service failed' }
}

function decodeId(encoded: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch {
    throw new InputError('invalid encoded library id')
  }
}

function decodeRevisionId(encoded: string): string {
  const revisionId = decodeId(encoded)
  if (!/^rev-[a-f0-9]{24}$/.test(revisionId)) throw new InputError('invalid revision id')
  return revisionId
}

async function generateResult(args: GenerateInput, sessionId?: string): Promise<Record<string, unknown>> {
  const options: MindmapBuildOptions = {
    contextLimit: args.config?.contextLimit,
    maxNodes: args.config?.maxNodes,
    maxChildren: args.config?.maxNodes && args.config.maxNodes > 360 ? 100 : args.config?.density === 'detailed' ? 100 : undefined,
    maxDepth: args.config?.maxNodes && args.config.maxNodes > 360 ? 12 : args.config?.density === 'detailed' ? 12 : undefined,
  }
  const document = buildMindmap(args.context, args.title ?? '', options)
  const saved = args.save !== false
  const source = args.source ?? { kind: 'unknown' as const, ...(sessionId ? { sessionId } : {}) }
  const record = saved ? await saveMindmap({ libraryId: args.libraryId, title: document.title, document, config: args.config, source }) : null
  const current = record?.current ?? document
  return {
    title: record?.title ?? current.title,
    document: asJsonValue(current),
    markdown: mindmapToMarkdown(current.root),
    nodeCount: countMindmapNodes(current.root),
    libraryId: record?.libraryId ?? '',
    revisionId: revisionIdOf(current),
    saved,
  }
}

const CAPABILITY_NOTE = '面板重新生成会在可用时直接使用 fork 子代理，并仅在脑图面板显示状态；它不会创建 DSH Job、写入主聊天或追加聊天 SVG 卡。'
const OUTLINE_SCHEMA: ObjectJsonSchema = { type: 'object', additionalProperties: false, required: ['title', 'outline'], properties: { title: { type: 'string' }, outline: { type: 'string' } } }
const PANEL_RUN_TIMEOUT_MS = 180_000

type PanelRun = PanelRunView & { controller: AbortController; run?: SubagentRun }

function asOutline(value: unknown): { title: string; outline: string } {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.outline !== 'string' || !value.title.trim() || !value.outline.trim() || value.title.length > 120 || value.outline.length > 200_000) throw new Error('子代理没有返回有效的脑图大纲')
  return { title: value.title.trim(), outline: value.outline.trim() }
}

function regenerationPrompt(record: Awaited<ReturnType<typeof getMindmap>>, instruction?: string): string {
  if (!record) throw new Error('mindmap not found')
  return `将下面已有脑图转换为结构清晰、可编辑的 Markdown 层级大纲。只输出符合 schema 的 title 和 outline。不要调用工具，不要解释过程，不要编造来源。\n\n当前标题：${record.title}\n当前脑图 Markdown：\n${mindmapToMarkdown(record.current.root)}\n\n最多节点：${record.config.maxNodes}\n附加要求：${instruction?.trim() || record.config.instruction || '保持原主题和层级信息，必要时改善结构。'}`
}

function startPanelRegeneration(services: PanelServices | undefined, libraryId: string, input: RegenerateInput, panelRuns: Map<string, PanelRun>, activeByLibrary: Map<string, string>): PanelRunView {
  if (activeByLibrary.has(libraryId)) throw new InputError('该脑图正在重新生成，请等待或取消当前任务', 409)
  const parent = services?.agents.get(SessionId(input.sessionId))
  const runtime = services?.subagents
  if (!parent || !runtime?.getProvider('fork')) throw new InputError('当前会话不支持 fork 子代理重新生成', 503)
  const runId = `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const controller = new AbortController()
  const panelRun: PanelRun = { runId, libraryId, status: 'running', detail: '正在由 fork 子代理整理脑图大纲…', controller }
  panelRuns.set(runId, panelRun)
  activeByLibrary.set(libraryId, runId)
  const timeout = windowOrGlobalTimeout(() => controller.abort(), PANEL_RUN_TIMEOUT_MS)
  void (async () => {
    try {
      const record = await getMindmap(libraryId)
      if (!record) throw new Error('mindmap not found')
      const run = await runtime.start('fork', { label: `重新构建脑图：${record.title}`, prompt: [{ type: 'text', text: regenerationPrompt(record, input.instruction) }], parent, signal: controller.signal, outputSchema: OUTLINE_SCHEMA, maxDepth: 1, toolFilter: { allow: [] }, persona: '只把给定脑图内容整理为严格 Markdown 层级大纲。不得调用任何工具、技能、子代理或外部服务；不要解释过程。' })
      panelRun.run = run
      panelRun.childId = run.id
      panelRun.detail = `Fork 子代理已启动：${run.id}`
      const result = await run.result
      if (controller.signal.aborted) { panelRun.status = 'cancelled'; panelRun.detail = '已取消重新生成'; return }
      if (result.stopReason !== 'completed') throw new Error(result.diagnostic || '子代理未完成重新生成')
      const outline = asOutline(result.structured)
      const document = buildMindmapFromOutline(outline.outline, outline.title, { maxNodes: record.config.maxNodes, contextLimit: record.config.contextLimit, maxChildren: record.config.maxNodes > 360 ? 100 : undefined, maxDepth: record.config.maxNodes > 360 ? 12 : undefined })
      const saved = await saveMindmap({ libraryId, title: outline.title, document, config: record.config, source: record.source, expectedUpdatedAt: input.expectedUpdatedAt })
      panelRun.status = 'completed'; panelRun.detail = `重新生成完成：${countMindmapNodes(saved.current.root)} 个节点`; panelRun.revisionId = revisionIdOf(saved.current)
    } catch (error) {
      panelRun.status = controller.signal.aborted ? 'cancelled' : 'failed'
      panelRun.detail = controller.signal.aborted ? '已取消重新生成' : error instanceof Error ? error.message : '重新生成失败'
    } finally {
      clearTimeout(timeout)
      await panelRun.run?.dispose().catch(() => undefined)
      activeByLibrary.delete(libraryId)
    }
  })()
  return { runId: panelRun.runId, libraryId: panelRun.libraryId, status: panelRun.status, detail: panelRun.detail }
}

function windowOrGlobalTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout> { return setTimeout(callback, milliseconds) }

async function presentResult(args: PresentInput): Promise<{ libraryId: string; revisionId: string; title: string; nodeCount: number; state: 'available' | 'expired'; capabilityNote: string }> {
  const record = await getMindmap(args.libraryId)
  if (!record) return { libraryId: args.libraryId, revisionId: args.revisionId, title: 'Mind map', nodeCount: 0, state: 'expired', capabilityNote: CAPABILITY_NOTE }
  const document = revisionIdOf(record.current) === args.revisionId ? record.current : record.previous && revisionIdOf(record.previous) === args.revisionId ? record.previous : null
  if (!document) return { libraryId: args.libraryId, revisionId: args.revisionId, title: record.title, nodeCount: 0, state: 'expired', capabilityNote: CAPABILITY_NOTE }
  return { libraryId: args.libraryId, revisionId: args.revisionId, title: document.title, nodeCount: countMindmapNodes(document.root), state: 'available', capabilityNote: CAPABILITY_NOTE }
}

function presentContent(value: { libraryId?: string; revisionId?: string; title?: string; nodeCount?: number; state?: string; capabilityNote?: string }) {
  // This text is intentionally self-contained and durable. The client card
  // reads it when the call head was pruned from a history window.
  return [{ type: 'text' as const, text: `dsh-chat-mindmap-preview:${JSON.stringify({ libraryId: value.libraryId ?? '', revisionId: value.revisionId ?? '', title: value.title ?? 'Mind map', nodeCount: value.nodeCount ?? 0, state: value.state ?? 'expired', capabilityNote: value.capabilityNote ?? CAPABILITY_NOTE })}` }]
}

export function apply(ctx: PluginContext): void {
  const panelRuns = new Map<string, PanelRun>()
  const activeByLibrary = new Map<string, string>()
  let panelServices: PanelServices | undefined
  const injectOptional = (ctx as PluginContext & { inject?: PluginContext['inject'] }).inject
  injectOptional?.(['agents', 'subagents'], (serviceCtx) => {
    const services: PanelServices = { agents: serviceCtx.agents, subagents: serviceCtx.subagents }
    panelServices = services
    serviceCtx.effect(() => () => { if (panelServices === services) panelServices = undefined }, 'chat-mindmap: panel fork capability')
  })
  const generate = defineTool({
    name: 'generate_chat_mindmap',
    description: 'Convert agent-provided chat context into a structured editable mind map. Pass the relevant conversation text or a Markdown outline; do not pass secrets that should not be summarized.',
    parameters: {
      context: { type: 'string', required: true, description: 'Extracted text or Markdown outline from chat, PDF, image, or document.' },
      title: { type: 'string', description: 'Optional root title.' },
      libraryId: { type: 'string', description: 'Existing library ID to replace current with a new generated version.' },
      source: { type: 'json', description: 'Source metadata such as kind, name, attachmentId, sessionId, and workspaceId.' },
      config: { type: 'json', description: 'Generation and visual settings.' },
      save: { type: 'boolean', description: 'Persist to the global mindmap library; defaults to true.' },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: `Generated mind map “${value.title}” with ${value.nodeCount} nodes. revisionId=${value.revisionId}\n\n${value.markdown}` }],
    },
    timeoutMs: 30_000,
    execute: async (rawArgs, exec) => generateResult(parseGenerateInput(rawArgs), exec.agent?.id),
  })

  const present = defineTool({
    name: 'present_chat_mindmap',
    description: 'Render a previously generated mind map as a read-only SVG preview in the chat. Pass the libraryId and revisionId returned by generate_chat_mindmap. This tool does not change the map.',
    parameters: {
      libraryId: { type: 'string', required: true, description: 'Persistent mind map library ID.' },
      revisionId: { type: 'string', required: true, description: 'Immutable revision ID returned by generation.' },
    },
    output: {
      schema: PRESENT_SCHEMA,
      render: (_args, value) => presentContent(value),
    },
    timeoutMs: 15_000,
    execute: async (rawArgs) => presentResult(parsePresentInput(rawArgs)),
  })

  ctx.effect(() => ctx.tools.register(generate), 'chat-mindmap: generate_chat_mindmap')
  ctx.effect(() => ctx.tools.register(present), 'chat-mindmap: present_chat_mindmap')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-chat-mindmap',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (req.method === 'GET' && url.pathname.endsWith('/health')) {
          const fork = Boolean(panelServices?.subagents.getProvider('fork'))
          writeJson(res, 200, { ok: true, plugin: name, version: 4, capabilities: { jobs: false, subagents: fork, panelForkRegeneration: Boolean(panelServices && fork), settings: false, localGeneration: true, svgPreview: true }, capabilityNote: CAPABILITY_NOTE })
          return
        }
        const regenerateMatch = /\/maps\/([^/]+)\/regenerate$/.exec(url.pathname)
        if (regenerateMatch && req.method === 'POST') {
          const input = parseRegenerateInput(await readJsonBody(req))
          const libraryId = decodeId(regenerateMatch[1]!)
          if (!await getMindmap(libraryId)) { writeJson(res, 404, { ok: false, error: 'mindmap not found' }); return }
          writeJson(res, 202, { ok: true, value: startPanelRegeneration(panelServices, libraryId, input, panelRuns, activeByLibrary) })
          return
        }
        const panelRunMatch = /\/panel-runs\/([^/]+)$/.exec(url.pathname)
        if (panelRunMatch && req.method === 'GET') {
          const run = panelRuns.get(decodeId(panelRunMatch[1]!))
          if (!run) { writeJson(res, 404, { ok: false, error: 'panel run not found' }); return }
          writeJson(res, 200, { ok: true, value: { runId: run.runId, libraryId: run.libraryId, status: run.status, detail: run.detail, ...(run.childId ? { childId: run.childId } : {}), ...(run.revisionId ? { revisionId: run.revisionId } : {}) } satisfies PanelRunView })
          return
        }
        if (panelRunMatch && req.method === 'DELETE') {
          const run = panelRuns.get(decodeId(panelRunMatch[1]!))
          if (!run) { writeJson(res, 404, { ok: false, error: 'panel run not found' }); return }
          if (run.status === 'running') run.controller.abort()
          writeJson(res, 200, { ok: true, value: { runId: run.runId, status: run.status } })
          return
        }
        if (req.method === 'GET' && url.pathname.endsWith('/maps')) {
          const workspaceId = url.searchParams.get('workspaceId') || undefined
          const sessionId = url.searchParams.get('sessionId') || undefined
          const archivedParam = url.searchParams.get('archived')
          const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined
          if (archivedParam && archived === undefined) throw new InputError('archived must be true or false')
          writeJson(res, 200, { ok: true, value: await listMindmaps({ workspaceId, sessionId, archived }) })
          return
        }
        if (req.method === 'POST' && url.pathname.endsWith('/maps')) {
          const input = parseCreateMapInput(await readJsonBody(req))
          const document = input.document
          const record = await saveMindmap({ title: input.title ?? document.title, document, config: input.config, source: input.source })
          writeJson(res, 201, { ok: true, value: record })
          return
        }
        const archiveMatch = /\/maps\/([^/]+)\/archive$/.exec(url.pathname)
        if (req.method === 'POST' && archiveMatch) {
          const record = await archiveMindmap(decodeId(archiveMatch[1]!), true)
          if (!record) { writeJson(res, 404, { ok: false, error: 'mindmap not found' }); return }
          writeJson(res, 200, { ok: true, value: record })
          return
        }
        const mapMatch = /\/maps\/([^/]+)$/.exec(url.pathname)
        const revisionMatch = /\/maps\/([^/]+)\/revisions\/([^/]+)$/.exec(url.pathname)
        if (req.method === 'GET' && revisionMatch) {
          const libraryId = decodeId(revisionMatch[1]!)
          const revisionId = decodeRevisionId(revisionMatch[2]!)
          const record = await getMindmap(libraryId)
          if (!record) { writeJson(res, 410, { ok: false, error: 'mindmap revision expired' }); return }
          const document = revisionIdOf(record.current) === revisionId ? record.current : record.previous && revisionIdOf(record.previous) === revisionId ? record.previous : null
          if (!document) { writeJson(res, 410, { ok: false, error: 'mindmap revision expired' }); return }
          writeJson(res, 200, { ok: true, value: { libraryId, revisionId, title: document.title, document: asJsonValue(document), config: record.config } })
          return
        }
        if (req.method === 'GET' && mapMatch) {
          const record = await getMindmap(decodeId(mapMatch[1]!))
          if (!record) { writeJson(res, 404, { ok: false, error: 'mindmap not found' }); return }
          writeJson(res, 200, { ok: true, value: record })
          return
        }
        if ((req.method === 'PATCH' || req.method === 'DELETE') && mapMatch) {
          const id = decodeId(mapMatch[1]!)
          if (req.method === 'DELETE') {
            writeJson(res, 200, { ok: true, value: { deleted: await deleteMindmap(id) } })
            return
          }
          const patch = parsePatchInput(await readJsonBody(req))
          const record = await updateMindmap(id, patch)
          if (!record) { writeJson(res, 404, { ok: false, error: 'mindmap not found' }); return }
          writeJson(res, 200, { ok: true, value: record })
          return
        }
        if (req.method !== 'POST' || !url.pathname.endsWith('/generate')) {
          writeJson(res, 404, { ok: false, error: 'not found' })
          return
        }
        writeJson(res, 200, { ok: true, value: await generateResult(parseGenerateInput(await readJsonBody(req))) })
      } catch (error) {
        const response = errorResponse(error)
        writeJson(res, response.status, { ok: false, error: response.message })
      }
    },
  }), 'chat-mindmap: HTTP API')
}

export { buildMindmap }
