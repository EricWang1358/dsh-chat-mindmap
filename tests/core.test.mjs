import assert from 'node:assert/strict'
import { buildMindmap, flattenNode } from '../lib/core.js'

const outline = buildMindmap('# Product launch\n## Scope\n### Browser plugin\n## Risks\n### Bundle size')
assert.equal(outline.title, 'Product launch')
assert.deepEqual(outline.root.children?.map((node) => node.title), ['Scope', 'Risks'])
assert.equal(flattenNode(outline.root).length, 5)

const transcript = buildMindmap('用户：整理插件需求\n助手：先做 MVP\n用户：需要导出 XMind')
assert.ok((transcript.root.children?.length ?? 0) >= 2)
assert.ok(flattenNode(transcript.root).some((node) => node.title.includes('整理插件需求')))

console.log('core tests passed')
