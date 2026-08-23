import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mountKeyOf, shouldApplyAutosave } from '../lib/client/components/BrainmapView.js'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '')
const viewSrc = await readFile(join(root, 'src/client/components/BrainmapView.tsx'), 'utf8')

// R16: mount key excludes layout/theme - appearance changes cannot rebuild the instance.
const baseRecord = { libraryId: 'm1', current: { source: { generatedAt: 'g1' } } }
assert.equal(mountKeyOf(baseRecord), mountKeyOf({ ...baseRecord, config: { layout: 'z', theme: 'w' } }))
assert.equal(mountKeyOf({ libraryId: 'm2', current: { source: { generatedAt: 'g1' } } }), 'm2:g1')
console.log('client-perf mount-key purity passed')

// §13.4 autosave fencing: only the newest un-aborted response may apply.
assert.equal(shouldApplyAutosave(1, 1, false), true)
assert.equal(shouldApplyAutosave(1, 2, false), false)
assert.equal(shouldApplyAutosave(1, 1, true), false)
assert.equal(shouldApplyAutosave(3, 3, false), true)
console.log('client-perf autosave fence passed')

// Source anchors: eager XMind export gone; export is user-triggered only.
assert.ok(!viewSrc.includes("void instance.doExport?.export('xmind'"))
assert.ok(viewSrc.includes('exportXmind: async () => {'))
assert.ok(viewSrc.includes('ONLY on explicit user action'))
assert.ok(!viewSrc.includes('onXmind'), 'xmind state plumbing fully removed')
assert.ok(viewSrc.includes('[renderKey]'), 'mount effect depends on renderKey only')
console.log('client-perf source anchors passed')

// Benchmark evidence: 360-node profile, pipeline under 1s each.
execSync('node scripts/benchmark.mjs', { stdio: 'inherit' })
const bench = JSON.parse(await readFile(join(root, 'docs/evidence/S4-perf-benchmark.json'), 'utf8'))
assert.equal(bench.nodes, 360)
for (const [k, v] of Object.entries(bench.timingsMs)) assert.ok(v < 1000, k + ' must stay under 1s')
assert.equal(bench.browserTimings.canvasInteractionMs, 'PENDING_LIVE')
assert.equal(bench.browserTimings.svgGenerationMs, 'PENDING_LIVE')
console.log('client-perf benchmark evidence passed')