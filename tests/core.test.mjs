import assert from 'node:assert/strict'
import { buildMindmap, buildMindmapFromOutline, countMindmapNodes, flattenNode, mindmapToMarkdown, validateMindmapDocument } from '../lib/core.js'

const outline = buildMindmap('# Product launch\n## Scope\n### Browser plugin\n## Risks\n### Bundle size')
assert.equal(outline.title, 'Product launch')
assert.deepEqual(outline.root.children?.map((node) => node.title), ['Scope', 'Risks'])
assert.equal(flattenNode(outline.root).length, 5)
assert.match(mindmapToMarkdown(outline.root), /^# Product launch/m)

const transcript = buildMindmap('用户：整理插件需求\n助手：先做 MVP\n用户：需要导出 XMind')
assert.ok((transcript.root.children?.length ?? 0) >= 2)
assert.ok(flattenNode(transcript.root).some((node) => node.title.includes('整理插件需求')))
const strictOutline = buildMindmapFromOutline('# Strict root\n## Strict child')
assert.equal(strictOutline.root.children?.[0]?.title, 'Strict child')
assert.throws(() => buildMindmapFromOutline('plain transcript without headings'), /invalid Markdown outline/)

const limited = buildMindmap('# Root\n## A\n### A1\n## B\n### B1\n## C', 'ignored', { contextLimit: 20, maxNodes: 3 })
assert.ok(limited.source.characters <= 20)
assert.ok(countMindmapNodes(limited.root) <= 3)

const detailed = buildMindmap('# DevOps\n## CI/CD\n- Continuous integration\n  - Run tests on every change\n- Continuous delivery')
assert.equal(detailed.root.children?.[0]?.children?.[0]?.title, 'Continuous integration')
assert.equal(detailed.root.children?.[0]?.children?.[0]?.children?.[0]?.title, 'Run tests on every change')
assert.equal(detailed.root.children?.[0]?.children?.[1]?.title, 'Continuous delivery')

const defaultCapacity = buildMindmap(Array.from({ length: 10 }, (_, section) => [`## Section ${section}`, ...Array.from({ length: 18 }, (_, topic) => `### Topic ${section}-${topic}`)].join('\n')).join('\n'))
assert.ok(countMindmapNodes(defaultCapacity.root) > 120)
const highCapacity = buildMindmap(Array.from({ length: 16 }, (_, section) => [`## Section ${section}`, ...Array.from({ length: 30 }, (_, topic) => `### Topic ${section}-${topic}`)].join('\n')).join('\n'), '', { maxNodes: 1000, maxChildren: 100 })
assert.ok(countMindmapNodes(highCapacity.root) > 360)
assert.ok(countMindmapNodes(highCapacity.root) <= 1000)
assert.ok(mindmapToMarkdown(highCapacity.root).includes('Topic 0-0'))

const collapsed = buildMindmap('# Root\n## Topic')
collapsed.root.children[0].collapsed = true
assert.equal(validateMindmapDocument(collapsed).root.children[0].collapsed, true)

assert.throws(() => validateMindmapDocument({ version: 1, title: 'bad', root: { id: 'x', title: 'x' } }), /source is required/)
assert.throws(() => validateMindmapDocument({ version: 1, title: 'bad', source: { kind: 'agent-context', characters: 0, generatedAt: '' }, root: { id: 'x', title: 'x', children: 'bad' } }), /children must be an array/)

console.log('core tests passed')
