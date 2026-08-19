import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMindmap } from '../lib/core.js'
import { saveMindmap } from '../lib/library.js'
import { revisionIdOf } from '../lib/revisions.js'
import { apply } from '../lib/index.js'

class FakeRequest extends EventEmitter {
  constructor(body, url, method = 'POST') {
    super()
    this.body = body
    this.url = url
    this.method = method
  }
  setEncoding() {}
  start() {
    process.nextTick(() => {
      this.emit('data', this.body)
      this.emit('end')
    })
  }
}

class FakeResponse {
  statusCode = 200
  headers = {}
  body = ''
  writableEnded = false
  setHeader(name, value) { this.headers[name] = value }
  end(value) { assert.equal(this.writableEnded, false); this.body = value ?? ''; this.writableEnded = true }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-chat-http-'))
process.env.DSH_MINDMAP_HOME = root
try {
  let handler
  const ctx = {
    tools: { register() {} },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    effect(callback) { return callback() },
  }
  apply(ctx)
  assert.ok(handler)

  const request = async (body, url = '/@dsh-external/dsh-chat-mindmap/generate', method = 'POST') => {
    const req = new FakeRequest(body, url, method)
    const res = new FakeResponse()
    const result = handler(req, res)
    req.start()
    await result
    return { status: res.statusCode, payload: JSON.parse(res.body), response: res }
  }

  const valid = await request(JSON.stringify({ context: '# Root\n## Child', save: false }))
  assert.equal(valid.status, 200)
  assert.equal(valid.payload.ok, true)

  const malformed = await request('{')
  assert.equal(malformed.status, 400)
  assert.equal(malformed.payload.ok, false)
  assert.equal(malformed.response.writableEnded, true)

  const oversized = await request('x'.repeat(256_001))
  assert.equal(oversized.status, 413)
  assert.equal(oversized.payload.ok, false)

  const invalidId = await request('', '/@dsh-external/dsh-chat-mindmap/maps/%E0%A4%A', 'GET')
  assert.equal(invalidId.status, 400)

  const created = await request(JSON.stringify({ title: 'Created', document: buildMindmap('# Created\n## Child'), config: { maxNodes: 1000 } }), '/@dsh-external/dsh-chat-mindmap/maps', 'POST')
  assert.equal(created.status, 201)
  assert.equal(created.payload.value.config.maxNodes, 1000)
  const saved = await saveMindmap({ title: 'Patch', document: buildMindmap('# Patch\n## Child') })
  const invalidPatch = await request(JSON.stringify({ document: { version: 1 } }), `/@dsh-external/dsh-chat-mindmap/maps/${saved.libraryId}`, 'PATCH')
  assert.equal(invalidPatch.status, 400)

  const revisionId = revisionIdOf(saved.current)
  const preview = await request('', `/@dsh-external/dsh-chat-mindmap/maps/${saved.libraryId}/revisions/${revisionId}`, 'GET')
  assert.equal(preview.status, 200)
  assert.equal(preview.payload.value.revisionId, revisionId)
  assert.equal(preview.payload.value.document.title, 'Patch')

  const expiredPreview = await request('', `/@dsh-external/dsh-chat-mindmap/maps/${saved.libraryId}/revisions/rev-000000000000000000000000`, 'GET')
  assert.equal(expiredPreview.status, 410)
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('HTTP tests passed')
