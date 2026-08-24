import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const readme = await readFile(join(root, 'README.md'), 'utf8')
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')

assert.equal(packageJson.publishConfig?.access, 'public', 'published package must remain public')
assert.equal(packageLock.packages?.['']?.version, packageJson.version, 'package.json and package-lock.json versions must match')
assert.match(readme, new RegExp(`npmjs\\.com/package/${packageJson.name.replace('/', '\\/')}`), 'README must link to the public npm package')
assert.match(readme, /github\.com\/EricWang1358\/dsh-chat-mindmap/, 'README must link to the public repository')
assert.match(readme, /generate_chat_mindmap/, 'README must document the primary generation action')
assert.match(readme, /操作卡会直接打开对应脑图页/, 'README must document direct navigation instead of a fragile image preview')
assert.doesNotMatch(readme, /SVG 卡片|预览卡|···菜单/, 'README must not advertise superseded UI')
assert.doesNotMatch(readme, /私有仓库|仅供内部|\bprivate\b|\binternal-only\b/i, 'README must not imply an unavailable or private product')
assert.match(changelog, new RegExp(`## ${packageJson.version.replaceAll('.', '\\.')}`), 'CHANGELOG must include the package version')

console.log('release readiness documentation passed')
