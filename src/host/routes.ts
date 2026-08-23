import { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { validateMindmapDocument, type MindmapDocument } from '../core.js'
import { DomainError, type DomainErrorCode } from '../domain/errors.js'
import {
  deleteMindmap,
  getMindmap,
  listMindmaps,
  restorePreviousMindmap,
  saveMindmap,
  updateMindmap,
  type MindmapRecord,
} from '../library.js'
import { revisionIdOf } from '../revisions.js'
import type { PanelRunRegistry, PanelRunView } from './panel-runs.js'
import {
  LIBRARY_ID_MAX_LENGTH,
  LIBRARY_ID_PATTERN,
  REVISION_ID_MAX_LENGTH,
  REVISION_ID_PATTERN,
  RUN_ID_MAX_LENGTH,
  RUN_ID_PATTERN,
} from './id-patterns.js'
import { parseLaunchConfig, parseLaunchSource } from './tools.js'

// ---------------------------------------------------------------------------
// REST V2 (§11). Canonical implementation; the frozen inline handler in
// src/index.ts is superseded and deleted at the integration switchover.
// Error envelope: { ok:false, error:{ code, message } } — never String(error).
// ---------------------------------------------------------------------------

export const PLUGIN_ROUTE_PREFIXES = ['/@ericwang1358/dsh-chat-mindmap', '/@dsh-external/dsh-chat-mindmap'] as const
export const ROUTES_VERSION = 5
export const PLUGIN_ROUTE_NAME = '@ericwang1358/dsh-chat-mindmap'
const BODY_LIMIT_BYTES = 256_000
const BODY_TIMEOUT_MS = 15_000

export interface MindmapCapabilities {
  jobs: boolean
  subagents: boolean
  fork: boolean
  settings: boolean
  toolCard: boolean
}

export interface PanelStartRequest {
  libraryId: string
  sessionId: string
  instruction?: string
  supplementalContext?: string
  expectedRecordVersion: number
}

export interface MindmapRouteDeps {
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void }
  /** Live-agent registry fencing every mutation; absent → all mutations are SESSION_UNAVAILABLE. */
  agents?: { get(id: ReturnType<typeof SessionId>): unknown }
  panelRuns: PanelRunRegistry
  /** Panel generation starter (integration wires the S2 adapter); absent → regenerate reports CAPABILITY_UNAVAILABLE. */
  startPanelRun?(request: PanelStartRequest): Promise<PanelRunView> | PanelRunView
  capabilities?: Partial<MindmapCapabilities>
  loadRecord?(id: string): Promise<MindmapRecord | null>
  listRecords?(filters: { workspaceId?: string; sessionId?: string; archived?: boolean }): Promise<unknown>
  saveRecord?(input: Parameters<typeof saveMindmap>[0]): Promise<MindmapRecord>
  patchRecord?(id: string, patch: Parameters<typeof updateMindmap>[1]): Promise<MindmapRecord | null>
  restoreRecord?(id: string, options?: { expectedRecordVersion?: number }): Promise<MindmapRecord | null>
  deleteRecord?(id: string, options?: { expectedRecordVersion?: number }): Promise<boolean>
  logger?(line: string): void
  workspaceKeyOfSession?(sessionId: string): string | undefined
}

interface AgentRef { id?: string }

class RouteError extends Error {
  constructor(readonly status: number, readonly code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

const STATUS_BY_CODE: Partial<Record<DomainErrorCode, number>> = {
  INVALID_REQUEST: 400,
  MINDMAP_NOT_FOUND: 404,
  WORKSPACE_SCOPE_MISMATCH: 404,
  MINDMAP_BUSY: 409,
  MINDMAP_CONFLICT: 409,
  SESSION_UNAVAILABLE: 409,
  MINDMAP_REVISION_EXPIRED: 410,
  CAPABILITY_UNAVAILABLE: 503,
  STORAGE_FAILED: 500,
}

function toErrorResponse(error: unknown): { status: number; code: DomainErrorCode; message: string } {
  if (error instanceof RouteError) return { status: error.status, code: error.code, message: error.message }
  if (error instanceof DomainError) return { status: STATUS_BY_CODE[error.code] ?? 500, code: error.code, message: error.message }
  if (error instanceof Error && error.message === 'invalid library id') return { status: 400, code: 'INVALID_REQUEST', message: error.message }
  return { status: 500, code: 'STORAGE_FAILED', message: 'mindmap service failed' }
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function writeError(res: ServerResponse, error: unknown, logger?: (line: string) => void): void {
  const response = toErrorResponse(error)
  if (response.status >= 500 && logger) {
    try {
      logger('routes: ' + (error instanceof Error ? (error.stack ?? error.message) : String(error)))
    } catch {
      // A broken sink must never break the error response.
    }
  }
  writeJson(res, response.status, { ok: false, error: { code: response.code, message: response.message } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new RouteError(400, 'INVALID_REQUEST', field + ' must be a string of at most ' + maxLength + ' characters')
  return value
}

function decodeSegment(encoded: string, pattern: RegExp, maxLength: number, field: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    throw new RouteError(400, 'INVALID_REQUEST', field + ' is not a valid encoding')
  }
  if (decoded.length > maxLength || !pattern.test(decoded)) throw new RouteError(400, 'INVALID_REQUEST', field + ' is invalid')
  return decoded
}

// Canonical request-security copy: loopback + same-origin/Fetch Metadata +
// custom mutation header. The frozen duplicate in index.ts is superseded at
// integration switchover; behavior parity is locked by its golden assertions.
function requestSecurityError(req: IncomingMessage): RouteError | null {
  const headers = req.headers ?? {}
  const site = headers['sec-fetch-site']
  if (site === 'cross-site' || site === 'none') return new RouteError(403, 'INVALID_REQUEST', 'cross-site request rejected')
  const origin = headers.origin
  if (origin) {
    if (origin === 'null') return new RouteError(403, 'INVALID_REQUEST', 'opaque origin rejected')
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      return new RouteError(403, 'INVALID_REQUEST', 'invalid request origin')
    }
    const host = headers.host
    if (!host || parsed.host !== host || !['http:', 'https:'].includes(parsed.protocol)) return new RouteError(403, 'INVALID_REQUEST', 'origin is not the DSH web origin')
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) {
    if (headers['x-dsh-chat-mindmap-request'] !== '1') return new RouteError(403, 'INVALID_REQUEST', 'plugin request header required')
  }
  const remote = req.socket?.remoteAddress
  if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return new RouteError(403, 'INVALID_REQUEST', 'non-loopback request rejected')
  return null
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0
    let settled = false
    const timer = setTimeout(() => fail(new RouteError(408, 'INVALID_REQUEST', 'request body timeout')), BODY_TIMEOUT_MS)
    const fail = (error: RouteError): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    req.on('data', (chunk: unknown) => {
      if (settled) return
      bytes += Buffer.byteLength(chunk as string, 'utf8')
      if (bytes > BODY_LIMIT_BYTES) {
        fail(new RouteError(413, 'INVALID_REQUEST', 'request body too large'))
        return
      }
      body += chunk as string
    })
    req.on('end', () => {
      if (settled) return
      try {
        const parsed = body ? JSON.parse(body) : {}
        settled = true
        clearTimeout(timer)
        resolve(parsed)
      } catch {
        fail(new RouteError(400, 'INVALID_REQUEST', 'invalid JSON'))
      }
    })
    req.on('error', (error: unknown) => {
      clearTimeout(timer)
      fail(new RouteError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'request stream failed'))
    })
  })
}

function requireLiveAgent(deps: MindmapRouteDeps, rawSessionId: unknown): AgentRef {
  const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
  if (!sessionId || !deps.agents) throw new RouteError(409, 'SESSION_UNAVAILABLE', 'no live session is available for this mutation')
  const agent = deps.agents.get(SessionId(sessionId))
  if (!agent) throw new RouteError(409, 'SESSION_UNAVAILABLE', 'no live session is available for this mutation')
  return agent as AgentRef
}

function requireExpectedRecordVersion(container: Record<string, unknown>): number {
  const version = container.expectedRecordVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new RouteError(400, 'INVALID_REQUEST', 'expectedRecordVersion must be a positive integer')
  return version
}

async function loadExisting(deps: MindmapRouteDeps, id: string): Promise<MindmapRecord> {
  const record = await (deps.loadRecord ?? getMindmap)(id)
  if (!record) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
  return record
}

interface CreateBody {
  title?: string
  document: MindmapDocument
  config?: ReturnType<typeof parseLaunchConfig>
  source?: NonNullable<ReturnType<typeof parseLaunchSource>>
}

function parseCreateBody(value: unknown): CreateBody {
  if (!isRecord(value)) throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object')
  let document: MindmapDocument
  try {
    document = validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 })
  } catch (error) {
    throw new RouteError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'invalid document')
  }
  return {
    title: optionalString(value.title, 'title', 120),
    document,
    config: parseLaunchConfig(value.config),
    source: parseLaunchSource(value.source),
  }
}

interface PatchBody {
  title?: string
  document?: MindmapDocument
  config?: ReturnType<typeof parseLaunchConfig>
  archived?: boolean
  expectedRecordVersion: number
}

function parsePatchBody(value: Record<string, unknown>): PatchBody {
  let document: MindmapDocument | undefined
  if (typeof value.document !== 'undefined') {
    try {
      document = validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 })
    } catch (error) {
      throw new RouteError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'invalid document')
    }
  }
  let archived: boolean | undefined
  if (typeof value.archived !== 'undefined') {
    if (value.archived !== true && value.archived !== false) throw new RouteError(400, 'INVALID_REQUEST', 'archived must be a boolean')
    archived = value.archived
  }
  const title = optionalString(value.title, 'title', 120)
  const config = parseLaunchConfig(value.config)
  const expectedRecordVersion = requireExpectedRecordVersion(value)
  if (typeof title === 'undefined' && typeof document === 'undefined' && typeof config === 'undefined' && typeof archived === 'undefined') throw new RouteError(400, 'INVALID_REQUEST', 'patch must include an editable field')
  return { title, document, config, archived, expectedRecordVersion }
}

async function dispatch(deps: MindmapRouteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const securityError = requestSecurityError(req)
  if (securityError) {
    writeError(res, securityError)
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname
  const method = req.method ?? ''

  if (method === 'GET' && pathname.endsWith('/health')) {
    writeJson(res, 200, { ok: true, value: { plugin: PLUGIN_ROUTE_NAME, version: ROUTES_VERSION, capabilities: resolveCapabilities(deps) } })
    return
  }
  if (method === 'GET' && pathname.endsWith('/capabilities')) {
    writeJson(res, 200, { ok: true, value: resolveCapabilities(deps) })
    return
  }

  const revisionMatch = /\/maps\/([^/]+)\/revisions\/([^/]+)$/.exec(pathname)
  if (revisionMatch && method === 'GET') {
    const libraryId = decodeSegment(revisionMatch[1]!, LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id')
    const revisionId = decodeSegment(revisionMatch[2]!, REVISION_ID_PATTERN, REVISION_ID_MAX_LENGTH, 'revision id')
    const record = await (deps.loadRecord ?? getMindmap)(libraryId)
    if (!record) throw new DomainError('MINDMAP_REVISION_EXPIRED', 'mindmap revision expired')
    const document = revisionIdOf(record.current) === revisionId ? record.current : record.previous && revisionIdOf(record.previous) === revisionId ? record.previous : null
    if (!document) throw new DomainError('MINDMAP_REVISION_EXPIRED', 'mindmap revision expired')
    writeJson(res, 200, { ok: true, value: { libraryId, revisionId, title: document.title, document, config: record.config } })
    return
  }

  const restoreMatch = /\/maps\/([^/]+)\/restore-previous$/.exec(pathname)
  if (restoreMatch && method === 'POST') {
    const bodyValue = await readJsonBody(req)
    if (!isRecord(bodyValue)) throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object')
    requireLiveAgent(deps, bodyValue.sessionId)
    const expectedRecordVersion = requireExpectedRecordVersion(bodyValue)
    const restored = await (deps.restoreRecord ?? restorePreviousMindmap)(restoreMatch[1]!, { expectedRecordVersion })
    if (!restored) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
    writeJson(res, 200, { ok: true, value: restored })
    return
  }

  const regenerateMatch = /\/maps\/([^/]+)\/regenerate$/.exec(pathname)
  if (regenerateMatch && method === 'POST') {
    const bodyValue = await readJsonBody(req)
    if (!isRecord(bodyValue)) throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object')
    requireLiveAgent(deps, bodyValue.sessionId)
    const libraryId = decodeSegment(regenerateMatch[1]!, LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id')
    await loadExisting(deps, libraryId)
    const expectedRecordVersion = requireExpectedRecordVersion(bodyValue)
    if (!deps.startPanelRun) throw new DomainError('CAPABILITY_UNAVAILABLE', 'panel regeneration is not wired in this deployment')
    const view = await deps.startPanelRun({
      libraryId,
      sessionId: typeof bodyValue.sessionId === 'string' ? bodyValue.sessionId : '',
      instruction: optionalString(bodyValue.instruction, 'instruction', 4_000),
      supplementalContext: optionalString(bodyValue.supplementalContext, 'supplementalContext', 200_000),
      expectedRecordVersion,
    })
    writeJson(res, 202, { ok: true, value: view })
    return
  }

  const panelRunMatch = /\/panel-runs\/([^/]+)$/.exec(pathname)
  if (panelRunMatch && (method === 'GET' || method === 'DELETE')) {
    const runId = decodeSegment(panelRunMatch[1]!, RUN_ID_PATTERN, RUN_ID_MAX_LENGTH, 'run id')
    if (method === 'GET') {
      writeJson(res, 200, { ok: true, value: deps.panelRuns.getViewOrInterrupted(runId) })
      return
    }
    const cancelled = deps.panelRuns.cancel(runId)
    writeJson(res, 200, { ok: true, value: { runId, cancelled } })
    return
  }

  if (pathname.endsWith('/maps') && method === 'GET') {
    const scope = url.searchParams.get('scope') ?? 'session'
    if (scope !== 'session' && scope !== 'workspace') throw new RouteError(400, 'INVALID_REQUEST', 'scope must be session or workspace')
    const archivedParam = url.searchParams.get('archived')
    const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined
    if (archivedParam !== null && archived === undefined) throw new RouteError(400, 'INVALID_REQUEST', 'archived must be true or false')
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    const workspaceId = scope === 'workspace' && sessionId ? deps.workspaceKeyOfSession?.(sessionId) : undefined
    const records = await (deps.listRecords ?? listMindmaps)({
      ...(workspaceId ? { workspaceId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(archived !== undefined ? { archived } : {}),
    })
    writeJson(res, 200, { ok: true, value: records })
    return
  }

  if (pathname.endsWith('/maps') && method === 'POST') {
    requireLiveAgent(deps, url.searchParams.get('sessionId') ?? undefined)
    const input = parseCreateBody(await readJsonBody(req))
    const record = await (deps.saveRecord ?? saveMindmap)({
      title: input.title ?? input.document.title,
      document: input.document,
      ...(input.config ? { config: input.config } : {}),
      ...(input.source ? { source: input.source } : {}),
    })
    writeJson(res, 201, { ok: true, value: record })
    return
  }

  const mapMatch = /\/maps\/([^/]+)$/.exec(pathname)
  if (mapMatch) {
    const id = decodeSegment(mapMatch[1]!, LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id')
    if (method === 'GET') {
      const record = await (deps.loadRecord ?? getMindmap)(id)
      if (!record) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
      const sessionIdParam = url.searchParams.get('sessionId') ?? undefined
      if (sessionIdParam && typeof record.workspaceKey === 'string' && record.workspaceKey !== 'legacy-unscoped') {
        const callerWorkspace = deps.workspaceKeyOfSession?.(sessionIdParam)
        if (callerWorkspace !== undefined && callerWorkspace !== record.workspaceKey) throw new DomainError('WORKSPACE_SCOPE_MISMATCH', 'mindmap not found in this workspace')
      }
      writeJson(res, 200, { ok: true, value: record })
      return
    }
    if (method === 'PATCH') {
      const bodyValue = await readJsonBody(req)
      if (!isRecord(bodyValue)) throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object')
      requireLiveAgent(deps, bodyValue.sessionId)
      await loadExisting(deps, id)
      const patch = parsePatchBody(bodyValue)
      const record = await (deps.patchRecord ?? updateMindmap)(id, {
        title: patch.title,
        document: patch.document,
        config: patch.config,
        archived: patch.archived,
        expectedRecordVersion: patch.expectedRecordVersion,
      })
      if (!record) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
      writeJson(res, 200, { ok: true, value: record })
      return
    }
    if (method === 'DELETE') {
      const bodyValue = await readJsonBody(req)
      const body = isRecord(bodyValue) ? bodyValue : {}
      requireLiveAgent(deps, typeof body.sessionId === 'string' ? body.sessionId : url.searchParams.get('sessionId'))
      await loadExisting(deps, id)
      const expectedFromQuery = url.searchParams.get('expectedRecordVersion')
      let expectedRecordVersion: number | undefined
      if (typeof body.expectedRecordVersion === 'number') expectedRecordVersion = body.expectedRecordVersion
      else if (expectedFromQuery !== null && /^[1-9][0-9]*$/.test(expectedFromQuery)) expectedRecordVersion = Number(expectedFromQuery)
      if (typeof expectedRecordVersion !== 'number' || !Number.isInteger(expectedRecordVersion) || expectedRecordVersion < 1) throw new RouteError(400, 'INVALID_REQUEST', 'expectedRecordVersion must be a positive integer')
      const deleted = await (deps.deleteRecord ?? deleteMindmap)(id, { expectedRecordVersion })
      if (!deleted) throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found')
      writeJson(res, 200, { ok: true, value: { deleted: true } })
      return
    }
  }

  throw new RouteError(404, 'INVALID_REQUEST', 'not found')
}

function resolveCapabilities(deps: MindmapRouteDeps): MindmapCapabilities {
  return { jobs: false, subagents: false, fork: false, settings: false, toolCard: true, ...(deps.capabilities ?? {}) }
}

/**
 * REST V2 assembly. Integration wires this with one call inside apply();
 * tests drive it against a capturing fake webServer.
 */
export function registerMindmapRoutes(deps: MindmapRouteDeps): () => void {
  const disposers: Array<() => void> = []
  for (const prefix of PLUGIN_ROUTE_PREFIXES) {
    disposers.push(
      deps.webServer.register({
        kind: 'prefix',
        path: prefix,
        handler: (req: IncomingMessage, res: ServerResponse) => {
          void (async () => {
            try {
              await dispatch(deps, req, res)
            } catch (error) {
              writeError(res, error, deps.logger)
            }
          })()
        },
      }),
    )
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}
