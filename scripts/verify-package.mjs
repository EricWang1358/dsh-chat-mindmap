import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
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
assert.match(clientSource, /···/)
assert.equal(await readFile(join(root, 'lib', 'client.js.map')).then(() => true).catch(() => false), false, 'public package must not ship client source map')
assert.match(clientSource, /gridTemplateColumns: sidebarOpen \?/)
assert.match(clientSource, /workspaceRef/)
assert.match(clientSource, /收起脑图库/)
assert.match(clientSource, /position: 'absolute', top: '16px', right: '16px', bottom: '16px'/)
assert.match(clientSource, /width: 'min\(300px, calc\(100% - 276px\)\)'/)
assert.doesNotMatch(clientSource, /zoomPercent/)
assert.doesNotMatch(clientSource, /setZoom/)
assert.match(clientSource, /var\(--dsw-alias-bg-layer-1/)
assert.match(clientSource, /var\(--dsw-alias-interactive-bg-hover/)
assert.match(clientSource, /DEFAULT_RENDER_COLLAPSE_DEPTH = 2/)
assert.match(clientSource, /collapseForInitialRender = depth >= DEFAULT_RENDER_COLLAPSE_DEPTH && hasChildren/)
assert.doesNotMatch(clientSource, /collapseForInitialRender =[^\n]+collapsed !== false/)
assert.match(clientSource, /shellIsDark/)
assert.match(clientSource, /shellThemeConfig/)
assert.match(clientSource, /MutationObserver/)
assert.match(clientSource, /toRenderNode\(sourceRoot, 0\)/)
assert.match(clientSource, /key: `\$\{record\.libraryId\}:\$\{record\.current\.source\.generatedAt\}`/)
assert.match(clientSource, /\/maps\/\$\{encodeURIComponent\(record\.libraryId\)\}\/regenerate/)
assert.match(clientSource, /Fork 子代理运行中/)
assert.doesNotMatch(clientSource, /inputActions\.setDraft/)
assert.match(clientSource, /cancelRegenerate/)
assert.match(clientSource, /instruction\.trim\(\)/)
assert.match(clientSource, /附带 \$\{note\.length\} 字备注/)
assert.match(clientSource, /useCallback/)
assert.match(clientSource, /galleryRequestRef/)
assert.match(clientSource, /图库加载失败/)
assert.match(clientSource, /重试/)
assert.match(clientSource, /节点属性/)
assert.match(clientSource, /节点备注/)
assert.match(clientSource, /node_active/)
assert.match(clientSource, /ResizeObserver\(/)
assert.match(clientSource, /requestAnimationFrame\(\(\) => \{[\s\S]*mapRef\.current\?\.resize\(\)/)
assert.match(clientSource, /flex: '1 1 0'/)
assert.match(clientSource, /ref: canvasRef, style: \{ position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 \}/)

const hostSource = await readFile(join(root, 'src', 'index.ts'), 'utf8')
assert.match(hostSource, /injectOptional\?\.\(\['agents', 'subagents'\]/)
assert.match(hostSource, /SubagentRun, SubagentRuntime/)
assert.match(hostSource, /runtime\.start\('fork'/)
assert.match(hostSource, /childId = run\.id/)
assert.doesNotMatch(hostSource, /reflect\?\.get/)
assert.match(hostSource, /requestSecurityError/)
assert.match(hostSource, /cross-site request rejected/)
const librarySource = await readFile(join(root, 'src', 'library.ts'), 'utf8')
assert.match(librarySource, /MAX_TOTAL_STORAGE_BYTES/)
assert.match(librarySource, /LIST_CONCURRENCY/)
assert.match(hostSource, /Call present_chat_mindmap with libraryId and revisionId/)

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const filename = `${packageJson.name.replace(/^@/, '').replace('/', '-')}-${packageJson.version}.tgz`
const tarball = join(root, filename)
// Use inherited stdio: confined Windows cannot open the pipe used by the old
// capture-based npm-pack implementation, while npm itself still does the real
// packaging work. The deterministic npm filename is then inspected directly.
execFileSync(npmBin, ['pack'], {
  cwd: root,
  shell: process.platform === 'win32',
  stdio: 'inherit',
  env: { ...process.env, npm_config_cache: join(root, '.npm-cache'), npm_config_update_notifier: 'false' },
})
const tar = gunzipSync(await readFile(tarball))
const published = new Set()
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512)
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  if (!name) break
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
  const rawSize = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
  const size = rawSize ? Number.parseInt(rawSize, 8) : 0
  published.add((prefix ? `${prefix}/` : '') + name.replace(/^package\//, ''))
  offset += 512 + Math.ceil(size / 512) * 512
}
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
await rm(tarball, { force: true })
console.log('package verification passed')
