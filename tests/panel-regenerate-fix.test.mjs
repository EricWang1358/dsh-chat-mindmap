import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countMindmapNodes, buildMindmap } from '../lib/core.js'
import {
  regenerateUnavailableWhileRunning,
  shouldDropPanelRunResponse,
} from '../lib/client/components/BrainmapView.js'
import { getMindmap, saveMindmap, listMindmaps } from '../lib/library.js'
import { apply } from '../lib/index.js'

// Regression suite for the 0.2.7 panel-regenerate fix set.  Three
// reproducible bugs motivated these tests:
//
//   1. The POST /regenerate response is answered with status='accepted'
//      while the async settle() is still pending.  The original polling
//      effect gated on `panelRun.status === 'running'` only, so it never
//      started polling, the accepted->running->completed transition was
//      never observed, and the original mindmap was never refreshed.
//      The fix widens the gate to `running|accepted` and the predicate
//      to the same set.
//
//   2. After the user cancels or starts a new run, in-flight poll
//      responses for the abandoned run could still call
//      setRecord/setStatus on whatever record the user had navigated
//      to.  The fix routes every late-response check through
//      `shouldDropPanelRunResponse`, which compares the runId from the
//      latest `panelRunRef` against the `targetRunId` captured in the
//      effect's closure.
//
//   3. The header/sidebar node count showed the pre-regeneration value
//      until the background gallery refresh completed, which is
//      jarring after a successful regen.  The fix now applies the
//      confirmed record to the gallery map immediately using the same
//      `countMindmapNodes` the server uses in `summaryOf`.

// --- Test 1: predicate + lifecycle ---------------------------------------

assert.equal(
  regenerateUnavailableWhileRunning({ status: 'accepted' }),
  true,
  'disable predicate must also block on the synchronous accepted state',
)
assert.equal(
  regenerateUnavailableWhileRunning({ status: 'running' }),
  true,
  'predicate must still block while running',
)
assert.equal(
  regenerateUnavailableWhileRunning({ status: 'completed' }),
  false,
  'completed runs must not disable the toolbar',
)
assert.equal(
  regenerateUnavailableWhileRunning({ status: 'failed' }),
  false,
  'failed runs must not disable the toolbar',
)
assert.equal(
  regenerateUnavailableWhileRunning({ status: 'timed_out' }),
  false,
  'timed_out runs must not disable the toolbar',
)
assert.equal(
  regenerateUnavailableWhileRunning({ status: 'cancelled' }),
  false,
  'cancelled runs must not disable the toolbar',
)
assert.equal(
  regenerateUnavailableWhileRunning(null),
  false,
  'no run is never a reason to disable the toolbar',
)
assert.equal(
  regenerateUnavailableWhileRunning(undefined),
  false,
  'undefined run is never a reason to disable the toolbar',
)

// Server-side: prove the lifecycle is accepted -> running -> completed so
// the widened polling gate actually has a chance to fire.  We rebuild
// the test runtime (a fresh DSH context) and watch the runId through
// its stages, asserting that the very first view returned by POST
// already says 'accepted' (so the client poll must start in the
// accepted window) and that the panel-runs GET eventually reports
// 'completed'.
{
  const root = await mkdtemp(join(tmpdir(), 'dsh-chat-fix-1-'))
  const previousHome = process.env.DSH_MINDMAP_HOME
  process.env.DSH_MINDMAP_HOME = root
  let started = 0
  let accepts = 0
  let runs = 0
  let compls = 0
  try {
    const recorded = []
    const runtime = {
      getProvider(name) { return name === 'fork' ? { name: 'fork' } : undefined },
      start(_name, request) {
        started += 1
        let resolveResult
        const result = new Promise((res) => { resolveResult = res })
        recorded.push({ request, resolve: (outcome) => resolveResult(outcome) })
        return { id: 'child-' + started, result, async dispose() {} }
      },
    }
    const agents = { get(id) { return { session: { header: { cwd: process.cwd() } } } } }
    const tools = new Map()
    const routes = []
    const disposers = []
    const ctx = {
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      webServer: { register(route) { routes.push(route); return () => {} } },
      effect(factory) { const d = factory(); if (typeof d === 'function') disposers.push(d); return d },
      inject(names, callback) {
        if (names.join('+') === 'agents+subagents') callback({
          agents,
          subagents: runtime,
          effect(factory) { const d = factory(); if (typeof d === 'function') disposers.push(d); return d },
        })
      },
    }
    apply(ctx)

    const prefix = '/@ericwang1358/dsh-chat-mindmap'
    const handle = routes[0].handler
    async function call(method, url, body) {
      const listeners = {}
      const req = {
        method,
        url,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        headers: method === 'GET' ? {} : { 'x-dsh-chat-mindmap-request': '1', 'sec-fetch-site': 'same-origin' },
        socket: { remoteAddress: '127.0.0.1' },
        on(ev, fn) { (listeners[ev] ||= []).push(fn) },
        emit(ev, ...args) { for (const fn of listeners[ev] || []) fn(...args) },
      }
      let resolveRes
      const finished = new Promise((res) => { resolveRes = res })
      const res = {
        statusCode: 200,
        headers: {},
        body: '',
        writableEnded: false,
        finished,
        setHeader(k, v) { this.headers[k] = v },
        end(value) {
          this.body = value ?? ''
          this.writableEnded = true
          resolveRes()
        },
      }
      const settled = handle(req, res)
      if (req.body !== undefined) {
        process.nextTick(() => {
          req.emit('data', req.body)
          req.emit('end')
        })
      }
      await finished
      await settled
      return { status: res.statusCode, payload: res.body ? JSON.parse(res.body) : null }
    }

    const seeded = await saveMindmap({ title: 'Lifecycle', document: buildMindmap('seed', 'Lifecycle', { maxNodes: 60 }) })
    const sessionId = 'session-active'
    const regen = await call('POST', prefix + '/maps/' + encodeURIComponent(seeded.libraryId) + '/regenerate', {
      sessionId,
      expectedRecordVersion: seeded.recordVersion,
      instruction: 'make it tighter',
    })
    assert.equal(regen.status, 202, 'POST /regenerate must answer 202')
    const view = regen.payload.value
    assert.equal(view.libraryId, seeded.libraryId)
    assert.equal(view.status, 'accepted', '§11: the very first view must be accepted (not running)')
    accepts += 1
    // The async settle() picks the runtime up on a microtask after the
    // 202 has been flushed; the client must keep polling through the
    // accepted window, so allow it to land before asserting.
    const deadline = Date.now() + 1000
    while (recorded.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal(recorded.length, 1, 'runtime.start must be triggered by begin()')
    const startedRequest = recorded[0].request
    assert.equal(startedRequest.parent?.session?.header?.cwd, process.cwd(), 'fork parent must be the live session')
    assert.equal(startedRequest.toolFilter?.allow?.length ?? 0, 0, 'regenerate must forbid all tools')
    assert.ok(startedRequest.outputSchema?.required?.includes('title'), 'output schema must require title')
    assert.ok(startedRequest.outputSchema?.required?.includes('outline'), 'output schema must require outline')

    // Drive the runtime to 'completed' and assert the GET sees the new
    // status.  Polling would observe this transition in real life; the
    // widened gate now lets the poll run while the run is in 'accepted'.
    recorded[0].resolve({ structured: { title: 'Lifecycle v2', outline: '# Lifecycle v2\n## A\n## B' }, stopReason: 'completed' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    runs += 1

    const polled = await call('GET', prefix + '/panel-runs/' + encodeURIComponent(view.runId) + '?sessionId=' + encodeURIComponent(sessionId))
    assert.equal(polled.status, 200)
    assert.equal(polled.payload.value.status, 'completed', 'panel-runs GET must surface the completed state')
    assert.equal(polled.payload.value.libraryId, seeded.libraryId)
    compls += 1

    const updated = await getMindmap(seeded.libraryId)
    assert.equal(updated.current.title, 'Lifecycle v2', 'completed run must commit the new document to the same libraryId')
    assert.ok(updated.recordVersion > seeded.recordVersion, 'recordVersion must monotonically advance on commit')
    assert.ok(updated.previous, 'regenerate must rotate previous on commit')

    for (const d of disposers) await d?.()
  } finally {
    if (previousHome === undefined) delete process.env.DSH_MINDMAP_HOME
    else process.env.DSH_MINDMAP_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
  assert.equal(started, 1, 'exactly one runtime.start for the regenerate')
  assert.equal(accepts, 1)
  assert.equal(runs, 1)
  assert.equal(compls, 1)
}
console.log('panel-regenerate fix 1/3 (lifecycle) passed')

// --- Test 2: stale-response guard ----------------------------------------

assert.equal(
  shouldDropPanelRunResponse(null, 'run-A'),
  true,
  'no latest run -> every response for the captured target is stale',
)
assert.equal(
  shouldDropPanelRunResponse(undefined, 'run-A'),
  true,
  'undefined latest run must also be treated as stale',
)
assert.equal(
  shouldDropPanelRunResponse({ runId: 'run-A', libraryId: 'L', status: 'running', detail: '' }, 'run-A'),
  false,
  'matching runId means the response still belongs to the captured effect',
)
assert.equal(
  shouldDropPanelRunResponse({ runId: 'run-B', libraryId: 'L', status: 'running', detail: '' }, 'run-A'),
  true,
  'different runId means the user has cancelled/started a newer run - drop',
)
assert.equal(
  shouldDropPanelRunResponse({ runId: 'run-B', libraryId: 'L2', status: 'completed', detail: '' }, 'run-A'),
  true,
  'late completion of an abandoned run must not overwrite a newer run',
)
assert.equal(
  shouldDropPanelRunResponse({ runId: '', libraryId: 'L', status: 'running', detail: '' }, 'run-A'),
  true,
  'an empty runId is never a match - defence against blank-string bug',
)
console.log('panel-regenerate fix 2/3 (stale-response guard) passed')

// --- Test 3: node count sync ---------------------------------------------

function makeNode(title, children = []) {
  return { id: 'n-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, ...(children.length ? { children } : {}) }
}
assert.equal(countMindmapNodes(makeNode('root')), 1, 'a leaf is 1 node')
assert.equal(
  countMindmapNodes(makeNode('r', [makeNode('l'), makeNode('rl', [makeNode('rll'), makeNode('rlr')])])),
  5,
  '1 + 2 + 2 = 5 descendants total',
)
assert.equal(countMindmapNodes(makeNode('root', Array.from({ length: 7 }, (_, i) => makeNode('c' + i)))), 8, 'root + 7 children = 8')
assert.equal(countMindmapNodes(makeNode('r', [makeNode('a', [makeNode('aa', [makeNode('aaa'), makeNode('aab')])])])), 5, 'r + a + aa + aaa + aab = 5 (deeply skewed tree must still be counted correctly)')
console.log('countMindmapNodes unit table passed')

// The server's summaryOf uses countMindmapNodes too; after a regenerate
// the client's `setMaps((items) => items.map(...))` must produce the
// same value the server will eventually return.  This guards against a
// future refactor that changes one but not the other.
{
  const outline = [
    '# Demo',
    '## Section A',
    '### A1',
    '### A2',
    '## Section B',
  ].join('\n')
  const document = buildMindmap(outline, 'Demo', { maxNodes: 200 })
  const clientCount = countMindmapNodes(document.root)
  // Save a fresh record so summaryOf is exercised against real storage.
  const root = await mkdtemp(join(tmpdir(), 'dsh-chat-fix-3-'))
  const previousHome = process.env.DSH_MINDMAP_HOME
  process.env.DSH_MINDMAP_HOME = root
  try {
    const saved = await saveMindmap({ title: 'Demo', document })
    const summaries = await listMindmaps()
    const mine = summaries.find((entry) => entry.libraryId === saved.libraryId)
    assert.ok(mine, 'freshly saved record must be in the summary index')
    assert.equal(mine.nodeCount, clientCount, 'server summary nodeCount must equal the client recompute')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_MINDMAP_HOME
    else process.env.DSH_MINDMAP_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
}
console.log('panel-regenerate fix 3/3 (node count sync) passed')

console.log('panel-regenerate-fix tests passed')
