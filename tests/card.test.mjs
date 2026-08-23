import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { cardStateOf, CARD_EXPIRED_NOTE, CARD_MISSING_NOTE } from '../lib/client/card-state.js'
import { createBlobUrlLru } from '../lib/client/components/blob-url-lru.js'
import { CardBody, MindmapToolCard, previewReference } from '../lib/client/components/MindmapToolCard.js'

const reference = (overrides = {}) => ({ libraryId: 'map-a', revisionId: 'rev-aaaabbbbccccddddeeeeffff', title: '示例图', nodeCount: 12, state: 'available', ...overrides })

{ // cardStateOf priority: expired > failed > loading > ready
  assert.deepEqual(cardStateOf(reference({ state: 'expired' }), null, null), { kind: 'expired', note: CARD_EXPIRED_NOTE })
  assert.deepEqual(cardStateOf(reference(), null, '导出失败'), { kind: 'failed', note: '导出失败' })
  assert.equal(cardStateOf(reference(), null, '导出失败').kind, 'failed')
  assert.deepEqual(cardStateOf(reference(), null, null), { kind: 'loading' })
  assert.deepEqual(cardStateOf(reference(), 'blob:x', null), { kind: 'ready' })
  const missing = cardStateOf(null, 'blob:x', null)
  assert.equal(missing.kind, 'failed')
  assert.equal(missing.note, CARD_MISSING_NOTE)
  // expired wins even when an error is present
  assert.equal(cardStateOf(reference({ state: 'expired' }), null, 'boom').kind, 'expired')
}

function makeLru(capacity) {
  let nextId = 0
  const created = []
  const revoked = []
  const lru = createBlobUrlLru({
    capacity,
    create(blob) { const url = 'blob:' + blob.tag + '-' + (++nextId); created.push(url); return url },
    revoke(url) { if (!created.includes(url)) throw new Error('revoke of unknown url'); if (revoked.includes(url)) throw new Error('double revoke'); revoked.push(url) },
  })
  return { lru, created, revoked }
}

{ // capacity eviction triggers revoke of the oldest entry
  const { lru, created, revoked } = makeLru(2)
  lru.put('a', { tag: 'a' })
  lru.put('b', { tag: 'b' })
  lru.put('c', { tag: 'c' })
  assert.equal(lru.size(), 2)
  assert.equal(created.length, 3)
  assert.deepEqual(revoked, ['blob:a-1'])
  assert.equal(lru.has('a'), false)
  assert.equal(lru.stats().evicted, 1)
}

{ // get promotes recency so the newest-use survivor is kept
  const { lru, revoked } = makeLru(2)
  lru.put('a', { tag: 'a' })
  lru.put('b', { tag: 'b' })
  assert.equal(lru.get('a'), 'blob:a-1') // promote a above b
  lru.put('c', { tag: 'c' })
  assert.deepEqual(revoked, ['blob:b-2'])
  assert.equal(lru.has('a'), true)
}

{ // same-key re-put replaces exactly once: no leak, no double revoke
  const { lru, created, revoked } = makeLru(4)
  lru.put('k', { tag: 'one' })
  lru.put('k', { tag: 'two' })
  assert.equal(lru.size(), 1)
  assert.equal(created.length, 2)
  assert.deepEqual(revoked, ['blob:one-1'])
  assert.equal(lru.get('k'), 'blob:two-2')
}

{ // unmount scenario: plain has/get churn never revokes
  const { lru, revoked } = makeLru(8)
  lru.put('m', { tag: 'm' })
  for (let i = 0; i < 10; i += 1) {
    assert.ok(lru.has('m'))
    assert.equal(lru.get('m'), 'blob:m-1')
  }
  assert.deepEqual(revoked, [])
}

{ // disposeAll empties the store with revoked === created
  const { lru, created, revoked } = makeLru(3)
  lru.put('x', { tag: 'x' })
  lru.put('y', { tag: 'y' })
  lru.disposeAll()
  assert.equal(lru.size(), 0)
  assert.equal(revoked.length, created.length)
  assert.deepEqual(revoked.sort(), [...created].sort())
  const stats = lru.stats()
  assert.equal(stats.revoked, stats.created)
}

{ // source contract: no raw-HTML escape hatches in the component file
  const source = readFileSync(new URL('../src/client/components/MindmapToolCard.tsx', import.meta.url), 'utf8')
  for (const banned of ['innerHTML', 'dangerouslySetInnerHTML', '<iframe']) {
    assert.equal(source.includes(banned), false, 'component must not contain ' + banned)
  }
}

{ // previewReference parses the canonical payload prefix and rejects junk
  const good = { kind: 'toolresult', content: [{ type: 'text', text: 'dsh-chat-mindmap-preview:' + JSON.stringify(reference()) }] }
  const parsed = previewReference(good)
  assert.equal(parsed.libraryId, 'map-a')
  assert.equal(previewReference({ kind: 'toolresult', content: [{ type: 'text', text: 'dsh-chat-mindmap-preview:{broken' }] }), null)
  assert.equal(previewReference({ kind: 'toolresult', content: [{ type: 'text', text: 'unrelated' }]}), null)
  assert.equal(previewReference({}), null)
}

const h = (element) => renderToStaticMarkup(React.createElement(element.type, element.props))

{ // static render structure: expired / failed / ready / loading
  const expired = h(React.createElement(CardBody, { reference: reference({ state: 'expired' }), url: null, error: null }))
  assert.equal(expired.includes(CARD_EXPIRED_NOTE), true)
  assert.equal(expired.includes('<button'), false)
  const missing = h(React.createElement(CardBody, { reference: null, url: null, error: null }))
  assert.equal(missing.includes(CARD_MISSING_NOTE), true)
  const loading = h(React.createElement(CardBody, { reference: reference(), url: null, error: null }))
  assert.equal(loading.includes('正在生成 SVG 预览…'), true)
  const ready = h(React.createElement(CardBody, { reference: reference({ title: 'T 图' }), url: 'blob:ready', error: null }))
  assert.equal(ready.includes('aria-label="打开 T 图 SVG 预览"'), true)
  assert.equal(ready.includes('src="blob:ready"'), true)
  assert.equal(ready.includes('<iframe'), false)
  const failed = h(React.createElement(CardBody, { reference: reference(), url: null, error: '无法生成' }))
  assert.equal(failed.includes('>无法生成<'), true)
}

{ // full card renders statically without window/effects and stays iframe-free
  const block = { kind: 'toolresult', content: [{ type: 'text', text: 'dsh-chat-mindmap-preview:' + JSON.stringify(reference()) }] }
  const html = renderToStaticMarkup(React.createElement(MindmapToolCard, { block }))
  assert.equal(html.includes('正在生成 SVG 预览…'), true)
  assert.equal(html.includes('<iframe'), false)
}

console.log('card tests passed')
