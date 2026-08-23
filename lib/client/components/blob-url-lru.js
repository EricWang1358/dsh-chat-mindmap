/**
 * Module-scoped blob-URL LRU for tool-card thumbnails (S3-W4, R2-2). The LRU
 * owns URL lifecycle: unmounting a card never revokes; capacity pressure,
 * key replacement, and disposeAll do. A pure factory keeps every rule
 * testable without touching browser globals; getBlobUrlLru() lazily wraps
 * the singleton used by production components.
 */
export function createBlobUrlLru(options) {
    const entries = new Map();
    const stats = { created: 0, revoked: 0, evicted: 0 };
    const revokeQuietly = (url) => {
        try {
            options.revoke(url);
            stats.revoked += 1;
        }
        catch {
            // A revoked-twice URL throws in some engines; lifecycle bookkeeping must not break.
        }
    };
    const dropOldest = () => {
        const oldest = entries.keys().next();
        if (oldest.done)
            return;
        const url = entries.get(oldest.value);
        entries.delete(oldest.value);
        if (url !== undefined) {
            revokeQuietly(url);
            stats.evicted += 1;
        }
    };
    return {
        put(key, blob) {
            const existing = entries.get(key);
            if (existing !== undefined) {
                entries.delete(key);
                revokeQuietly(existing);
            }
            const url = options.create(blob);
            stats.created += 1;
            entries.set(key, url);
            while (entries.size > Math.max(1, options.capacity))
                dropOldest();
            return url;
        },
        get(key) {
            const url = entries.get(key);
            if (url === undefined)
                return undefined;
            entries.delete(key);
            entries.set(key, url); // re-insert as most recent: plain has/get never revokes.
            return url;
        },
        has(key) {
            return entries.has(key);
        },
        size() {
            return entries.size;
        },
        disposeAll() {
            for (const url of entries.values())
                revokeQuietly(url);
            entries.clear();
        },
        stats() {
            return { ...stats };
        },
    };
}
let singleton = null;
export function getBlobUrlLru() {
    if (!singleton) {
        singleton = createBlobUrlLru({
            capacity: 8,
            create: (blob) => URL.createObjectURL(blob),
            revoke: (url) => URL.revokeObjectURL(url),
        });
    }
    return singleton;
}
