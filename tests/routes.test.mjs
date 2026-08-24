import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DomainError } from '../lib/domain/errors.js'
import { PLUGIN_ROUTE_NAME, PLUGIN_ROUTE_PREFIXES, ROUTES_VERSION, registerMindmapRoutes } from '../lib/host/routes.js'
import { INTERRUPTED_DETAIL, PanelRunRegistry } from '../lib/host/panel-runs.js'
import { revisionIdOf as revisionIdOfSafe } from '../lib/revisions.js'

const baseConfig = { layout: 'logicalStructure', density: 'standard', maxNodes: 360, theme: 'default', font: 'system', instruction: '', language: 'auto', contextLimit: 80_000 }

function makeRecord(overrides = {}) {
  return {
    libraryId: 'map-existing',
    title: 'Existing',
    current: { version: 1, title: 'Existing', root: { id: 'r', title: 'Existing', children: [] } },
    previous: undefined,
    previewCurrent: undefined,
    previewPrevious: undefined,
    schemaVersion: 2,
    recordVersion: 7,
    workspaceKey: 'legacy-unscoped',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    source: undefined,
    config: { ...baseConfig },
    ...overrides,
  }
}

const validDocument = () => ({ version: 1, title: 'Fresh', source: { kind: 'agent-context', characters: 120, generatedAt: '2026-01-01T00:00:00.000Z' }, root: { id: 'r', title: 'Fresh', children: [] } })
const MUT_HEADERS = { 'x-dsh-chat-mindmap-request': '1' }

class FakeRequest extends EventEmitter {
  constructor(opts = {}) {
    super()
    this.method = opts.method ?? 'GET'
    this.url = opts.url ?? '/'
    this.headers = opts.headers ?? {}
    this.socket = { remoteAddress: opts.remoteAddress ?? '127.0.0.1' }
  }
}

class FakeResponse {
  constructor() {
    this.statusCode = 0
    this.headerMap = {}
    this.chunks = []
    this.writableEnded = false
  }
  setHeader(name, value) { this.headerMap[name] = value }
  end(body) { if (body) this.chunks.push(String(body)); this.writableEnded = true }
  get bodyText() { return this.chunks.join('') }
  json() { return JSON.parse(this.bodyText) }
}

function makeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at >= 0) routes.splice(at, 1)
      }
    },
  }
}

async function settle(res) {
  for (let i = 0; i < 400 && !res.writableEnded; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(res.writableEnded, 'response never settled')
  return res
}

function makeDeps(overrides = {}) {
  const webServer = makeWebServer()
  const records = new Map()
  const calls = { load: [], list: [], save: [], patch: [], restore: [], delete: [], start: [] }
  const logs = []
  const deps = {
    webServer,
    agents: { get(id) { return id ? { id } : undefined } },
    panelRuns: new PanelRunRegistry(),
    capabilities: {},
    loadRecord: async (id) => { calls.load.push(id); return records.get(id) ?? null },
    listRecords: async (filters) => { calls.list.push(filters); return [] },
    saveRecord: async (input) => { calls.save.push(input); const rec = makeRecord({ libraryId: 'map-new', title: input.title, current: input.document }); records.set('map-new', rec); return rec },
    patchRecord: async (id, patch) => { calls.patch.push({ id, patch }); return records.get(id) ? makeRecord({ libraryId: id, recordVersion: 8 }) : null },
    restoreRecord: async (id, options) => { calls.restore.push({ id, options }); return makeRecord({ libraryId: id, recordVersion: 9 }) },
    deleteRecord: async (id, options) => { calls.delete.push({ id, options }); return true },
    startPanelRun: async (request) => { calls.start.push(request); return { runId: 'run-1', libraryId: request.libraryId, status: 'running', detail: '' } },
    workspaceKeyOfSession: (sessionId) => (sessionId === 'sess-ws' ? 'ws-bbb' : undefined),
    logger: (line) => { logs.push(line) },
    ...overrides,
  }
  return { deps, webServer, records, calls, logs, dispose: registerMindmapRoutes(deps) }
}

async function call(harness, method, url, opts = {}) {
  const req = new FakeRequest({ method, url, headers: opts.headers ?? {}, remoteAddress: opts.remoteAddress })
  const res = new FakeResponse()
  harness.webServer.routes[0].handler(req, res)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (opts.body !== undefined) req.emit('data', typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
    req.emit('end')
  }
  await settle(res)
  return res
}

function assertEnvelope(res, status, code) {
  assert.equal(res.statusCode, status)
  const parsed = res.json()
  assert.equal(parsed.ok, false)
  if (code) assert.equal(parsed.error.code, code)
  assert.equal(typeof parsed.error.message, 'string')
  return parsed
}

{ // registration shape and dispose
  const harness = makeDeps()
  assert.equal(harness.webServer.routes.length, PLUGIN_ROUTE_PREFIXES.length)
  assert.deepEqual(harness.webServer.routes.map((r) => r.kind), ['prefix', 'prefix'])
  assert.deepEqual(harness.webServer.routes.map((r) => r.path), [...PLUGIN_ROUTE_PREFIXES])
  harness.dispose()
  assert.equal(harness.webServer.routes.length, 0)
}

{ // health and capabilities endpoints
  const harness = makeDeps()
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const health = await call(harness, 'GET', prefix + '/health')
  assert.equal(health.statusCode, 200)
  const healthBody = health.json()
  assert.equal(healthBody.ok, true)
  assert.equal(healthBody.value.plugin, PLUGIN_ROUTE_NAME)
  assert.equal(healthBody.value.version, ROUTES_VERSION)
  assert.equal(healthBody.value.capabilities.toolCard, true)
  assert.equal(healthBody.value.capabilities.jobs, false)
  const caps = await call(harness, 'GET', prefix + '/capabilities')
  assert.equal(caps.statusCode, 200)
  assert.deepEqual(caps.json().value, { jobs: false, subagents: false, fork: false, settings: false, toolCard: true })
}

{ // request security fence: cross-site, missing mutation header, non-loopback
  const harness = makeDeps()
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const crossSite = await call(harness, 'GET', prefix + '/maps', { headers: { 'sec-fetch-site': 'cross-site' } })
  assertEnvelope(crossSite, 403, 'INVALID_REQUEST')
  const noHeader = await call(harness, 'POST', prefix + '/maps?sessionId=s1', { body: { document: validDocument() } })
  assertEnvelope(noHeader, 403, 'INVALID_REQUEST')
  const remote = await call(harness, 'GET', prefix + '/maps', { remoteAddress: '10.0.0.8' })
  assertEnvelope(remote, 403, 'INVALID_REQUEST')
  const sameSite = await call(harness, 'GET', prefix + '/maps', { headers: { 'sec-fetch-site': 'same-origin' } })
  assert.equal(sameSite.statusCode, 200)
}

{ // GET /maps/:id happy path, miss, and workspace fence
  const harness = makeDeps({ workspaceKeyOfSession: () => 'ws-bbb' })
  harness.records.set('map-existing', makeRecord())
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const found = await call(harness, 'GET', prefix + '/maps/map-existing')
  assert.equal(found.statusCode, 200)
  assert.equal(found.json().value.libraryId, 'map-existing')
  const missing = await call(harness, 'GET', prefix + '/maps/map-nope')
  assertEnvelope(missing, 404, 'MINDMAP_NOT_FOUND')
  harness.records.set('map-scoped', makeRecord({ libraryId: 'map-scoped', workspaceKey: 'ws-aaa' }))
  const fenced = await call(harness, 'GET', prefix + '/maps/map-scoped?sessionId=any')
  assertEnvelope(fenced, 404, 'WORKSPACE_SCOPE_MISMATCH')
  const blockedWithoutSession = await call(harness, 'GET', prefix + '/maps/map-scoped', {})
  assertEnvelope(blockedWithoutSession, 404, 'WORKSPACE_SCOPE_MISMATCH')
  const blockedPatch = await call(harness, 'PATCH', prefix + '/maps/map-scoped', { headers: MUT_HEADERS, body: { sessionId: 'any', title: 'Nope', expectedRecordVersion: 7 } })
  assertEnvelope(blockedPatch, 404, 'WORKSPACE_SCOPE_MISMATCH')
  const blockedDelete = await call(harness, 'DELETE', prefix + '/maps/map-scoped?sessionId=any&expectedRecordVersion=7', { headers: MUT_HEADERS })
  assertEnvelope(blockedDelete, 404, 'WORKSPACE_SCOPE_MISMATCH')
  const legacy = await call(harness, 'GET', prefix + '/maps/map-existing?sessionId=sess-ws')
  assert.equal(legacy.statusCode, 200)
}

{ // archive route uses the same live-session, workspace, and CAS fences
  const harness = makeDeps({ patchRecord: async (id, patch) => {
    const existing = harness.records.get(id)
    if (!existing || existing.recordVersion !== patch.expectedRecordVersion) throw new DomainError('MINDMAP_CONFLICT', 'record version drifted')
    const next = makeRecord({ libraryId: id, workspaceKey: existing.workspaceKey, recordVersion: existing.recordVersion + 1, archived: patch.archived })
    harness.records.set(id, next)
    return next
  } })
  harness.records.set('map-scoped', makeRecord({ libraryId: 'map-scoped', workspaceKey: 'ws-bbb' }))
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const archived = await call(harness, 'POST', prefix + '/maps/map-scoped/archive?sessionId=sess-ws', { headers: MUT_HEADERS, body: { archived: true, expectedRecordVersion: 7 } })
  assert.equal(archived.statusCode, 200)
  assert.equal(archived.json().value.archived, true)
  const stale = await call(harness, 'POST', prefix + '/maps/map-scoped/archive?sessionId=sess-ws', { headers: MUT_HEADERS, body: { archived: false, expectedRecordVersion: 7 } })
  assertEnvelope(stale, 409, 'MINDMAP_CONFLICT')
}

{ // revision resolution: current hit, previous hit, expired miss
  const current = { version: 1, title: 'C', root: { id: 'r', title: 'C', children: [] } }
  const previous = { version: 1, title: 'P', root: { id: 'r', title: 'P', children: [] } }
  const harness = makeDeps()
  harness.records.set('map-existing', makeRecord({ current, previous }))
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const curId = encodeURIComponent(revisionIdOfSafe(current))
  const prevId = encodeURIComponent(revisionIdOfSafe(previous))
  const hitCurrent = await call(harness, 'GET', prefix + '/maps/map-existing/revisions/' + curId)
  assert.equal(hitCurrent.statusCode, 200)
  assert.equal(hitCurrent.json().value.document.title, 'C')
  const hitPrevious = await call(harness, 'GET', prefix + '/maps/map-existing/revisions/' + prevId)
  assert.equal(hitPrevious.statusCode, 200)
  assert.equal(hitPrevious.json().value.document.title, 'P')
  const expired = await call(harness, 'GET', prefix + '/maps/map-existing/revisions/rev-deadbeefdeadbeefdeadbeef')
  assertEnvelope(expired, 410, 'MINDMAP_REVISION_EXPIRED')
  const goneRecord = await call(harness, 'GET', prefix + '/maps/map-nope/revisions/' + curId)
  assertEnvelope(goneRecord, 410, 'MINDMAP_REVISION_EXPIRED')
}

{ // POST /maps create: happy, no live session, invalid document
  const harness = makeDeps()
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const created = await call(harness, 'POST', prefix + '/maps?sessionId=sess-ws', { headers: MUT_HEADERS, body: { document: validDocument(), config: { maxNodes: 120 }, source: { kind: 'chat', name: 'session' } } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().value.libraryId, 'map-new')
  assert.equal(harness.calls.save.length, 1)
  assert.equal(harness.calls.save[0].document.title, 'Fresh')
  assert.equal(harness.calls.save[0].title, 'Fresh')
  assert.equal(harness.calls.save[0].config.maxNodes, 120)
  assert.equal(harness.calls.save[0].workspaceKey, 'ws-bbb')
  const noWorkspace = makeDeps({ workspaceKeyOfSession: () => undefined })
  const unresolved = await call(noWorkspace, 'POST', prefix + '/maps?sessionId=s1', { headers: MUT_HEADERS, body: { document: validDocument() } })
  assertEnvelope(unresolved, 409, 'SESSION_UNAVAILABLE')
  noWorkspace.dispose()
  const noSession = makeDeps({ agents: undefined })
  const rejected = await call(noSession, 'POST', noSession.webServer ? PLUGIN_ROUTE_PREFIXES[0] + '/maps?sessionId=s1' : '/', { headers: MUT_HEADERS, body: { document: validDocument() } })
  assertEnvelope(rejected, 409, 'SESSION_UNAVAILABLE')
  noSession.dispose()
  const badDoc = await call(harness, 'POST', prefix + '/maps?sessionId=sess-ws', { headers: MUT_HEADERS, body: { document: { version: 1 } } })
  assertEnvelope(badDoc, 400, 'INVALID_REQUEST')
}

{ // PATCH /maps/:id: CAS passthrough, validation errors, conflict mapping
  const harness = makeDeps()
  harness.records.set('map-existing', makeRecord())
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const patched = await call(harness, 'PATCH', prefix + '/maps/map-existing', { headers: MUT_HEADERS, body: { sessionId: 's1', title: 'Renamed', expectedRecordVersion: 7 } })
  assert.equal(patched.statusCode, 200)
  assert.deepEqual(harness.calls.patch[0], { id: 'map-existing', patch: { title: 'Renamed', document: undefined, config: undefined, archived: undefined, expectedRecordVersion: 7 } })
  const emptyPatch = await call(harness, 'PATCH', prefix + '/maps/map-existing', { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assertEnvelope(emptyPatch, 400, 'INVALID_REQUEST')
  const noCas = await call(harness, 'PATCH', prefix + '/maps/map-existing', { headers: MUT_HEADERS, body: { sessionId: 's1', title: 'X' } })
  assertEnvelope(noCas, 400, 'INVALID_REQUEST')
  const ghost = await call(harness, 'PATCH', prefix + '/maps/map-nope', { headers: MUT_HEADERS, body: { sessionId: 's1', title: 'X', expectedRecordVersion: 1 } })
  assertEnvelope(ghost, 404, 'MINDMAP_NOT_FOUND')
  const conflicting = makeDeps({ patchRecord: async () => { throw new DomainError('MINDMAP_CONFLICT', 'record version drifted') } })
  conflicting.records.set('map-existing', makeRecord())
  const conflict = await call(conflicting, 'PATCH', PLUGIN_ROUTE_PREFIXES[0] + '/maps/map-existing', { headers: MUT_HEADERS, body: { sessionId: 's1', title: 'X', expectedRecordVersion: 3 } })
  assertEnvelope(conflict, 409, 'MINDMAP_CONFLICT')
  conflicting.dispose()
}

{ // DELETE /maps/:id: CAS required via body or query, miss maps to 404
  const harness = makeDeps()
  harness.records.set('map-existing', makeRecord())
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const noCas = await call(harness, 'DELETE', prefix + '/maps/map-existing?sessionId=s1', { headers: MUT_HEADERS })
  assertEnvelope(noCas, 400, 'INVALID_REQUEST')
  const viaQuery = await call(harness, 'DELETE', prefix + '/maps/map-existing?sessionId=s1&expectedRecordVersion=7', { headers: MUT_HEADERS })
  assert.equal(viaQuery.statusCode, 200)
  assert.equal(viaQuery.json().value.deleted, true)
  assert.deepEqual(harness.calls.delete[0], { id: 'map-existing', options: { expectedRecordVersion: 7 } })
  const viaBody = await call(harness, 'DELETE', prefix + '/maps/map-existing?sessionId=s1', { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 8 } })
  assert.equal(viaBody.statusCode, 200)
  assert.equal(harness.calls.delete[1].options.expectedRecordVersion, 8)
  const refusing = makeDeps({ deleteRecord: async () => false })
  const gone = await call(refusing, 'DELETE', PLUGIN_ROUTE_PREFIXES[0] + '/maps/map-existing?sessionId=s1&expectedRecordVersion=7', { headers: MUT_HEADERS })
  assertEnvelope(gone, 404, 'MINDMAP_NOT_FOUND')
  refusing.dispose()
}

{ // restore-previous: live-agent gate, CAS gate, restored payload, miss
  const harness = makeDeps()
  harness.records.set('map-existing', makeRecord())
  const url = PLUGIN_ROUTE_PREFIXES[0] + '/maps/map-existing/restore-previous'
  const restored = await call(harness, 'POST', url, { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assert.equal(restored.statusCode, 200)
  assert.equal(restored.json().value.recordVersion, 9)
  const noSessionDeps = makeDeps({ agents: undefined })
  const gated = await call(noSessionDeps, 'POST', url, { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assertEnvelope(gated, 409, 'SESSION_UNAVAILABLE')
  noSessionDeps.dispose()
  const noCas = await call(harness, 'POST', url, { headers: MUT_HEADERS, body: { sessionId: 's1' } })
  assertEnvelope(noCas, 400, 'INVALID_REQUEST')
  const ok = await call(harness, 'POST', url, { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().value.recordVersion, 9)
  assert.deepEqual(harness.calls.restore[0], { id: 'map-existing', options: { expectedRecordVersion: 7 } })
  const nullRestoring = makeDeps({ restoreRecord: async () => null })
  const missing = await call(nullRestoring, 'POST', url, { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assertEnvelope(missing, 404, 'MINDMAP_NOT_FOUND')
  nullRestoring.dispose()
}

{ // regenerate: capability gate, record existence gate, 202 passthrough
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const unwired = makeDeps({ startPanelRun: undefined })
  unwired.records.set('map-existing', makeRecord())
  const uncapable = await call(unwired, 'POST', prefix + '/maps/map-existing/regenerate', { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assertEnvelope(uncapable, 503, 'CAPABILITY_UNAVAILABLE')
  unwired.dispose()
  const ghost = makeDeps()
  const missing = await call(ghost, 'POST', prefix + '/maps/map-nope/regenerate', { headers: MUT_HEADERS, body: { sessionId: 's1', expectedRecordVersion: 7 } })
  assertEnvelope(missing, 404, 'MINDMAP_NOT_FOUND')
  ghost.dispose()
  const harness = makeDeps()
  harness.records.set('map-existing', makeRecord())
  const accepted = await call(harness, 'POST', prefix + '/maps/map-existing/regenerate', { headers: MUT_HEADERS, body: { sessionId: 'sess-ws', instruction: '更细', supplementalContext: 'extra', expectedRecordVersion: 7 } })
  assert.equal(accepted.statusCode, 202)
  assert.equal(accepted.json().value.runId, 'run-1')
  assert.equal(harness.calls.start.length, 1)
  assert.equal(harness.calls.start[0].libraryId, 'map-existing')
  assert.equal(harness.calls.start[0].instruction, '更细')
}

{ // panel-runs GET and DELETE over the registry
  const harness = makeDeps()
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  harness.records.set('map-existing', makeRecord())
  harness.deps.panelRuns.register({ runId: 'panel-run-nine', libraryId: 'map-existing', sessionId: 's1', status: 'running', detail: '' })
  const view = await call(harness, 'GET', prefix + '/panel-runs/panel-run-nine?sessionId=s1')
  assert.equal(view.statusCode, 200)
  assert.equal(view.json().value.status, 'running')
  const interrupted = await call(harness, 'GET', prefix + '/panel-runs/panel-ghost-run')
  assert.equal(interrupted.json().value.detail, INTERRUPTED_DETAIL)
  assert.equal(interrupted.json().value.status, 'failed')
  const notCancellable = await call(harness, 'DELETE', prefix + '/panel-runs/panel-ghost-run', { headers: MUT_HEADERS })
  assert.equal(notCancellable.json().value.cancelled, false)
}

{ // list endpoint: scope validation, workspace resolution, filter forwarding
  const harness = makeDeps()
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const badScope = await call(harness, 'GET', prefix + '/maps?scope=galaxy')
  assertEnvelope(badScope, 400, 'INVALID_REQUEST')
  const badArchived = await call(harness, 'GET', prefix + '/maps?archived=maybe')
  assertEnvelope(badArchived, 400, 'INVALID_REQUEST')
  await call(harness, 'GET', prefix + '/maps?scope=session&archived=false')
  assert.deepEqual(harness.calls.list[0], { archived: false })
  await call(harness, 'GET', prefix + '/maps?scope=workspace&sessionId=sess-ws')
  assert.deepEqual(harness.calls.list[1], { workspaceId: 'ws-bbb', sessionId: 'sess-ws' })
}

{ // body limits, malformed JSON, unknown route, generic error mapping
  const harness = makeDeps()
  const prefix = PLUGIN_ROUTE_PREFIXES[0]
  const huge = await call(harness, 'POST', prefix + '/maps?sessionId=s1', { headers: MUT_HEADERS, body: JSON.stringify({ document: validDocument(), padding: 'x'.repeat(270_000) }) })
  assertEnvelope(huge, 413, 'INVALID_REQUEST')
  const malformed = await call(harness, 'POST', prefix + '/maps?sessionId=s1', { headers: MUT_HEADERS, body: '{not-json' })
  assertEnvelope(malformed, 400, 'INVALID_REQUEST')
  const unknown = await call(harness, 'GET', prefix + '/nowhere')
  assertEnvelope(unknown, 404, 'INVALID_REQUEST')
  const exploding = makeDeps({ saveRecord: async () => { throw new Error('boom') } })
  const internal = await call(exploding, 'POST', prefix + '/maps?sessionId=sess-ws', { headers: MUT_HEADERS, body: { document: validDocument() } })
  assertEnvelope(internal, 500, 'STORAGE_FAILED')
  assert.equal(internal.json().error.message.includes('boom'), false)
  assert.ok(exploding.logs.some((line) => line.includes('boom')), '5xx must reach the logger')
  exploding.dispose()
}

console.log('routes tests passed')