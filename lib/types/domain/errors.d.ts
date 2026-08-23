export declare const DOMAIN_ERROR_CODES: readonly ["CAPABILITY_UNAVAILABLE", "SESSION_UNAVAILABLE", "WORKSPACE_SCOPE_MISMATCH", "MINDMAP_NOT_FOUND", "MINDMAP_BUSY", "MINDMAP_CONFLICT", "MINDMAP_REVISION_EXPIRED", "SOURCE_UNAVAILABLE", "GENERATION_TIMEOUT", "GENERATION_FAILED", "INVALID_AGENT_OUTLINE", "INVALID_REQUEST", "STORAGE_FAILED"];
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];
export declare class DomainError extends Error {
    readonly code: DomainErrorCode;
    constructor(code: DomainErrorCode, message: string, options?: {
        cause?: unknown;
    });
    static isDomainError(value: unknown): value is DomainError;
}
