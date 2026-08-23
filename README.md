# DSH Chat Mindmap

`@ericwang1358/dsh-chat-mindmap` is a DSH hybrid plugin for generating, editing, and exporting mind maps from Agent-provided chat context.

## Install

```bash
dsh plugin --profile web add github:EricWang1358/dsh-chat-mindmap
```

Restart DSH web after installation. No local build required — the npm package ships compiled `lib/` artifacts.

**Minimum DSH version:** 0.1.0-rc.8

## Usage

### Chat generation
Ask an agent to create a mind map; the launcher starts a background job and returns a preview card on completion. Call `present_chat_mindmap` to render the SVG tool card.

### Brainmap panel
Open the **脑图** tab: session-first list, SimpleMindMap canvas editor, regenerate with fork subagent, restore previous version, archive/delete, and A3 print export.

### Export
From the `···` menu: JSON / Markdown / XMind / PNG download, SVG preview in new tab, and A3 landscape print HTML (classic/minimal/creative/academic themes).

## Settings

Plugin settings appear under **Settings → Plugins → 脑图** when the settings service is available. Values only affect newly created maps (§7).

## Capability degradation (§15)

| Missing capability | Behavior |
|---|---|
| subagents | View/edit only; semantic generation disabled |
| fork provider | Regeneration unavailable |
| jobs/tool-jobs | Chat launcher reports explicit gap |
| settings | Compiled defaults; no plugin card |
| tool view slot | Text fallback result |
| ImageLightbox (rc8) | Own accessible dialog used |

## Platform support

- **Windows:** fully supported and CI-gated.
- **macOS:** CI workflow defined; live smoke evidence PENDING_LIVE.
- **Linux:** untested.

## License MIT
