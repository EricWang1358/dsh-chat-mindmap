# DSH Chat Mindmap

`@dsh-external/dsh-chat-mindmap` is a DSH hybrid plugin for turning agent-provided chat context into an editable mind map.

## MVP contract

- **Host tool:** `generate_chat_mindmap`
- **Web API:** `POST /@dsh-external/dsh-chat-mindmap/generate`
- **UI:** `conversation.view` slot with a paste-and-generate panel
- **Renderer:** [SimpleMindMap](https://github.com/wanglin2/mind-map), bundled in the client
- **Exports:** JSON, Markdown, and XMind when the browser export plugin succeeds
- **Context boundary:** the caller supplies the conversation text; this plugin does not read DSH's private session database

## Install / build

The build uses the DSH checkout's TypeScript compiler and produces host and browser bundles:

```powershell
$env:DSH_CHECKOUT = 'D:\Program Files\nodejs\node_global\node_modules\@deepseek-ai\dsh'
npm install --legacy-peer-deps
npm run build
```

For the local super-injector:

```text
dev_build_plugin {"dir":"D:/A/1NUS/1Sem/dsh-chat-mindmap"}
dev_inject_plugin {"dir":"D:/A/1NUS/1Sem/dsh-chat-mindmap"}
```

The normal profile installation path is:

```text
dev_install_package {"dir":"D:/A/1NUS/1Sem/dsh-chat-mindmap","profile":"web"}
```

## Agent usage

Ask the DSH agent to call `generate_chat_mindmap` with the relevant text or a Markdown outline. The tool returns a stable intermediate document rather than renderer-specific data.

```json
{
  "context": "# Project launch\n## Product\n### Scope\n## Risks\n### Timeline",
  "title": "Project launch"
}
```

## Design decisions

1. Agent tool and UI are two entry points over one host generator.
2. No MCP server in the first version; MCP is an external integration concern, not an internal DSH transport.
3. The intermediate `MindmapDocument` is renderer-independent so Drawnix/Plait can be added later.
4. Context is bounded to 120,000 characters and generated content is capped to avoid runaway browser work.

## Known limitations

- The UI currently accepts pasted/agent-provided context; it does not silently scrape the current session.
- XMind export depends on SimpleMindMap's browser export plugin and may be unavailable in a restricted browser.
- The current panel is an MVP surface; source-message backlinks, branch regeneration, persistence, and native current-session selection are follow-up work.
