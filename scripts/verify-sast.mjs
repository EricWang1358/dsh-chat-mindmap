import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const pathname = decodeURIComponent(new URL('..', import.meta.url).pathname)
const root = process.platform === 'win32' ? pathname.replace(/^\/(?=[A-Za-z]:)/, '') : pathname
// Every runtime source module must be listed here. Missing files are skipped
// (instead of crashing) so any prefix of commits can be rolled back and still
// run this gate.
const files = [
  'src/index.ts',
  'src/core.ts',
  'src/library.ts',
  'src/revisions.ts',
  'src/client/index.ts',
  'src/domain/errors.ts',
  'src/domain/settings.ts',
  'src/domain/records.ts',
  'src/domain/generation.ts',
  'src/host/generation-executor.ts',
  'src/host/generation-locks.ts',
  'src/host/panel-runs.ts',
  'src/host/adapters.ts',
].map((file) => join(root, file)).filter((file) => existsSync(file))
assert.ok(files.length >= 4, 'SAST scan list must not be empty')
const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
for (const pattern of [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /child_process/, /process\.env\.(AWS|AZURE|GOOGLE|OPENAI|ANTHROPIC|GITHUB)_/]) {
  assert.doesNotMatch(source, pattern, `SAST forbidden pattern: ${pattern}`)
}
assert.match(source, /requestSecurityError/)
assert.match(source, /cross-site request rejected/)
assert.match(source, /MAX_TOTAL_STORAGE_BYTES/)
assert.match(source, /MAX_MAP_COUNT/)
console.log('SAST static checks passed')
