import type { MindmapDocument } from '../core.js';
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
/** ADR-008: compile-time stability policy. Never exposed as a user setting. */
export declare const GENERATION_MAX_TOKENS = 6000;
export declare const OUTLINE_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["title", "outline"];
    readonly properties: {
        readonly title: {
            readonly type: "string";
        };
        readonly outline: {
            readonly type: "string";
        };
    };
};
export declare const OUTLINE_PERSONA = "\u53EA\u628A\u7ED9\u5B9A\u8111\u56FE\u5185\u5BB9\u6574\u7406\u4E3A\u4E25\u683C Markdown \u5C42\u7EA7\u5927\u7EB2\u3002\u4E0D\u5F97\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\u3001\u6280\u80FD\u3001\u5B50\u4EE3\u7406\u6216\u5916\u90E8\u670D\u52A1\uFF1B\u4E0D\u8981\u89E3\u91CA\u8FC7\u7A0B\u3002";
export interface SubagentRunLike {
    id: string;
    result: Promise<{
        stopReason: string;
        structured?: unknown;
        diagnostic?: string;
    }>;
    dispose(): Promise<void>;
}
export interface SubagentRuntimeLike {
    getProvider(name: string): unknown;
    start(name: string, request: Record<string, unknown>): Promise<SubagentRunLike>;
}
/** §8.2 provider ladder: fork → spawn(only with supplemental context) → null. */
export declare function selectProvider(runtime: Pick<SubagentRuntimeLike, 'getProvider'> | undefined, supplementalContext?: string): 'fork' | 'spawn' | null;
export interface OutlineCompleted {
    kind: 'completed';
    document: MindmapDocument;
    title: string;
    truncated: boolean;
    childId: string;
    provider: 'fork' | 'spawn';
}
export interface OutlineFailed {
    kind: 'failed';
    diagnostic: string;
}
export type OutlineResult = OutlineCompleted | OutlineFailed;
/**
 * Runs one subagent outline attempt. Provider selection follows §8.2; the
 * prompt is always composed by buildRegenerationPrompt (P3 single copy); the
 * result must pass the strict outline pipeline (§8.4). Runtime outcome
 * problems are returned as values, never thrown, so callers can map them to
 * terminal run states deterministically.
 */
export declare function runOutlineGeneration(services: {
    runtime: SubagentRuntimeLike;
}, input: {
    record: RegenerationPromptSource;
    instruction?: string;
    supplementalContext?: string;
    parent?: unknown;
    label?: string;
    controller?: AbortController;
}): Promise<OutlineResult>;
