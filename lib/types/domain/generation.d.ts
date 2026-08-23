import { type MindmapBuildOptions, type MindmapDocument } from '../core.js';
export interface AgentOutlineResult {
    title: string;
    outline: string;
}
/**
 * Strict validation of a subagent outline result per technical design §8.4:
 * bounded non-empty title and outline, plus at least one root heading and one
 * child heading. No transcript-parser fallback exists downstream of this.
 */
export declare function validateAgentOutlineResult(value: unknown): AgentOutlineResult;
export declare function buildStrictOutlineDocument(result: unknown, options?: MindmapBuildOptions): {
    document: MindmapDocument;
    truncated: boolean;
};
