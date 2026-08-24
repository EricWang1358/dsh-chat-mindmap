import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// Real storage home for this suite; library.ts resolves DSH_MINDMAP_HOME lazily.
process.env.DSH_MINDMAP_HOME = await mkdtemp(join(tmpdir(), 'dsh-chat-mindmap-integ-'))

import { deleteMindmap, getMindmap, saveMindmap } from '../lib/library.js'
import { buildMindmap } from '../lib/core.js'
import { revisionIdOf } from '../lib/revisions.js'
import { GenerationLockRegistry } from '../lib/host/generation-locks.js'
import { INTERRUPTED_DETAIL, PanelRunRegistry } from '../lib/host/panel-runs.js'
import { createChatMindmapTools, PREVIEW_PAYLOAD_PREFIX } from '../lib/host/tools.js'
import { registerMindmapRoutes } from '../lib/host/routes.js'
import { CardBody, previewReference } from '../lib/client/components/MindmapToolCard.js'
import { cardStateOf } from '../lib/client/card-state.js'
import { createBlobUrlLru } from '../lib/client/components/blob-url-lru.js'

const SOURCE = { kind: 'text', name: 'integration' }

async function generation(libraryId, outline) {
  return saveMindmap({ ...(libraryId ? { libraryId } : {}), title: '集成图', document: buildMindmap(outline), source: SOURCE })
}

// --- minimal route harness (GET-only mirror of routes.test.mjs fixtures) ---
class FakeRequest extends EventEmitter {
  constructor(url) { super(); this.method = 'GET'; this.url = url; this.headers = {}; this.socket = { remoteAddress: '127.0.0.1' } }
}
class FakeResponse {
  constructor() { this.statusCode = 0; this.chunks = []; this.writableEnded = false }
  setHeader() {}
  end(body) { if (body) this.chunks.push(String(body)); this.writableEnded = true }
  json() { return JSON.parse(this.chunks.join('')) }
}
async function routeGet(pathname) {
  const routes = []
  const dispose = registerMindmapRoutes({ webServer: { register(route) { routes.push(route); return () => undefined } }, panelRuns: new PanelRunRegistry() })
  try {
    const req = new FakeRequest('/@ericwang1358/dsh-chat-mindmap' + pathname)
    const res = new FakeResponse()
    routes[0].handler(req, res)
    for (let i = 0; i < 400 && !res.writableEnded; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.ok(res.writableEnded, 'route never settled')
    return res
  } finally {
    dispose()
  }
}

{ // S6-1: three-generation rotation expires the first revision end to end
  const gen1 = await generation(null, '# 集成图\n## A')
  const staleRevision = revisionIdOf(gen1.current)
  await generation(gen1.libraryId, '# 集成图\n## B')
  const gen3 = await generation(gen1.libraryId, '# 集成图\n## C')
  assert.equal(revisionIdOf(gen3.current) === staleRevision, false)

  const expiredRoute = await routeGet('/maps/' + gen1.libraryId + '/revisions/' + encodeURIComponent(staleRevision))
  assert.equal(expiredRoute.statusCode, 410)
  assert.equal(expiredRoute.json().error.code, 'MINDMAP_REVISION_EXPIRED')

  const tools = createChatMindmapTools({
    locks: new GenerationLockRegistry(),
    jobs: null,
    runtime: null,
    loadRecord: (id) => getMindmap(id),
  })
  const presentValue = await tools.present.execute({ libraryId: gen1.libraryId, revisionId: staleRevision }, { agent: { id: 's' } })
  assert.equal(presentValue.state, 'expired')

  const reference = { libraryId: gen1.libraryId, revisionId: staleRevision, title: presentValue.title, nodeCount: presentValue.nodeCount, state: 'expired' }
  const html = renderToStaticMarkup(React.createElement(CardBody, { reference, url: null, error: null }))
  assert.equal(html.includes('本图已失效'), true)
}

{ // S6-2: deletion expires every revision and the present tool reports it
  const created = await generation(null, '# 删除目标\n## 节点')
  const rid = revisionIdOf(created.current)
  const removed = await deleteMindmap(created.libraryId, { expectedRecordVersion: created.recordVersion })
  assert.equal(removed, true)
  assert.equal(await getMindmap(created.libraryId), null)

  const gone = await routeGet('/maps/' + created.libraryId + '/revisions/' + encodeURIComponent(rid))
  assert.equal(gone.statusCode, 410)

  const tools = createChatMindmapTools({
    locks: new GenerationLockRegistry(),
    jobs: null,
    runtime: null,
    loadRecord: (id) => getMindmap(id),
  })
  const value = await tools.present.execute({ libraryId: created.libraryId, revisionId: rid }, { agent: { id: 's' } })
  assert.equal(value.state, 'expired')
}

{ // S6-3: reload + trimmed call head — interrupted view and ready replay render
  const freshRegistry = new PanelRunRegistry()
  const view = freshRegistry.getViewOrInterrupted('panel-rel0ad-x')
  assert.equal(view.status, 'failed')
  assert.equal(view.detail, INTERRUPTED_DETAIL)

  // A stored result payload survives even when the call-head blocks are gone.
  const document = buildMindmap('# 回放图\n## 子节点')
  const payloadText = PREVIEW_PAYLOAD_PREFIX + JSON.stringify({ libraryId: 'map-replay', revisionId: 'rev-aaaabbbbccccddddeeeeffff', title: '回放图', nodeCount: 2, state: 'available' })
  const block = { kind: 'toolresult', content: [{ type: 'text', text: payloadText }] }
  const reference = previewReference(block)
  assert.equal(reference.title, '回放图')
  assert.equal(cardStateOf(reference, 'open-link', null).kind, 'ready')
  const html = renderToStaticMarkup(React.createElement(CardBody, { reference, error: null }))
  assert.equal(html.includes('<img'), false)
  assert.equal(html.includes('打开 回放图 脑图'), true)
}

{ // S6-4 (R2-2): dispose-to-zero across locks, panel runs, and the LRU
  const locks = new GenerationLockRegistry()
  assert.notEqual(locks.tryAcquire('m1', 'run-a'), null)
  assert.notEqual(locks.tryAcquire('m2', 'run-b'), null)
  assert.equal(locks.size(), 2)
  locks.disposeAll()
  assert.equal(locks.size(), 0)

  const panelRuns = new PanelRunRegistry()
  panelRuns.register({ runId: 'panel-d1', libraryId: 'm', status: 'running', detail: '' }, new AbortController())
  panelRuns.register({ runId: 'panel-d2', libraryId: 'm', status: 'running', detail: '' })
  assert.equal(panelRuns.size(), 2)
  await panelRuns.disposeAll()
  assert.equal(panelRuns.size(), 0)

  let createdCount = 0
  let revokedCount = 0
  const lru = createBlobUrlLru({ capacity: 4, create() { createdCount += 1; return 'blob:d' + createdCount }, revoke() { revokedCount += 1 } })
  lru.put('k1', {}); lru.put('k2', {}); lru.put('k3', {})
  lru.disposeAll()
  assert.equal(lru.size(), 0)
  assert.equal(revokedCount, createdCount)
  assert.equal(createdCount, 3)
}

console.log('integration tests passed')

process.on('exit', () => { rm(process.env.DSH_MINDMAP_HOME, { recursive: true, force: true }).catch(() => undefined) })
