import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DICTS, createT, resolveLocale } from '../lib/client/locale.js'
import { EmptyState, regenerateUnavailableWhileRunning } from '../lib/client/components/BrainmapView.js'
import { GenerationLockRegistry } from '../lib/host/generation-locks.js'
import { createChatMindmapTools, previewPayloadText } from '../lib/host/tools.js'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '')

// §14 dictionary integrity: zh/en key sets identical, zero missing both ways.
const zhKeys = Object.keys(DICTS.zh).sort()
const enKeys = Object.keys(DICTS.en).sort()
assert.deepEqual(zhKeys, enKeys)
assert.ok(zhKeys.length >= 10, 'dictionary must cover the chrome surface')
for (const key of zhKeys) {
  assert.ok(DICTS.zh[key].length > 0 && DICTS.en[key].length > 0, 'empty value: ' + key)
  assert.ok(!DICTS.zh[key].includes('${') && !DICTS.en[key].includes('${'), 'dict values are static copy: ' + key)
}
console.log('locale dictionary integrity passed')

// Unknown locale falls back to English; zh resolves Chinese.
const tEn = createT('fr')
assert.equal(tEn('common.cancel'), 'Cancel')
assert.equal(createT('zh-CN')('common.cancel'), '取消')
assert.equal(createT(undefined)('empty.session.title'), DICTS.en['empty.session.title'])

// Resolution chain: service -> navigator -> en.
assert.equal(resolveLocale('en-US', 'zh-CN'), 'en')
assert.equal(resolveLocale(undefined, 'zh-CN'), 'zh')
assert.equal(resolveLocale(undefined, undefined), 'en')
console.log('locale fallback passed')

// EmptyState honors the locale id (adopted surface proof).
const zhHtml = renderToStaticMarkup(createElement(EmptyState, { kind: 'session', localeId: 'zh' }))
const enHtml = renderToStaticMarkup(createElement(EmptyState, { kind: 'session', localeId: 'en' }))
assert.ok(zhHtml.includes('当前会话暂无脑图'))
assert.ok(enHtml.includes('No mind maps in this session yet'))

// §15 row 1+2: subagents/fork absent -> explicit CAPABILITY_UNAVAILABLE.
function makeDeps(opts = {}) {
  return { locks: new GenerationLockRegistry(), jobs: opts.jobs, runtime: opts.runtime, loadRecord: async () => null }
}
async function expectCapability(deps) {
  const tools = createChatMindmapTools(deps)
  await assert.rejects(() => tools.generate.execute({ context: 'x' }, { agent: { id: 's' } }), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
}
await expectCapability(makeDeps({}))
await expectCapability(makeDeps({ jobs: {}, runtime: { getProvider: () => undefined } }))
await expectCapability(makeDeps({ runtime: { getProvider: () => ({}) } }))
// §15 row 3: jobs/tool-jobs absent -> launcher reports capability gap.
await expectCapability({ locks: new GenerationLockRegistry(), runtime: { getProvider: () => ({}) } })
console.log('locale degradation rows 1-3 passed')

// §15 row 4: settings absent -> compiled defaults, no namespace (settings.test.mjs covers host; capability flag anchor here).
const idxSrc = await readFile(join(root, 'src/client/index.ts'), 'utf8')
assert.ok(idxSrc.includes("ctx.inject?.(['settingsScope']"), 'client card degrades when settingsScope is absent')

// §15 row 5: tool view slot absent -> chat still receives durable text payload.
const payload = previewPayloadText({ libraryId: 'm1', revisionId: 'rev-1', title: 'T', nodeCount: 2, state: 'available' })
assert.ok(payload.startsWith('dsh-chat-mindmap-preview:'))

// §15 row 6: no public ImageLightbox -> own accessible dialog only.
const dialogSrc = await readFile(join(root, 'src/client/preview/dialog.tsx'), 'utf8')
assert.ok(dialogSrc.includes("role='dialog'"), 'own accessible preview dialog present')
execSync('node -e "const fs=require(\'fs\');let bad=false;const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+\'/\'+e.name;if(e.isDirectory())walk(p);else if(/\\.(ts|tsx)$/.test(e.name)){const s=fs.readFileSync(p,\'utf8\');if(s.includes(\'ImageLightbox\')){bad=true;console.error(\'ImageLightbox ref: \' + p)}}}};walk(\'src\');process.exit(bad?1:0)"', { stdio: 'inherit' })
console.log('locale §15 degradation matrix passed')
