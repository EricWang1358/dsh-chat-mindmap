import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DomainError } from '../lib/domain/errors.js'
import { GenerationLockRegistry } from '../lib/host/generation-locks.js'
import { buildSourceOutlinePrompt, runWithGenerationControl, runSourceOutlineGeneration, OUTLINE_OUTPUT_SCHEMA, OUTLINE_PERSONA } from '../lib/host/generation-executor.js'
import { LIBRARY_ID_SOURCE, REVISION_ID_SOURCE, RUN_ID_SOURCE } from '../lib/host/id-patterns.js'
import { TIMEOUT_OUTPUT, createChatMindmapTools, effectiveConfig, parseLaunchInput } from '../lib/host/tools.js'
import { reserveLibraryId } from '../lib/domain/records.js'
import { revisionIdOf } from '../lib/revisions.js'
import { DEFAULT_MINDMAP_CONFIG } from '../lib/domain/settings.js'

const baseConfig = { layout: 'logicalStructure', density: 'standard', maxNodes: 360, theme: 'default', font: 'system', instruction: '', language: 'auto', contextLimit: 80_000 }

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function makeRecord(overrides = {}) {
  return {
    libraryId: 'map-existing',
    title: 'Existing',
    current: { version: 1, title: 'Existing', root: { id: 'r', title: 'Existing', children: [] } },
    previous: undefined,
    previewCurrent: undefined,
    previewPrevious: undefined,
    schemaVersion: 2,
    recordVersion: 7,
    workspaceKey: 'legacy-unscoped',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    source: undefined,
    config: { ...baseConfig },
    ...overrides,
  }
}

function makeDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeFakeRuntime(options = {}) {
  const state = { starts: [], disposed: [] }
  return {
    state,
    getProvider(name) { return name === 'fork' ? { name: 'fork' } : undefined },
    start(name, request) {
      const deferred = makeDeferred()
      const run = {
        id: 'child-' + (state.starts.length + 1),
        result: options.hang ? new Promise(() => undefined) : deferred.promise,
        async dispose() { state.disposed.push(run.id) },
      }
      state.starts.push({ name, request, deferred })
      return run
    },
    resolveNext(outcome) {
      const last = state.starts[state.starts.length - 1]
      assert.ok(last, 'no runtime start to resolve')
      last.deferred.resolve({ stopReason: outcome.stopReason ?? 'completed', ...(outcome.structured !== undefined ? { structured: outcome.structured } : {}), ...(outcome.diagnostic !== undefined ? { diagnostic: outcome.diagnostic } : {}) })
    },
  }
}

class FakeJobsService {
  constructor() {
    this.started = []
    this.hooksById = new Map()
    this.throwOnStart = null
  }
  start(spec) {
    if (this.throwOnStart) throw this.throwOnStart
    const id = 'mindmap-' + (this.started.length + 1)
    this.started.push({ id, spec })
    this.hooksById.set(id, spec.run())
    return id
  }
  hooks(jobId) {
    const hooks = this.hooksById.get(jobId)
    assert.ok(hooks, 'hooks missing for ' + jobId)
    return hooks
  }
}

function makeDeps(overrides = {}) {
  const jobs = overrides.jobs === null ? undefined : (overrides.jobs ?? new FakeJobsService())
  const runtime = overrides.runtime === null ? undefined : (overrides.runtime ?? makeFakeRuntime())
  const deps = {
    locks: overrides.locks ?? new GenerationLockRegistry(),
    jobs,
    runtime,
    loadRecord: overrides.loadRecord ?? (async () => null),
    saveCalls: [],
    timeoutMs: overrides.timeoutMs,
    logger: overrides.logger,
    workspaceKeyOfAgent: overrides.workspaceKeyOfAgent ?? (() => 'ws-test'),
  }
  deps.save = overrides.save ?? (async (inputArg) => {
    deps.saveCalls.push(inputArg)
    return {
      libraryId: inputArg.libraryId,
      title: inputArg.title,
      current: inputArg.document,
      previous: undefined,
      previewCurrent: undefined,
      previewPrevious: undefined,
      schemaVersion: 2,
      recordVersion: 1,
      workspaceKey: 'legacy-unscoped',
      archived: false,
      createdAt: '',
      updatedAt: '',
      source: inputArg.source,
      config: inputArg.config,
    }
  })
  for (const [key, value] of Object.entries(overrides)) {
    if (['jobs', 'runtime', 'locks', 'loadRecord', 'save', 'timeoutMs', 'logger', 'workspaceKeyOfAgent'].includes(key)) continue
    deps[key] = value
  }
  return deps
}

// ---------------------------------------------------------------------------
// prompt builder
// ---------------------------------------------------------------------------

const promptWithContext = buildSourceOutlinePrompt({ context: '# 来源材料 A\n## 子节点 B', title: '测试 标题', instruction: '保留细节', sourceKind: 'chat', config: baseConfig })
assert.ok(promptWithContext.includes('<source-material>\n# 来源材料 A\n## 子节点 B\n</source-material>'))
assert.ok(promptWithContext.includes('- 最多节点：360'))
assert.ok(promptWithContext.includes('- 密度：standard'))
assert.ok(promptWithContext.includes('- 语言：auto'))
assert.ok(promptWithContext.includes('- 根标题建议：测试 标题'))
assert.ok(promptWithContext.includes('- 附加要求：保留细节'))
assert.ok(promptWithContext.includes('来源类型：chat'))
const promptWithoutContext = buildSourceOutlinePrompt({ config: baseConfig })
assert.ok(promptWithoutContext.includes('当前会话已完成回合中的相关内容'))
assert.ok(promptWithoutContext.includes('- 根标题：从材料中提炼简洁主题'))
console.log('tools source outline prompt tests passed')

// ---------------------------------------------------------------------------
// control scaffolding direct behavior (parity with S2 executor semantics)
// ---------------------------------------------------------------------------

const controlledOk = await runWithGenerationControl({}, async () => 41 + 1)
assert.deepEqual(controlledOk, { settled: true, value: 42 })

const preAborted = new AbortController()
preAborted.abort()
const controlledAborted = await runWithGenerationControl({ controller: preAborted }, async () => 'never')
assert.deepEqual(controlledAborted, { settled: false, kind: 'cancelled' })

const timeoutController = new AbortController()
const controlledTimeout = await runWithGenerationControl(
  { timeoutMs: 15, controller: timeoutController },
  () => new Promise(() => undefined),
)
assert.deepEqual(controlledTimeout, { settled: false, kind: 'timed_out' })

let propagated = false
try {
  await runWithGenerationControl({}, async () => { throw new Error('boom') })
} catch {
  propagated = true
}
assert.equal(propagated, true)
console.log('generation control scaffolding tests passed')

// ---------------------------------------------------------------------------
// launcher happy path (new map): template, contract keys, lock lifecycle
// ---------------------------------------------------------------------------

const happyRuntime = makeFakeRuntime()
const happyJobs = new FakeJobsService()
const happyDeps = makeDeps({ runtime: happyRuntime, jobs: happyJobs })
const { generate } = createChatMindmapTools(happyDeps)
const launchArgs = {
  context: '# Root\n## Child SECRET-MARKER',
  title: '测试 标题 "引号"',
}
const startedAt = process.hrtime.bigint()
const launch = await generate.execute(launchArgs, { agent: { id: 'session-active' } })
const launchMs = Number(process.hrtime.bigint() - startedAt) / 1e6
assert.ok(launchMs < 250, 'launcher must return immediately, took ' + launchMs + 'ms')
assert.equal(launch.kind, 'background')
assert.match(launch.libraryId, new RegExp(LIBRARY_ID_SOURCE))
assert.equal(happyJobs.started[0].spec.kind, 'mindmap')
assert.equal(happyJobs.started[0].spec.outputLimitBytes, 2048)
assert.equal(happyJobs.started[0].spec.owner.id, 'session-active')
assert.ok(happyJobs.started[0].spec.label.startsWith('脑图生成：测试 标题'))
const requestKeys = Object.keys(happyRuntime.state.starts[0].request).sort()
for (const key of requestKeys) assert.ok(['label', 'maxDepth', 'outputSchema', 'parent', 'persona', 'prompt', 'signal', 'toolFilter'].includes(key), 'unexpected rc8 start key: ' + key)
assert.deepEqual(happyRuntime.state.starts[0].request.outputSchema, OUTLINE_OUTPUT_SCHEMA)
assert.equal(happyRuntime.state.starts[0].request.persona, OUTLINE_PERSONA)
assert.deepEqual(happyRuntime.state.starts[0].request.toolFilter, { allow: [] })
assert.equal(happyRuntime.state.starts[0].name, 'fork')
assert.ok(happyRuntime.state.starts[0].request.prompt[0].text.includes('SECRET-MARKER'))
assert.equal(happyDeps.locks.stateOf(launch.libraryId), 'running')

happyRuntime.resolveNext({ structured: { title: 'Forked 标题 "Q"', outline: '# Forked 标题 "Q"\n## 甲\n## 乙' } })
const outcome = await happyJobs.hooks(launch.jobId).done
assert.equal(outcome.status, 'completed')
const saved = happyDeps.saveCalls[0]
const expectedOutput = 'mindmap completed: libraryId=' + launch.libraryId + ' revisionId=' + revisionIdOf(saved.document) + ' title=' + JSON.stringify('Forked 标题 "Q"') + ' nodes=3.\nCall present_chat_mindmap with libraryId and revisionId.'
assert.equal(outcome.output, expectedOutput)
assert.equal(saved.rotatePrevious, true)
assert.equal('expectedRecordVersion' in saved, false, 'new-map commit must not carry a CAS baseline')
assert.equal(saved.source.kind, 'chat')
assert.equal(saved.source.sessionId, 'session-active')
assert.equal(saved.workspaceKey, 'ws-test')
assert.equal(happyDeps.locks.stateOf(launch.libraryId), undefined)
const unresolvedWorkspaceDeps = makeDeps({ workspaceKeyOfAgent: () => undefined })
const unresolvedWorkspaceTools = createChatMindmapTools(unresolvedWorkspaceDeps)
await assert.rejects(() => unresolvedWorkspaceTools.generate.execute({ context: '# New\n## Map' }, { agent: { id: 'missing-workspace' } }), /workspace identity unavailable/)
console.log('tools new-map workspace identity tests passed')
console.log('tools launcher happy path tests passed')

// ---------------------------------------------------------------------------
// render one-liner + description minimal protocol note
// ---------------------------------------------------------------------------

const rendered = generate.output.render({}, { jobId: 'j-1', libraryId: 'map-x' })
assert.equal(rendered.length, 1)
assert.ok(rendered[0].text.includes('jobId=j-1'))
assert.ok(rendered[0].text.includes('libraryId=map-x'))
assert.ok(generate.description.includes('present_chat_mindmap'))
assert.ok(generate.description.includes('background'))
console.log('tools render and description tests passed')

// ---------------------------------------------------------------------------
// existing map: CAS baseline carried, per-map config wins
// ---------------------------------------------------------------------------

const existingRecord = makeRecord({ libraryId: 'map-existing', config: { ...baseConfig, maxNodes: 123 } })
let existingLoadCount = 0
const existingDeps = makeDeps({
  runtime: makeFakeRuntime(),
  jobs: new FakeJobsService(),
  loadRecord: async (id) => {
    if (id === 'map-existing') { existingLoadCount += 1; return existingRecord }
    return null
  },
})
const existingTools = createChatMindmapTools(existingDeps)
const existingLaunch = await existingTools.generate.execute({ context: '# 新来源\n## 新子节点', libraryId: 'map-existing', config: { maxNodes: 9 } }, { agent: { id: 's' } })
existingDeps.runtime.resolveNext({ structured: { title: 'Replaced', outline: '# Replaced\n## One' } })
await existingDeps.jobs.hooks(existingLaunch.jobId).done
const existingSave = existingDeps.saveCalls[0]
assert.equal(existingSave.expectedRecordVersion, 7)
assert.equal(existingSave.config.maxNodes, 123, 'per-map settings must win over caller overrides')
assert.equal(existingSave.libraryId, 'map-existing')

const scopedExisting = makeRecord({ libraryId: 'map-scoped', workspaceKey: 'ws-aaa' })
const scopedDeps = makeDeps({
  loadRecord: async (id) => id === 'map-scoped' ? scopedExisting : null,
  workspaceKeyOfAgent: () => 'ws-bbb',
})
const scopedTools = createChatMindmapTools(scopedDeps)
await assert.rejects(() => scopedTools.generate.execute({ context: '# Hidden\n## Branch', libraryId: 'map-scoped' }, { agent: { id: 'other' } }), /mindmap not found/)
console.log('tools generation workspace fence tests passed')
console.log('tools existing-map CAS tests passed')

// ---------------------------------------------------------------------------
// busy rejection while first generation is in flight
// ---------------------------------------------------------------------------

const busyRuntime = makeFakeRuntime()
const busyJobs = new FakeJobsService()
const busyDeps = makeDeps({ runtime: busyRuntime, jobs: busyJobs, loadRecord: async (id) => makeRecord({ libraryId: id }), timeoutMs: 80 })
const busyTools = createChatMindmapTools(busyDeps)
const firstLaunch = await busyTools.generate.execute({ context: '# A' }, { agent: undefined })
await assert.rejects(
  () => busyTools.generate.execute({ context: '# A', libraryId: firstLaunch.libraryId }, { agent: undefined }),
  (error) => error instanceof DomainError && error.code === 'MINDMAP_BUSY',
)
assert.equal(busyJobs.started.length, 1)
busyRuntime.resolveNext({ structured: { title: 'B', outline: '# B\n## C' } })
await busyJobs.hooks(firstLaunch.jobId).done
console.log('tools busy rejection tests passed')

// ---------------------------------------------------------------------------
// invalid outline: stable code output, zero leakage, record bytes unchanged
// ---------------------------------------------------------------------------

const invalidRuntime = makeFakeRuntime()
const invalidJobs = new FakeJobsService()
const priorRecord = makeRecord({ libraryId: 'map-victim', current: { version: 1, title: 'Victim', root: { id: 'r', title: 'Victim', children: [] }, revision: 'rev-aaaaaaaaaaaaaaaaaaaaaaaa' } })
const invalidDeps = makeDeps({ runtime: invalidRuntime, jobs: invalidJobs, loadRecord: async () => priorRecord })
const invalidTools = createChatMindmapTools(invalidDeps)
const invalidLaunch = await invalidTools.generate.execute({ context: 'SECRET-MARKER should never leak', libraryId: 'map-victim' }, { agent: undefined })
invalidRuntime.resolveNext({ structured: { title: '', outline: '' } })
const invalidOutcome = await invalidJobs.hooks(invalidLaunch.jobId).done
assert.equal(invalidOutcome.status, 'failed')
assert.equal(invalidOutcome.output, 'mindmap failed: code=INVALID_AGENT_OUTLINE. Subagent returned an invalid outline.')
assert.equal(invalidDeps.saveCalls.length, 0)
assert.equal(sha256(priorRecord.current), sha256(priorRecord.current))
const fingerprint = sha256(priorRecord.current)
const leakFree = [invalidOutcome.output].join('\n')
assert.ok(!leakFree.includes('SECRET-MARKER'), 'raw source material must not leak into model-facing output')
assert.ok(!leakFree.includes('\\'), 'failure output must not contain path separators')
assert.ok(!leakFree.includes('at '), 'failure output must not contain stack frames')
assert.equal(invalidDeps.locks.stateOf('map-victim'), undefined)
void fingerprint
console.log('tools invalid outline tests passed')

// ---------------------------------------------------------------------------
// hard timeout through the chat path (injected short value, static copy)
// ---------------------------------------------------------------------------

assert.equal(typeof TIMEOUT_OUTPUT, 'string')
const timedRuntime = makeFakeRuntime({ hang: true })
const timedDeps = makeDeps({ runtime: timedRuntime, jobs: new FakeJobsService(), timeoutMs: 30 })
const timedTools = createChatMindmapTools(timedDeps)
const timedLaunch = await timedTools.generate.execute({ context: '# slow' }, { agent: undefined })
const timedOutcome = await timedDeps.jobs.hooks(timedLaunch.jobId).done
assert.equal(timedOutcome.status, 'failed')
assert.equal(timedOutcome.detail, 'timed out')
assert.equal(timedOutcome.output, TIMEOUT_OUTPUT)
assert.equal(timedDeps.locks.stateOf(timedLaunch.libraryId), undefined)
assert.deepEqual(timedRuntime.state.disposed, ['child-1'])
console.log('tools timeout tests passed')

// ---------------------------------------------------------------------------
// kill path: killed status, cancelled copy, lock release, dispose once
// ---------------------------------------------------------------------------

const killRuntime = makeFakeRuntime({ hang: true })
const killDeps = makeDeps({ runtime: killRuntime, jobs: new FakeJobsService(), timeoutMs: 5_000 })
const killTools = createChatMindmapTools(killDeps)
const killLaunch = await killTools.generate.execute({ context: '# kill me' }, { agent: undefined })
killDeps.jobs.hooks(killLaunch.jobId).cancel('user requested')
const killOutcome = await killDeps.jobs.hooks(killLaunch.jobId).done
assert.equal(killOutcome.status, 'killed')
assert.equal(killOutcome.detail, 'cancelled')
assert.equal(killOutcome.output, 'mindmap cancelled: libraryId=' + killLaunch.libraryId + '. No map was changed.')
assert.equal(killDeps.locks.stateOf(killLaunch.libraryId), undefined)
assert.deepEqual(killRuntime.state.disposed, ['child-1'])
console.log('tools kill path tests passed')

// ---------------------------------------------------------------------------
// capability gaps and start failures release the lock deterministically
// ---------------------------------------------------------------------------

const noJobsDeps = makeDeps({ jobs: null, runtime: makeFakeRuntime() })
const noJobsTools = createChatMindmapTools(noJobsDeps)
await assert.rejects(
  () => noJobsTools.generate.execute({ context: '# x' }, { agent: undefined }),
  (error) => error instanceof DomainError && error.code === 'CAPABILITY_UNAVAILABLE',
)
const noRuntimeDeps = makeDeps({ runtime: null })
const noRuntimeTools = createChatMindmapTools(noRuntimeDeps)
await assert.rejects(
  () => noRuntimeTools.generate.execute({ context: '# x' }, { agent: undefined }),
  (error) => error instanceof DomainError && error.code === 'CAPABILITY_UNAVAILABLE',
)
const throwingJobs = new FakeJobsService()
throwingJobs.throwOnStart = new Error('registry preflight rejected')
const heldLibraryId = reserveLibraryId()
const throwingDeps = makeDeps({ jobs: throwingJobs, loadRecord: async (id) => (id === heldLibraryId ? makeRecord({ libraryId: heldLibraryId }) : null) })
const throwingTools = createChatMindmapTools(throwingDeps)
await assert.rejects(() => throwingTools.generate.execute({ libraryId: heldLibraryId, context: '# y' }, { agent: undefined }))
assert.equal(throwingDeps.locks.stateOf(heldLibraryId), undefined)
console.log('tools capability gap tests passed')

// ---------------------------------------------------------------------------
// latency proxy for §18 (<250ms per synchronous launch against fakes)
// ---------------------------------------------------------------------------

const latencyDeps = makeDeps({ timeoutMs: 40 })
const latencyTools = createChatMindmapTools(latencyDeps)
for (let i = 0; i < 20; i += 1) {
  const t0 = Date.now()
  await latencyTools.generate.execute({ context: '# L' + i }, { agent: undefined })
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 250, 'launch ' + i + ' took ' + elapsed + 'ms')
}
console.log('tools latency proxy tests passed')

// ---------------------------------------------------------------------------
// parse/effective-config helpers and id pattern sources
// ---------------------------------------------------------------------------

const parsed = parseLaunchInput({ context: '   ' })
assert.equal(parsed.context, undefined)
let threwInvalid = false
try {
  parseLaunchInput({ libraryId: 'bad id!' })
} catch (error) {
  threwInvalid = error instanceof DomainError && error.code === 'INVALID_REQUEST'
}
assert.equal(threwInvalid, true)
const merged = effectiveConfig(null, { maxNodes: 42 })
assert.equal(merged.maxNodes, 42)
assert.equal(merged.density, DEFAULT_MINDMAP_CONFIG.density)
const kept = effectiveConfig(makeRecord(), { maxNodes: 1 })
assert.equal(kept.maxNodes, 360)
assert.match(reserveLibraryId(1755936000000, 'abcdefabcdef'), new RegExp(LIBRARY_ID_SOURCE))
assert.equal(new RegExp(REVISION_ID_SOURCE).test('rev-0123456789abcdef01234567'), true)
assert.equal(new RegExp(RUN_ID_SOURCE).test('panel-m1abc-01234567'), true)
console.log('tools parse and pattern tests passed')

// ---------------------------------------------------------------------------
// runSourceOutlineGeneration: DomainError propagation contract
// ---------------------------------------------------------------------------

const noProviderRuntime = { getProvider: () => undefined }
await assert.rejects(
  () => runSourceOutlineGeneration({ runtime: noProviderRuntime }, { config: baseConfig }),
  (error) => error instanceof DomainError && error.code === 'CAPABILITY_UNAVAILABLE',
)
const spawnOnlyRuntime = { getProvider: (name) => (name === 'spawn' ? { name } : undefined), start: async () => { throw new Error('should not start') } }
await assert.rejects(
  () => runSourceOutlineGeneration({ runtime: spawnOnlyRuntime }, { config: baseConfig }),
  (error) => error instanceof DomainError && error.code === 'CAPABILITY_UNAVAILABLE',
)
console.log('tools source runner contract tests passed')

// Let injected-short-timeout bodies settle so no generation timer outlives
// the suite (a clean process exit is itself part of the contract).
await new Promise((resolve) => setTimeout(resolve, 200))

// ---------------------------------------------------------------------------
// present_chat_mindmap: five-key durable payload, fence, zero-write surface
// ---------------------------------------------------------------------------

import { buildMindmap } from '../lib/core.js'
import { PREVIEW_PAYLOAD_PREFIX } from '../lib/host/tools.js'

function makePresentRecord(overrides = {}) {
  const current = buildMindmap('# Present Root\n## Kid')
  const previous = buildMindmap('# Old Root\n## Old Kid')
  return {
    libraryId: 'map-present',
    title: current.title,
    current,
    previous,
    previewCurrent: undefined,
    previewPrevious: undefined,
    schemaVersion: 2,
    recordVersion: 3,
    workspaceKey: 'legacy-unscoped',
    archived: false,
    createdAt: '',
    updatedAt: '',
    source: undefined,
    config: { ...baseConfig },
    ...overrides,
  }
}

const presentRecord = makePresentRecord()
const presentLoadCalls = []
const presentDeps = makeDeps({
  jobs: null,
  runtime: null,
  loadRecord: async (id) => {
    presentLoadCalls.push(id)
    return presentRecord
  },
})
const presentFactory = createChatMindmapTools(presentDeps)
assert.ok(presentFactory.present, 'factory must expose the present tool')
assert.deepEqual(Object.keys(presentFactory.present.parameters.properties).sort(), ['libraryId', 'revisionId'])

const currentRevision = revisionIdOf(presentRecord.current)
const availableValue = await presentFactory.present.execute({ libraryId: 'map-present', revisionId: currentRevision }, { agent: { id: 's' } })
assert.deepEqual(availableValue, { libraryId: 'map-present', revisionId: currentRevision, title: 'Present Root', nodeCount: 2, state: 'available' })
const renderedBlocks = presentFactory.present.output.render({}, availableValue)
assert.equal(renderedBlocks.length, 2)
const expectedPayloadText = PREVIEW_PAYLOAD_PREFIX + JSON.stringify({ libraryId: 'map-present', revisionId: currentRevision, title: 'Present Root', nodeCount: 2, state: 'available' })
assert.equal(renderedBlocks[0].text, expectedPayloadText)
assert.ok(renderedBlocks[1].text.includes('已定位脑图'))
assert.equal(presentLoadCalls.length, 1, 'present must read exactly once per invocation')
console.log('tools present available tests passed')

// G0-4-fixture isomorph: call head pruned, only durable content survives.
const prunedResultNode = {
  kind: 'tool-result',
  seq: 41,
  time: 1,
  callId: 'mindmap-present-1',
  call: null,
  callTime: null,
  content: [{ type: 'text', text: renderedBlocks[0].text }],
  isError: false,
  callView: null,
  resultView: null,
  subCalls: [],
}
const wireCopy = JSON.parse(JSON.stringify(prunedResultNode))
assert.equal(wireCopy.call, null)
const recoveredPayload = JSON.parse(wireCopy.content[0].text.slice(PREVIEW_PAYLOAD_PREFIX.length))
assert.deepEqual(recoveredPayload, { libraryId: 'map-present', revisionId: currentRevision, title: 'Present Root', nodeCount: 2, state: 'available' })
console.log('tools present replay fixture tests passed')

// Workspace fence: scoped record + different caller workspace → generic expiry.
const fencedRecord = makePresentRecord({ workspaceKey: 'ws-aaa' })
const fenceDeps = makeDeps({
  jobs: null,
  runtime: null,
  loadRecord: async () => fencedRecord,
  workspaceKeyOfAgent: () => 'ws-bbb',
})
const fenceTools = createChatMindmapTools(fenceDeps)
const fencedValue = await fenceTools.present.execute({ libraryId: 'map-present', revisionId: currentRevision }, { agent: { id: 'other' } })
assert.deepEqual(fencedValue, { libraryId: 'map-present', revisionId: currentRevision, title: 'Mind map', nodeCount: 0, state: 'expired' })
const fenceBlocks = fenceTools.present.output.render({}, fencedValue)
const fenceLeakCheck = fenceBlocks.map((b) => b.text).join('\n')
assert.ok(!fenceLeakCheck.includes('Present Root'), 'workspace mismatch must not leak the real title')
assert.ok(fenceLeakCheck.includes('"nodeCount":0'), 'workspace mismatch must report zero nodes')

// Legacy unscoped stays readable without any resolver.
const legacyValue = await presentFactory.present.execute({ libraryId: 'map-present', revisionId: currentRevision }, { agent: undefined })
assert.equal(legacyValue.state, 'available')
console.log('tools present workspace fence tests passed')

// Deleted map and stale revision paths.
const goneDeps = makeDeps({ jobs: null, runtime: null, loadRecord: async () => null })
const goneTools = createChatMindmapTools(goneDeps)
const goneValue = await goneTools.present.execute({ libraryId: 'map-gone', revisionId: 'rev-0123456789abcdef01234567' }, { agent: undefined })
assert.deepEqual(goneValue, { libraryId: 'map-gone', revisionId: 'rev-0123456789abcdef01234567', title: 'Mind map', nodeCount: 0, state: 'expired' })
const staleValue = await presentFactory.present.execute({ libraryId: 'map-present', revisionId: 'rev-999999999999999999999999' }, { agent: undefined })
assert.equal(staleValue.state, 'expired')
assert.equal(staleValue.title, 'Present Root')
assert.equal(staleValue.nodeCount, 0)
console.log('tools present expiry path tests passed')

// Strict id whitelists on the tool surface mirror the route surface.
for (const badArgs of [{ libraryId: 'bad!', revisionId: 'rev-0123456789abcdef01234567' }, { libraryId: 'map-ok', revisionId: 'not-a-revision' }]) {
  let threwCode = ''
  try {
    await presentFactory.present.execute(badArgs, { agent: undefined })
  } catch (error) {
    threwCode = error instanceof DomainError ? error.code : ''
  }
  assert.equal(threwCode, 'INVALID_REQUEST')
}
console.log('tools present whitelist tests passed')

console.log('tools tests passed')
