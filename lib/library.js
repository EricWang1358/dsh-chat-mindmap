import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { countMindmapNodes, validateMindmapDocument } from './core.js';
let writeQueue = Promise.resolve();
export const DEFAULT_CONFIG = {
    layout: 'logicalStructure',
    density: 'standard',
    maxNodes: 360,
    theme: 'default',
    font: 'system',
    instruction: '',
    language: 'auto',
    contextLimit: 80_000,
};
const MAX_TITLE_LENGTH = 120;
const MAX_SOURCE_STRING_LENGTH = 500;
const MAX_METADATA_ENTRIES = 32;
const MAX_METADATA_VALUE_LENGTH = 500;
function rootPath() {
    return process.env.DSH_MINDMAP_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'chat-mindmap');
}
function indexPath() { return join(rootPath(), 'index.json'); }
function safeId(id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
        throw new Error('invalid library id');
    return id;
}
function mapPath(id) { return join(rootPath(), 'maps', `${safeId(id)}.json`); }
function uid() {
    return `map-${Date.now().toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function boundedString(value, fallback, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}
function normalizeConfig(config) {
    const input = isRecord(config) ? config : {};
    const density = input.density === 'compact' || input.density === 'detailed' ? input.density : DEFAULT_CONFIG.density;
    const numeric = (value, fallback, min, max) => {
        const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
        return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
    };
    return {
        layout: boundedString(input.layout, DEFAULT_CONFIG.layout, 80),
        density,
        maxNodes: numeric(input.maxNodes, DEFAULT_CONFIG.maxNodes, 8, 2_000),
        theme: boundedString(input.theme, DEFAULT_CONFIG.theme, 80),
        font: boundedString(input.font, DEFAULT_CONFIG.font, 80),
        instruction: boundedString(input.instruction, DEFAULT_CONFIG.instruction, 4_000),
        language: boundedString(input.language, DEFAULT_CONFIG.language, 32),
        contextLimit: numeric(input.contextLimit, DEFAULT_CONFIG.contextLimit, 8_000, 200_000),
    };
}
function normalizeSource(source) {
    if (!isRecord(source) || typeof source.kind !== 'string')
        return undefined;
    const allowedKinds = new Set(['text', 'pdf', 'image', 'document', 'chat', 'unknown']);
    const kind = allowedKinds.has(source.kind) ? source.kind : 'unknown';
    const result = { kind };
    for (const key of ['name', 'attachmentId', 'sessionId', 'workspaceId']) {
        if (typeof source[key] === 'string' && source[key].length > 0)
            result[key] = source[key].slice(0, MAX_SOURCE_STRING_LENGTH);
    }
    if (isRecord(source.metadata)) {
        const metadata = {};
        for (const [key, value] of Object.entries(source.metadata).slice(0, MAX_METADATA_ENTRIES)) {
            if (typeof value === 'string')
                metadata[key.slice(0, 100)] = value.slice(0, MAX_METADATA_VALUE_LENGTH);
        }
        if (Object.keys(metadata).length)
            result.metadata = metadata;
    }
    return result;
}
async function atomicJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
        await rename(tmp, path);
    }
    catch (error) {
        await unlink(tmp).catch(() => undefined);
        throw error;
    }
}
async function readJson(path, fallback) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return fallback;
        throw error;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`invalid JSON in ${path}`);
    }
}
async function readRecord(id) {
    const path = mapPath(id);
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return null;
        throw error;
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new Error(`invalid JSON in ${path}`);
    }
    return validateMindmapRecord(value, id, path);
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
function validateMindmapRecord(value, expectedId, path) {
    if (!isRecord(value) || value.libraryId !== expectedId || typeof value.title !== 'string' || value.title.length > MAX_TITLE_LENGTH ||
        typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || typeof value.archived !== 'boolean' && typeof value.archived !== 'undefined') {
        throw new Error(`invalid mindmap record in ${path}`);
    }
    const current = validateMindmapDocument(value.current, { maxNodes: 2_000, maxDepth: 32 });
    const previous = typeof value.previous === 'undefined' ? undefined : validateMindmapDocument(value.previous, { maxNodes: 2_000, maxDepth: 32 });
    const record = {
        libraryId: expectedId,
        title: value.title,
        current,
        ...(previous ? { previous } : {}),
        config: normalizeConfig(value.config),
        ...(value.source ? { source: normalizeSource(value.source) } : {}),
        ...(value.archived ? { archived: true } : {}),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
    return record;
}
async function readIndex() {
    const ids = await readJson(indexPath(), []);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
        throw new Error(`invalid mindmap index in ${indexPath()}`);
    return ids.map((id) => safeId(id));
}
function enqueueWrite(operation) {
    const run = writeQueue.catch(() => undefined).then(operation);
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
}
export async function listMindmaps(filters) {
    const ids = await readIndex();
    const records = await Promise.all(ids.map(readRecord));
    return records.filter((record) => record !== null &&
        (filters?.archived === undefined ? !record.archived : Boolean(record.archived) === filters.archived) &&
        (!filters?.workspaceId || record.source?.workspaceId === filters.workspaceId) &&
        (!filters?.sessionId || record.source?.sessionId === filters.sessionId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((record) => ({
        libraryId: record.libraryId,
        title: record.title,
        source: record.source,
        config: record.config,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        hasPrevious: Boolean(record.previous),
        archived: Boolean(record.archived),
        nodeCount: countMindmapNodes(record.current.root),
    }));
}
export async function getMindmap(id) {
    return readRecord(safeId(id));
}
export async function saveMindmap(input) {
    return enqueueWrite(async () => {
        const id = input.libraryId ? safeId(input.libraryId) : uid();
        const existing = await readRecord(id);
        if (input.expectedUpdatedAt && existing?.updatedAt !== input.expectedUpdatedAt)
            throw new Error('mindmap conflict');
        const config = normalizeConfig({ ...existing?.config, ...input.config });
        const document = validateMindmapDocument(input.document, { maxNodes: config.maxNodes, maxDepth: 32 });
        const now = new Date().toISOString();
        const record = {
            libraryId: id,
            title: boundedString(input.title || document.title, document.title, MAX_TITLE_LENGTH),
            current: document,
            previous: input.rotatePrevious === false ? existing?.previous : existing?.current,
            config,
            source: normalizeSource(input.source) ?? existing?.source,
            archived: input.archived ?? existing?.archived ?? false,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        await atomicJson(mapPath(id), record);
        const ids = await readIndex();
        if (!ids.includes(id))
            ids.push(id);
        await atomicJson(indexPath(), ids);
        return record;
    });
}
export async function updateMindmap(id, patch) {
    return enqueueWrite(async () => {
        const safeLibraryId = safeId(id);
        const existing = await readRecord(safeLibraryId);
        if (!existing)
            return null;
        const config = normalizeConfig({ ...existing.config, ...patch.config });
        const document = patch.document ? validateMindmapDocument(patch.document, { maxNodes: config.maxNodes, maxDepth: 32 }) : existing.current;
        const now = new Date().toISOString();
        const record = {
            ...existing,
            title: boundedString(patch.title ?? existing.title, existing.title, MAX_TITLE_LENGTH),
            current: document,
            previous: patch.rotatePrevious === false ? existing.previous : patch.document ? existing.current : existing.previous,
            config,
            archived: patch.archived ?? existing.archived ?? false,
            updatedAt: now,
        };
        await atomicJson(mapPath(safeLibraryId), record);
        const ids = await readIndex();
        if (!ids.includes(safeLibraryId))
            ids.push(safeLibraryId);
        await atomicJson(indexPath(), ids);
        return record;
    });
}
export async function archiveMindmap(id, archived = true) {
    return updateMindmap(id, { archived });
}
export async function deleteMindmap(id) {
    return enqueueWrite(async () => {
        const safeLibraryId = safeId(id);
        const ids = await readIndex();
        if (!ids.includes(safeLibraryId))
            return false;
        await atomicJson(indexPath(), ids.filter((value) => value !== safeLibraryId));
        try {
            await unlink(mapPath(safeLibraryId));
        }
        catch (error) {
            if (!isNodeError(error) || error.code !== 'ENOENT')
                throw error;
        }
        return true;
    });
}
//# sourceMappingURL=library.js.map