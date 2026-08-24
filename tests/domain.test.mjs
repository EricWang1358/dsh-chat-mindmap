import assert from 'node:assert/strict'
import { DOMAIN_ERROR_CODES, DomainError } from '../lib/domain/errors.js'

const expectedCodes = [
  'CAPABILITY_UNAVAILABLE',
  'SESSION_UNAVAILABLE',
  'WORKSPACE_SCOPE_MISMATCH',
  'MINDMAP_NOT_FOUND',
  'MINDMAP_BUSY',
  'MINDMAP_CONFLICT',
  'MINDMAP_REVISION_EXPIRED',
  'SOURCE_UNAVAILABLE',
  'GENERATION_TIMEOUT',
  'GENERATION_FAILED',
  'INVALID_AGENT_OUTLINE',
  'INVALID_REQUEST',
  'STORAGE_FAILED',
]
assert.deepEqual([...DOMAIN_ERROR_CODES].sort(), [...expectedCodes].sort())

for (const code of expectedCodes) {
  const error = new DomainError(code, 'detail')
  assert.ok(error instanceof Error)
  assert.equal(error.name, 'DomainError')
  assert.equal(error.code, code)
  assert.equal(error.message, 'detail')
}

const conflict = new DomainError('MINDMAP_CONFLICT', 'mindmap conflict')
assert.equal(conflict.message, 'mindmap conflict')

console.log('domain errors tests passed')

import { DEFAULT_MINDMAP_CONFIG, normalizeMindmapSettings, resolveNewRecordConfig } from '../lib/domain/settings.js'
import { DEFAULT_CONFIG } from '../lib/library.js'

assert.equal(DEFAULT_CONFIG, DEFAULT_MINDMAP_CONFIG)

const fallback = normalizeMindmapSettings(undefined)
assert.deepEqual(fallback, {
  defaultLayout: 'logicalStructure',
  defaultTheme: 'default',
  defaultDensity: 'standard',
  defaultMaxNodes: 360,
  defaultContextLimit: 80_000,
  defaultLanguage: 'auto',
  focusGeneratedMap: false,
  onboardingSeen: false,
})
assert.deepEqual(normalizeMindmapSettings({}), fallback)
assert.equal(normalizeMindmapSettings({ defaultDensity: 'huge' }).defaultDensity, 'standard')
assert.equal(normalizeMindmapSettings({ defaultMaxNodes: -5 }).defaultMaxNodes, 8)
assert.equal(normalizeMindmapSettings({ defaultMaxNodes: 99_999 }).defaultMaxNodes, 2_000)
assert.equal(normalizeMindmapSettings({ defaultContextLimit: 'x' }).defaultContextLimit, 80_000)
assert.equal(normalizeMindmapSettings({ defaultLayout: 'fishBone' }).defaultLayout, 'fishBone')
assert.equal(normalizeMindmapSettings({ focusGeneratedMap: 1 }).focusGeneratedMap, false)
assert.equal(normalizeMindmapSettings({ onboardingSeen: 1 }).onboardingSeen, false)

const custom = normalizeMindmapSettings({ defaultTheme: 'ocean', defaultDensity: 'compact', defaultMaxNodes: 120, focusGeneratedMap: true, onboardingSeen: true })
assert.deepEqual(custom, {
  defaultLayout: 'logicalStructure',
  defaultTheme: 'ocean',
  defaultDensity: 'compact',
  defaultMaxNodes: 120,
  defaultContextLimit: 80_000,
  defaultLanguage: 'auto',
  focusGeneratedMap: true,
  onboardingSeen: true,
})

const merged = resolveNewRecordConfig(custom, { theme: 'forest', instruction: '重点风险', maxNodes: 500 })
assert.equal(merged.theme, 'forest')
assert.equal(merged.maxNodes, 500)
assert.equal(merged.density, 'compact')
assert.equal(merged.contextLimit, 80_000)
assert.equal(merged.language, 'auto')
assert.equal(merged.layout, 'logicalStructure')
assert.equal(merged.instruction, '重点风险')
assert.equal(merged.font, 'system')

const untouched = resolveNewRecordConfig(custom, {})
assert.deepEqual(untouched, {
  layout: 'logicalStructure',
  density: 'compact',
  maxNodes: 120,
  theme: 'ocean',
  font: 'system',
  instruction: '',
  language: 'auto',
  contextLimit: 80_000,
})

const settingsSnapshot = JSON.stringify(custom)
const mergedRequest = { theme: 'forest', instruction: '重点风险', maxNodes: 500 }
const mergedRequestSnapshot = JSON.stringify(mergedRequest)
assert.deepEqual(resolveNewRecordConfig(custom, mergedRequest), merged)
assert.equal(JSON.stringify(custom), settingsSnapshot)
assert.equal(JSON.stringify(mergedRequest), mergedRequestSnapshot)
assert.deepEqual(resolveNewRecordConfig(custom, mergedRequest), merged)

console.log('domain settings tests passed')

import { normalizeWorkspaceCwd, workspaceKeyOf } from '../lib/domain/records.js'
import { buildMindmap, countMindmapNodes, flattenNode, validateMindmapDocument } from '../lib/core.js'

const winVariants = ['D:\\A\\Dir', 'd:\\a\\dir', 'D:/A/Dir/', '\\\\?\\D:\\A\\Dir', 'D:\\\\A\\\\Dir']
const winNormalized = new Set(winVariants.map((sample) => normalizeWorkspaceCwd(sample, 'win32')))
assert.equal(winNormalized.size, 1)
assert.equal(normalizeWorkspaceCwd('C:\\', 'win32'), 'c:\\')

const posixVariants = ['/tmp/work/', '/tmp//work']
assert.deepEqual(posixVariants.map((sample) => normalizeWorkspaceCwd(sample, 'linux')), ['/tmp/work', '/tmp/work'])
assert.notEqual(normalizeWorkspaceCwd('/tmp/Work', 'darwin'), normalizeWorkspaceCwd('/tmp/work', 'darwin'))

assert.notEqual(workspaceKeyOf('/srv/maps', 'linux'), workspaceKeyOf('D:\\maps', 'win32'))
for (const sample of winVariants) assert.equal(workspaceKeyOf(sample, 'win32'), workspaceKeyOf('D:\\A\\Dir', 'win32'))

const key = workspaceKeyOf('/tmp/work', 'linux')
assert.match(key, /^[a-f0-9]{32}$/)

assert.throws(() => normalizeWorkspaceCwd('relative/path', 'win32'), /absolute/)
assert.throws(() => normalizeWorkspaceCwd('relative/path', 'linux'), /absolute/)
assert.throws(() => normalizeWorkspaceCwd('', 'linux'), /required/)
assert.throws(() => normalizeWorkspaceCwd(null, 'linux'), /required/)

console.log('domain workspace tests passed')

import { LEGACY_UNSCOPED_WORKSPACE, migrateRecordToV2 } from '../lib/domain/records.js'
import { revisionIdOf } from '../lib/revisions.js'

const v1Document = buildMindmap('# Legacy\n## Child')
const v1Record = {
  libraryId: 'map-legacy-1',
  title: 'Legacy',
  current: v1Document,
  config: { layout: 'logicalStructure', density: 'standard', maxNodes: 360, theme: 'default', font: 'system', instruction: '', language: 'auto', contextLimit: 80_000 },
  source: { kind: 'text' },
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}
const migrated = migrateRecordToV2(v1Record)
assert.equal(migrated.schemaVersion, 2)
assert.equal(migrated.recordVersion, 1)
assert.equal(migrated.workspaceKey, LEGACY_UNSCOPED_WORKSPACE)
assert.equal(migrated.previewCurrent.revisionId, revisionIdOf(v1Document))
assert.deepEqual(migrated.previewCurrent.document, v1Document)
assert.equal(migrated.previewCurrent.generatedAt, v1Record.updatedAt)
assert.equal(migrated.previewPrevious, undefined)
assert.notEqual(migrated, v1Record)

const snapshot = JSON.stringify(v1Record)
migrateRecordToV2(v1Record)
assert.equal(JSON.stringify(v1Record), snapshot)

const remigrated = migrateRecordToV2(JSON.parse(JSON.stringify(migrated)))
assert.deepEqual(remigrated, JSON.parse(JSON.stringify(migrated)))

const preKeyed = migrateRecordToV2({ ...JSON.parse(JSON.stringify(v1Record)), workspaceKey: 'abc123' })
assert.equal(preKeyed.workspaceKey, 'abc123')

console.log('domain records migration tests passed')

import { applyManualEdit, rotateGenerationSnapshots, snapshotOf, swapCurrentPrevious } from '../lib/domain/records.js'

const docs = {
  A: buildMindmap('# Gen One\n## A-child'),
  B: buildMindmap('# Gen Two\n## B-child'),
  C: buildMindmap('# Gen Three\n## C-child'),
}

const generationOne = migrateRecordToV2({ ...JSON.parse(JSON.stringify(v1Record)), current: docs.A })
assert.equal(generationOne.previewCurrent.revisionId, revisionIdOf(docs.A))

const generationTwo = rotateGenerationSnapshots(generationOne, docs.B, '2026-01-03T00:00:00.000Z')
assert.equal(generationTwo.current, docs.B)
assert.equal(generationTwo.previous, docs.A)
assert.equal(generationTwo.previewCurrent.revisionId, revisionIdOf(docs.B))
assert.deepEqual(generationTwo.previewPrevious, generationOne.previewCurrent)
assert.notEqual(generationTwo.recordVersion, undefined)

const generationThree = rotateGenerationSnapshots(generationTwo, docs.C, '2026-01-04T00:00:00.000Z')
assert.equal(generationThree.previewCurrent.revisionId, revisionIdOf(docs.C))
assert.equal(generationThree.previewPrevious.revisionId, revisionIdOf(docs.B))
const expiredRevision = revisionIdOf(docs.A)
for (const key of ['current', 'previous', 'previewCurrent', 'previewPrevious']) {
  const value = generationThree[key]
  const revisionId = value && value.revisionId ? value.revisionId : value ? revisionIdOf(value) : null
  assert.ok(revisionId !== expiredRevision, `generation one must expire from ${key}`)
}
assert.equal(JSON.stringify(generationThree).includes(expiredRevision), false)

assert.equal(snapshotOf(docs.A, 'x').revisionId, revisionIdOf(docs.A))

const beforeManualEdit = generationThree
const manuallyEdited = applyManualEdit(generationThree, buildMindmap('# Manual\n## Edit'))
assert.equal(manuallyEdited.current.title, 'Manual')
assert.equal(manuallyEdited.previous, beforeManualEdit.previous)
assert.equal(manuallyEdited.previewCurrent, beforeManualEdit.previewCurrent)
assert.equal(manuallyEdited.previewPrevious, beforeManualEdit.previewPrevious)

const swapped = swapCurrentPrevious(generationThree)
assert.equal(swapped.current, docs.B)
assert.equal(swapped.previous, docs.C)
assert.equal(swapped.previewCurrent, generationThree.previewCurrent)
assert.equal(swapped.previewPrevious, generationThree.previewPrevious)
const swappedBack = swapCurrentPrevious(swapped)
assert.equal(swappedBack.current, docs.C)
assert.equal(swappedBack.previous, docs.B)

assert.throws(() => swapCurrentPrevious({ ...generationThree, previous: undefined }), /no previous/)

console.log('domain records rotation tests passed')

import { buildStrictOutlineDocument, validateAgentOutlineResult } from '../lib/domain/generation.js'

assert.deepEqual(validateAgentOutlineResult({ title: ' T ', outline: ' # R\n## C ' }), { title: 'T', outline: '# R\n## C' })
for (const bad of [
  { title: '', outline: '# R\n## C' },
  { title: '   ', outline: '# R\n## C' },
  { title: 'x'.repeat(121), outline: '# R\n## C' },
  { title: 'T', outline: '' },
  { title: 'T', outline: '   ' },
  { title: 'T', outline: 'x'.repeat(200_001) },
  { title: 'T', outline: '# Only root' },
  { title: 'T', outline: '# A' },
  null,
  { title: 7, outline: '# R\n## C' },
]) {
  assert.throws(() => validateAgentOutlineResult(bad), /INVALID_AGENT_OUTLINE|outline|title/, JSON.stringify(bad))
}

const bulletStrict = buildStrictOutlineDocument({ title: 'Bullet', outline: '# Bullet\n- Child A\n- Child B' })
assert.equal(bulletStrict.document.root.children?.length, 2)

const strict = buildStrictOutlineDocument({ title: 'Strict', outline: '# Strict\n## Child' })
assert.equal(strict.document.title, 'Strict')
assert.equal(strict.truncated, false)
assert.doesNotThrow(() => validateMindmapDocument(strict.document))

const jump = buildStrictOutlineDocument({ title: 'Jump', outline: '# R\n### X\n## Y' })
const jumpTitles = flattenNode(jump.document.root).map((entry) => entry.title)
assert.ok(jumpTitles.includes('X') && jumpTitles.includes('Y'), 'level jump must not lose nodes')
assert.equal(jump.document.root.children?.length, 2)

const overflowing = buildStrictOutlineDocument({ title: 'Cap', outline: '# Cap\n## b\n## c\n## d\n## e' }, { maxNodes: 3 })
assert.equal(overflowing.truncated, true)
assert.ok(countMindmapNodes(overflowing.document.root) <= 3)

const transcriptOnly = () => buildStrictOutlineDocument({ title: 'Bad', outline: 'plain transcript without headings' })
assert.throws(transcriptOnly, DomainError)
try {
  transcriptOnly()
} catch (error) {
  assert.equal(error.code, 'INVALID_AGENT_OUTLINE')
}

console.log('domain generation tests passed')
