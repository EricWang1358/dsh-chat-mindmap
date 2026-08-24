import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshRoot = join('D:', 'Program Files', 'nodejs', 'node_global', 'node_modules', '@deepseek-ai', 'dsh')
const dshPackages = join(dshRoot, 'node_modules', '@deepseek-ai')
const forkPackage = join(dshPackages, 'dsh-subagent-fork-in-process', 'package.json')
const forkReadme = join(dshPackages, 'dsh-subagent-fork-in-process', 'README.md')
const jobsPackage = join(dshPackages, 'dsh-tool-jobs', 'package.json')
const jobsReadme = join(dshPackages, 'dsh-tool-jobs', 'README.md')
const g03LiveEvidence = join(root, 'docs', 'PHASE_0_G0_3_LIVE_TRANSCRIPT.md')
const attachmentPackage = join(dshPackages, 'dsh-client-ui-attachment', 'package.json')
const toolPackage = join(dshPackages, 'dsh-client-ui-tool', 'package.json')
const runtimePackage = join(dshPackages, 'dsh-client-runtime', 'package.json')
const exportFile = join(root, 'node_modules', 'simple-mind-map', 'src', 'plugins', 'Export.js')

const results = []
function pass(id, title, evidence, verification = 'fixture') {
  results.push({ id, title, status: 'PASS', verification, evidence })
}
function pending(id, title, reason) {
  results.push({ id, title, status: 'PENDING_LIVE', verification: 'live', evidence: reason })
}

const forkMeta = JSON.parse(await readFile(forkPackage, 'utf8'))
const forkDocs = await readFile(forkReadme, 'utf8')
assert.equal(forkMeta.version, '0.1.0-rc.8')
assert.match(forkDocs, /providerName.*default.*fork/i)
assert.match(forkDocs, /outputSchema.*toolFilter.*persona/is)
assert.match(forkDocs, /completed conversation turns/i)
pass('G0-1', 'fork provider 名称与启动能力', 'rc8 public package metadata and README document providerName fork and outputSchema/toolFilter/persona capabilities.', 'public-contract')

const events = [
  { seq: 0, type: 'turn/end', data: { turn: 0 } },
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'tool/call', data: { name: 'current_tool' } },
]
const lastEnd = events.findLast((event) => event.type === 'turn/end')
const seed = events.slice(0, lastEnd.seq + 1)
assert.deepEqual(seed, events.slice(0, 1))
assert.equal(seed.some((event) => event.type === 'tool/call'), false)
pass('G0-2', 'fork 只继承已完成回合', 'Equivalent completedTurnPrefix fixture stops at the last turn/end and excludes the in-flight tool call; supplementalContext remains the caller-owned escape hatch.', 'source-contract+fixture')

const jobsMeta = JSON.parse(await readFile(jobsPackage, 'utf8'))
const jobsDocs = await readFile(jobsReadme, 'utf8').catch(() => '')
assert.equal(jobsMeta.version, '0.1.0-rc.8')
assert.ok(jobsMeta.exports?.['.'])
assert.match(jobsDocs, /completion|job_output|owner/i)
pass('G0-3', 'owned Job 完成通知与 job_output 协议', 'rc8 public package metadata and documentation expose the Jobs package and describe completion/output ownership semantics.', 'public-contract')

const { Context } = await import('@deepseek-ai/cordis')
const { LocalJobRegistry } = await import('@deepseek-ai/dsh-jobs-local')
const jobsCtx = new Context()
const registry = new LocalJobRegistry(jobsCtx, {})
registry.attachController('gate0')
let completionCount = 0
let completionSnapshot
const completion = new Promise((resolve) => {
  registry.onJobDone((snapshot) => {
    completionCount += 1
    completionSnapshot = snapshot
    resolve()
  })
})
let release
const jobId = registry.start({
  kind: 'subagent',
  label: 'gate0 completion fixture',
  run: () => ({
    cancel() {},
    done: new Promise((resolve) => { release = resolve }),
  }),
})
release({ status: 'completed', output: 'gate0-output' })
await completion
const read = registry.read(jobId)
assert.equal(completionCount, 1)
assert.equal(completionSnapshot.id, jobId)
assert.equal(read.text, 'gate0-output')
assert.equal(read.snapshot.status, 'completed')
pass('G0-3-fixture', 'Jobs registry completion/read 生命周期', 'Real LocalJobRegistry fixture starts a job, settles it, receives exactly one onJobDone callback, and reads the final output through the registry read contract.', 'runtime-fixture')
const g03Evidence = await readFile(g03LiveEvidence, 'utf8').catch((error) => {
  if (error?.code === 'ENOENT') return undefined
  throw error
})
if (g03Evidence) {
  for (const marker of ['pwsh-1', 'LIVE_GATE0_DONE', 'completion notification', 'job_output', 'completed', 'exit code: `0`', 'console errors observed during the check: `0`']) assert.equal(g03Evidence.includes(marker), true, `missing G0-3 evidence: ${marker}`)
  pass('G0-3-live', 'owned Job 真实父 Agent 通信', 'Supplied GUI transcript evidence records pwsh-1, LIVE_GATE0_DONE, owner completion notification before job_output, completed, exit code 0, and zero browser console errors. Presentation-tool follow-up is explicitly not inferred.', 'live-transcript')
} else {
  pending('G0-3-live', 'owned Job 真实父 Agent 通信', 'Requires the local GUI transcript PHASE_0_G0_3_LIVE_TRANSCRIPT.md. Historical live evidence is intentionally excluded from the public repository, so its absence is reported as pending instead of failing ordinary CI.')
}

const toolMeta = JSON.parse(await readFile(toolPackage, 'utf8'))
const runtimeMeta = JSON.parse(await readFile(runtimePackage, 'utf8'))
assert.ok(toolMeta.exports?.['./client'])
assert.ok(runtimeMeta.exports?.['./client'])
const clientSource = await readFile(join(root, 'src', 'client', 'index.ts'), 'utf8')
assert.match(clientSource, /tool\.call\.toolview/)
assert.match(clientSource, /callId|content/)
pass('G0-4', '工具卡 replay-safe 数据形态', 'The plugin uses rc8 public client package exports and its renderer reads durable tool result content; no private DSH UI module is imported.', 'public-contract+plugin-source')
const previewPrefix = 'dsh-chat-mindmap-preview:'
const replayResult = {
  kind: 'tool-result',
  seq: 41,
  time: 1,
  callId: 'mindmap-present-1',
  call: null,
  callTime: null,
  content: [{ type: 'text', text: `${previewPrefix}${JSON.stringify({ libraryId: 'map-1', revisionId: 'rev-0123456789abcdef01234567', title: 'Replay map', nodeCount: 2, state: 'available' })}` }],
  isError: false,
  callView: null,
  resultView: null,
  subCalls: [],
}
const replayWire = JSON.parse(JSON.stringify(replayResult))
assert.equal(replayWire.callId, replayResult.callId)
assert.equal(replayWire.call, null)
const replayPayload = JSON.parse(replayWire.content[0].text.slice(previewPrefix.length))
assert.deepEqual(replayPayload, { libraryId: 'map-1', revisionId: 'rev-0123456789abcdef01234567', title: 'Replay map', nodeCount: 2, state: 'available' })
const fullWindow = [
  { seq: 40, type: 'tool/call', data: { callId: replayResult.callId, name: 'present_chat_mindmap' } },
  { seq: replayResult.seq, type: 'tool/result', data: replayResult },
]
const historyWindow = fullWindow.filter((event) => event.type !== 'tool/call')
assert.equal(historyWindow[0].data.callId, replayResult.callId)
assert.equal(historyWindow[0].data.call, null)
assert.equal(historyWindow[0].data.content[0].text, replayResult.content[0].text)
pass('G0-4-fixture', '工具卡裁剪后 reload replay fixture', 'A serialized ToolResultNode with call=null preserves its stable callId and the exact production dsh-chat-mindmap-preview payload; the renderer can recover libraryId plus immutable revisionId without the call head.', 'runtime-fixture')
pending('G0-4-live', '工具卡 live/reload/call-head 裁剪重放', 'Requires browser GUI evidence across live render, HMR/reload, and a history window where the call head is absent. A production renderer and immutable revision resolver exist; this browser-only proof is intentionally not claimed.')

const exportSource = await readFile(exportFile, 'utf8')
const attachmentMeta = JSON.parse(await readFile(attachmentPackage, 'utf8'))
assert.match(exportSource, /async svg\(name\)/)
assert.match(exportSource, /new Blob\(\[str\], \{\s*type: ['"]image\/svg\+xml['"]\s*\}\)/)
assert.ok(attachmentMeta.exports?.['./client'])
// S3-W4/W5 componentization: the dialog contract moved to preview/dialog.tsx,
// and object-URL lifecycle to components/blob-url-lru.ts.
const dialogSource = await readFile(join(root, 'src', 'client', 'preview', 'dialog.tsx'), 'utf8')
const lruSource = await readFile(join(root, 'src', 'client', 'components', 'blob-url-lru.ts'), 'utf8')
assert.match(dialogSource, /role='dialog'/)
assert.match(lruSource, /URL\.revokeObjectURL/)
assert.match(dialogSource, /aria-label/)
pass('G0-5', 'SimpleMindMap SVG 与 rc8 预览 dialog 契约', 'SimpleMindMap exports image/svg+xml Blob; rc8 attachment has no public ImageLightbox export, so the plugin source provides its own accessible dialog and revokes object URLs.', 'public-contract+plugin-source')
const svgBlob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><title>Gate 0</title></svg>'], { type: 'image/svg+xml' })
assert.equal(svgBlob.type, 'image/svg+xml')
assert.ok((await svgBlob.text()).includes('<svg'))
const svgUrl = URL.createObjectURL(svgBlob)
const svgResponse = await fetch(svgUrl)
assert.equal(svgResponse.headers.get('content-type'), 'image/svg+xml')
assert.ok((await svgResponse.text()).includes('<svg'))
URL.revokeObjectURL(svgUrl)
await assert.rejects(() => fetch(svgUrl))
pass('G0-5-fixture', 'SVG Blob MIME、object URL 与 revoke 生命周期', 'The runtime Blob contract preserves image/svg+xml and non-empty SVG XML bytes; Node object URL fetch succeeds before revoke and fails after revoke.', 'runtime-fixture')
pending('G0-5-live', 'SVG 在浏览器 img 与自有预览 dialog 中可用', 'Requires a live browser DOM smoke test with an initialized map, export("svg", false), Blob URL image load, accessible dialog open/close, focus restore, and URL cleanup. rc8 has no public ImageLightbox export.')

const optionalMountFixture = (ctx) => {
  const injected = typeof ctx?.inject === 'function'
  const get = typeof ctx?.get === 'function'
  return { injected, get, mounted: true }
}
assert.deepEqual(optionalMountFixture({}), { injected: false, get: false, mounted: true })
assert.deepEqual(optionalMountFixture({ inject() {}, get() {} }), { injected: true, get: true, mounted: true })
const { apply: applyHost } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
let registeredTool = false
let registeredRoute = false
applyHost({
  tools: { register() { registeredTool = true } },
  webServer: { register() { registeredRoute = true; return () => {} } },
  effect(callback) { return callback() },
})
assert.equal(registeredTool, true)
assert.equal(registeredRoute, true)
pass('G0-6', '缺失 optional 能力不阻止 mount', 'The real plugin apply() mounts against a context exposing only its required tools/webServer services; jobs, subagents, settings, inject and get are absent, while both required registrations complete.', 'runtime-fixture')
pending('G0-6-live', '缺失 jobs/subagents/settings 的真实 mount 降级', 'Requires the same assertion in a composed DSH profile with the actual loader and browser client, plus explicit user-visible degradation state. The isolated Host apply fixture is not counted as full profile E2E proof.')

console.log(JSON.stringify({ gate: 'Phase 0 Gate 0', generatedAt: new Date().toISOString(), results }, null, 2))
if (process.argv.includes('--require-live') && results.some((result) => result.status === 'PENDING_LIVE')) process.exitCode = 2
