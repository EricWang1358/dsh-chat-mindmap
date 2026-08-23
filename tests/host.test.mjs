import assert from 'node:assert/strict'
import { DomainError } from '../lib/domain/errors.js'
import { buildRegenerationPrompt } from '../lib/host/generation-executor.js'
import { GenerationLockRegistry } from '../lib/host/generation-locks.js'
import { GENERATION_MAX_TOKENS, OUTLINE_OUTPUT_SCHEMA, OUTLINE_PERSONA, selectProvider, runOutlineGeneration } from '../lib/host/generation-executor.js'
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

const spawnRuntime = { getProvider: (name) => name === 'spawn' ? {} : undefined }
const spawnOutcome = await runOutlineGeneration({ runtime: spawnRuntime }, { record, supplementalContext: '当前回合补充正文' })
assert.equal(spawnOutcome.kind, 'completed')
assert.equal(spawnOutcome.provider, 'spawn')

const unavailableCode = await runOutlineGeneration({ runtime: { getProvider: () => undefined } }, { record }).then(() => 'no-error', (error) => error.code)
assert.equal(unavailableCode, 'CAPABILITY_UNAVAILABLE')

console.log('host executor pipeline tests passed')
