import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const pathname = decodeURIComponent(new URL('..', import.meta.url).pathname)
const root = process.platform === 'win32' ? pathname.replace(/^\/(?=[A-Za-z]:)/, '') : pathname
const files = ['src/index.ts', 'src/client/index.ts', 'src/core.ts', 'src/library.ts'].map((file) => join(root, file))
const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
for (const pattern of [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /child_process/, /process\.env\.(AWS|AZURE|GOOGLE|OPENAI|ANTHROPIC|GITHUB)_/]) {
  assert.doesNotMatch(source, pattern, `SAST forbidden pattern: ${pattern}`)
}
assert.match(source, /requestSecurityError/)
assert.match(source, /cross-site request rejected/)
assert.match(source, /MAX_TOTAL_STORAGE_BYTES/)
assert.match(source, /MAX_MAP_COUNT/)
console.log('SAST static checks passed')
