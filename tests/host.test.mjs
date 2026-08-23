import assert from 'node:assert/strict'
import { DomainError } from '../lib/domain/errors.js'
import { buildRegenerationPrompt } from '../lib/host/generation-executor.js'
import { GenerationLockRegistry } from '../lib/host/generation-locks.js'
import { GENERATION_MAX_TOKENS, GENERATION_TIMEOUT_MS, OUTLINE_OUTPUT_SCHEMA, OUTLINE_PERSONA, selectProvider, runOutlineGeneration } from '../lib/host/generation-executor.js'
import { buildMindmap } from '../lib/core.js'

const baseConfig = { layout: 'logicalStructure', density: 'standard', maxNodes: 360, theme: 'default', font: 'system', instruction: '', language: 'auto', contextLimit: 80_000 }

function makeRecord(overrides = {}) {
  return {
    libraryId: 'map-p3',
    title: 'T',
    current: buildMindmap('# T\n## C'),
    previous: undefined,
    previewCurrent: undefined,
    previewPrevious: undefined,
    schemaVersion: 2,
    recordVersion: 1,
    workspaceKey: 'legacy-unscoped',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    source: undefined,
    ...overrides,
  }
}

try {
  buildRegenerationPrompt(null)
  assert.fail('missing record must throw')
} catch (error) {
  assert.ok(error instanceof DomainError)
  assert.equal(error.code, 'MINDMAP_NOT_FOUND')
  assert.equal(error.message, 'mindmap not found')
}

const bare = makeRecord({ config: { ...baseConfig } })
const bareResult = buildRegenerationPrompt(bare)
assert.equal(bareResult.noteLength, 0)
assert.ok(!bareResult.text.includes('<panel-note>'))
assert.ok(!bareResult.text.includes('node-notes'))
assert.ok(bareResult.text.includes('当前标题：T'))
assert.ok(bareResult.text.includes('# T\n## C'))
assert.ok(bareResult.text.includes('最多节点：360'))
assert.ok(bareResult.text.endsWith('如果没有 panel-note，则保持原主题和层级信息，必要时改善结构。'))

const instructed = buildRegenerationPrompt(makeRecord({ config: { ...baseConfig } }), '  重点提取风险  ')
assert.equal(instructed.noteLength, '重点提取风险'.length)
assert.ok(instructed.text.includes('<panel-note>\n重点提取风险\n</panel-note>'))
assert.ok(instructed.text.indexOf('最多节点：360') < instructed.text.indexOf('<panel-note>'))

const fromConfig = buildRegenerationPrompt(makeRecord({ config: { ...baseConfig, instruction: '配置默认指令' } }), '   ')
assert.equal(fromConfig.noteLength, '配置默认指令'.length)
assert.ok(fromConfig.text.includes('配置默认指令'))

const notedDoc = buildMindmap('# T\n## C')
notedDoc.root.children[0].note = '子节点备注内容'
const noted = buildRegenerationPrompt(makeRecord({ current: notedDoc, config: { ...baseConfig } }))
const notesMatch = /<node-notes format="json">\n(\[[^\n]+\])\n<\/node-notes>/.exec(noted.text)
assert.ok(notesMatch)
const parsedNotes = JSON.parse(notesMatch[1])
assert.deepEqual(parsedNotes.map((entry) => ({ id: entry.id, path: entry.path, note: entry.note })), [
  { id: notedDoc.root.children[0].id, path: 'T > C', note: '子节点备注内容' },
])
assert.ok(!noted.text.includes('未附带'))

const tinyBudget = makeRecord({
  current: (() => { const doc = buildMindmap('# T\n## C'); doc.root.children[0].note = 'x'.repeat(6_000); return doc })(),
  config: { ...baseConfig, contextLimit: 1 },
})
const allOmitted = buildRegenerationPrompt(tinyBudget)
// Known latent gap F-1: the omission notice only renders when at least one
// note survived. Faithful extraction must reproduce this until the
// integration-phase switchover fixes it in the single canonical copy.
assert.ok(!allOmitted.text.includes('<node-notes'))
assert.ok(!allOmitted.text.includes('未附带'))

const mixedDoc = buildMindmap('# T\n## A\n## B')
mixedDoc.root.children[0].note = 'small note'
mixedDoc.root.children[1].note = 'x'.repeat(6_000)
const mixed = buildRegenerationPrompt(makeRecord({ current: mixedDoc, config: { ...baseConfig, contextLimit: 1 } }))
assert.ok(mixed.text.includes('small note'))
assert.ok(mixed.text.includes('未附带'))

console.log('host regeneration prompt tests passed')

const registry = new GenerationLockRegistry()
assert.equal(registry.tryAcquire('map-a', 'run-1')?.state, 'accepted')
assert.equal(registry.tryAcquire('map-a', 'run-2'), null)
assert.equal(registry.tryAcquire('map-b', 'run-2')?.state, 'accepted')

const events = []
registry.transition('map-a', 'running'); events.push('a-running')
registry.transition('map-b', 'running'); events.push('b-running')
assert.deepEqual(events, ['a-running', 'b-running'])

for (const terminal of ['completed', 'failed', 'timed_out', 'cancelled']) {
  const reg = new GenerationLockRegistry()
  reg.tryAcquire('map-x', 'r')
  reg.transition('map-x', 'running')
  reg.transition('map-x', terminal)
  assert.equal(reg.stateOf('map-x'), terminal)
  assert.throws(() => reg.transition('map-x', 'failed'), /invalid generation state transition/)
  assert.equal(reg.release('map-x'), true)
  assert.equal(reg.release('map-x'), false)
  assert.equal(reg.tryAcquire('map-x', 'r2')?.state, 'accepted')
}

const fresh = new GenerationLockRegistry()
fresh.tryAcquire('m', 'r')
assert.throws(() => fresh.transition('m', 'completed'), /invalid generation state transition/)
assert.throws(() => fresh.transition('unknown', 'running'), /invalid generation state transition/)
assert.equal(fresh.release('unknown'), false)
try {
  fresh.transition('m', 'running')
} catch (error) {
  assert.equal(error.code, 'INVALID_REQUEST')
}

console.log('host locks tests passed')

assert.equal(GENERATION_MAX_TOKENS, 6000)
assert.equal(OUTLINE_OUTPUT_SCHEMA.type, 'object')
assert.deepEqual(OUTLINE_OUTPUT_SCHEMA.required, ['title', 'outline'])
assert.ok(OUTLINE_PERSONA.includes('严格 Markdown 层级大纲'))

const runtimeOf = (providers) => ({ getProvider: (name) => providers[name] })
const selectionTable = [
  [{ fork: {}, spawn: {} }, '', 'fork'],
  [{ fork: {}, spawn: {} }, 'ctx', 'fork'],
  [{ spawn: {} }, 'ctx', 'spawn'],
  [{ spawn: {} }, '', null],
  [{}, 'ctx', null],
]
for (const [providers, supp, want] of selectionTable) {
  assert.equal(selectProvider(runtimeOf(providers), supp), want, JSON.stringify(providers))
}
assert.equal(selectProvider(undefined, 'ctx'), null)

const RC8_START_KEYS = ['label', 'prompt', 'parent', 'signal', 'outputSchema', 'maxDepth', 'toolFilter', 'persona']
function scriptedRuntime(plan) {
  const requests = []
  return {
    requests,
    runtime: {
      getProvider: (name) => providersMap[name],
      async start(name, request) {
        requests.push({ name, request })
        return { id: plan.id ?? 'child-9', result: Promise.resolve(plan.result), dispose: plan.dispose }
      },
    },
  }
}
const providersMap = { fork: {}, spawn: {} }

const record = makeRecord({ config: { ...baseConfig } })
const happy = scriptedRuntime({ result: { stopReason: 'completed', structured: { title: 'Out', outline: '# Out\n## C' } }, id: 'child-9', dispose: async () => {} })
const happyOutcome = await runOutlineGeneration({ runtime: happy.runtime }, { record, label: '重新构建脑图：T' })
assert.equal(happyOutcome.kind, 'completed')
assert.equal(happyOutcome.document.title, 'Out')
assert.equal(happyOutcome.truncated, false)
assert.equal(happyOutcome.childId, 'child-9')
assert.equal(happyOutcome.provider, 'fork')

const sent = happy.requests[0]
assert.equal(sent.name, 'fork')
for (const key of Object.keys(sent.request)) assert.ok(RC8_START_KEYS.includes(key), 'unexpected key ' + key)
assert.deepEqual(sent.request.toolFilter, { allow: [] })
assert.equal(sent.request.maxDepth, 1)
assert.equal(sent.request.outputSchema, OUTLINE_OUTPUT_SCHEMA)
assert.equal(sent.request.persona, OUTLINE_PERSONA)
assert.ok(sent.request.signal instanceof AbortSignal)
assert.equal(sent.request.prompt.length, 1)
assert.equal(sent.request.prompt[0].type, 'text')
assert.ok(sent.request.prompt[0].text.includes('将下面已有脑图转换'))

const stopped = scriptedRuntime({ result: { stopReason: 'aborted', diagnostic: 'caller went away' }, dispose: async () => {} })
const stoppedOutcome = await runOutlineGeneration({ runtime: stopped.runtime }, { record })
assert.equal(stoppedOutcome.kind, 'failed')
assert.equal(stoppedOutcome.diagnostic, 'caller went away')

const invalid = scriptedRuntime({ result: { stopReason: 'completed', structured: { title: 'Only' } }, dispose: async () => {} })
const invalidOutcome = await runOutlineGeneration({ runtime: invalid.runtime }, { record })
assert.equal(invalidOutcome.kind, 'failed')
assert.match(invalidOutcome.diagnostic, /outline is empty/)
assert.ok(invalidOutcome.diagnostic.length <= 500)

const truncating = scriptedRuntime({ result: { stopReason: 'completed', structured: { title: 'Cap', outline: '# Cap\n## a\n## b\n## c\n## d' } }, dispose: async () => {} })
const truncatingOutcome = await runOutlineGeneration({ runtime: truncating.runtime }, { record: makeRecord({ config: { ...baseConfig, maxNodes: 3 } }) })
assert.equal(truncatingOutcome.kind, 'completed')
assert.equal(truncatingOutcome.truncated, true)

const spawnRuntime = {
  getProvider: (name) => name === 'spawn' ? {} : undefined,
  async start(name, request) {
    return { id: 'child-spawn', result: Promise.resolve({ stopReason: 'completed', structured: { title: 'S', outline: '# S\n## C' } }), dispose: async () => {} }
  },
}
const spawnOutcome = await runOutlineGeneration({ runtime: spawnRuntime }, { record, supplementalContext: '当前回合补充正文' })
assert.equal(spawnOutcome.kind, 'completed')
assert.equal(spawnOutcome.provider, 'spawn')

const unavailableCode = await runOutlineGeneration({ runtime: { getProvider: () => undefined } }, { record }).then(() => 'no-error', (error) => error.code)
assert.equal(unavailableCode, 'CAPABILITY_UNAVAILABLE')

console.log('host executor pipeline tests passed')

assert.equal(GENERATION_TIMEOUT_MS, 180_000)

function controllableRuntime(payload = { stopReason: 'completed', structured: { title: 'Slow', outline: '# Slow\n## C' } }) {
  const requests = []
  let releaseResult = () => {}
  let disposedCount = 0
  let resultPromise
  const runtime = {
    getProvider: () => ({}),
    async start(name, request) {
      requests.push({ name, request })
      if (!resultPromise) {
        resultPromise = new Promise((resolve, reject) => {
          releaseResult = () => resolve(payload)
          request.signal.addEventListener('abort', () => reject(new Error('aborted by signal')))
        })
      }
      return { id: 'child-slow', result: resultPromise, dispose: async () => { disposedCount += 1 } }
    },
  }
  return { requests, runtime, release: () => releaseResult(), get disposedCount() { return disposedCount } }
}

const slow = controllableRuntime()
const timedOutOutcome = await runOutlineGeneration({ runtime: slow.runtime }, { record }, { timeoutMs: 25 })
assert.equal(timedOutOutcome.kind, 'timed_out')
assert.equal(slow.disposedCount, 1)
slow.release()

const cancelledCtl = new AbortController()
const cancellable = controllableRuntime()
const cancelledPending = runOutlineGeneration({ runtime: cancellable.runtime }, { record }, { controller: cancelledCtl, timeoutMs: 5_000 })
assert.equal(cancellable.requests.length, 1)
cancelledCtl.abort()
const cancelledOutcome = await cancelledPending
assert.equal(cancelledOutcome.kind, 'cancelled')
assert.equal(cancellable.disposedCount, 1)

const errorPath = controllableRuntime({ stopReason: 'crashed' })
const errorPending = runOutlineGeneration({ runtime: errorPath.runtime }, { record })
errorPath.release()
const errorOutcome = await errorPending
assert.equal(errorOutcome.kind, 'failed')
assert.equal(errorPath.disposedCount, 1)

const happyPath = controllableRuntime()
const happyPending = runOutlineGeneration({ runtime: happyPath.runtime }, { record })
happyPath.release()
const happySlow = await happyPending
assert.equal(happySlow.kind, 'completed')
assert.equal(happyPath.disposedCount, 1)

console.log('host timeout cleanup tests passed')

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitGenerationOutcome } from '../lib/host/generation-executor.js'
import { reserveLibraryId } from '../lib/domain/records.js'
import { getMindmap, saveMindmap, updateMindmap } from '../lib/library.js'

assert.match(reserveLibraryId(1_800_000_000_000, 'abcdef123456'), /^map-[0-9a-z]+-[0-9a-f]{12}$/)
assert.equal(reserveLibraryId(0, '000000000000'), 'map-0-000000000000')
assert.notEqual(reserveLibraryId(), undefined)

process.env.DSH_MINDMAP_HOME = await mkdtemp(join(tmpdir(), 'dsh-chat-mindmap-s2w4-'))
try {
  const base = await saveMindmap({ title: 'W4', document: buildMindmap('# W4\n## A'), source: { kind: 'text' } })
  const recordPath = join(process.env.DSH_MINDMAP_HOME, 'maps', `${base.libraryId}.json`)
  const sha = async () => createHash('sha256').update(await readFile(recordPath, 'utf8')).digest('hex')

  await updateMindmap(base.libraryId, { title: 'Edited during generation' })
  const protectedState = await sha()

  let conflictError = null
  try {
    await commitGenerationOutcome({ libraryId: base.libraryId, document: buildMindmap('# Gen\n## Result'), title: 'Gen', config: base.config, source: base.source, baselineRecordVersion: base.recordVersion })
  } catch (error) {
    conflictError = error
  }
  assert.ok(conflictError)
  assert.equal(conflictError.code, 'MINDMAP_CONFLICT')
  assert.equal(conflictError.message, 'mindmap conflict')
  assert.equal(await sha(), protectedState)

  let invalidError = null
  try {
    await commitGenerationOutcome({ libraryId: base.libraryId, document: { version: 1 }, title: 'Broken', config: base.config })
  } catch (error) {
    invalidError = error
  }
  assert.ok(invalidError)
  assert.equal(await sha(), protectedState)

  let resolveSave
  const fakeSaved = { ...base, current: buildMindmap('# Ordered\n## Save-first'), recordVersion: 99 }
  const orderedPending = commitGenerationOutcome(
    { libraryId: base.libraryId, document: buildMindmap('# Ordered\n## Save-first'), title: 'Ordered', config: base.config },
    { save: () => new Promise((resolve) => { resolveSave = () => resolve(fakeSaved) }) },
  )
  let settled = false
  orderedPending.then(() => { settled = true }, () => {})
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(settled, false)
  resolveSave()
  const ordered = await orderedPending
  assert.equal(ordered.recordVersion, 99)
  await Promise.resolve()
  assert.equal(settled, true)

  const freshId = reserveLibraryId(Date.now())
  const created = await commitGenerationOutcome({ libraryId: freshId, document: buildMindmap('# Fresh\n## New'), title: 'Fresh', config: base.config })
  assert.equal(created.libraryId, freshId)
  assert.equal((await getMindmap(freshId)).current.root.children?.[0]?.title, 'New')
} finally {
  await rm(process.env.DSH_MINDMAP_HOME, { recursive: true, force: true })
}

console.log('host commit transaction tests passed')

import { INTERRUPTED_DETAIL, PanelRunRegistry } from '../lib/host/panel-runs.js'

assert.equal(INTERRUPTED_DETAIL, '生成已中断')

const panelRegistry = new PanelRunRegistry()
panelRegistry.register({ runId: 'run-1', libraryId: 'map-1', status: 'running', detail: 'started' })
assert.equal(panelRegistry.get('run-1')?.status, 'running')
panelRegistry.update('run-1', { status: 'completed', detail: 'done', revisionId: 'rev-x' })
assert.equal(panelRegistry.get('run-1')?.revisionId, 'rev-x')
assert.equal(panelRegistry.update('ghost', { status: 'failed', detail: 'x' }), null)

const missingView = panelRegistry.getViewOrInterrupted('missing-run')
assert.equal(missingView.status, 'failed')
assert.equal(missingView.detail, INTERRUPTED_DETAIL)
assert.ok(!Object.prototype.hasOwnProperty.call(missingView, 'revisionId'))

const builtModuleSource = await readFile(new URL('../lib/host/panel-runs.js', import.meta.url), 'utf8')
assert.ok(!/node:fs|require\(|readFile|writeFile/.test(builtModuleSource), 'panel-runs must have zero IO surface')

const disposal = new PanelRunRegistry()
const makeTracked = () => { let resolveIt; const promise = new Promise((resolve) => { resolveIt = resolve }); return [promise, () => resolveIt()] }
const [firstPromise, firstResolve] = makeTracked()
const [secondPromise, secondResolve] = makeTracked()
const firstController = new AbortController()
const secondController = new AbortController()
disposal.register({ runId: 'r1', libraryId: 'm1', status: 'running', detail: '' }, firstController)
disposal.register({ runId: 'r2', libraryId: 'm2', status: 'running', detail: '' }, secondController)
disposal.trackCompletion(firstPromise.then(() => 1))
disposal.trackCompletion(secondPromise.then(() => 2))

const disposedPromise = disposal.disposeAll()
assert.equal(firstController.signal.aborted, true)
assert.equal(secondController.signal.aborted, true)
secondResolve()
firstResolve()
await disposedPromise
// S3-W6 (R2-2): dispose drops the whole registry — lookups fall through to
// the interrupted fallback exactly like an unknown runId.
assert.equal(disposal.get('r1'), undefined)
assert.equal(disposal.getViewOrInterrupted('r1').detail, INTERRUPTED_DETAIL)

console.log('host panel registry tests passed')

import { createChatGenerationLauncher, createPanelGenerationAdapter, createParentSideEffectProbe } from '../lib/host/adapters.js'

const probe = createParentSideEffectProbe()
probe.parent.someMethod()
probe.parent.another(1, 2)
assert.ok(probe.emissionCount() >= 2)

process.env.DSH_MINDMAP_HOME = await mkdtemp(join(tmpdir(), 'dsh-chat-mindmap-s2w6-'))
try {
  const s2Locks = new GenerationLockRegistry()
  const s2Registry = new PanelRunRegistry()
  const adaptScripted = scriptedRuntime({ result: { stopReason: 'completed', structured: { title: 'Adapt', outline: '# Adapt\n## C' } } })
  const baseRecord = await saveMindmap({ title: 'AdaptBase', document: buildMindmap('# AdaptBase\n## Old'), source: { kind: 'text' } })

  const adapter = createPanelGenerationAdapter({
    locks: s2Locks,
    registry: s2Registry,
    runtime: adaptScripted.runtime,
    promptSourceOf: async (id) => await getMindmap(id),
    baselineVersionOf: async (id) => (await getMindmap(id))?.recordVersion,
  })

  const emissionsBeforeRun = probe.emissionCount()
  const okView = await adapter.start({ libraryId: baseRecord.libraryId, parent: probe.parent, label: '适配器重建' })
  assert.equal(okView.status, 'completed')
  assert.ok(okView.revisionId)
  assert.equal(adaptScripted.requests.length, 1)
  assert.equal(adaptScripted.requests[0].request.parent, probe.parent)
  assert.equal(probe.emissionCount(), emissionsBeforeRun)
  assert.equal(s2Locks.stateOf(baseRecord.libraryId), undefined)

  await s2Locks.tryAcquire(baseRecord.libraryId, 'external-holder')
  const busyError = await adapter.start({ libraryId: baseRecord.libraryId }).then(() => null, (e) => e)
  assert.equal(busyError.code, 'MINDMAP_BUSY')
  s2Locks.release(baseRecord.libraryId)

  const brokenRuntime = scriptedRuntime({ result: { stopReason: 'completed', structured: { title: 'Broken' } } })
  const failingAdapter = createPanelGenerationAdapter({
    locks: s2Locks, registry: s2Registry, runtime: brokenRuntime.runtime,
    promptSourceOf: async () => makeRecord({ config: { ...baseConfig } }),
    baselineVersionOf: async () => undefined,
  })
  const failedView = await failingAdapter.start({ libraryId: 'map-fresh-fail' })
  assert.equal(failedView.status, 'failed')
  assert.ok(failedView.detail.length > 0 && failedView.detail.length <= 500)
  assert.equal(s2Locks.stateOf('map-fresh-fail'), undefined)

  const missingAdapter = createPanelGenerationAdapter({
    locks: s2Locks, registry: s2Registry, runtime: adaptScripted.runtime,
    promptSourceOf: async () => null, baselineVersionOf: async () => undefined,
  })
  const missingView2 = await missingAdapter.start({ libraryId: 'map-gone' })
  assert.equal(missingView2.status, 'failed')

  const gate = scriptedRuntime({})
  let releaseGated
  const gatedRuntime = { getProvider: () => ({}), start: async (n, r) => { const out = await gate.runtime.start(n, r); void releaseGated; return out } }
  void gatedRuntime
  const longRunning = new PanelRunRegistry()
  const longLocks = new GenerationLockRegistry()
  let resolveSlowRun
  const slowAdapter = createPanelGenerationAdapter({
    locks: longLocks, registry: longRunning,
    runtime: { getProvider: () => ({}), start: async (name, request) => {
      request.signal.addEventListener('abort', () => resolveSlowRun(new Error('aborted')))
      return { id: 'child-slow', result: new Promise((resolve, reject) => { resolveSlowRun = reject }), dispose: async () => {} }
    } },
    promptSourceOf: async () => makeRecord({ config: { ...baseConfig } }),
    baselineVersionOf: async () => undefined,
  })
  const inflight = slowAdapter.start({ libraryId: 'map-inflight' })
  const disposedAll = longRunning.disposeAll()
  await inflight.then((v) => { assert.equal(v.status, 'cancelled'); return v }, (e) => { throw e })
  await disposedAll

  const chatWithoutJobs = createChatGenerationLauncher({ jobs: undefined, runtime: adaptScripted.runtime })
  assert.equal(chatWithoutJobs.capabilities.jobs, false)
  const unavailableOutcome = await chatWithoutJobs.launch({ libraryId: baseRecord.libraryId })
  assert.deepEqual(unavailableOutcome, { mode: 'unavailable', code: 'CAPABILITY_UNAVAILABLE' })

  let jobStarts = 0
  const chatWithJobs = createChatGenerationLauncher({ jobs: { start: async (input) => { jobStarts += 1; assert.equal(input.libraryId, baseRecord.libraryId); return { id: 'job-1' } } }, runtime: adaptScripted.runtime })
  assert.equal(chatWithJobs.capabilities.jobs, true)
  const backgroundOutcome = await chatWithJobs.launch({ libraryId: baseRecord.libraryId })
  assert.deepEqual(backgroundOutcome, { mode: 'background', jobId: 'job-1' })
  assert.equal(jobStarts, 1)
  assert.equal(adaptScripted.requests.length, 1, 'chat launcher must not run outline inline')
} finally {
  await rm(process.env.DSH_MINDMAP_HOME, { recursive: true, force: true })
}

console.log('host adapters tests passed')
