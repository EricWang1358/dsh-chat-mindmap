const pendingTargets = new Map<string, string>()

/** The view id is deliberately stable: it is also the id registered in index.ts. */
export const MINDMAP_VIEW_ID = '@ericwang1358/dsh-chat-mindmap-panel'

/**
 * Switch using the same visible DSH tab that a user clicks. The host does not
 * expose its per-session view action to tool-card registrants, so this avoids
 * reaching into its private store while retaining normal tab behavior.
 */
export function openMindmap(sessionId: string, libraryId: string): boolean {
  pendingTargets.set(sessionId, libraryId)
  const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-selected]'))
    .find((button) => button.textContent?.trim() === '脑图')
  if (!tab) {
    pendingTargets.delete(sessionId)
    return false
  }
  tab.click()
  return true
}

/** Read once when the brainmap view mounts, retaining normal selection otherwise. */
export function consumeMindmapTarget(sessionId: string): string | undefined {
  const target = pendingTargets.get(sessionId)
  pendingTargets.delete(sessionId)
  return target
}
