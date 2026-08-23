import { buildMindmapFromOutline, countMindmapNodes, validateMindmapDocument } from '../core.js';
import { DomainError } from './errors.js';
const MAX_OUTLINE_TITLE = 120;
const MAX_OUTLINE_CHARS = 200_000;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Strict validation of a subagent outline result per technical design §8.4:
 * bounded non-empty title and outline, plus at least one root heading and one
 * child heading. No transcript-parser fallback exists downstream of this.
 */
export function validateAgentOutlineResult(value) {
    const record = isRecord(value) ? value : {};
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const outline = typeof record.outline === 'string' ? record.outline.trim() : '';
    if (!title)
        throw new DomainError('INVALID_AGENT_OUTLINE', 'agent outline title is required');
    if (title.length > MAX_OUTLINE_TITLE)
        throw new DomainError('INVALID_AGENT_OUTLINE', 'agent outline title exceeds 120 characters');
    if (!outline)
        throw new DomainError('INVALID_AGENT_OUTLINE', 'agent outline is empty');
    if (outline.length > MAX_OUTLINE_CHARS)
        throw new DomainError('INVALID_AGENT_OUTLINE', 'agent outline exceeds 200000 characters');
    const headingCount = outline.split(/\r?\n/).filter((line) => /^\s{0,3}#{1,6}\s+\S/.test(line)).length;
    if (headingCount < 2)
        throw new DomainError('INVALID_AGENT_OUTLINE', 'agent outline needs a root heading and at least one sub heading');
    return { title, outline };
}
/**
 * Upper bound of nodes the parser could produce from this outline; comparing
 * it with the built document detects silent truncation for caller warnings.
 */
function potentialNodeCount(outline) {
    let count = 0;
    let sawRootHeading = false;
    for (const line of outline.split(/\r?\n/)) {
        if (/^\s{0,3}#{1,6}\s+\S/.test(line)) {
            // The first heading becomes the root itself, not an extra node.
            if (!sawRootHeading) {
                sawRootHeading = true;
                count += 1;
                continue;
            }
            count += 1;
        }
        else if (/^\s*[-*+]\s+\S/.test(line))
            count += 1;
    }
    return count;
}
export function buildStrictOutlineDocument(result, options) {
    const { title, outline } = validateAgentOutlineResult(result);
    let document;
    try {
        document = buildMindmapFromOutline(outline, title, options);
    }
    catch (error) {
        throw new DomainError('INVALID_AGENT_OUTLINE', error instanceof Error ? error.message : 'invalid agent outline', { cause: error });
    }
    validateMindmapDocument(document);
    return { document, truncated: countMindmapNodes(document.root) < potentialNodeCount(outline) };
}
