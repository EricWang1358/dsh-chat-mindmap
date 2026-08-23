import type { MindmapDocument } from '../core.js';
export declare const LEGACY_UNSCOPED_WORKSPACE = "legacy-unscoped";
export interface GenerationPreviewSnapshot {
    revisionId: string;
    document: MindmapDocument;
    generatedAt: string;
}
export declare function isSchemaV2Record(value: unknown): value is Record<string, unknown> & {
    schemaVersion: 2;
};
/**
 * Lazy V1→V2 migration per technical design §6.3. Pure and idempotent: it
 * never touches disk, never mutates its input, and re-migrating an already
 * migrated record yields a deep-equal result. The migrated snapshot counts as
 * generation #1, so legacy maps get a stable chat preview immediately.
 */
export declare function migrateRecordToV2<T extends object>(record: T): T & {
    schemaVersion: 2;
    recordVersion: number;
    previewCurrent: GenerationPreviewSnapshot;
    workspaceKey: string;
};
/**
 * Deterministic workspace identity per the technical design §6.2: the Host
 * only exposes an absolute cwd, so the scope key is a normalized, hashed cwd.
 * Normalization is pure — no realpath, no filesystem IO — so deleted
 * workspaces and network drives cannot break scoping.
 */
export declare function normalizeWorkspaceCwd(cwd: string, platform?: NodeJS.Platform): string;
export declare function workspaceKeyOf(cwd: string, platform?: NodeJS.Platform): string;
export declare function snapshotOf(document: MindmapDocument, generatedAt: string): GenerationPreviewSnapshot;
/**
 * Agent generation commit: rotates current→previous and
 * previewCurrent→previewPrevious in one pure step. Only two generations of
 * each kind survive; the third rotation expires the first revision entirely.
 */
export declare function rotateGenerationSnapshots<T extends {
    current: MindmapDocument;
    previewCurrent: GenerationPreviewSnapshot;
}>(record: T, nextDocument: MindmapDocument, generatedAt: string): T;
/** Manual edits only ever replace `current`; previous and previews stay put. */
export declare function applyManualEdit<T extends {
    current: MindmapDocument;
}>(record: T, nextDocument: MindmapDocument): T;
/** Atomic restore primitive: exchanges current/previous, never the previews. */
export declare function swapCurrentPrevious<T extends {
    current: MindmapDocument;
    previous?: MindmapDocument;
}>(record: T): T;
/** §9.1: pre-allocate a library id without creating any disk record. */
export declare function reserveLibraryId(now?: number, randomHex?: string): string;
