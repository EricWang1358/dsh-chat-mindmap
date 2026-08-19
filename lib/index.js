import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildMindmap } from './core.js';
import { archiveMindmap, deleteMindmap, getMindmap, listMindmaps, saveMindmap, updateMindmap, } from './library.js';
export const name = '@dsh-external/dsh-chat-mindmap';
export const inject = ['tools', 'webServer'];
const RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: { type: 'string' },
        document: { type: 'json' },
        markdown: { type: 'string' },
        nodeCount: { type: 'integer' },
        libraryId: { type: 'string' },
        saved: { type: 'boolean' },
    },
};
function asJsonValue(document) {
    return JSON.parse(JSON.stringify(document));
}
function countNodes(document) {
    let count = 0;
    const visit = (node) => {
        count += 1;
        for (const child of node.children ?? [])
            visit(child);
    };
    visit(document.root);
    return count;
}
function toMarkdown(document) {
    const lines = [];
    const visit = (node, depth) => {
        lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`);
        for (const child of node.children ?? [])
            visit(child, depth + 1);
    };
    visit(document.root, 0);
    return lines.join('\n');
}
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 256_000)
                reject(new Error('request body too large'));
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch {
                reject(new Error('invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}
function writeJson(res, status, value) {
    const body = JSON.stringify(value);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(body);
}
export function apply(ctx) {
    const generate = defineTool({
        name: 'generate_chat_mindmap',
        description: 'Convert agent-provided chat context into a structured editable mind map. Pass the relevant conversation text or a Markdown outline; do not pass secrets that should not be summarized.',
        parameters: {
            context: { type: 'string', required: true, description: 'Extracted text or Markdown outline from chat, PDF, image, or document.' },
            title: { type: 'string', description: 'Optional root title.' },
            libraryId: { type: 'string', description: 'Existing library ID to replace current with a new generated version.' },
            source: { type: 'json', description: 'Source metadata such as kind, name, attachmentId, sessionId, and workspaceId.' },
            config: { type: 'json', description: 'Generation and visual settings.' },
            save: { type: 'boolean', description: 'Persist to the global mindmap library; defaults to true.' },
        },
        output: {
            schema: RESULT_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: `Generated mind map “${value.title}” with ${value.nodeCount} nodes.\n\n${value.markdown}` }],
        },
        timeoutMs: 30_000,
        execute: async (rawArgs, exec) => {
            const args = rawArgs;
            const document = buildMindmap(args.context, args.title ?? '');
            const saved = args.save !== false;
            const source = args.source ?? { kind: 'unknown', sessionId: exec.agent?.id };
            const record = saved ? await saveMindmap({
                libraryId: args.libraryId,
                title: document.title,
                document,
                config: args.config,
                source,
            }) : null;
            return {
                title: record?.title ?? document.title,
                document: asJsonValue(record?.current ?? document),
                markdown: toMarkdown(record?.current ?? document),
                nodeCount: countNodes(record?.current ?? document),
                libraryId: record?.libraryId ?? '',
                saved,
            };
        },
    });
    ctx.effect(() => ctx.tools.register(generate), 'chat-mindmap: generate_chat_mindmap');
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/@dsh-external/dsh-chat-mindmap',
        handler: async (req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (req.method === 'GET' && url.pathname.endsWith('/health')) {
                writeJson(res, 200, { ok: true, plugin: name, version: 2 });
                return;
            }
            if (req.method === 'GET' && url.pathname.endsWith('/maps')) {
                const workspaceId = url.searchParams.get('workspaceId') || undefined;
                const sessionId = url.searchParams.get('sessionId') || undefined;
                const archived = url.searchParams.get('archived') === 'true' ? true : undefined;
                writeJson(res, 200, { ok: true, value: await listMindmaps({ workspaceId, sessionId, archived }) });
                return;
            }
            const archiveMatch = /\/maps\/([^/]+)\/archive$/.exec(url.pathname);
            if (req.method === 'POST' && archiveMatch) {
                const record = await archiveMindmap(decodeURIComponent(archiveMatch[1]), true);
                if (!record) {
                    writeJson(res, 404, { ok: false, error: 'mindmap not found' });
                    return;
                }
                writeJson(res, 200, { ok: true, value: record });
                return;
            }
            const mapMatch = /\/maps\/([^/]+)$/.exec(url.pathname);
            if (req.method === 'GET' && mapMatch) {
                const record = await getMindmap(decodeURIComponent(mapMatch[1]));
                if (!record) {
                    writeJson(res, 404, { ok: false, error: 'mindmap not found' });
                    return;
                }
                writeJson(res, 200, { ok: true, value: record });
                return;
            }
            if ((req.method === 'PATCH' || req.method === 'DELETE') && mapMatch) {
                const id = decodeURIComponent(mapMatch[1]);
                if (req.method === 'DELETE') {
                    writeJson(res, 200, { ok: true, value: { deleted: await deleteMindmap(id) } });
                    return;
                }
                const body = await readJsonBody(req);
                const record = await updateMindmap(id, body);
                if (!record) {
                    writeJson(res, 404, { ok: false, error: 'mindmap not found' });
                    return;
                }
                writeJson(res, 200, { ok: true, value: record });
                return;
            }
            if (req.method !== 'POST' || !url.pathname.endsWith('/generate')) {
                writeJson(res, 404, { ok: false, error: 'not found' });
                return;
            }
            try {
                const body = await readJsonBody(req);
                if (typeof body.context !== 'string' || body.context.trim().length === 0) {
                    writeJson(res, 400, { ok: false, error: 'context must be a non-empty string' });
                    return;
                }
                const document = buildMindmap(body.context, body.title ?? '');
                const saved = body.save !== false;
                const record = saved ? await saveMindmap({
                    libraryId: body.libraryId,
                    title: document.title,
                    document,
                    config: body.config,
                    source: body.source,
                }) : null;
                const current = record?.current ?? document;
                writeJson(res, 200, {
                    ok: true,
                    value: { title: record?.title ?? current.title, document: current, markdown: toMarkdown(current), nodeCount: countNodes(current), libraryId: record?.libraryId ?? '', saved },
                });
            }
            catch (error) {
                writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        },
    }), 'chat-mindmap: HTTP API');
}
export { buildMindmap };
//# sourceMappingURL=index.js.map