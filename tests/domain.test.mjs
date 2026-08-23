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
