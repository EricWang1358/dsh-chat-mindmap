import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMindmap } from '../lib/core.js'
import { archiveMindmap, deleteMindmap, getMindmap, listMindmaps, saveMindmap, updateMindmap } from '../lib/library.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-chat-mindmap-'))
process.env.DSH_MINDMAP_HOME = root
try {
  const first = await saveMindmap({ title: 'One', document: buildMindmap('# One\n## A'), source: { kind: 'text' } })
  const second = await saveMindmap({ libraryId: first.libraryId, title: 'One', document: buildMindmap('# One\n## B'), source: { kind: 'text' } })
  assert.equal(second.previous?.root.children?.[0]?.title, 'A')
  const edited = await updateMindmap(first.libraryId, { document: buildMindmap('# One\n## Edited'), rotatePrevious: false })
  assert.equal(edited?.previous?.root.children?.[0]?.title, 'A')
  await assert.rejects(() => saveMindmap({ libraryId: first.libraryId, title: 'Conflict', document: buildMindmap('# Conflict\n## Lost'), expectedUpdatedAt: first.updatedAt }), /mindmap conflict/)
  await archiveMindmap(first.libraryId)
  assert.equal((await listMindmaps()).length, 0)
  assert.equal((await listMindmaps({ archived: true })).length, 1)
  assert.ok(await getMindmap(first.libraryId))

  const concurrent = await Promise.all([
    saveMindmap({ libraryId: first.libraryId, title: 'One', document: buildMindmap('# One\n## C') }),
    saveMindmap({ libraryId: first.libraryId, title: 'One', document: buildMindmap('# One\n## D') }),
  ])
  const final = await getMindmap(first.libraryId)
  assert.ok(final)
  assert.equal(final.current.root.children?.[0]?.title, concurrent[1].current.root.children?.[0]?.title)
  assert.equal(final.previous?.root.children?.[0]?.title, concurrent[0].current.root.children?.[0]?.title)

  assert.equal(await deleteMindmap(first.libraryId), true)
  assert.equal(await getMindmap(first.libraryId), null)
  assert.equal((await listMindmaps({ archived: true })).length, 0)
  await assert.rejects(() => readFile(join(root, 'maps', `${first.libraryId}.json`)), /ENOENT/)
  const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'))
  assert.ok(!index.includes(first.libraryId))

  await assert.rejects(() => getMindmap('../invalid'), /invalid library id/)
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('library tests passed')
