import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildMindmap, type MindmapDocument } from './core.js'

export const name = '@dsh-external/dsh-chat-mindmap'
export const inject = ['tools', 'webServer']

interface PluginContext extends Context {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

const RESULT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    title: { type: 'string' as const },
    document: { type: 'json' as const },
    markdown: { type: 'string' as const },
    nodeCount: { type: 'integer' as const },
  },
}

function asJsonValue(document: MindmapDocument): JsonValue {
  return JSON.parse(JSON.stringify(document)) as JsonValue
}

function countNodes(document: MindmapDocument): number {
  let count = 0
  const visit = (node: MindmapDocument['root']) => {
    count += 1
    for (const child of node.children ?? []) visit(child)
  }
  visit(document.root)
  return count
}

function toMarkdown(document: MindmapDocument): string {
  const lines: string[] = []
  const visit = (node: MindmapDocument['root'], depth: number) => {
    lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`)
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(document.root, 0)
  return lines.join('\n')
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 256_000) reject(new Error('request body too large'))
    })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

export function apply(ctx: PluginContext): void {
  const generate = defineTool({
    name: 'generate_chat_mindmap',
    description: 'Convert agent-provided chat context into a structured editable mind map. Pass the relevant conversation text or a Markdown outline; do not pass secrets that should not be summarized.',
    parameters: {
      context: { type: 'string', required: true, description: 'Conversation text or Markdown outline to organize.' },
      title: { type: 'string', description: 'Optional root title.' },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: `Generated mind map “${value.title}” with ${value.nodeCount} nodes.\n\n${value.markdown}` }],
    },
    timeoutMs: 30_000,
    execute: async (args) => {
      const document = buildMindmap(args.context, args.title ?? '')
      return {
        title: document.title,
        document: asJsonValue(document),
        markdown: toMarkdown(document),
        nodeCount: countNodes(document),
      }
    },
  })

  ctx.effect(() => ctx.tools.register(generate), 'chat-mindmap: generate_chat_mindmap')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-chat-mindmap',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname.endsWith('/health')) {
        writeJson(res, 200, { ok: true, plugin: name, version: 1 })
        return
      }
      if (req.method !== 'POST' || !url.pathname.endsWith('/generate')) {
        writeJson(res, 404, { ok: false, error: 'not found' })
        return
      }
      try {
        const body = await readJsonBody(req) as { context?: unknown; title?: unknown }
        if (typeof body.context !== 'string' || body.context.trim().length === 0) {
          writeJson(res, 400, { ok: false, error: 'context must be a non-empty string' })
          return
        }
        const document = buildMindmap(body.context, typeof body.title === 'string' ? body.title : '')
        writeJson(res, 200, {
          ok: true,
          value: { title: document.title, document, markdown: toMarkdown(document), nodeCount: countNodes(document) },
        })
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'chat-mindmap: HTTP API')
}

export { buildMindmap }
