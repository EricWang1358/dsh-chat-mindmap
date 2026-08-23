/**
 * Module-scoped blob-URL LRU for tool-card thumbnails (S3-W4, R2-2). The LRU
 * owns URL lifecycle: unmounting a card never revokes; capacity pressure,
 * key replacement, and disposeAll do. A pure factory keeps every rule
 * testable without touching browser globals; getBlobUrlLru() lazily wraps
 * the singleton used by production components.
 */
export interface BlobUrlLruStats {
    created: number;
    revoked: number;
    evicted: number;
}
export interface BlobUrlLru {
    put(key: string, blob: Blob): string;
    get(key: string): string | undefined;
    has(key: string): boolean;
    size(): number;
    disposeAll(): void;
    stats(): BlobUrlLruStats;
}
export declare function createBlobUrlLru(options: {
    capacity: number;
    create(blob: Blob): string;
    revoke(url: string): void;
}): BlobUrlLru;
export declare function getBlobUrlLru(): BlobUrlLru;
