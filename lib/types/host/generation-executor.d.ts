import type { MindmapRecord } from '../library.js';
/**
 * Canonical regeneration prompt composition (P3 adjudication,
 * docs/plans/S2_DESIGN_DELTA_REVIEW.md). This module is the single normative
 * copy; the frozen legacy duplicate in src/index.ts must be switched over and
 * deleted during the integration phase. The output format is pinned byte for
 * byte by the HTTP golden assertion in tests/index.test.mjs.
 */
export type RegenerationPromptSource = Pick<MindmapRecord, 'title' | 'current' | 'config'>;
export declare function buildRegenerationPrompt(record: RegenerationPromptSource | null | undefined, instruction?: string): {
    text: string;
    noteLength: number;
};
