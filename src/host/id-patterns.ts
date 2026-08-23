/**
 * Strict identifier whitelists shared by the tool surface (§10) and REST V2
 * routes (§11). Sources are exported so tests can pin cross-module equality;
 * drift away from these constants must fail loudly.
 */
export const LIBRARY_ID_SOURCE = '^map-[0-9a-z]+(-[0-9a-f]{12})?$'
export const REVISION_ID_SOURCE = '^rev-[a-f0-9]{24}$'
export const RUN_ID_SOURCE = '^panel-[0-9a-z-]{8,80}$'

export const LIBRARY_ID_PATTERN = new RegExp(LIBRARY_ID_SOURCE)
export const REVISION_ID_PATTERN = new RegExp(REVISION_ID_SOURCE)
export const RUN_ID_PATTERN = new RegExp(RUN_ID_SOURCE)

/** Maximum accepted lengths; patterns bound shape, these bound size. */
export const LIBRARY_ID_MAX_LENGTH = 100
export const REVISION_ID_MAX_LENGTH = 40
export const RUN_ID_MAX_LENGTH = 96
