import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMindmap } from '../lib/core.js'
import { archiveMindmap, deleteMindmap, getMindmap, listMindmaps, saveMindmap, updateMindmap } from '../lib/library.js'
import { revisionIdOf } from '../lib/revisions.js'

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

import { mkdir, writeFile } from 'node:fs/promises'
import { validateMindmapDocument } from '../lib/core.js'

process.env.DSH_MINDMAP_HOME = await mkdtemp(join(tmpdir(), 'dsh-chat-mindmap-v2-'))
try {
  const created = await saveMindmap({ title: 'V2', document: buildMindmap('# V2\n## Fresh'), source: { kind: 'text' } })
  assert.equal(created.schemaVersion, 2)
  assert.equal(created.recordVersion, 1)
  assert.equal(created.previewCurrent.revisionId, revisionIdOf(created.current))
  assert.deepEqual(created.previewCurrent.document, created.current)

  await mkdir(join(process.env.DSH_MINDMAP_HOME, 'maps'), { recursive: true })
  const v1FixtureId = 'map-v1fixture'
  const v1Fixture = {
    libraryId: v1FixtureId,
    title: 'Legacy fixture',
    current: buildMindmap('# Fixture\n## Old'),
    config: { layout: 'logicalStructure', density: 'standard', maxNodes: 360, theme: 'default', font: 'system', instruction: '', language: 'auto', contextLimit: 80_000 },
    archived: false,
    createdAt: '2025-12-31T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  }
  await writeFile(join(process.env.DSH_MINDMAP_HOME, 'maps', `${v1FixtureId}.json`), JSON.stringify(v1Fixture), 'utf8')
  await writeFile(join(process.env.DSH_MINDMAP_HOME, 'index.json'), JSON.stringify([created.libraryId, v1FixtureId]), 'utf8')

  const migratedFixture = await getMindmap(v1FixtureId)
  assert.ok(migratedFixture)
  assert.equal(migratedFixture.schemaVersion, 2)
  assert.equal(migratedFixture.recordVersion, 1)
  assert.equal(migratedFixture.previewCurrent.revisionId, revisionIdOf(migratedFixture.current))
  assert.equal(migratedFixture.previewCurrent.generatedAt, v1Fixture.updatedAt)
  const listed = await listMindmaps()
  assert.ok(listed.some((entry) => entry.libraryId === v1FixtureId))

  const rotated = await saveMindmap({ libraryId: created.libraryId, title: 'V2', document: buildMindmap('# V2\n## Second'), source: { kind: 'text' } })
  assert.equal(rotated.recordVersion, 2)
  assert.equal(rotated.previewCurrent.revisionId, revisionIdOf(rotated.current))
  assert.equal(rotated.previewPrevious.revisionId, revisionIdOf(created.current))

  const persisted = JSON.parse(await readFile(join(process.env.DSH_MINDMAP_HOME, 'maps', `${rotated.libraryId}.json`), 'utf8'))
  for (const key of ['libraryId', 'title', 'config', 'createdAt', 'updatedAt', 'schemaVersion', 'recordVersion', 'previewCurrent']) {
    assert.ok(Object.prototype.hasOwnProperty.call(persisted, key), `persisted record missing ${key}`)
  }
  assert.doesNotThrow(() => validateMindmapDocument(persisted.current))
  assert.doesNotThrow(() => validateMindmapDocument(persisted.previous))
} finally {
  await rm(process.env.DSH_MINDMAP_HOME, { recursive: true, force: true })
}
console.log('library v2 storage tests passed')
