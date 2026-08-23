import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DswButton, DswInput, DswStateDot, DswMenu, DswModal, DswToast, DswTooltip } from '../lib/client/components/ui/primitives.js'

// Button variants render token-first styles and forward handlers.
const primary = renderToStaticMarkup(createElement(DswButton, { variant: 'primary', disabled: true, 'data-x': '1' }, 'go'))
assert.ok(primary.includes('disabled'), 'primary button forwards disabled')
assert.ok(primary.includes('data-x='), 'button forwards extra attributes')
assert.ok(primary.includes('--dsw-alias-brand-primary'), 'primary uses brand token')
const ghost = renderToStaticMarkup(createElement(DswButton, { variant: 'ghost' }, 'x'))
assert.ok(ghost.includes('<button'), 'ghost renders a real button')
console.log('client-ui primitives passed')

// StateDot exposes an accessible name and tone.
assert.ok(renderToStaticMarkup(createElement(DswStateDot, { tone: 'ok', label: '完成' })).includes('aria-label=') || renderToStaticMarkup(createElement(DswStateDot, { tone: 'ok', label: '完成' })).includes('title='), 'state dot carries accessible name')

// Modal: closed renders nothing; open renders dialog semantics.
assert.equal(renderToStaticMarkup(createElement(DswModal, { open: false, label: 'm', onClose: () => undefined, children: null })), '')
assert.ok(renderToStaticMarkup(createElement(DswModal, { open: true, label: '重新生成', onClose: () => undefined, children: createElement('div', null, 'body') })).includes('role="dialog"'))
assert.ok(renderToStaticMarkup(createElement(DswModal, { open: true, label: '重新生成', onClose: () => undefined, children: createElement('div', null, 'body') })).includes('aria-modal') && renderToStaticMarkup(createElement(DswModal, { open: true, label: '重新生成', onClose: () => undefined, children: createElement('div', null, 'body') })).includes('aria-label'));

// Menu lists menuitems; tooltip/toast render copy.
assert.ok(renderToStaticMarkup(createElement(DswMenu, { label: '更多', items: [{ key: 'a', label: 'A', onSelect: () => undefined }, { key: 'b', label: 'B', onSelect: () => undefined, disabled: true }] })).includes('role="menu"') && renderToStaticMarkup(createElement(DswMenu, { label: '更多', items: [{ key: 'a', label: 'A', onSelect: () => undefined }, { key: 'b', label: 'B', onSelect: () => undefined, disabled: true }] })).includes('role="menuitem"'))
assert.ok(renderToStaticMarkup(createElement(DswTooltip, { tip: 'hint' }, createElement('span', null, 't'))).includes('hint'))
assert.ok(renderToStaticMarkup(createElement(DswToast, { message: 'saved' })).includes('status'))
assert.equal(renderToStaticMarkup(createElement(DswToast, { message: null })), '')

// DswInput forwards aria labels.
assert.ok(renderToStaticMarkup(createElement(DswInput, { 'aria-label': '搜索脑图' })).includes('搜索脑图'))
console.log('client-ui component smoke passed')

// Token gate: brainmap-page chrome carries no bare color literals (§13.3).
execSync('node scripts/check-tokens.mjs', { stdio: 'inherit' })

// No copied official CSS: primitives import nothing from DSH web internals.
const { readFile } = await import('node:fs/promises')
const { join } = await import('node:path')
const rootDir = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '')
const ps = await readFile(join(rootDir, 'src/client/components/ui/primitives.tsx'), 'utf8')
assert.ok(!ps.includes('dsh-web-frontend'), 'primitives must not import DSH web internals')
assert.ok(!ps.includes('class='), 'primitives must not borrow official class names')
console.log('client-ui token + provenance gate passed')
