import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { MindmapDocument, MindmapNode } from './core.js'

export interface MindmapConfig {
  layout: string
  density: 'compact' | 'standard' | 'detailed'
  maxNodes: number
  theme: string
  font: string
  instruction: string
  language: string
  contextLimit: number
}

export interface MindmapSource {
  kind: 'text' | 'pdf' | 'image' | 'document' | 'chat' | 'unknown'
  name?: string
  attachmentId?: string
  sessionId?: string
  workspaceId?: string
  metadata?: Record<string, string>
}

export interface MindmapRecord {
  libraryId: string
  title: string
  current: MindmapDocument
  previous?: MindmapDocument
  config: MindmapConfig
  source?: MindmapSource
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface MindmapSummary {
  libraryId: string
  title: string
  source?: MindmapSource
  config: MindmapConfig
  createdAt: string
  updatedAt: string
  hasPrevious: boolean
  archived: boolean
  nodeCount: number
}

let writeQueue: Promise<void> = Promise.resolve()

const DEFAULT_CONFIG: MindmapConfig = {
  layout: 'logicalStructure',
  density: 'standard',
  maxNodes: 120,
  theme: 'default',
  font: 'system',
  instruction: '',
  language: 'auto',
  contextLimit: 80_000,
}

function rootPath(): string {
  return process.env.DSH_MINDMAP_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'chat-mindmap')
}

function indexPath(): string { return join(rootPath(), 'index.json') }
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('invalid library id')
  return id
}
function mapPath(id: string): string { return join(rootPath(), 'maps', `${safeId(id)}.json`) }

function uid(): string {
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function countNodes(node: MindmapNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0)
}

function normalizeConfig(config?: Partial<MindmapConfig>): MindmapConfig {
  const merged = { ...DEFAULT_CONFIG, ...(config ?? {}) }
  return {
    ...merged,
    maxNodes: Math.max(8, Math.min(2000, Number(merged.maxNodes) || DEFAULT_CONFIG.maxNodes)),
    contextLimit: Math.max(8_000, Math.min(200_000, Number(merged.contextLimit) || DEFAULT_CONFIG.contextLimit)),
    instruction: String(merged.instruction || '').slice(0, 4000),
    language: String(merged.language || 'auto').slice(0, 32),
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, path)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

async function readRecord(id: string): Promise<MindmapRecord | null> {
  try { return JSON.parse(await readFile(mapPath(id), 'utf8')) as MindmapRecord } catch { return null }
}

export async function listMindmaps(filters?: { workspaceId?: string; sessionId?: string; archived?: boolean }): Promise<MindmapSummary[]> {
  const ids = await readJson<string[]>(indexPath(), [])
  const records = await Promise.all(ids.map(readRecord))
  return records.filter((record): record is MindmapRecord => record !== null &&
    (filters?.archived === undefined ? !record.archived : Boolean(record.archived) === filters.archived) &&
    (!filters?.workspaceId || record.source?.workspaceId === filters.workspaceId) &&
    (!filters?.sessionId || record.source?.sessionId === filters.sessionId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((record) => ({
      libraryId: record.libraryId,
      title: record.title,
      source: record.source,
      config: record.config,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      hasPrevious: Boolean(record.previous),
      archived: Boolean(record.archived),
      nodeCount: countNodes(record.current.root),
    }))
}

export async function getMindmap(id: string): Promise<MindmapRecord | null> {
  return readRecord(id)
}

export async function saveMindmap(input: {
  libraryId?: string
  title: string
  document: MindmapDocument
  config?: Partial<MindmapConfig>
  source?: MindmapSource
  archived?: boolean
  rotatePrevious?: boolean
}): Promise<MindmapRecord> {
  const now = new Date().toISOString()
  const id = input.libraryId || uid()
  const existing = await readRecord(id)
  const record: MindmapRecord = {
    libraryId: id,
    title: input.title || input.document.title,
    current: input.document,
    previous: input.rotatePrevious === false ? existing?.previous : existing?.current,
    config: normalizeConfig({ ...existing?.config, ...input.config }),
    source: input.source ?? existing?.source,
    archived: input.archived ?? existing?.archived ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await new Promise<void>((resolve, reject) => {
    const run = writeQueue.catch(() => undefined).then(async () => {
      await atomicJson(mapPath(id), record)
      const ids = await readJson<string[]>(indexPath(), [])
      if (!ids.includes(id)) ids.push(id)
      await atomicJson(indexPath(), ids)
    })
    writeQueue = run
    run.then(resolve, reject)
  })
  return record
}

export async function updateMindmap(id: string, patch: {
  title?: string
  document?: MindmapDocument
  config?: Partial<MindmapConfig>
  archived?: boolean
  rotatePrevious?: boolean
}): Promise<MindmapRecord | null> {
  const existing = await readRecord(id)
  if (!existing) return null
  return saveMindmap({
    libraryId: id,
    title: patch.title ?? existing.title,
    document: patch.document ?? existing.current,
    config: { ...existing.config, ...patch.config },
    source: existing.source,
    archived: patch.archived ?? existing.archived,
    rotatePrevious: patch.rotatePrevious ?? patch.document !== undefined,
  })
}

export async function archiveMindmap(id: string, archived = true): Promise<MindmapRecord | null> {
  return updateMindmap(id, { archived })
}

export async function deleteMindmap(id: string): Promise<boolean> {
  const ids = await readJson<string[]>(indexPath(), [])
  if (!ids.includes(id)) return false
  await atomicJson(indexPath(), ids.filter((value) => value !== id))
  try { await unlink(mapPath(id)) } catch { /* already absent */ }
  return true
}

export { DEFAULT_CONFIG }
