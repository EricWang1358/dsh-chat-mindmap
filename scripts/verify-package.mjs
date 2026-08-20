import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const clientSource = await readFile(join(root, 'src', 'client', 'index.ts'), 'utf8')
assert.ok(packageJson.exports['.'])
assert.ok(packageJson.exports['./client'])
assert.ok(packageJson.files.includes('lib'))
assert.match(clientSource, /export\('png', false/)
assert.match(clientSource, /image\/png/)
assert.match(clientSource, /openSvgPreview/)
assert.match(clientSource, /window\.open\('', '_blank'\)/)
assert.match(clientSource, /requestFullscreen/)
assert.match(clientSource, /exitFullscreen/)
assert.match(clientSource, /runCanvasTask/)
assert.match(clientSource, /task\(\)[\s\S]*await nextPaint\(\)/)
assert.match(clientSource, /aria-busy/)
assert.match(clientSource, /正在渲染脑图/)
assert.match(clientSource, /更多操作/)
assert.match(clientSource, /展开外观设置/)
assert.match(clientSource, /外观 · \$\{LAYOUT_OPTIONS/)
assert.match(clientSource, /PROGRESSIVE_RENDER_THRESHOLD = 180/)
assert.match(clientSource, /toRenderNode/)
assert.match(clientSource, /key: `\$\{record\.libraryId\}:\$\{record\.current\.source\.generatedAt\}`/)
assert.match(clientSource, /\/maps\/\$\{encodeURIComponent\(record\.libraryId\)\}\/regenerate/)
assert.match(clientSource, /Fork 子代理运行中/)
assert.doesNotMatch(clientSource, /inputActions\.setDraft/)
assert.match(clientSource, /cancelRegenerate/)
assert.match(clientSource, /重新生成备注/)
assert.match(clientSource, /附带 \$\{note\.length\} 字备注/)
const hostSource = await readFile(join(root, 'src', 'index.ts'), 'utf8')
assert.match(hostSource, /injectOptional\?\.\(\['agents', 'subagents'\]/)
assert.match(hostSource, /SubagentRun, SubagentRuntime/)
assert.match(hostSource, /runtime\.start\('fork'/)
assert.match(hostSource, /childId = run\.id/)
assert.doesNotMatch(hostSource, /reflect\?\.get/)
assert.match(hostSource, /libraryId=\$\{value\.libraryId\} revisionId=\$\{value\.revisionId\}/)
assert.match(hostSource, /Call present_chat_mindmap with libraryId and revisionId/)

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const useShell = process.platform === 'win32'
const packs = JSON.parse(execFileSync(npmBin, ['pack', '--json'], { cwd: root, encoding: 'utf8', shell: useShell }))
const pack = packs[0]
assert.equal(typeof pack?.filename, 'string')
const published = new Set(pack.files.map((file) => file.path))
for (const required of [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
]) assert.ok(published.has(required), `missing published artifact: ${required}`)

// DSH supplies the package's Host/UI services as peers. Import behavior is
// covered by project tests against the real local DSH graph; a bare npm temp
// project has no equivalent composition and is not a meaningful install target.
await rm(join(root, pack.filename), { force: true })
console.log('package verification passed')
