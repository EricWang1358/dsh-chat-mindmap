import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundle = await readFile(join(root, 'lib', 'client.js'))
const gzipBytes = gzipSync(bundle).byteLength
const budgetBytes = 200 * 1024

assert.ok(bundle.byteLength > 0, 'client bundle is empty')
assert.ok(gzipBytes <= budgetBytes, `client gzip bundle ${gzipBytes} B exceeds ${budgetBytes} B budget`)
console.log(`bundle verification passed: ${bundle.byteLength} B raw, ${gzipBytes} B gzip (budget ${budgetBytes} B)`)
