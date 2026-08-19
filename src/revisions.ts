import { createHash } from 'node:crypto'
import type { MindmapDocument } from './core.js'

/**
 * A stable, content-addressed revision id for the immutable preview shown in
 * chat.  The id deliberately excludes record metadata so an autosave does not
 * invalidate a chat preview; a new generated document produces a new id.
 */
export function revisionIdOf(document: MindmapDocument): string {
  const canonical = JSON.stringify(document)
  return `rev-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24)}`
}
