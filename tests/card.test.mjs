import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { cardStateOf, CARD_EXPIRED_NOTE, CARD_MISSING_NOTE } from '../lib/client/card-state.js'
import { CardBody, MindmapToolCard, previewReference } from '../lib/client/components/MindmapToolCard.js'

const reference = (overrides = {}) => ({ libraryId: 'map-a', revisionId: 'rev-aaaabbbbccccddddeeeeffff', title: '示例图', nodeCount: 12, state: 'available', ...overrides })

{ // card state remains safe for malformed and expired historical results
  assert.deepEqual(cardStateOf(reference({ state: 'expired' }), 'open-link', null), { kind: 'expired', note: CARD_EXPIRED_NOTE })
  assert.equal(cardStateOf(null, 'open-link', null).note, CARD_MISSING_NOTE)
}

{ // source contract: cards are links, never image/export implementations
  const source = readFileSync(new URL('../src/client/components/MindmapToolCard.tsx', import.meta.url), 'utf8')
  for (const banned of ['innerHTML', 'dangerouslySetInnerHTML', '<iframe', '<img', 'doExport', 'fetcher(', 'ImagePreviewDialog']) {
    assert.equal(source.includes(banned), false, 'card must not contain ' + banned)
  }
  assert.match(source, /openMindmap\(String\(sessionId\), reference\.libraryId\)/)
}

{ // assembly exposes a stable view destination and no snapshot fetcher
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.match(source, /MINDMAP_VIEW_ID/)
  assert.equal(source.includes('registerSnapshotFetcher'), false)
}

{ // canonical payload parsing accepts only durable, shaped card references
  const good = { kind: 'toolresult', content: [{ type: 'text', text: 'dsh-chat-mindmap-preview:' + JSON.stringify(reference()) }] }
  assert.equal(previewReference(good).libraryId, 'map-a')
  assert.equal(previewReference({ kind: 'toolresult', content: [{ type: 'text', text: 'dsh-chat-mindmap-preview:{broken' }] }), null)
  assert.equal(previewReference({}), null)
}

const h = (element) => renderToStaticMarkup(React.createElement(element.type, element.props))

{ // cards show a direct action instead of a fragile browser preview
  const expired = h(React.createElement(CardBody, { reference: reference({ state: 'expired' }), error: null }))
  assert.equal(expired.includes(CARD_EXPIRED_NOTE), true)
  assert.equal(expired.includes('<button'), false)
  const missing = h(React.createElement(CardBody, { reference: null, error: null }))
  assert.equal(missing.includes(CARD_MISSING_NOTE), true)
  const linked = h(React.createElement(CardBody, { reference: reference({ title: 'T 图' }), error: null }))
  assert.equal(linked.includes('aria-label="打开 T 图 脑图"'), true)
  assert.equal(linked.includes('在脑图库中编辑'), true)
  assert.equal(linked.includes('<img'), false)
  const failed = h(React.createElement(CardBody, { reference: reference(), error: '无法打开' }))
  assert.equal(failed.includes('>无法打开<'), true)
}

{ // static rendering does not depend on browser APIs
  const block = { kind: 'toolresult', content: [{ type: 'text', text: 'dsh-chat-mindmap-preview:' + JSON.stringify(reference()) }] }
  const html = renderToStaticMarkup(React.createElement(MindmapToolCard, { block }))
  assert.equal(html.includes('打开脑图'), true)
  assert.equal(html.includes('<iframe'), false)
}

console.log('card tests passed')
