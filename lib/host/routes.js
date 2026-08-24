import { SessionId } from '@deepseek-ai/dsh-session';
import { validateMindmapDocument } from '../core.js';
import { DomainError } from '../domain/errors.js';
import { deleteMindmap, getMindmap, listMindmaps, restorePreviousMindmap, saveMindmap, updateMindmap, } from '../library.js';
import { revisionIdOf } from '../revisions.js';
import { LIBRARY_ID_MAX_LENGTH, LIBRARY_ID_PATTERN, REVISION_ID_MAX_LENGTH, REVISION_ID_PATTERN, RUN_ID_MAX_LENGTH, RUN_ID_PATTERN, } from './id-patterns.js';
import { parseLaunchConfig, parseLaunchSource } from './tools.js';
// ---------------------------------------------------------------------------
// REST V2 (§11). Canonical implementation; the frozen inline handler in
// src/index.ts is superseded and deleted at the integration switchover.
// Error envelope: { ok:false, error:{ code, message } } — never String(error).
// ---------------------------------------------------------------------------
export const PLUGIN_ROUTE_PREFIXES = ['/@ericwang1358/dsh-chat-mindmap', '/@dsh-external/dsh-chat-mindmap'];
export const ROUTES_VERSION = 5;
export const PLUGIN_ROUTE_NAME = '@ericwang1358/dsh-chat-mindmap';
const BODY_LIMIT_BYTES = 256_000;
const BODY_TIMEOUT_MS = 15_000;
class RouteError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'RouteError';
    }
}
const STATUS_BY_CODE = {
    INVALID_REQUEST: 400,
    MINDMAP_NOT_FOUND: 404,
    WORKSPACE_SCOPE_MISMATCH: 404,
    MINDMAP_BUSY: 409,
    MINDMAP_CONFLICT: 409,
    SESSION_UNAVAILABLE: 409,
    MINDMAP_REVISION_EXPIRED: 410,
    CAPABILITY_UNAVAILABLE: 503,
    STORAGE_FAILED: 500,
};
function toErrorResponse(error) {
    if (error instanceof RouteError)
        return { status: error.status, code: error.code, message: error.message };
    if (error instanceof DomainError)
        return { status: STATUS_BY_CODE[error.code] ?? 500, code: error.code, message: error.message };
    if (error instanceof Error && error.message === 'invalid library id')
        return { status: 400, code: 'INVALID_REQUEST', message: error.message };
    return { status: 500, code: 'STORAGE_FAILED', message: 'mindmap service failed' };
}
function writeJson(res, status, value) {
    if (res.writableEnded)
        return;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(value));
}
function writeError(res, error, logger) {
    const response = toErrorResponse(error);
    if (response.status >= 500 && logger) {
        try {
            logger('routes: ' + (error instanceof Error ? (error.stack ?? error.message) : String(error)));
        }
        catch {
            // A broken sink must never break the error response.
        }
    }
    writeJson(res, response.status, { ok: false, error: { code: response.code, message: response.message } });
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function optionalString(value, field, maxLength) {
    if (typeof value === 'undefined')
        return undefined;
    if (typeof value !== 'string' || value.length > maxLength)
        throw new RouteError(400, 'INVALID_REQUEST', field + ' must be a string of at most ' + maxLength + ' characters');
    return value;
}
function decodeSegment(encoded, pattern, maxLength, field) {
    let decoded;
    try {
        decoded = decodeURIComponent(encoded);
    }
    catch {
        throw new RouteError(400, 'INVALID_REQUEST', field + ' is not a valid encoding');
    }
    if (decoded.length > maxLength || !pattern.test(decoded))
        throw new RouteError(400, 'INVALID_REQUEST', field + ' is invalid');
    return decoded;
}
// Canonical request-security copy: loopback + same-origin/Fetch Metadata +
// custom mutation header. The frozen duplicate in index.ts is superseded at
// integration switchover; behavior parity is locked by its golden assertions.
function requestSecurityError(req) {
    const headers = req.headers ?? {};
    const site = headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'none')
        return new RouteError(403, 'INVALID_REQUEST', 'cross-site request rejected');
    const origin = headers.origin;
    if (origin) {
        if (origin === 'null')
            return new RouteError(403, 'INVALID_REQUEST', 'opaque origin rejected');
        let parsed;
        try {
            parsed = new URL(origin);
        }
        catch {
            return new RouteError(403, 'INVALID_REQUEST', 'invalid request origin');
        }
        const host = headers.host;
        if (!host || parsed.host !== host || !['http:', 'https:'].includes(parsed.protocol))
            return new RouteError(403, 'INVALID_REQUEST', 'origin is not the DSH web origin');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) {
        if (headers['x-dsh-chat-mindmap-request'] !== '1')
            return new RouteError(403, 'INVALID_REQUEST', 'plugin request header required');
    }
    const remote = req.socket?.remoteAddress;
    if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote))
        return new RouteError(403, 'INVALID_REQUEST', 'non-loopback request rejected');
    return null;
}
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let bytes = 0;
        let settled = false;
        const timer = setTimeout(() => fail(new RouteError(408, 'INVALID_REQUEST', 'request body timeout')), BODY_TIMEOUT_MS);
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        };
        req.on('data', (chunk) => {
            if (settled)
                return;
            bytes += Buffer.byteLength(chunk, 'utf8');
            if (bytes > BODY_LIMIT_BYTES) {
                fail(new RouteError(413, 'INVALID_REQUEST', 'request body too large'));
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            if (settled)
                return;
            try {
                const parsed = body ? JSON.parse(body) : {};
                settled = true;
                clearTimeout(timer);
                resolve(parsed);
            }
            catch {
                fail(new RouteError(400, 'INVALID_REQUEST', 'invalid JSON'));
            }
        });
        req.on('error', (error) => {
            clearTimeout(timer);
            fail(new RouteError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'request stream failed'));
        });
    });
}
function requireLiveAgent(deps, rawSessionId) {
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    if (!sessionId || !deps.agents)
        throw new RouteError(409, 'SESSION_UNAVAILABLE', 'no live session is available for this mutation');
    const agent = deps.agents.get(SessionId(sessionId));
    if (!agent)
        throw new RouteError(409, 'SESSION_UNAVAILABLE', 'no live session is available for this mutation');
    return agent;
}
function requireExpectedRecordVersion(container) {
    const version = container.expectedRecordVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
        throw new RouteError(400, 'INVALID_REQUEST', 'expectedRecordVersion must be a positive integer');
    return version;
}
async function loadExisting(deps, id) {
    const record = await (deps.loadRecord ?? getMindmap)(id);
    if (!record)
        throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
    return record;
}
function sessionIdOf(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function assertRecordAccess(deps, record, rawSessionId, requireSession = false) {
    const sessionId = sessionIdOf(rawSessionId);
    const scoped = typeof record.workspaceKey === 'string' && record.workspaceKey !== 'legacy-unscoped';
    if (!sessionId) {
        if (requireSession || scoped)
            throw new DomainError('WORKSPACE_SCOPE_MISMATCH', 'mindmap not found in this workspace');
        return '';
    }
    if (scoped) {
        const callerWorkspace = deps.workspaceKeyOfSession?.(sessionId);
        if (!callerWorkspace || callerWorkspace !== record.workspaceKey)
            throw new DomainError('WORKSPACE_SCOPE_MISMATCH', 'mindmap not found in this workspace');
    }
    return sessionId;
}
function parseCreateBody(value) {
    if (!isRecord(value))
        throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object');
    let document;
    try {
        document = validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 });
    }
    catch (error) {
        throw new RouteError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'invalid document');
    }
    return {
        title: optionalString(value.title, 'title', 120),
        document,
        config: parseLaunchConfig(value.config),
        source: parseLaunchSource(value.source),
    };
}
function parsePatchBody(value) {
    let document;
    if (typeof value.document !== 'undefined') {
        try {
            document = validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 });
        }
        catch (error) {
            throw new RouteError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'invalid document');
        }
    }
    let archived;
    if (typeof value.archived !== 'undefined') {
        if (value.archived !== true && value.archived !== false)
            throw new RouteError(400, 'INVALID_REQUEST', 'archived must be a boolean');
        archived = value.archived;
    }
    const title = optionalString(value.title, 'title', 120);
    const config = parseLaunchConfig(value.config);
    const expectedRecordVersion = requireExpectedRecordVersion(value);
    if (typeof title === 'undefined' && typeof document === 'undefined' && typeof config === 'undefined' && typeof archived === 'undefined')
        throw new RouteError(400, 'INVALID_REQUEST', 'patch must include an editable field');
    return { title, document, config, archived, expectedRecordVersion };
}
async function dispatch(deps, req, res) {
    const securityError = requestSecurityError(req);
    if (securityError) {
        writeError(res, securityError);
        return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = req.method ?? '';
    if (method === 'GET' && pathname.endsWith('/health')) {
        writeJson(res, 200, { ok: true, value: { plugin: PLUGIN_ROUTE_NAME, version: ROUTES_VERSION, capabilities: resolveCapabilities(deps) } });
        return;
    }
    if (method === 'GET' && pathname.endsWith('/capabilities')) {
        writeJson(res, 200, { ok: true, value: resolveCapabilities(deps) });
        return;
    }
    const revisionMatch = /\/maps\/([^/]+)\/revisions\/([^/]+)$/.exec(pathname);
    if (revisionMatch && method === 'GET') {
        const libraryId = decodeSegment(revisionMatch[1], LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id');
        const revisionId = decodeSegment(revisionMatch[2], REVISION_ID_PATTERN, REVISION_ID_MAX_LENGTH, 'revision id');
        const record = await (deps.loadRecord ?? getMindmap)(libraryId);
        if (!record)
            throw new DomainError('MINDMAP_REVISION_EXPIRED', 'mindmap revision expired');
        assertRecordAccess(deps, record, url.searchParams.get('sessionId'));
        const document = revisionIdOf(record.current) === revisionId ? record.current : record.previous && revisionIdOf(record.previous) === revisionId ? record.previous : null;
        if (!document)
            throw new DomainError('MINDMAP_REVISION_EXPIRED', 'mindmap revision expired');
        writeJson(res, 200, { ok: true, value: { libraryId, revisionId, title: document.title, document, config: record.config } });
        return;
    }
    const restoreMatch = /\/maps\/([^/]+)\/restore-previous$/.exec(pathname);
    if (restoreMatch && method === 'POST') {
        const bodyValue = await readJsonBody(req);
        if (!isRecord(bodyValue))
            throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object');
        requireLiveAgent(deps, bodyValue.sessionId);
        const expectedRecordVersion = requireExpectedRecordVersion(bodyValue);
        const libraryId = decodeSegment(restoreMatch[1], LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id');
        const existing = await loadExisting(deps, libraryId);
        assertRecordAccess(deps, existing, bodyValue.sessionId, true);
        const restored = await (deps.restoreRecord ?? restorePreviousMindmap)(libraryId, { expectedRecordVersion });
        if (!restored)
            throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
        writeJson(res, 200, { ok: true, value: restored });
        return;
    }
    const regenerateMatch = /\/maps\/([^/]+)\/regenerate$/.exec(pathname);
    if (regenerateMatch && method === 'POST') {
        const bodyValue = await readJsonBody(req);
        if (!isRecord(bodyValue))
            throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object');
        requireLiveAgent(deps, bodyValue.sessionId);
        const libraryId = decodeSegment(regenerateMatch[1], LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id');
        const existing = await loadExisting(deps, libraryId);
        assertRecordAccess(deps, existing, bodyValue.sessionId, true);
        const expectedRecordVersion = requireExpectedRecordVersion(bodyValue);
        if (existing.recordVersion !== expectedRecordVersion)
            throw new DomainError('MINDMAP_CONFLICT', 'mindmap conflict');
        if (!deps.startPanelRun)
            throw new DomainError('CAPABILITY_UNAVAILABLE', 'panel regeneration is not wired in this deployment');
        const view = await deps.startPanelRun({
            libraryId,
            sessionId: typeof bodyValue.sessionId === 'string' ? bodyValue.sessionId : '',
            instruction: optionalString(bodyValue.instruction, 'instruction', 4_000),
            supplementalContext: optionalString(bodyValue.supplementalContext, 'supplementalContext', 200_000),
            expectedRecordVersion,
        });
        writeJson(res, 202, { ok: true, value: view });
        return;
    }
    const panelRunMatch = /\/panel-runs\/([^/]+)$/.exec(pathname);
    if (panelRunMatch && (method === 'GET' || method === 'DELETE')) {
        const runId = decodeSegment(panelRunMatch[1], RUN_ID_PATTERN, RUN_ID_MAX_LENGTH, 'run id');
        if (method === 'GET') {
            const view = deps.panelRuns.getViewOrInterrupted(runId);
            if (view.libraryId) {
                const record = await loadExisting(deps, view.libraryId);
                assertRecordAccess(deps, record, url.searchParams.get('sessionId') || view.sessionId, true);
            }
            writeJson(res, 200, { ok: true, value: view });
            return;
        }
        const view = deps.panelRuns.getViewOrInterrupted(runId);
        if (view.libraryId) {
            const record = await loadExisting(deps, view.libraryId);
            assertRecordAccess(deps, record, url.searchParams.get('sessionId') || view.sessionId, true);
        }
        const cancelled = deps.panelRuns.cancel(runId);
        writeJson(res, 200, { ok: true, value: { runId, cancelled } });
        return;
    }
    if (pathname.endsWith('/maps') && method === 'GET') {
        const scope = url.searchParams.get('scope') ?? 'session';
        if (scope !== 'session' && scope !== 'workspace')
            throw new RouteError(400, 'INVALID_REQUEST', 'scope must be session or workspace');
        const archivedParam = url.searchParams.get('archived');
        const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;
        if (archivedParam !== null && archived === undefined)
            throw new RouteError(400, 'INVALID_REQUEST', 'archived must be true or false');
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        if (scope === 'workspace' && !sessionId)
            throw new RouteError(409, 'SESSION_UNAVAILABLE', 'a live session is required for workspace map listing');
        const workspaceId = scope === 'workspace' ? deps.workspaceKeyOfSession?.(sessionId) : undefined;
        if (scope === 'workspace' && !workspaceId)
            throw new RouteError(409, 'SESSION_UNAVAILABLE', 'workspace could not be resolved for this session');
        const records = await (deps.listRecords ?? listMindmaps)({
            ...(workspaceId ? { workspaceId } : {}),
            ...(sessionId ? { sessionId } : {}),
            ...(archived !== undefined ? { archived } : {}),
        });
        writeJson(res, 200, { ok: true, value: records });
        return;
    }
    if (pathname.endsWith('/maps') && method === 'POST') {
        const input = parseCreateBody(await readJsonBody(req));
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        requireLiveAgent(deps, sessionId);
        const workspaceKey = deps.workspaceKeyOfSession?.(sessionId);
        if (!workspaceKey)
            throw new RouteError(409, 'SESSION_UNAVAILABLE', 'workspace could not be resolved for this session');
        const record = await (deps.saveRecord ?? saveMindmap)({
            title: input.title ?? input.document.title,
            document: input.document,
            ...(input.config ? { config: input.config } : {}),
            ...(input.source ? { source: input.source } : {}),
            workspaceKey,
        });
        writeJson(res, 201, { ok: true, value: record });
        return;
    }
    const archiveMatch = /\/maps\/([^/]+)\/archive$/.exec(pathname);
    if (archiveMatch && method === 'POST') {
        const bodyValue = await readJsonBody(req);
        if (!isRecord(bodyValue))
            throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object');
        const sessionId = typeof bodyValue.sessionId === 'string' ? bodyValue.sessionId : url.searchParams.get('sessionId');
        requireLiveAgent(deps, sessionId);
        const libraryId = decodeSegment(archiveMatch[1], LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id');
        const existing = await loadExisting(deps, libraryId);
        assertRecordAccess(deps, existing, sessionId, true);
        const expectedRecordVersion = requireExpectedRecordVersion(bodyValue);
        if (bodyValue.archived !== true && bodyValue.archived !== false)
            throw new RouteError(400, 'INVALID_REQUEST', 'archived must be a boolean');
        const archived = await (deps.patchRecord ?? updateMindmap)(libraryId, { archived: bodyValue.archived, expectedRecordVersion });
        if (!archived)
            throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
        writeJson(res, 200, { ok: true, value: archived });
        return;
    }
    const mapMatch = /\/maps\/([^/]+)$/.exec(pathname);
    if (mapMatch) {
        const id = decodeSegment(mapMatch[1], LIBRARY_ID_PATTERN, LIBRARY_ID_MAX_LENGTH, 'library id');
        if (method === 'GET') {
            const record = await loadExisting(deps, id);
            assertRecordAccess(deps, record, url.searchParams.get('sessionId'));
            writeJson(res, 200, { ok: true, value: record });
            return;
        }
        if (method === 'PATCH') {
            const bodyValue = await readJsonBody(req);
            if (!isRecord(bodyValue))
                throw new RouteError(400, 'INVALID_REQUEST', 'request body must be an object');
            requireLiveAgent(deps, bodyValue.sessionId);
            const existing = await loadExisting(deps, id);
            assertRecordAccess(deps, existing, bodyValue.sessionId, true);
            const patch = parsePatchBody(bodyValue);
            const record = await (deps.patchRecord ?? updateMindmap)(id, {
                title: patch.title,
                document: patch.document,
                config: patch.config,
                archived: patch.archived,
                expectedRecordVersion: patch.expectedRecordVersion,
            });
            if (!record)
                throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
            writeJson(res, 200, { ok: true, value: record });
            return;
        }
        if (method === 'DELETE') {
            const bodyValue = await readJsonBody(req);
            const body = isRecord(bodyValue) ? bodyValue : {};
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : url.searchParams.get('sessionId');
            requireLiveAgent(deps, sessionId);
            const existing = await loadExisting(deps, id);
            assertRecordAccess(deps, existing, sessionId, true);
            const expectedFromQuery = url.searchParams.get('expectedRecordVersion');
            let expectedRecordVersion;
            if (typeof body.expectedRecordVersion === 'number')
                expectedRecordVersion = body.expectedRecordVersion;
            else if (expectedFromQuery !== null && /^[1-9][0-9]*$/.test(expectedFromQuery))
                expectedRecordVersion = Number(expectedFromQuery);
            if (typeof expectedRecordVersion !== 'number' || !Number.isInteger(expectedRecordVersion) || expectedRecordVersion < 1)
                throw new RouteError(400, 'INVALID_REQUEST', 'expectedRecordVersion must be a positive integer');
            const deleted = await (deps.deleteRecord ?? deleteMindmap)(id, { expectedRecordVersion });
            if (!deleted)
                throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
            writeJson(res, 200, { ok: true, value: { deleted: true } });
            return;
        }
    }
    throw new RouteError(404, 'INVALID_REQUEST', 'not found');
}
function resolveCapabilities(deps) {
    return { jobs: false, subagents: false, fork: false, settings: false, toolCard: true, ...(deps.capabilities ?? {}) };
}
/**
 * REST V2 assembly. Integration wires this with one call inside apply();
 * tests drive it against a capturing fake webServer.
 */
export function registerMindmapRoutes(deps) {
    const disposers = [];
    for (const prefix of PLUGIN_ROUTE_PREFIXES) {
        disposers.push(deps.webServer.register({
            kind: 'prefix',
            path: prefix,
            handler: (req, res) => {
                void (async () => {
                    try {
                        await dispatch(deps, req, res);
                    }
                    catch (error) {
                        writeError(res, error, deps.logger);
                    }
                })();
            },
        }));
    }
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
