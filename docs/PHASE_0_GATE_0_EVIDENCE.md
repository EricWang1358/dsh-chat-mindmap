# Phase 0 Gate 0 Evidence

Date: 2026-08-20
Repository: `@dsh-external/dsh-chat-mindmap`
Status: **Automated contracts PASS; selected live GUI evidence recorded; remaining live items remain pending**

## Reproducible checks

rc8 constraint: `@deepseek-ai/dsh-client-ui-attachment` does not export `ImageLightbox` from its public package surface. The plugin therefore uses its own accessible SVG preview dialog and does not import private DSH compiled paths. Any old plan text referring to an official ImageLightbox is superseded by this constraint.

```text
npm run verify:gate0
npm test
```

`verify:gate0` is implemented by `scripts/gate0.mjs`. It checks the installed DSH checkout and local SimpleMindMap source contracts, then exercises the fork seed boundary and optional-capability fixture. It exits zero for contract verification and reports live-only checks as `PENDING_LIVE`. Use `node scripts/gate0.mjs --require-live` to make any pending live item fail the command.

Current automated result: static/fixture checks PASS; the LocalJobRegistry runtime fixture also passes; existing Core, Library and HTTP tests PASS. The command intentionally keeps parent-Agent/browser-only checks as `PENDING_LIVE`.

## 2026-08-20 GUI observation

The existing DSH Web GUI was inspected at `http://127.0.0.1:3080` after the 0.1.1 hot reload. The screenshot showed the real failure mode: the conversation host exposed a short usable panel, while the brainmap workspace still assumed excessive page height; the lower half became an empty dark region and the fixed 228px library consumed valuable width. The 0.1.x follow-up adds a measured workspace viewport, a collapsible library rail, and finite flex sizing. This observation is visual evidence of the defect and of the required acceptance dimensions; it is not a claim that browser automation has proven every interaction.

## Result table

| Assumption | Result | Evidence | Remaining proof |
|---|---|---|---|
| `fork` provider name and capabilities | PASS | Official `dsh-subagent-fork-in-process` source declares provider default `fork`, `outputSchema`, `toolFilter`, `persona`, and `inheritsParentContext`. | Confirm the target DSH composition uses this provider, not a replacement registration. |
| fork context boundary | PASS (contract + fixture) | Official implementation seeds through the last `turn/end`; the local fixture proves an in-flight `tool/call` is excluded. | Live fork must verify completed parent context and the documented `supplementalContext` path for attachment/body input. |
| owned Jobs communication | PASS (contract + local runtime fixture + live GUI) | Official Jobs types define owner-scoped access and `onJobDone`; `dsh-tool-jobs` sends a completion notice instructing `job_output`, then wakes/injects the owner. `gate0.mjs` also starts a real `LocalJobRegistry` job, settles it, observes exactly one callback, and reads final output. Live transcript evidence records task `pwsh-1`, output `LIVE_GATE0_DONE`, owner completion notice, forced `job_output` readback, final `completed`, exit code 0, and zero browser console errors. | The supplied transcript does not evidence the planned presentation-tool step; keep that as a separate implementation check if it remains required. |
| tool-card replay | PASS (type + runtime fixture; live partial) | `tool.call.toolview` receives stable `callId` and `ToolCallBlock`; replayed `ToolResultNode` preserves content and permits `call=null` when the call head is outside the window. Runtime fixture round-trips `call=null`; live GUI refresh retained Pwsh/Glob/Read/Skill cards. | Reproduce a history window with the call head actually outside the window and record resulting `call=null` renderer behavior. |
| SVG export and preview dialog | PASS (library + runtime fixture; live partial) | Installed SimpleMindMap `Export.svg` serializes SVG into an `image/svg+xml` Blob; runtime fixture verifies MIME/XML, object URL fetch, and revoke failure. DSH rc8 does not publicly export `ImageLightbox`; the plugin uses an accessible own dialog with Escape/backdrop/close behavior and object URL cleanup. | Browser `<img>` load and actual dialog interaction still require GUI evidence; no claim is made for an official ImageLightbox. |
| optional capability degradation | PASS (runtime fixture; live partial) | The real plugin `apply()` mounts against a context exposing only required `tools`/`webServer`; absent `jobs`, `subagents`, `settings`, `inject`, and `get` do not prevent both registrations. Live router-spec profile evidence confirms the plugin mounts. | Direct evidence of a profile with those optional services absent plus explicit user-visible degradation state is still missing. |

## Live verification runbook

These checks must be performed in the existing DSH Web GUI at `http://127.0.0.1:3080`; starting another server does not validate this composition.

1. Jobs + parent communication: in a fresh session, start a short owned background Job, record the returned Job id, wait for the completion notice, call `job_output` with that id, then invoke the planned presentation tool. Capture the session log or screenshot showing the notice, `job_output`, and presentation call in order.
2. Tool-card replay: render a tool card with a stable reference, refresh the GUI, confirm the same card is reconstructed from the persisted result, then repeat with the call head outside the visible history window and record `call=null` handling.
3. SVG preview: open the brainmap/chat preview, create a two-node map, call the library's SVG export with download disabled, assert a non-empty `image/svg+xml` Blob URL loads in the chat `<img>`, click the image, assert the plugin's accessible preview dialog opens, close it with the close control or Escape, and verify cleanup on unmount. DSH rc8 has no public ImageLightbox export; do not claim one. Capture screenshot and browser console output.
4. Optional degradation: use a test composition/profile with `jobs`, `subagents`, and `settings` absent but the plugin's required `tools` and `webServer` present; assert the plugin registers its required route/tool and reports disabled optional features without throwing. Do not alter the production profile to create this evidence.

## Gate decision

Gate 0 automated contracts and local runtime fixtures are passing. Browser-only replay, SVG dialog interaction, and optional-service user-visible degradation remain explicitly `PENDING_LIVE`; the 2026-08-20 screenshot has been recorded as defect evidence for the responsive workspace fix, not as full E2E proof.

No Phase 1 or later source refactor was performed as part of this verification work.
