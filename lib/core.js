const DEFAULT_CONTEXT_LIMIT = 120_000;
// 120 is enough for a summary, but not for courseware, PDFs, or an actually
// useful study map.  Keep the hard safety ceiling while making the product
// default deep enough to retain the major branches and their supporting facts.
const DEFAULT_MAX_NODES = 360;
const DEFAULT_MAX_CHILDREN = 24;
const DEFAULT_MAX_DEPTH = 5;
const MAX_TITLE_LENGTH = 120;
const MAX_NODE_TITLE_LENGTH = 180;
const MAX_NOTE_LENGTH = 4_000;
function cleanText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function positiveInteger(value, fallback, maximum) {
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(1, Math.min(maximum, Math.floor(value)));
}
function limitsFrom(options) {
    return {
        contextLimit: positiveInteger(options?.contextLimit, DEFAULT_CONTEXT_LIMIT, 200_000),
        maxNodes: positiveInteger(options?.maxNodes, DEFAULT_MAX_NODES, 2_000),
        maxDepth: positiveInteger(options?.maxDepth, DEFAULT_MAX_DEPTH, 32),
        maxChildren: positiveInteger(options?.maxChildren, DEFAULT_MAX_CHILDREN, 200),
    };
}
function nodeId(path) {
    let hash = 2166136261;
    for (const char of path) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return `node-${(hash >>> 0).toString(36)}`;
}
function makeNode(title, path, children) {
    return { id: nodeId(path), title: cleanText(title).slice(0, MAX_NODE_TITLE_LENGTH), ...(children?.length ? { children } : {}) };
}
function parseMarkdownOutline(input, title, limits) {
    const lines = input.split(/\r?\n/);
    const headingLines = lines.filter((line) => /^\s{0,3}#{1,6}\s+\S/.test(line));
    if (headingLines.length < 1)
        return null;
    const rootHeading = headingLines[0].replace(/^\s*#+\s+/, '').trim() || title;
    const root = makeNode(rootHeading, 'root');
    limits.nodeCount = 1;
    const stack = [{ level: 1, node: root }];
    const bulletStack = [];
    let headingOrdinal = 0;
    let bulletOrdinal = 0;
    let sawStructure = false;
    for (const line of lines) {
        const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (match) {
            // The first heading supplied the root above; do not duplicate it.
            if (match[2].trim() === rootHeading && limits.nodeCount === 1)
                continue;
            const level = match[1].length;
            while (stack.length > 1 && stack[stack.length - 1].level >= level)
                stack.pop();
            const parent = stack[stack.length - 1].node;
            const depth = stack.length;
            if (depth > limits.maxDepth || limits.nodeCount >= limits.maxNodes)
                continue;
            if ((parent.children?.length ?? 0) >= limits.maxChildren)
                continue;
            const node = makeNode(match[2], `heading-${headingOrdinal++}`);
            parent.children ??= [];
            parent.children.push(node);
            limits.nodeCount += 1;
            sawStructure = true;
            bulletStack.length = 0;
            if (stack.length < limits.maxDepth)
                stack.push({ level, node });
            continue;
        }
        // A heading-only parser turns useful course facts into empty leaves. Keep
        // nested Markdown bullets as real nodes, so generators can add practical
        // definitions, examples, caveats, and exam points under a topic.
        const bullet = /^(\s*)[-*+]\s+(.+?)\s*$/.exec(line);
        if (!bullet || limits.nodeCount >= limits.maxNodes)
            continue;
        const level = Math.floor(bullet[1].replace(/\t/g, '  ').length / 2);
        const parent = bulletStack[level - 1] ?? stack[stack.length - 1].node;
        const depth = stack.length + level;
        if (depth > limits.maxDepth || (parent.children?.length ?? 0) >= limits.maxChildren)
            continue;
        const node = makeNode(bullet[2], `bullet-${bulletOrdinal++}`);
        parent.children ??= [];
        parent.children.push(node);
        limits.nodeCount += 1;
        sawStructure = true;
        bulletStack[level] = node;
        bulletStack.length = level + 1;
    }
    return sawStructure && root.children?.length ? root : null;
}
function parseTranscript(input, title, limits) {
    const root = makeNode(title || '聊天记录思维导图', 'root');
    limits.nodeCount = 1;
    const lines = input
        .split(/\r?\n/)
        .map((line) => cleanText(line.replace(/^[-*]\s+/, '')))
        .filter((line) => line.length >= 2);
    const speakerGroups = new Map();
    let currentSpeaker = '讨论要点';
    for (const line of lines) {
        const speaker = /^(用户|user|助手|assistant|system|开发者|developer)\s*[:：]/i.exec(line);
        if (speaker) {
            currentSpeaker = speaker[1].toLowerCase();
            speakerGroups.set(currentSpeaker, speakerGroups.get(currentSpeaker) ?? []);
            const content = cleanText(line.slice(speaker[0].length));
            if (content)
                speakerGroups.get(currentSpeaker).push(content);
        }
        else {
            speakerGroups.set(currentSpeaker, speakerGroups.get(currentSpeaker) ?? []);
            speakerGroups.get(currentSpeaker).push(line);
        }
    }
    let groupIndex = 0;
    for (const [speaker, entries] of speakerGroups) {
        if (!entries.length || limits.nodeCount >= limits.maxNodes || (root.children?.length ?? 0) >= limits.maxChildren)
            continue;
        const children = [];
        for (const [index, entry] of entries.slice(0, limits.maxChildren).entries()) {
            if (limits.nodeCount + 2 > limits.maxNodes)
                break;
            children.push(makeNode(entry, `speaker-${groupIndex}-${index}`));
            limits.nodeCount += 1;
        }
        if (!children.length)
            continue;
        root.children ??= [];
        if (limits.nodeCount + 1 > limits.maxNodes)
            break;
        root.children.push(makeNode(speaker === 'user' ? '用户观点' : speaker === 'assistant' ? '助手观点' : speaker, `speaker-${groupIndex}`, children));
        limits.nodeCount += 1;
        groupIndex += 1;
    }
    if (!root.children?.length) {
        root.children = [];
        for (const [index, line] of lines.slice(0, limits.maxChildren).entries()) {
            if (limits.nodeCount >= limits.maxNodes)
                break;
            root.children.push(makeNode(line, `line-${index}`));
            limits.nodeCount += 1;
        }
    }
    return root;
}
export function buildMindmap(context, title = '', options) {
    const limits = limitsFrom(options);
    const bounded = String(context ?? '').slice(0, limits.contextLimit);
    const cleanTitle = cleanText(String(title ?? '')).slice(0, MAX_TITLE_LENGTH) || '聊天记录思维导图';
    const parseLimits = { maxNodes: limits.maxNodes, maxDepth: limits.maxDepth, maxChildren: limits.maxChildren, nodeCount: 0 };
    const root = parseMarkdownOutline(bounded, cleanTitle, parseLimits) ?? parseTranscript(bounded, cleanTitle, parseLimits);
    return {
        version: 1,
        title: root.title,
        root,
        source: {
            kind: 'agent-context',
            characters: bounded.length,
            generatedAt: new Date().toISOString(),
        },
    };
}
export function buildMindmapFromOutline(outline, title = '', options) {
    const limits = limitsFrom(options);
    const bounded = String(outline ?? '').slice(0, limits.contextLimit);
    const cleanTitle = cleanText(String(title ?? '')).slice(0, MAX_TITLE_LENGTH) || '聊天记录思维导图';
    const parseLimits = { maxNodes: limits.maxNodes, maxDepth: limits.maxDepth, maxChildren: limits.maxChildren, nodeCount: 0 };
    const root = parseMarkdownOutline(bounded, cleanTitle, parseLimits);
    if (!root || !root.children?.length)
        throw new Error('invalid Markdown outline');
    return { version: 1, title: root.title, root, source: { kind: 'agent-context', characters: bounded.length, generatedAt: new Date().toISOString() } };
}
export function countMindmapNodes(node) {
    let count = 0;
    const pending = [node];
    while (pending.length) {
        const current = pending.pop();
        count += 1;
        pending.push(...(current.children ?? []));
    }
    return count;
}
export function mindmapToMarkdown(node) {
    const lines = [];
    const pending = [{ node, depth: 0 }];
    while (pending.length) {
        const current = pending.pop();
        lines.push(`${'#'.repeat(Math.min(current.depth + 1, 6))} ${current.node.title}`);
        const children = current.node.children ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1)
            pending.push({ node: children[index], depth: current.depth + 1 });
    }
    return lines.join('\n');
}
/**
 * Serializes node notes separately from the Markdown outline so regeneration
 * can use their detail without interpreting a note as a new mind-map node.
 */
export function mindmapNodeNotesForPrompt(root, maxCharacters = 96_000) {
    const notes = [];
    const pending = [{ node: root, path: root.title }];
    let remaining = Math.max(0, Math.floor(maxCharacters));
    let omitted = 0;
    while (pending.length) {
        const current = pending.pop();
        const children = current.node.children ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1)
            pending.push({ node: children[index], path: `${current.path} > ${children[index].title}` });
        const note = current.node.note?.trim();
        if (!note)
            continue;
        // Preserve a valid, bounded JSON payload even for exceptionally detailed
        // course maps. A normal map includes every note; only the overflowing tail
        // is omitted, and the caller tells the model exactly how many were skipped.
        const candidate = JSON.stringify({ id: current.node.id, path: current.path, note });
        if (candidate.length > remaining) {
            omitted += 1;
            continue;
        }
        notes.push({ id: current.node.id, path: current.path, note });
        remaining -= candidate.length;
    }
    return { notes, omitted };
}
export function validateMindmapDocument(value, options) {
    const limits = {
        maxNodes: positiveInteger(options?.maxNodes, 2_000, 10_000),
        maxDepth: positiveInteger(options?.maxDepth, 32, 128),
        maxTitleLength: positiveInteger(options?.maxTitleLength, MAX_TITLE_LENGTH, 1_000),
        maxNoteLength: positiveInteger(options?.maxNoteLength, MAX_NOTE_LENGTH, 20_000),
    };
    if (!value || typeof value !== 'object')
        throw new Error('document must be an object');
    const document = value;
    if (document.version !== 1 || typeof document.title !== 'string' || document.title.length > limits.maxTitleLength)
        throw new Error('invalid document metadata');
    const source = document.source;
    if (!source || typeof source !== 'object')
        throw new Error('document source is required');
    const sourceRecord = source;
    if (sourceRecord.kind !== 'agent-context' || !Number.isInteger(sourceRecord.characters) || typeof sourceRecord.generatedAt !== 'string')
        throw new Error('invalid document source');
    const root = document.root;
    if (!root || typeof root !== 'object')
        throw new Error('document root is required');
    let count = 0;
    const pending = [{ value: root, depth: 0 }];
    while (pending.length) {
        const current = pending.pop();
        if (!current.value || typeof current.value !== 'object')
            throw new Error('invalid mindmap node');
        const node = current.value;
        if (typeof node.id !== 'string' || node.id.length === 0 || node.id.length > 200 || typeof node.title !== 'string' || node.title.length === 0 || node.title.length > 180)
            throw new Error('invalid mindmap node fields');
        if (typeof node.note !== 'undefined' && (typeof node.note !== 'string' || node.note.length > limits.maxNoteLength))
            throw new Error('invalid mindmap node note');
        if (typeof node.collapsed !== 'undefined' && typeof node.collapsed !== 'boolean')
            throw new Error('invalid mindmap node collapsed state');
        if (current.depth > limits.maxDepth)
            throw new Error('mindmap depth exceeds limit');
        count += 1;
        if (count > limits.maxNodes)
            throw new Error('mindmap node count exceeds limit');
        if (typeof node.children !== 'undefined') {
            if (!Array.isArray(node.children))
                throw new Error('mindmap children must be an array');
            for (const child of node.children)
                pending.push({ value: child, depth: current.depth + 1 });
        }
    }
    return value;
}
export function flattenNode(node) {
    const result = [];
    const pending = [{ node, depth: 0 }];
    while (pending.length) {
        const current = pending.pop();
        result.push({ title: current.node.title, depth: current.depth });
        const children = current.node.children ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1)
            pending.push({ node: children[index], depth: current.depth + 1 });
    }
    return result;
}
//# sourceMappingURL=core.js.map