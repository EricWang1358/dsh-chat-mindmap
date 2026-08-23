import type { MindmapDocument } from './core.js';
/**
 * A stable, content-addressed revision id for the immutable preview shown in
 * chat.  The id deliberately excludes record metadata so an autosave does not
 * invalidate a chat preview; a new generated document produces a new id.
 */
export declare function revisionIdOf(document: MindmapDocument): string;
