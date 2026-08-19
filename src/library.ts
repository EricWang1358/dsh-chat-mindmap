import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { countMindmapNodes, validateMindmapDocument, type MindmapDocument } from './core.js'

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

export const DEFAULT_CONFIG: MindmapConfig = {
  layout: 'logicalStructure',
  density: 'standard',
  maxNodes: 360,
  theme: 'default',
  font: 'system',
  instruction: '',
  language: 'auto',
  contextLimit: 80_000,
}

const MAX_TITLE_LENGTH = 120
const MAX_SOURCE_STRING_LENGTH = 500
const MAX_METADATA_ENTRIES = 32
const MAX_METADATA_VALUE_LENGTH = 500

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
  return `map-${Date.now().toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback
}

function normalizeConfig(config?: Partial<MindmapConfig> | unknown): MindmapConfig {
  const input = isRecord(config) ? config : {}
  const density = input.density === 'compact' || input.density === 'detailed' ? input.density : DEFAULT_CONFIG.density
  const numeric = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback
  }
  return {
    layout: boundedString(input.layout, DEFAULT_CONFIG.layout, 80),
    density,
    maxNodes: numeric(input.maxNodes, DEFAULT_CONFIG.maxNodes, 8, 2_000),
    theme: boundedString(input.theme, DEFAULT_CONFIG.theme, 80),
    font: boundedString(input.font, DEFAULT_CONFIG.font, 80),
    instruction: boundedString(input.instruction, DEFAULT_CONFIG.instruction, 4_000),
    language: boundedString(input.language, DEFAULT_CONFIG.language, 32),
    contextLimit: numeric(input.contextLimit, DEFAULT_CONFIG.contextLimit, 8_000, 200_000),
  }
}

function normalizeSource(source: unknown): MindmapSource | undefined {
  if (!isRecord(source) || typeof source.kind !== 'string') return undefined
  const allowedKinds = new Set(['text', 'pdf', 'image', 'document', 'chat', 'unknown'])
  const kind = allowedKinds.has(source.kind) ? source.kind as MindmapSource['kind'] : 'unknown'
  const result: MindmapSource = { kind }
  for (const key of ['name', 'attachmentId', 'sessionId', 'workspaceId'] as const) {
    if (typeof source[key] === 'string' && source[key].length > 0) result[key] = source[key].slice(0, MAX_SOURCE_STRING_LENGTH)
  }
  if (isRecord(source.metadata)) {
    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(source.metadata).slice(0, MAX_METADATA_ENTRIES)) {
      if (typeof value === 'string') metadata[key.slice(0, 100)] = value.slice(0, MAX_METADATA_VALUE_LENGTH)
    }
    if (Object.keys(metadata).length) result.metadata = metadata
  }
  return result
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return fallback
    throw error
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`invalid JSON in ${path}`)
  }
}

async function readRecord(id: string): Promise<MindmapRecord | null> {
  const path = mapPath(id)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`invalid JSON in ${path}`)
  }
  return validateMindmapRecord(value, id, path)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function validateMindmapRecord(value: unknown, expectedId: string, path: string): MindmapRecord {
  if (!isRecord(value) || value.libraryId !== expectedId || typeof value.title !== 'string' || value.title.length > MAX_TITLE_LENGTH ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || typeof value.archived !== 'boolean' && typeof value.archived !== 'undefined') {
    throw new Error(`invalid mindmap record in ${path}`)
  }
  const current = validateMindmapDocument(value.current, { maxNodes: 2_000, maxDepth: 32 })
  const previous = typeof value.previous === 'undefined' ? undefined : validateMindmapDocument(value.previous, { maxNodes: 2_000, maxDepth: 32 })
  const record: MindmapRecord = {
    libraryId: expectedId,
    title: value.title,
    current,
    ...(previous ? { previous } : {}),
    config: normalizeConfig(value.config),
    ...(value.source ? { source: normalizeSource(value.source) } : {}),
    ...(value.archived ? { archived: true } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  return record
}

async function readIndex(): Promise<string[]> {
  const ids = await readJson<unknown>(indexPath(), [])
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error(`invalid mindmap index in ${indexPath()}`)
  return ids.map((id) => safeId(id))
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = writeQueue.catch(() => undefined).then(operation)
  writeQueue = run.then(() => undefined, () => undefined)
  return run
}

export async function listMindmaps(filters?: { workspaceId?: string; sessionId?: string; archived?: boolean }): Promise<MindmapSummary[]> {
  const ids = await readIndex()
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
      nodeCount: countMindmapNodes(record.current.root),
    }))
}

export async function getMindmap(id: string): Promise<MindmapRecord | null> {
  return readRecord(safeId(id))
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
  return enqueueWrite(async () => {
    const id = input.libraryId ? safeId(input.libraryId) : uid()
    const existing = await readRecord(id)
    const config = normalizeConfig({ ...existing?.config, ...input.config })
    const document = validateMindmapDocument(input.document, { maxNodes: config.maxNodes, maxDepth: 32 })
    const now = new Date().toISOString()
    const record: MindmapRecord = {
      libraryId: id,
      title: boundedString(input.title || document.title, document.title, MAX_TITLE_LENGTH),
      current: document,
      previous: input.rotatePrevious === false ? existing?.previous : existing?.current,
      config,
      source: normalizeSource(input.source) ?? existing?.source,
      archived: input.archived ?? existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await atomicJson(mapPath(id), record)
    const ids = await readIndex()
    if (!ids.includes(id)) ids.push(id)
    await atomicJson(indexPath(), ids)
    return record
  })
}

export async function updateMindmap(id: string, patch: {
  title?: string
  document?: MindmapDocument
  config?: Partial<MindmapConfig>
  archived?: boolean
  rotatePrevious?: boolean
}): Promise<MindmapRecord | null> {
  return enqueueWrite(async () => {
    const safeLibraryId = safeId(id)
    const existing = await readRecord(safeLibraryId)
    if (!existing) return null
    const config = normalizeConfig({ ...existing.config, ...patch.config })
    const document = patch.document ? validateMindmapDocument(patch.document, { maxNodes: config.maxNodes, maxDepth: 32 }) : existing.current
    const now = new Date().toISOString()
    const record: MindmapRecord = {
      ...existing,
      title: boundedString(patch.title ?? existing.title, existing.title, MAX_TITLE_LENGTH),
      current: document,
      previous: patch.rotatePrevious === false ? existing.previous : patch.document ? existing.current : existing.previous,
      config,
      archived: patch.archived ?? existing.archived ?? false,
      updatedAt: now,
    }
    await atomicJson(mapPath(safeLibraryId), record)
    const ids = await readIndex()
    if (!ids.includes(safeLibraryId)) ids.push(safeLibraryId)
    await atomicJson(indexPath(), ids)
    return record
  })
}

export async function archiveMindmap(id: string, archived = true): Promise<MindmapRecord | null> {
  return updateMindmap(id, { archived })
}

export async function deleteMindmap(id: string): Promise<boolean> {
  return enqueueWrite(async () => {
    const safeLibraryId = safeId(id)
    const ids = await readIndex()
    if (!ids.includes(safeLibraryId)) return false
    await atomicJson(indexPath(), ids.filter((value) => value !== safeLibraryId))
    try {
      await unlink(mapPath(safeLibraryId))
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    }
    return true
  })
}
