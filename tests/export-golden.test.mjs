import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeDoc } from '../lib/domain/mindmap-doc.js'
import { renderPrintHtml, escText, escAttr, escUrl } from '../lib/host/export/print-html.js'
import { THEMES, resolveTheme } from '../lib/host/export/themes.js'
import { buildMindmap } from '../lib/core.js'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '')

// Build a representative fixture document.
const doc = buildMindmap('# 导出测试\n## 分支A\n### 组A1\n- 条目1\n- 条目2\n## 分支B\n- 叶子')
const exportDoc = normalizeDoc(doc)

// Structure golden: five mandatory sections present.
for (const theme of ['classic', 'minimal', 'creative', 'academic']) {
  const html = renderPrintHtml(exportDoc, { theme })
  assert.ok(html.includes('cover-page'), 'cover section exists for ' + theme)
  assert.ok(html.includes('class="toc"') || html.includes('Table of Contents'), 'toc exists')
  assert.ok(html.includes('branch-page'), 'branch pages exist')
  assert.ok(html.includes('overflow-report') || html.includes('溢出报告'), 'overflow report exists (or empty)')
  assert.ok(html.includes('@page{size:A3 landscape'), 'A3 landscape page size set')
}
console.log('export-golden structure passed')

// Theme presets produce distinct CSS variable sets.
const classicVars = JSON.stringify(THEMES.classic.cssVars)
const minimalVars = JSON.stringify(THEMES.minimal.cssVars)
assert.notEqual(classicVars, minimalVars, 'classic and minimal must differ')
const t = resolveTheme('nonexistent')
assert.equal(t.name, 'classic', 'unknown theme falls back to classic')
console.log('export-golden theme presets passed')

// Escape functions table-driven.
const escapeCases = [
  ['<script>alert(1)</script>', /&lt;script&gt;/],
  ['<img src=x onerror=alert(1)>', /&lt;img/],
  ['a & b < c > d', /a &amp; b &lt; c &gt; d/],
]
for (const [input, pattern] of escapeCases) {
  const escaped = escText(input)
  if (typeof pattern === 'string') assert.ok(escaped.includes(pattern), 'escape must contain ' + pattern)
  else assert.match(escaped, pattern)
}
// Attr escaping handles quotes.
assert.equal(escAttr('he said "hi"'), 'he said &quot;hi&quot;')
// URL escaping rejects javascript:.
assert.equal(escUrl('javascript:alert(1)'), '#')
assert.equal(escUrl('https://example.com/page'), 'https://example.com/page')
console.log('escape function tests passed')

// Self-contained HTML: zero external references.
const fullHtml = renderPrintHtml(exportDoc, { theme: 'academic' })
assert.ok(!fullHtml.includes('<script '), 'no script tags in output')
assert.ok(!fullHtml.includes('<link rel='), 'no external stylesheets')
assert.ok(!fullHtml.includes('http://') && !fullHtml.includes('https://'), 'zero CDN/external URLs')
assert.ok(fullHtml.includes('<!doctype html>'))
// Save sample for human review (R1-2).
try {
  const dir = join(root, 'docs', 'evidence', 'export-samples')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'sample-academic.html'), fullHtml)
} catch {}
console.log('self-contained HTML gate passed')

// Agent output with injection payloads is neutralized end-to-end.
const evilDoc = buildMindmap('# <img onerror=x>\n## <script>bad()</script>\n- <iframe src=evil>')
const evilExport = normalizeDoc(evilDoc)
const evilHtml = renderPrintHtml(evilExport, { theme: 'minimal' })
assert.ok(!evilHtml.includes('<script>bad()'), 'script payload neutralized')
assert.ok(!evilHtml.includes('<img onerror'), 'img onerror neutralized')
assert.ok(!evilHtml.includes('<iframe'), 'iframe neutralized')
console.log('injection neutralization passed')

// Quiz schema validation (S45-W3).
const quiz = [
  { type: 'choice', nodeId: '分支A', question: '哪个是正确的？', options: ['A', 'B', 'C'], answer: 'B', explanation: '因为B' },
  { type: 'judge', nodeId: '分支A', question: '判断对错。', answer: true },
  { type: 'blank', nodeId: '分支B', question: '填空：__ 是 __。', blanks: 2, answers: ['第一空', '第二空'] },
  { type: 'short-answer', nodeId: '分支B', question: '简述要点。', answer: '参考答案' },
]
function validateQuizItem(item, docNodes) {
  if (!item.type || !['choice', 'judge', 'blank', 'short-answer'].includes(item.type)) throw new Error('invalid quiz type: ' + item.type)
  if (!item.nodeId) throw new Error('quiz item missing nodeId')
  if (!docNodes.has(item.nodeId)) throw new Error('quiz nodeId not found in doc: ' + item.nodeId)
  if (item.type === 'choice' && (!Array.isArray(item.options) || item.options.length < 2)) throw new Error('choice needs >=2 options')
  if (item.type === 'choice' && !item.options.includes(item.answer)) throw new Error('choice answer must be in options')
  if (item.type === 'judge' && typeof item.answer !== 'boolean') throw new Error('judge answer must be boolean')
  if (item.type === 'blank' && Array.isArray(item.answers) && item.blanks !== item.answers.length) throw new Error('blanks/answers mismatch')
  return true
}
const docNodeIds = new Set(['分支A', '分支B', '组A1'])
for (const q of quiz) assert.ok(validateQuizItem(q, docNodeIds))
assert.throws(() => validateQuizItem({ ...quiz[0], nodeId: '不存在' }, docNodeIds), /not found/)
assert.throws(() => validateQuizItem({ ...quiz[0], options: ['A'], answer: 'A' }, docNodeIds), />=2 options/)
console.log('quiz schema validation passed')

// Quiz preview state machine (pure function).
function transitionQuizState(current, event) {
  const transitions = {
    idle: { draft: 'draft' },
    draft: { validate: 'validated', cancel: 'idle' },
    validated: { preview: 'preview', cancel: 'draft' },
    preview: { confirm: 'exported', back: 'validated' },
    exported: {},
  }
  const next = transitions[current]?.[event]
  if (!next) throw new Error('invalid transition: ' + current + ' + ' + event)
  return next
}
let state = 'idle'
state = transitionQuizState(state, 'draft')
state = transitionQuizState(state, 'validate')
state = transitionQuizState(state, 'preview')
assert.equal(state, 'preview')
assert.throws(() => transitionQuizState('exported', 'preview'), /invalid transition/)
console.log('quiz state machine passed')
