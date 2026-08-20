import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMindmap } from '../lib/core.js'
import { getMindmap, saveMindmap } from '../lib/library.js'
import { revisionIdOf } from '../lib/revisions.js'
import { apply } from '../lib/index.js'

class FakeRequest extends EventEmitter {
  constructor(body, url, method = 'POST') {
    super()
    this.body = body
    this.url = url
    this.headers = { 'x-dsh-chat-mindmap-request': '1' }
    this.socket = { remoteAddress: '127.0.0.1' }
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
  const fakeParent = { id: 'session-active' }
  let forkStarts = 0
  let forkPrompt = ''
  const ctx = {
    tools: { register() {} },
    agents: { get(id) { return id === fakeParent.id ? fakeParent : undefined } },
    subagents: {
      getProvider(name) { return name === 'fork' ? {} : undefined },
      async start(name, request) { forkStarts += 1; assert.equal(name, 'fork'); assert.equal(request.parent, fakeParent); assert.deepEqual(request.toolFilter, { allow: [] }); forkPrompt = request.prompt[0].text; return { id: 'child-1', result: Promise.resolve({ stopReason: 'completed', structured: { title: 'Forked', outline: '# Forked\n## Child' } }), async dispose() {} } },
    },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    effect(callback) { return callback() },
    inject(dependencies, callback) { assert.deepEqual(dependencies, ['agents', 'subagents']); return callback(ctx) },
  }
  apply(ctx)
  assert.ok(handler)

  const request = async (body, url = '/@ericwang1358/dsh-chat-mindmap/generate', method = 'POST') => {
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

  const invalidId = await request('', '/@ericwang1358/dsh-chat-mindmap/maps/%E0%A4%A', 'GET')
  assert.equal(invalidId.status, 400)

  const created = await request(JSON.stringify({ title: 'Created', document: buildMindmap('# Created\n## Child'), config: { maxNodes: 1000 } }), '/@ericwang1358/dsh-chat-mindmap/maps', 'POST')
  assert.equal(created.status, 201)
  assert.equal(created.payload.value.config.maxNodes, 1000)
  const patchDocument = buildMindmap('# Patch\n## Child')
  patchDocument.root.children[0].note = '子节点要覆盖边界案例，并保留练习题。'
  const saved = await saveMindmap({ title: 'Patch', document: patchDocument })
  const invalidPatch = await request(JSON.stringify({ document: { version: 1 } }), `/@ericwang1358/dsh-chat-mindmap/maps/${saved.libraryId}`, 'PATCH')
  assert.equal(invalidPatch.status, 400)

  const revisionId = revisionIdOf(saved.current)
  const preview = await request('', `/@ericwang1358/dsh-chat-mindmap/maps/${saved.libraryId}/revisions/${revisionId}`, 'GET')
  assert.equal(preview.status, 200)
  assert.equal(preview.payload.value.revisionId, revisionId)
  assert.equal(preview.payload.value.document.title, 'Patch')
  const expiredPreview = await request('', `/@ericwang1358/dsh-chat-mindmap/maps/${saved.libraryId}/revisions/rev-000000000000000000000000`, 'GET')
  assert.equal(expiredPreview.status, 410)

  const note = '保留所有原始分支，并优先展开性能验收项。'
  const regeneration = await request(JSON.stringify({ sessionId: fakeParent.id, expectedUpdatedAt: saved.updatedAt, instruction: note }), `/@ericwang1358/dsh-chat-mindmap/maps/${saved.libraryId}/regenerate`)
  assert.equal(regeneration.status, 202)
  assert.equal(regeneration.payload.value.status, 'running')
  await new Promise((resolve) => setTimeout(resolve, 25))
  const run = await request('', `/@ericwang1358/dsh-chat-mindmap/panel-runs/${regeneration.payload.value.runId}`, 'GET')
  assert.equal(forkStarts, 1)
  assert.equal(forkPrompt, `将下面已有脑图转换为结构清晰、可编辑的 Markdown 层级大纲。只输出符合 schema 的 title 和 outline。不要调用工具，不要解释过程，不要编造来源。节点备注是附加参考：应吸收其事实、范围和约束，但绝不能把备注文字当作节点标题逐字输出。\n\n当前标题：Patch\n当前脑图 Markdown：\n# Patch\n## Child\n\n<node-notes format="json">\n[${JSON.stringify({ id: patchDocument.root.children[0].id, path: 'Patch > Child', note: '子节点要覆盖边界案例，并保留练习题。' })}]\n</node-notes>\n\n最多节点：360\n\n<panel-note>\n${note}\n</panel-note>\n\n如果没有 panel-note，则保持原主题和层级信息，必要时改善结构。`)
  assert.equal(run.payload.value.noteLength, [...note].length)
  assert.match(run.payload.value.detail, /重新生成完成：2 个节点/)
  assert.equal(run.status, 200)
  assert.equal(run.payload.value.status, 'completed')
  assert.equal(run.payload.value.childId, 'child-1')
   assert.equal((await getMindmap(saved.libraryId)).current.title, 'Forked')
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('HTTP tests passed')
