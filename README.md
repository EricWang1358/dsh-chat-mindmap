# DSH Chat Mindmap

`@dsh-external/dsh-chat-mindmap` is a DSH hybrid plugin for turning Agent-provided chat, text, PDF, image, or document context into a persistent editable mindmap library.

## Product shape

The plugin registers a peer conversation tab alongside DSH's conversation and trajectory tabs:

```text
对话 | 轨迹 | 上下文 | 脑图
```

The **脑图** tab is not a sidebar and does not permanently occupy the composer. It is a persistent library surface:

- left: global active mindmap index
- right: selected SimpleMindMap editor
- Host-owned JSON persistence under `~/.dsh/chat-mindmap/`
- archive and delete operations to avoid unbounded growth
- one `current` plus one `previous` version per library item
- manual editor changes autosave without rotating `previous`
- Agent regeneration rotates current into previous and replaces current

## MVP contract

- **Host tool:** `generate_chat_mindmap`
- **Web API:**
  - `POST /@dsh-external/dsh-chat-mindmap/generate`
  - `GET /@dsh-external/dsh-chat-mindmap/maps`
  - `GET/PATCH/DELETE /@dsh-external/dsh-chat-mindmap/maps/:id`
  - `POST /@dsh-external/dsh-chat-mindmap/maps/:id/archive`
- **UI:** `conversation.view` slot with a persistent gallery/editor
- **Renderer:** [SimpleMindMap](https://github.com/wanglin2/mind-map), split-imported instead of `full.js`
- **Exports:** JSON, Markdown, and XMind
- **Source boundary:** Agent reads attachments and supplies extracted text plus source metadata; the plugin does not retain source text by default
- **Regeneration:** the UI prepares a bounded prompt in the current DSH input, including `libraryId`, current edited tree, source metadata, and configuration; Agent re-reads/re-supplies the source and calls the tool again

## Install / build

There are three different installation modes. **Do not use `dev_inject_plugin` for a normal installation**: it is a temporary live injection and is intentionally lost after DSH restarts.

### A. End user: published npm package (recommended once released)

After this package is published under its final npm name, an end user runs this from any directory:

```powershell
dsh plugin --profile web add @dsh-external/dsh-chat-mindmap@0.1.0
```

`dsh plugin` forwards to pnpm, writes the dependency into `~/.dsh/profiles/web/package.json`, adds the package to `dsh.profile.bundles`, and makes it survive restart. Then restart the DSH Web profile:

```powershell
dsh web
```

If the package is published under a different scope/name, replace the package spec in the command. The package must be published with the built `lib/` directory; users should not need the source checkout or DSH source tree.

### B. End user: GitHub repository

The public repository is ready; an end user can install the Git package persistently:

```powershell
dsh plugin --profile web add github:EricWang1358/dsh-chat-mindmap
```

For a tagged release:

```powershell
dsh plugin --profile web add github:EricWang1358/dsh-chat-mindmap#v0.1.0
```

The Git repository must contain built `lib/` artifacts, or a verified `prepare`/build workflow. The project repository is https://github.com/EricWang1358/dsh-chat-mindmap. For the most reliable user install, publish npm or attach a built tarball instead of requiring every user to compile TypeScript.

### C. End user: built `.tgz` artifact

A maintainer builds and packs the plugin:

```powershell
npm install --legacy-peer-deps
npm run build
npm pack
```

Then copy the generated `.tgz` to the target machine and install it persistently. On Windows, use a `file:` URL with forward slashes or an absolute tarball path:

```powershell
dsh plugin --profile web add file:C:/path/to/dsh-external-dsh-chat-mindmap-0.1.0.tgz
# equivalent: dsh plugin --profile web add C:/path/to/dsh-external-dsh-chat-mindmap-0.1.0.tgz
```

Restart DSH after installation. The `health` URL is an API endpoint, not a standalone app page; if the plugin is not installed/persisted, DSH's SPA fallback will return the conversation shell HTML instead of JSON. Verify the named route rather than opening it as a browser page:

```powershell
Invoke-WebRequest http://127.0.0.1:3080/@dsh-external/dsh-chat-mindmap/health
```

Expected content:

```json
{"ok":true,"plugin":"@dsh-external/dsh-chat-mindmap","version":2}
```

### D. Local developer checkout

The build uses the DSH checkout's TypeScript compiler and produces host and browser bundles:

```powershell
$env:DSH_CHECKOUT = 'D:\Program Files\nodejs\node_global\node_modules\@deepseek-ai\dsh'
npm install --legacy-peer-deps
npm run build
```

For a **persistent** local profile installation, use the supported package installer:

```text
dev_install_package {"dir":"D:/A/1NUS/1Sem/dsh-chat-mindmap","profile":"web"}
```

Only for temporary development/testing:

```text
dev_build_plugin {"dir":"D:/A/1NUS/1Sem/dsh-chat-mindmap"}
dev_inject_plugin {"dir":"D:/A/1NUS/1Sem/dsh-chat-mindmap"}
```

## Agent usage

Ask the DSH Agent to call `generate_chat_mindmap` with extracted source text. Persistence is enabled by default and the result includes `libraryId`:

```json
{
  "context": "# Project launch\n## Product\n### Scope\n## Risks\n### Timeline",
  "title": "Project launch",
  "source": {
    "kind": "pdf",
    "name": "architecture.pdf",
    "attachmentId": "attachment-id",
    "sessionId": "session-id"
  },
  "config": {
    "layout": "logicalStructure",
    "contextLimit": 80000,
    "instruction": "重点提取风险和行动项"
  }
}
```

## Persistence and lifecycle

```text
~/.dsh/chat-mindmap/
├── index.json
└── maps/
    └── <libraryId>.json
```

Each record stores metadata and bounded visual/generation settings, never the extracted source text by default. `current` and `previous` are rotated only for a new Agent result; UI autosave keeps the previous snapshot stable. Delete removes the index entry and map file. Archive hides an item from the active index without losing it.

## Verification

The current browser bundle is approximately **560 KB** (about **163 KB gzip**) after split imports and minification, versus the earlier multi-megabyte `full.js` bundle.

The GUI verification path has been exercised:

1. Open a DSH session in workspace `1Sem`.
2. Confirm `对话 | 轨迹 | 上下文 | 脑图` appears.
3. Open `脑图`, click `新建`, paste Markdown, and click `生成并保存`.
4. The persistent library entry renders in the left list and the editable canvas renders on the right.
5. The `XMind` button becomes enabled and downloads an `.xmind` archive. The archive contains `content.json`, `content.xml`, `metadata.json`, and `manifest.json`; the generated `content.json` was inspected successfully.
6. Layout changes call SimpleMindMap's live `setLayout` and re-render path; theme changes call `setThemeConfig` and re-render immediately. The UI exposes 14 layout choices and 10 visual presets: default, Classic 4, ocean, forest, sunset, lavender, graphite, rose, amber, and high contrast.

## Design decisions

1. Agent tool and UI are two entry points over one host generator.
2. No MCP server in this version; MCP is an external integration concern, not an internal DSH transport.
3. The intermediate `MindmapDocument` is renderer-independent so Drawnix/Plait can be added later.
4. Context is bounded and regeneration prompts explicitly warn about truncation to control token cost.
5. Layout/theme/font are immediate visual settings; density, max nodes, language, and instruction affect the next Agent generation.
