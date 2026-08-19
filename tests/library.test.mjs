import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { buildMindmap } from '../lib/core.js'
import { archiveMindmap, deleteMindmap, getMindmap, listMindmaps, saveMindmap, updateMindmap } from '../lib/library.js'

const root = `${process.cwd()}\\.test-mindmap-home`
process.env.DSH_MINDMAP_HOME = root
await rm(root, { recursive: true, force: true })
const first = await saveMindmap({ title: 'One', document: buildMindmap('# One\n## A'), source: { kind: 'text' } })
const second = await saveMindmap({ libraryId: first.libraryId, title: 'One', document: buildMindmap('# One\n## B'), source: { kind: 'text' } })
assert.equal(second.previous?.root.children?.[0]?.title, 'A')
const edited = await updateMindmap(first.libraryId, { document: buildMindmap('# One\n## Edited'), rotatePrevious: false })
assert.equal(edited?.previous?.root.children?.[0]?.title, 'A')
await archiveMindmap(first.libraryId)
assert.equal((await listMindmaps()).length, 0)
assert.equal((await listMindmaps({ archived: true })).length, 1)
assert.ok(await getMindmap(first.libraryId))
assert.equal(await deleteMindmap(first.libraryId), true)
console.log('library tests passed')
