import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { cycleFocus, DialogSurface } from '../lib/client/preview/dialog.js'

{ // cycleFocus pure behavior: step, both wraps, empty list
  assert.equal(cycleFocus(3, 0, true), 1)
  assert.equal(cycleFocus(3, 2, true), 0)
  assert.equal(cycleFocus(3, 0, false), 2)
  assert.equal(cycleFocus(3, 2, false), 1)
  assert.equal(cycleFocus(0, 5, true), 0)
}

{ // source contract: single onClose handler, no navigation/edit affordances
  const source = readFileSync(new URL('../src/client/preview/dialog.tsx', import.meta.url), 'utf8')
  const onClicks = source.match(/onClick=\{[^}]*\}/g) ?? []
  assert.ok(onClicks.length >= 2, 'backdrop and close button must exist')
  for (const handler of onClicks) assert.equal(handler, 'onClick={onClose}', 'every click handler must be onClose: ' + handler)
  for (const banned of ['编辑', '跳转', '打开脑图', '<a ', '<a>']) {
    assert.equal(source.includes(banned), false, 'dialog must not contain ' + banned)
  }
  // Only public platform surfaces are imported (react / react-dom here).
  const dshImports = source.match(/from '@deepseek-ai\/[^']+'/g) ?? []
  for (const entry of dshImports) assert.match(entry, /\/client'/, 'non-public dsh import: ' + entry)
}

{ // static structure: dialog semantics, image, single close affordance
  const html = renderToStaticMarkup(React.createElement(DialogSurface, { src: 'blob:x', alt: '示例图 思维导图', onClose() {} }))
  assert.equal(html.includes('role="dialog"'), true)
  assert.equal(html.includes('aria-modal="true"'), true)
  assert.equal(html.includes('aria-label="脑图 SVG 预览"'), true)
  assert.equal(html.includes('src="blob:x"'), true)
  assert.equal(html.includes('alt="示例图 思维导图"'), true)
  assert.equal(html.includes('关闭预览'), true)
  assert.equal((html.match(/关闭预览/g) ?? []).length, 2, 'backdrop label + visible close button only')
  for (const banned of ['<a ', '编辑', '跳转', '打开脑图']) {
    assert.equal(html.includes(banned), false, 'rendered dialog must not contain ' + banned)
  }
}

console.log('dialog tests passed')
