import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../lib/domain/settings.js'
import { effectiveConfig } from '../lib/host/tools.js'
import { apply } from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-settings-'))
process.env.DSH_MINDMAP_HOME = root

// --- §7 merge semantics of the canonical config resolver ---
const baseCfg = { layout: 'logicalStructure', density: 'standard', maxNodes: 360, theme: 'default', font: 'system', instruction: '', language: 'auto', contextLimit: 80000 }
const makeExisting = () => ({ config: { ...baseCfg } })
// Existing record config always wins.
assert.equal(effectiveConfig(makeExisting(), undefined).maxNodes, 360)
assert.equal(effectiveConfig(makeExisting(), undefined, { ...DEFAULT_SETTINGS, defaultMaxNodes: 500, defaultTheme: 'forest' }).theme, 'default')
// New record: explicit request config beats global defaults.
assert.equal(effectiveConfig(null, { maxNodes: 120 }, { ...DEFAULT_SETTINGS, defaultMaxNodes: 500, defaultTheme: 'forest' }).maxNodes, 120)
assert.equal(effectiveConfig(null, { maxNodes: 120 }, { ...DEFAULT_SETTINGS, defaultMaxNodes: 500, defaultTheme: 'forest' }).theme, 'forest')
assert.equal(effectiveConfig(null, { maxNodes: 120 }, { ...DEFAULT_SETTINGS, defaultMaxNodes: 500, defaultTheme: 'forest' }).contextLimit, DEFAULT_SETTINGS.defaultContextLimit)
// New record without request config inherits every global default.
assert.equal(effectiveConfig(null, undefined, { ...DEFAULT_SETTINGS, defaultMaxNodes: 500, defaultTheme: 'forest' }).maxNodes, 500)
// Without settings, compiled defaults apply.
assert.equal(effectiveConfig(null, undefined, undefined).maxNodes, 360)
console.log('settings merge semantics passed')

// --- Host registration + capability flag + degradation (fake provider) ---
function makeCtx(injectGroups) {
  const registered = new Map()
  const namespaces = []
  const ctx = {
    tools: { register(t) { registered.set(t.name, t); return () => {} } },
    webServer: { register() { return () => {} } },
    effect(make) { const d = make(); if (typeof d === 'function') disposers.push(d); return d },
  };
  var disposers = [];
  ctx.inject = (names, cb) => {
    if (names.join('+') !== 'settings' || injectGroups !== true) return;
    cb({
      settings: { register(ns, schema, opts) { namespaces.push({ ns: String(ns), applies: opts?.applies, base: opts?.base }); return { get: () => ({ ...DEFAULT_SETTINGS, defaultMaxNodes: 500 }) } } },
      effect(make) { const d = make(); if (typeof d === 'function') disposers.push(d) },
    })
  };
  return { ctx, registered, namespaces }
}

const withSettings = makeCtx(true)
apply(withSettings.ctx)
assert.equal(withSettings.namespaces.length, 1, 'exactly one namespace')
assert.ok(withSettings.namespaces[0].ns.includes('chat-mindmap'), 'namespace is chat-mindmap')
assert.equal(withSettings.namespaces[0].applies, 'live')
assert.equal(withSettings.namespaces[0].base.defaultLayout, DEFAULT_SETTINGS.defaultLayout)
const settingsCap = await (async () => { let captured; withSettings.ctx.webServer = { register(route) { captured = route; return () => {} } }; apply(withSettings.ctx); const res = { statusCode: 0 }; await captured.handler({ url: '/x/capabilities', headers: {}, method: 'GET', socket: { remoteAddress: '127.0.0.1' }, on() {}, once() {} }, { setHeader() {}, end(v) { res.body = v }, writableEnded: false, statusCode: 200 }); return JSON.parse(res.body).value.settings })()
assert.equal(settingsCap, true, 'capabilities expose settings when service present')

// Degradation: no settings service -> no namespace, capabilities stay false.
const bare = makeCtx(false)
apply(bare.ctx)
assert.equal(bare.namespaces.length, 0)
console.log('settings host registration passed')
await rm(root, { recursive: true, force: true })