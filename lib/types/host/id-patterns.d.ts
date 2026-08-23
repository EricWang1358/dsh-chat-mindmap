/**
 * Strict identifier whitelists shared by the tool surface (§10) and REST V2
 * routes (§11). Sources are exported so tests can pin cross-module equality;
 * drift away from these constants must fail loudly.
 */
export declare const LIBRARY_ID_SOURCE = "^map-[0-9a-z]+(-[0-9a-f]{12})?$";
export declare const REVISION_ID_SOURCE = "^rev-[a-f0-9]{24}$";
export declare const RUN_ID_SOURCE = "^panel-[0-9a-z-]{8,80}$";
export declare const LIBRARY_ID_PATTERN: RegExp;
export declare const REVISION_ID_PATTERN: RegExp;
export declare const RUN_ID_PATTERN: RegExp;
/** Maximum accepted lengths; patterns bound shape, these bound size. */
export declare const LIBRARY_ID_MAX_LENGTH = 100;
export declare const REVISION_ID_MAX_LENGTH = 40;
export declare const RUN_ID_MAX_LENGTH = 96;
