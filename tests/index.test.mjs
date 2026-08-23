import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMindmap, saveMindmap } from '../lib/library.js'
import { revisionIdOf } from '../lib/revisions.js'
import { createParentSideEffectProbe } from '../lib/host/adapters.js'
import { buildRegenerationPrompt } from '../lib/host/generation-executor.js'
import { apply } from '../lib/index.js'

const MUT_HEADERS = { 'x-dsh-chat-mindmap-request': '1', 'sec-fetch-site': 'same-origin' }

class FakeRequest extends EventEmitter {
  constructor(body, url, method = 'GET') {
    super()
    this.body = body
    this.url = url
    this.headers = method === 'GET' || method === 'HEAD' ? {} : { ...MUT_HEADERS }
    this.socket = { remoteAddress: '127.0.0.1' }
    this.method = method
  }
  setEncoding() {}
  start() {
    process.nextTick(() => {
      if (this.body !== undefined) this.emit('data', this.body)
      this.emit('end')
    })
  }
}

class FakeResponse {
  statusCode = 200
  headers = {}
  body = ''
  writableEnded = false
  constructor() {
    // Route handlers are fire-and-forget (dispatch settles asynchronously),
    // so completion is signaled by end(), not by the handler returning.
    this.finished = new Promise((resolve) => { this._finish = resolve })
  }
  setHeader(name, value) { this.headers[name] = value }
  end(value) {
    assert.equal(this.writableEnded, false, 'response ended twice')
    this.body = value ?? ''
    this.writableEnded = true
    this._finish()
  }
}

function makeDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeFakeRuntime(options = {}) {
  const state = { starts: [] }
  return {
    state,
    getProvider(name) { return name === 'fork' ? { name: 'fork' } : undefined },
    start(name, request) {
      const deferred = makeDeferred()
      const run = {
        id: 'child-' + (state.starts.length + 1),
        result: options.hang ? new Promise(() => undefined) : deferred.promise,
        async dispose() {},
      }
      state.starts.push({ name, request, deferred })
      return run
    },
    resolveNext(outcome) {
      const last = state.starts[state.starts.length - 1]
      assert.ok(last, 'no runtime start to resolve')
      last.deferred.resolve({
        stopReason: outcome.stopReason ?? 'completed',
        ...(outcome.structured !== undefined ? { structured: outcome.structured } : {}),
        ...(outcome.diagnostic !== undefined ? { diagnostic: outcome.diagnostic } : {}),
      })
    },
  }
}

class FakeJobsService {
  constructor() {
    this.started = []
    this.hooksById = new Map()
  }
  start(spec) {
    const id = 'mindmap-' + (this.started.length + 1)
    this.started.push({ id, spec })
    this.hooksById.set(id, spec.run())
    return id
  }
  hooks(jobId) {
    const hooks = this.hooksById.get(jobId)
    assert.ok(hooks, 'hooks missing for ' + jobId)
    return hooks
  }
}

const OUTLINE = { title: 'Assembled', outline: '# Assembled\n## One\n## Two' }

function makeCtx(injectGroups = []) {
  const registeredTools = new Map()
  const routes = []
  const disposers = []
  const ctx = {
    tools: {
      register(tool) {
        registeredTools.set(tool.name, tool)
        return () => registeredTools.delete(tool.name)
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(makeDisposer, label) {
      const disposer = makeDisposer()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
  }
  ctx.inject = (names, callback) => {
    const group = injectGroups.find((candidate) => candidate.names.join('+') === names.join('+'))
    if (!group) return
    callback({
      ...group.services,
      effect(makeDisposer, label) {
        const disposer = makeDisposer()
        if (typeof disposer === 'function') disposers.push(disposer)
      },
    })
  }
  return { ctx, registeredTools, routes, disposers }
}

async function waitForRunStatus(routes, runId, status, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    last = await call(routes, 'GET', '/@ericwang1358/dsh-chat-mindmap/panel-runs/' + encodeURIComponent(runId))
    if (last.payload?.value?.status === status) return last
  }
  return last
}

/** The adapter reaches runtime.start asynchronously; tests must aim their
 *  resolveNext at the NEWLY created deferred, not an older one. */
async function waitForNewStart(runtime, countBefore, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (runtime.state.starts.length > countBefore) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('runtime.start did not appear within ' + timeoutMs + 'ms')
}

async function call(routes, method, url, body) {
  const handler = routes[0].handler
  const req = new FakeRequest(body === undefined ? undefined : JSON.stringify(body), url, method)
  const res = new FakeResponse()
  const settled = handler(req, res)
  // Pump the wire after dispatch attached its body listeners (same tick).
  if (method !== 'GET' && method !== 'HEAD') req.start()
  await res.finished
  if (process.env.DSH_INDEX_DEBUG) console.log('[call]', method, url, '->', res.statusCode, String(res.body).slice(0, 220))
  return { status: res.statusCode, payload: res.body ? JSON.parse(res.body) : null }
}


const root = await mkdtemp(join(tmpdir(), 'dsh-chat-index-'))
process.env.DSH_MINDMAP_HOME = root
const trace = (label) => { if (process.env.DSH_INDEX_DEBUG) console.error('[trace] ' + label) }
try {
  // ------------------------------------------------------------------
  // Assembly + capabilities reflect optional services (W1 golden set).
  // ------------------------------------------------------------------
  const jobs = new FakeJobsService()
  const runtime = makeFakeRuntime()
  const probe = createParentSideEffectProbe()
  const agents = { registry: new Map([['session-active', probe.parent]]), get(id) { return this.registry.get(String(id)) } }
  const full = makeCtx([
    { names: ['agents', 'subagents'], services: { agents, subagents: runtime } },
    { names: ['jobs'], services: { jobs } },
  ])
  apply(full.ctx)
  trace('after apply full')
  assert.deepEqual([...full.registeredTools.keys()].sort(), ['generate_chat_mindmap', 'present_chat_mindmap'], 'canonical chat tools must be registered')
  assert.equal(full.routes.length, 2, 'both plugin route prefixes must be registered')
  trace('routes registered')

  const caps = await call(full.routes, 'GET', '/@ericwang1358/dsh-chat-mindmap/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.payload.value.jobs, true)
  assert.equal(caps.payload.value.subagents, true)
  assert.equal(caps.payload.value.fork, true)

  const bare = makeCtx([])
  apply(bare.ctx)
  const bareCaps = await call(bare.routes, 'GET', '/@ericwang1358/dsh-chat-mindmap/capabilities')
  assert.equal(bareCaps.payload.value.jobs, false)
  assert.equal(bareCaps.payload.value.fork, false)

  // ------------------------------------------------------------------
  // Launcher end-to-end through the assembly: job accepted, settles into a
  // saved V2 record, completion output carries both durable identifiers.
  // ------------------------------------------------------------------
  trace('caps ok')
  const generate = full.registeredTools.get('generate_chat_mindmap')
  trace('before launch')
  const launch = await generate.execute({ context: 'alpha beta gamma', title: 'Assembled' }, { agent: { id: 'session-active' } })
  trace('launched')
  assert.equal(launch.kind, 'background')
  const done = jobs.hooks(launch.jobId).done
  runtime.resolveNext({ structured: OUTLINE })
  trace('resolving runtime')
  const outcome = await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 4000))])
  trace('race settled: ' + String(outcome && outcome.status))
  if (outcome === 'TIMEOUT') {
    console.error('[diag] starts=', runtime.state.starts.length, 'jobsStarted=', JSON.stringify(jobs.started.map((s) => s.id)), 'settled=', String(runtime.state.starts[0]?.deferred.promise))
    console.error('[diag] done status flags:', jobs.hooksById.get(launch.jobId) === undefined ? 'no hooks' : 'hooks ok')
  }
  assert.equal(outcome.status, 'completed')
  const libraryId = /libraryId=([^\s]+)/.exec(outcome.output)[1]
  const revisionId = /revisionId=([^\s]+)/.exec(outcome.output)[1]
  const stored = await getMindmap(libraryId)
  trace('stored read back: ' + (stored ? 'yes' : 'null'))
  assert.ok(stored, 'completion must have persisted the record before settling the job')
  assert.equal(revisionIdOf(stored.current), revisionId)
  assert.equal(stored.title, 'Assembled')

  const present = full.registeredTools.get('present_chat_mindmap')
  const presentation = await present.execute({ libraryId, revisionId }, { agent: { id: 'session-active' } })
  trace('presentation state: ' + presentation.state)
  assert.equal(presentation.state, 'available')
  const rendered = present.output.render({}, presentation)
  assert.match(rendered[0].text, /^dsh-chat-mindmap-preview:/)

  // ------------------------------------------------------------------
  // Panel regeneration over REST V2: 202 view -> completed run; the parent
  // agent object is never touched (panel never writes to chat).
  // ------------------------------------------------------------------
  const seeded = await saveMindmap({ title: 'Panel map', document: { version: 1, title: 'Panel map', root: { id: 'r', title: 'Panel map', children: [] }, source: { kind: 'agent-context', characters: 10, generatedAt: '2026-01-01T00:00:00.000Z' } } })
  const prefix = '/@ericwang1358/dsh-chat-mindmap'
  const startsBefore = runtime.state.starts.length
  const started = await call(full.routes, 'POST', prefix + '/maps/' + encodeURIComponent(seeded.libraryId) + '/regenerate', { sessionId: 'session-active', expectedRecordVersion: seeded.recordVersion, instruction: '更精简' })
  assert.equal(started.status, 202)
  const runView = started.payload.value
  assert.equal(runView.libraryId, seeded.libraryId)
  assert.equal(runView.status, 'accepted', '§11: the runId must be answered before settlement')
  await waitForNewStart(runtime, startsBefore)
  runtime.resolveNext({ structured: OUTLINE })
  const polled = await waitForRunStatus(full.routes, runView.runId, 'completed')
  assert.equal(polled.payload.value.status, 'completed')
  const updated = await getMindmap(seeded.libraryId)
  assert.equal(polled.payload.value.revisionId, revisionIdOf(updated.current))
  assert.equal(probe.emissionCount(), 0, 'panel run must never touch the parent agent surface')

  // Busy conflict while the same map already owns the generation lock.
  const secondRecord = await saveMindmap({ title: 'Second', document: { version: 1, title: 'Second', root: { id: 'r2', title: 'Second', children: [] }, source: { kind: 'agent-context', characters: 5, generatedAt: '2026-01-01T00:00:00.000Z' } } })
  const firstStart = await call(full.routes, 'POST', prefix + '/maps/' + encodeURIComponent(secondRecord.libraryId) + '/regenerate', { sessionId: 'session-active', expectedRecordVersion: secondRecord.recordVersion })
  assert.equal(firstStart.status, 202)
  const duplicate = await call(full.routes, 'POST', prefix + '/maps/' + encodeURIComponent(secondRecord.libraryId) + '/regenerate', { sessionId: 'session-active', expectedRecordVersion: secondRecord.recordVersion })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.payload.error.code, 'MINDMAP_BUSY')
  await waitForNewStart(runtime, startsBefore + 1)
  runtime.resolveNext({ structured: OUTLINE })
  await new Promise((resolve) => setTimeout(resolve, 40))

  // ------------------------------------------------------------------
  // Dispose-to-zero: teardown cancels in-flight runs and reports interrupted.
  // ------------------------------------------------------------------
  const hangRuntime = makeFakeRuntime({ hang: true })
  const hangAgents = { get: () => ({}) }
  const hangCtxPack = makeCtx([{ names: ['agents', 'subagents'], services: { agents: hangAgents, subagents: hangRuntime } }])
  apply(hangCtxPack.ctx)
  const hangSeed = await saveMindmap({ title: 'Hang', document: { version: 1, title: 'Hang', root: { id: 'h', title: 'Hang', children: [] }, source: { kind: 'agent-context', characters: 4, generatedAt: '2026-01-01T00:00:00.000Z' } } })
  const hangStart = await call(hangCtxPack.routes, 'POST', prefix + '/maps/' + encodeURIComponent(hangSeed.libraryId) + '/regenerate', { sessionId: 'session-x', expectedRecordVersion: hangSeed.recordVersion })
  assert.equal(hangStart.status, 202)
  for (const disposer of hangCtxPack.disposers) await disposer?.()
  await new Promise((resolve) => setTimeout(resolve, 30))
  const afterDispose = await call(hangCtxPack.routes, 'GET', prefix + '/panel-runs/' + encodeURIComponent(hangStart.payload.value.runId))
  assert.equal(afterDispose.payload.value.detail, '生成已中断')

  // ------------------------------------------------------------------
  // F-1 closure (S2 review item): note-budget omission reporting.
  // ------------------------------------------------------------------
  function promptCase(notes) {
    return buildRegenerationPrompt({
      title: 'F-1',
      current: {
        version: 1,
        title: 'F-1',
        source: { kind: 'agent-context', characters: 3, generatedAt: '2026-01-01T00:00:00.000Z' },
        root: { id: 'r', title: 'F-1', children: notes.map(([id, note]) => ({ id, title: id.toUpperCase(), ...(note ? { note } : {}) })) },
      },
      config: { contextLimit: 8_000, maxNodes: 360, instruction: '' },
    })
  }
  const attached = promptCase([['a', 'small note'], ['b', 'another']])
  assert.equal(attached.text.includes('<node-notes'), true)
  assert.equal(attached.text.includes('未附带'), false)
  const partial = promptCase([['a', 'n'.repeat(9_000)], ['b', 'kept']])
  assert.equal(partial.text.includes('未附带'), true, 'partial overflow must report the omitted count')
  const allGone = promptCase([['a', 'x'.repeat(9_000)]])
  assert.match(allGone.text, /全部[^\n]*未附带/, 'F-1: all-notes-omitted case must state the gap explicitly')

  console.log('index assembly tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
