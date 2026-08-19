const MAX_CONTEXT_CHARS = 120_000;
const MAX_CHILDREN = 24;
const MAX_DEPTH = 5;
function cleanText(value) {
    return value.replace(/\s+/g, ' ').trim();
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
    return { id: nodeId(path), title: cleanText(title).slice(0, 180), ...(children?.length ? { children } : {}) };
}
function parseMarkdownOutline(input, title) {
    const lines = input.split(/\r?\n/);
    const headingLines = lines.filter((line) => /^\s{0,3}#{1,6}\s+\S/.test(line));
    if (headingLines.length < 2)
        return null;
    const rootHeading = headingLines[0].replace(/^\s*#+\s+/, '').trim() || title;
    const root = makeNode(rootHeading, 'root');
    const stack = [{ level: 1, node: root }];
    let ordinal = 0;
    for (const line of headingLines.slice(1)) {
        const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (!match)
            continue;
        const level = match[1].length;
        const node = makeNode(match[2], `heading-${ordinal++}`);
        while (stack.length && stack[stack.length - 1].level >= level)
            stack.pop();
        const parent = stack[stack.length - 1]?.node ?? root;
        parent.children ??= [];
        if (parent.children.length < MAX_CHILDREN)
            parent.children.push(node);
        if (stack.length < MAX_DEPTH)
            stack.push({ level, node });
    }
    return root.children?.length ? root : null;
}
function parseTranscript(input, title) {
    const root = makeNode(title || '聊天记录思维导图', 'root');
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
        if (!entries.length)
            continue;
        const children = entries.slice(0, MAX_CHILDREN).map((entry, index) => makeNode(entry, `speaker-${groupIndex}-${index}`));
        root.children ??= [];
        root.children.push(makeNode(speaker === 'user' ? '用户观点' : speaker === 'assistant' ? '助手观点' : speaker, `speaker-${groupIndex}`, children));
        groupIndex += 1;
        if (root.children.length >= MAX_CHILDREN)
            break;
    }
    if (!root.children?.length) {
        root.children = lines.slice(0, MAX_CHILDREN).map((line, index) => makeNode(line, `line-${index}`));
    }
    return root;
}
export function buildMindmap(context, title = '') {
    const bounded = context.slice(0, MAX_CONTEXT_CHARS);
    const cleanTitle = cleanText(title).slice(0, 120) || '聊天记录思维导图';
    const root = parseMarkdownOutline(bounded, cleanTitle) ?? parseTranscript(bounded, cleanTitle);
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
export function flattenNode(node) {
    const result = [];
    const visit = (current, depth) => {
        result.push({ title: current.title, depth });
        for (const child of current.children ?? [])
            visit(child, depth + 1);
    };
    visit(node, 0);
    return result;
}
//# sourceMappingURL=core.js.map