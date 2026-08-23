/**
 * Pure state resolution for the mindmap tool card (S3-W4). Priority order:
 * expired > failed > loading > ready. No React, no DOM, no I/O — directly
 * unit-testable and reused by the static render assertions in card.test.mjs.
 */
export type CardReference = {
    libraryId: string;
    revisionId: string;
    title: string;
    nodeCount: number;
    state: 'available' | 'expired';
    capabilityNote?: string;
};
export type CardState = {
    kind: 'expired' | 'failed' | 'loading' | 'ready';
    note?: string;
};
export declare const CARD_MISSING_NOTE = "\u8111\u56FE\u9884\u89C8\u6570\u636E\u4E0D\u53EF\u7528";
export declare const CARD_EXPIRED_NOTE = "\u672C\u56FE\u5DF2\u5931\u6548";
export declare function cardStateOf(reference: CardReference | null | undefined, url: string | null | undefined, error: string | null | undefined): CardState;
