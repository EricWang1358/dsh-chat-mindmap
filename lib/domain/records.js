import { createHash } from 'node:crypto';
import { revisionIdOf } from '../revisions.js';
import { DomainError } from './errors.js';
export const LEGACY_UNSCOPED_WORKSPACE = 'legacy-unscoped';
export function isSchemaV2Record(value) {
    return typeof value === 'object' && value !== null && value.schemaVersion === 2;
}
/**
 * Lazy V1→V2 migration per technical design §6.3. Pure and idempotent: it
 * never touches disk, never mutates its input, and re-migrating an already
 * migrated record yields a deep-equal result. The migrated snapshot counts as
 * generation #1, so legacy maps get a stable chat preview immediately.
 */
export function migrateRecordToV2(record) {
    if (isSchemaV2Record(record))
        return record;
    const loose = record;
    const current = loose.current;
    return {
        ...record,
        schemaVersion: 2,
        recordVersion: 1,
        workspaceKey: typeof loose.workspaceKey === 'string' ? loose.workspaceKey : LEGACY_UNSCOPED_WORKSPACE,
        previewCurrent: { revisionId: revisionIdOf(current), document: current, generatedAt: String(loose.updatedAt ?? '') },
    };
}
/**
 * Deterministic workspace identity per the technical design §6.2: the Host
 * only exposes an absolute cwd, so the scope key is a normalized, hashed cwd.
 * Normalization is pure — no realpath, no filesystem IO — so deleted
 * workspaces and network drives cannot break scoping.
 */
export function normalizeWorkspaceCwd(cwd, platform = process.platform) {
    if (typeof cwd !== 'string' || cwd.trim().length === 0)
        throw new DomainError('INVALID_REQUEST', 'workspace cwd is required');
    let value = cwd.trim();
    if (platform === 'win32') {
        if (/^\\\\\?\\UNC\\/i.test(value))
            value = `\\\\${value.slice(8)}`;
        else
            value = value.replace(/^\\\\\?\\/i, '');
        value = value.replace(/\//g, '\\');
        const unc = value.startsWith('\\\\');
        value = unc ? `\\${value.replace(/\\{2,}/g, '\\')}` : value.replace(/\\{2,}/g, '\\');
        if (!unc && !/^[a-z]:\\/i.test(value))
            throw new DomainError('INVALID_REQUEST', 'workspace cwd must be an absolute path');
        if (unc && !/^\\\\[^\\]+\\.*/.test(value))
            throw new DomainError('INVALID_REQUEST', 'workspace cwd must be an absolute path');
        if (value.length > 3 && value.endsWith('\\'))
            value = value.slice(0, -1);
        return value.toLowerCase();
    }
    if (!value.startsWith('/'))
        throw new DomainError('INVALID_REQUEST', 'workspace cwd must be an absolute path');
    value = `${value.replaceAll(/\/{2,}/g, '/')}`;
    return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}
export function workspaceKeyOf(cwd, platform = process.platform) {
    return createHash('sha256').update(normalizeWorkspaceCwd(cwd, platform), 'utf8').digest('hex').slice(0, 32);
}
export function snapshotOf(document, generatedAt) {
    return { revisionId: revisionIdOf(document), document, generatedAt };
}
/**
 * Agent generation commit: rotates current→previous and
 * previewCurrent→previewPrevious in one pure step. Only two generations of
 * each kind survive; the third rotation expires the first revision entirely.
 */
export function rotateGenerationSnapshots(record, nextDocument, generatedAt) {
    return {
        ...record,
        previous: record.current,
        current: nextDocument,
        previewPrevious: record.previewCurrent,
        previewCurrent: snapshotOf(nextDocument, generatedAt),
    };
}
/** Manual edits only ever replace `current`; previous and previews stay put. */
export function applyManualEdit(record, nextDocument) {
    return { ...record, current: nextDocument };
}
/** Atomic restore primitive: exchanges current/previous, never the previews. */
export function swapCurrentPrevious(record) {
    if (!record.previous)
        throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap has no previous version to restore');
    return { ...record, current: record.previous, previous: record.current };
}
