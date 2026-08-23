import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
// W7: source anchors follow the componentized layout (S4-W2/W3), not the old
// single-file client. Each surface owns its own assertion set.
const viewSource = await readFile(join(root, 'src', 'client', 'components', 'BrainmapView.tsx'), 'utf8')
const idxSource = await readFile(join(root, 'src', 'client', 'index.ts'), 'utf8')
const apiSource = await readFile(join(root, 'src', 'client', 'api.ts'), 'utf8')
const themeSource = await readFile(join(root, 'src', 'client', 'canvas-theme.ts'), 'utf8')
const primitivesSource = await readFile(join(root, 'src', 'client', 'components', 'ui', 'primitives.tsx'), 'utf8')

assert.ok(packageJson.exports['.'])
assert.ok(packageJson.exports['./client'])
assert.ok(packageJson.files.includes('lib'))

// --- View surface (components/BrainmapView.tsx) ---
assert.match(viewSource, /export\('png', false/)
assert.match(viewSource, /image\/png/)
assert.match(viewSource, /openSvgPreview/)
assert.match(viewSource, /window\.open\('', '_blank'\)/)
assert.match(viewSource, /requestFullscreen/)
assert.match(viewSource, /exitFullscreen/)
assert.match(viewSource, /runCanvasTask/)
assert.match(viewSource, /task\(\)[\s\S]*await nextPaint\(\)/)
assert.match(viewSource, /aria-busy/)
assert.match(viewSource, /正在渲染脑图/)
assert.match(viewSource, /···/)
assert.doesNotMatch(viewSource, /zoomPercent/)
assert.doesNotMatch(viewSource, /setZoom/)
assert.match(viewSource, /var\(--dsw-alias-bg-layer-1/)
assert.match(viewSource, /var\(--dsw-alias-interactive-bg-hover/)
assert.match(viewSource, /DEFAULT_RENDER_COLLAPSE_DEPTH = 2/)
assert.match(viewSource, /collapseForInitialRender = depth >= DEFAULT_RENDER_COLLAPSE_DEPTH && hasChildren/)
assert.doesNotMatch(viewSource, /collapseForInitialRender =[^\n]+collapsed !== false/)
assert.match(viewSource, /shellIsDark/)
assert.match(viewSource, /shellThemeConfig/)
assert.match(viewSource, /MutationObserver/)
assert.match(viewSource, /toRenderNode\(sourceRoot, 0\)/)
assert.match(viewSource, /mountKeyOf\(record\)/)
assert.match(viewSource, /\/maps\/\$\{encodeURIComponent\(record\.libraryId\)\}\/regenerate/)
assert.match(viewSource, /Fork 子代理运行中/)
assert.doesNotMatch(viewSource, /inputActions\.setDraft/)
assert.match(viewSource, /cancelRegenerate/)
assert.match(viewSource, /附带 \$\{note\.length\} 字备注/)
assert.match(viewSource, /useCallback/)
assert.match(viewSource, /galleryRequestRef/)
assert.match(viewSource, /图库加载失败/)
assert.match(viewSource, /重试/)
assert.match(viewSource, /节点属性/)
assert.match(viewSource, /节点备注/)
assert.match(viewSource, /node_active/)
assert.match(viewSource, /ResizeObserver\(/)
assert.match(viewSource, /requestAnimationFrame\(\(\) => \{[\s\S]*mapRef\.current\?\.resize\(\)/)
assert.match(viewSource, /flex: '1 1 0'/)
assert.match(viewSource, /ref: canvasRef, style: \{ position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 \}/)
assert.match(viewSource, /shouldApplyAutosave\(/)
assert.match(viewSource, /exportXmind: async \(\)/)
assert.ok(!viewSource.includes('onXmind'))
assert.ok(!viewSource.includes("'/generate'"))

// --- Client assembly (index.ts) ---
assert.match(idxSource, /tool\.call\.toolview/)
assert.match(idxSource, /conversation\.view/)
assert.match(idxSource, /registerSnapshotFetcher/)
assert.match(idxSource, /getBlobUrlLru\(\)\.disposeAll/)
assert.match(idxSource, /settingsScope/)

// --- API layer ---
assert.match(apiSource, /class ApiError/)
assert.match(apiSource, /listQueryOf/)

// --- Theme single source (D-S3-9 closure) ---
assert.match(themeSource, /THEME_PRESETS/)
assert.match(themeSource, /export function shellThemeConfig/)

// --- Primitives provenance ---
assert.match(primitivesSource, /DswButton/)
assert.ok(!primitivesSource.includes('dsh-web-frontend'))

// --- Host assembly (src/index.ts) ---
const hostSource = await readFile(join(root, 'src', 'index.ts'), 'utf8')
assert.match(hostSource, /injectOptional\?\.\(\['agents', 'subagents'\]/)
assert.match(hostSource, /injectOptional\?\.\(\['jobs'\]/)
assert.match(hostSource, /injectOptional\?\.\(\['settings'\]/)
assert.match(hostSource, /createChatMindmapTools/)
assert.match(hostSource, /registerMindmapRoutes/)
assert.match(hostSource, /PanelRunRegistry/)
assert.match(hostSource, /panelAdapter\.begin\(/)
assert.match(hostSource, /resolveNewRecordConfig/)
assert.match(hostSource, /workspaceKeyOf\(/)
assert.doesNotMatch(hostSource, /reflect\?\.get/)
assert.doesNotMatch(hostSource, /startPanelRegeneration/)
assert.doesNotMatch(hostSource, /parseGenerateInput/)

// --- Canonical surfaces ---
const toolsSource = await readFile(join(root, 'src', 'host', 'tools.ts'), 'utf8')
assert.match(toolsSource, /Call present_chat_mindmap with libraryId and revisionId/)
assert.match(toolsSource, /defaultsForNew\?\.\(\)/)
const routesSource = await readFile(join(root, 'src', 'host', 'routes.ts'), 'utf8')
assert.match(routesSource, /requestSecurityError/)
assert.match(routesSource, /cross-site request rejected/)
assert.match(routesSource, /ROUTES_VERSION = 5/)
assert.match(routesSource, /expectedRecordVersion/)
const executorSource = await readFile(join(root, 'src', 'host', 'generation-executor.ts'), 'utf8')
assert.match(executorSource, /全部因超出提示预算/)
assert.equal(await readFile(join(root, 'lib', 'client.js.map')).then(() => true).catch(() => false), false, 'public package must not ship client sourcemaps')

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const filename = `${packageJson.name.replace(/^@/, '').replace('/', '-')}-${packageJson.version}.tgz`
const tarball = join(root, filename)
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

await rm(tarball, { force: true })
console.log('package verification passed')
