import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { listQueryOf, ApiError } from '../lib/client/api.js'
import { EmptyState, regenerateUnavailableWhileRunning } from '../lib/client/components/BrainmapView.js'
import { MindmapGuide } from '../lib/client/components/MindmapGuide.js'
import { OnboardingPreference } from '../lib/client/components/onboarding-preference.js'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '')
const srcOf = async (rel) => readFile(join(root, rel), 'utf8')

// listQueryOf: §13.1 session-first scoping table
assert.equal(listQueryOf('session', undefined), '/maps?scope=session')
assert.equal(listQueryOf('session', 's1'), '/maps?scope=session&sessionId=s1')
assert.equal(listQueryOf('workspace', 's1'), '/maps?scope=workspace&sessionId=s1')
assert.equal(listQueryOf('workspace', 's1', true), '/maps?scope=workspace&sessionId=s1&archived=true')
assert.equal(listQueryOf('workspace', undefined, false), '/maps?scope=workspace&archived=false')
console.log('client-ia scope query table passed')

const expectations = {
  session: '当前会话暂无脑图',
  workspace: '当前工作区暂无脑图',
  capability: '脑图能力不可用',
}
for (const [kind, headline] of Object.entries(expectations)) {
  const html = renderToStaticMarkup(createElement(EmptyState, { kind, localeId: 'zh' }))
  assert.ok(html.includes(headline), 'empty state ' + kind + ' must render its headline')
}
const capHtml = renderToStaticMarkup(createElement(EmptyState, { kind: 'capability' }))
assert.ok(!capHtml.includes('让 Agent 从文本'), 'capability branch must not suggest generation')
const sessionHtml = renderToStaticMarkup(createElement(EmptyState, { kind: 'session', localeId: 'zh', onCreate: () => undefined, onOpenGuide: () => undefined }))
assert.ok(sessionHtml.includes('查看使用指南'), 'session empty state must expose the guide after dismissal')
assert.ok(sessionHtml.includes('data-mm-onboarding-create'), 'session empty state must provide an actionable creation entry')
console.log('client-ia empty states passed')

const guideHtml = renderToStaticMarkup(createElement(MindmapGuide, { open: true, localeId: 'zh', hasMap: true, onDismiss: () => undefined, onCreate: () => undefined, onOpenInspector: () => undefined, onOpenMore: () => undefined }))
assert.ok(guideHtml.includes('role="dialog"'), 'guide is an accessible modal')
assert.ok(guideHtml.includes('从一段内容开始'), 'guide begins with a concrete creation step')
assert.ok(guideHtml.includes('data-mm-guide-primary'), 'guide offers an action for the current step')
console.log('client-ia guide modal passed')

let guideValue = { onboardingSeen: false }
const guideListeners = new Set()
const writes = []
const scope = {
  getSnapshot: () => ({ status: 'ready', value: guideValue, writable: true }),
  subscribe: (listener) => { guideListeners.add(listener); return () => guideListeners.delete(listener) },
  set: async (field, next) => { writes.push([field, next]); guideValue = { ...guideValue, [field]: next }; guideListeners.forEach((listener) => listener()) },
}
const onboarding = new OnboardingPreference()
onboarding.attach(scope)
assert.equal(onboarding.seen, false)
onboarding.markSeen()
assert.equal(onboarding.seen, true, 'guide dismissal is optimistic')
await Promise.resolve()
assert.deepEqual(writes, [['onboardingSeen', true]], 'guide dismissal persists through settings scope')
onboarding.replay()
assert.equal(onboarding.seen, false, 'guide replay clears the durable preference')
console.log('client-ia guide preference passed')

// regenerate availability predicate (§17.3: disabled while running)
assert.equal(regenerateUnavailableWhileRunning({ status: 'running' }), true)
assert.equal(regenerateUnavailableWhileRunning({ status: 'completed' }), false)
assert.equal(regenerateUnavailableWhileRunning(null), false)
assert.equal(regenerateUnavailableWhileRunning(undefined), false)
console.log('client-ia regenerate predicate passed')

const viewSrc = await srcOf('src/client/components/BrainmapView.tsx')
const idxSrc = await srcOf('src/client/index.ts')
const guideSrc = await srcOf('src/client/components/MindmapGuide.tsx')

// Legacy sync endpoint must be gone from the client surface.
assert.ok(!viewSrc.includes("'/generate'"), 'client must not call removed POST /generate')
assert.ok(!idxSrc.includes("'/generate'"), 'assembly must not reference POST /generate')
assert.ok(viewSrc.includes("'/maps?sessionId=' + encodeURIComponent(sessionId ?? '')"), 'local creation commits through canonical POST /maps')

// Exactly one primary regenerate trigger, gated by running/session predicates.
const primaryHits = viewSrc.split('data-primary-regenerate').length - 1
assert.equal(primaryHits, 1, 'exactly one primary regenerate control')
assert.ok(viewSrc.includes('disabled: panelRunning || !sessionAvailable'))

// Restore remains conditional even though actions now live in the right-side utility dock.
assert.ok(viewSrc.includes('...(record.previous ? [createElement(PopoverAction'))
assert.ok(viewSrc.includes("label: '恢复重新生成前版本'"))

// Mutations carry optimistic concurrency versions.
assert.ok(viewSrc.includes('expectedRecordVersion: current.recordVersion'), 'autosave PATCH carries recordVersion')
assert.ok(viewSrc.includes('expectedRecordVersion: record.recordVersion, ...(note'), 'regenerate carries recordVersion')

// Scope switch drives the canonical list query.
assert.ok(viewSrc.includes('listQueryOf(scope, sessionId, showArchived)'))
assert.ok(idxSrc.includes('tool.call.toolview'))
assert.ok(viewSrc.includes('createElement(MindmapGuide'), 'first-use guide should be composed into the real canvas surface')
assert.ok(guideSrc.includes("data-mm-guide-primary"), 'guide should expose a primary action')
assert.ok(viewSrc.includes('setShowCreate(true)'), 'first-use guide should connect to the supported local create flow')
assert.ok(viewSrc.includes("'指南'"), 'workspace chrome should offer guide replay')
assert.ok(idxSrc.includes('onboarding.attach(scope)'), 'guide preference should attach to official settings scope')
console.log('client-ia source anchors passed')

const err = new ApiError(409, 'MINDMAP_CONFLICT', 'conflict')
assert.equal(err.code, 'MINDMAP_CONFLICT')
assert.equal(err.status, 409)
console.log('client-ia tests passed')
