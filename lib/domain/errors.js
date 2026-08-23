export const DOMAIN_ERROR_CODES = [
    'CAPABILITY_UNAVAILABLE',
    'SESSION_UNAVAILABLE',
    'WORKSPACE_SCOPE_MISMATCH',
    'MINDMAP_NOT_FOUND',
    'MINDMAP_BUSY',
    'MINDMAP_CONFLICT',
    'MINDMAP_REVISION_EXPIRED',
    'SOURCE_UNAVAILABLE',
    'GENERATION_TIMEOUT',
    'GENERATION_FAILED',
    'INVALID_AGENT_OUTLINE',
    'INVALID_REQUEST',
    'STORAGE_FAILED',
];
const CODE_SET = new Set(DOMAIN_ERROR_CODES);
export class DomainError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'DomainError';
        this.code = code;
    }
    static isDomainError(value) {
        return value instanceof DomainError && CODE_SET.has(value.code);
    }
}
