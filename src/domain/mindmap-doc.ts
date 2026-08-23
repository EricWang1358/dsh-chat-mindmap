import type { MindmapDocument, MindmapNode } from '../core.js'

/** S4.5-W1: normalized view model for the export pipeline (§20 Phase 4.5). */

export interface ExportSource {
  kind: string
  name?: string
}

export interface ExportSubItem {
  text: string
}

export interface ExportItem {
  text: string
  note: string
  sourceNodeId: string
  subItems: ExportSubItem[]
  overflowPath?: string
}

export interface ExportGroup {
  title: string
  sourceNodeId: string
  items: ExportItem[]
}

export interface ExportBranch {
  title: string
  sourceNodeId: string
  groups: ExportGroup[]
  /** Direct children of the branch that carry no intermediate group level. */
  inlineItems: ExportItem[]
}

export interface OverflowEntry {
  type: 'height' | 'width'
  path: string
  detail: string
}

export interface ExportDoc {
  title: string
  branches: ExportBranch[]
  overflow: OverflowEntry[]
}

// Thresholds for the data-level overflow heuristic (R2-2). These are static
// estimates, not pixel measurements; the browser print preview is the real gate.
export const WIDTH_OVERFLOW_CHARS = 500
export const HEIGHT_OVERFLOW_CHILDREN = 80

function toExportItem(node: MindmapNode, parentPath: string): ExportItem {
  const path = parentPath + ' > ' + node.title
  const item: ExportItem = { text: node.title, note: typeof node.note === 'string' ? node.note : '', sourceNodeId: node.id, subItems: [] }
  if (node.children && node.children.length > 0) {
    // Depth > 4: flatten remaining children as inline sub-items.
    for (const child of node.children) {
      item.subItems.push({ text: child.title })
      if (child.children && child.children.length > 0) {
        for (const gc of child.children) {
          item.subItems.push({ text: gc.title })
        }
      }
    }
    item.overflowPath = path
  }
  return item
}

// Augment via declaration merging to keep the optional field internal.

function toGroup(node: MindmapNode, parentPath: string): ExportGroup {
  const path = parentPath + ' > ' + node.title
  return {
    title: node.title,
    sourceNodeId: node.id,
    items: (node.children ?? []).map((child) => toExportItem(child, path)),
  }
}

function collectOverflow(branch: ExportBranch): OverflowEntry[] {
  const entries: OverflowEntry[] = []
  let totalItems = branch.inlineItems.length
  for (const g of branch.groups) totalItems += g.items.length
  if (totalItems > HEIGHT_OVERFLOW_CHILDREN) {
    entries.push({ type: 'height', path: branch.title, detail: totalItems + ' items exceed ' + HEIGHT_OVERFLOW_CHILDREN })
  }
  const checkWidth = (item: ExportItem, ctx: string) => {
    if (item.text.length > WIDTH_OVERFLOW_CHARS) {
      entries.push({ type: 'width', path: ctx + ' > ' + item.text.slice(0, 30), detail: item.text.length + ' chars' })
    }
  }
  for (const item of branch.inlineItems) checkWidth(item, branch.title)
  for (const group of branch.groups) {
    for (const item of group.items) checkWidth(item, branch.title + ' > ' + group.title)
  }
  return entries
}

/**
 * Normalize a validated MindmapDocument into the export view model.
 * Throws on structural violations rather than silently truncating (§20 Phase 4.5).
 */
export function normalizeDoc(doc: MindmapDocument): ExportDoc {
  const root = doc.root
  if (!root || typeof root !== 'object') throw new Error('mindmap-doc: root is missing')
  const rootChildren = root.children ?? []
  if (rootChildren.length === 0) throw new Error('mindmap-doc: document has no branches; nothing to export')

  const branches: ExportBranch[] = []
  const overflow: OverflowEntry[] = []

  for (const child of rootChildren) {
    const branchPath = root.title + ' > ' + child.title
    const grandchildren = child.children ?? []
    if (grandchildren.length === 0) {
      // A leaf at depth 1 becomes a single-item branch.
      const b: ExportBranch = {
        title: child.title,
        sourceNodeId: child.id,
        groups: [],
        inlineItems: [{ text: child.title, note: typeof child.note === 'string' ? child.note : '', sourceNodeId: child.id, subItems: [] }],
      }
      overflow.push(...collectOverflow(b))
      branches.push(b)
      continue
    }
    const branch: ExportBranch = { title: child.title, sourceNodeId: child.id, groups: [], inlineItems: [] }
    for (const gc of grandchildren) {
      const hasGreatChildren = (gc.children ?? []).length > 0
      if (hasGreatChildren || gc.children?.some((c) => (c.children ?? []).length > 0)) {
        branch.groups.push(toGroup(gc, branchPath))
      } else {
        branch.inlineItems.push({
          text: gc.title,
          note: typeof gc.note === 'string' ? gc.note : '',
          sourceNodeId: gc.id,
          subItems: [],
        })
      }
    }
    overflow.push(...collectOverflow(branch))
    branches.push(branch)
  }

  return { title: root.title, branches, overflow }
}
