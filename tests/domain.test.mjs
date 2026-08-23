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
})
assert.deepEqual(normalizeMindmapSettings({}), fallback)
assert.equal(normalizeMindmapSettings({ defaultDensity: 'huge' }).defaultDensity, 'standard')
assert.equal(normalizeMindmapSettings({ defaultMaxNodes: -5 }).defaultMaxNodes, 8)
assert.equal(normalizeMindmapSettings({ defaultMaxNodes: 99_999 }).defaultMaxNodes, 2_000)
assert.equal(normalizeMindmapSettings({ defaultContextLimit: 'x' }).defaultContextLimit, 80_000)
assert.equal(normalizeMindmapSettings({ defaultLayout: 'fishBone' }).defaultLayout, 'fishBone')
assert.equal(normalizeMindmapSettings({ focusGeneratedMap: 1 }).focusGeneratedMap, false)

const custom = normalizeMindmapSettings({ defaultTheme: 'ocean', defaultDensity: 'compact', defaultMaxNodes: 120, focusGeneratedMap: true })
assert.deepEqual(custom, {
  defaultLayout: 'logicalStructure',
  defaultTheme: 'ocean',
  defaultDensity: 'compact',
  defaultMaxNodes: 120,
  defaultContextLimit: 80_000,
  defaultLanguage: 'auto',
  focusGeneratedMap: true,
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
