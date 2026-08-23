import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { countMindmapNodes, validateMindmapDocument, type MindmapDocument } from './core.js'
import { isSchemaV2Record, LEGACY_UNSCOPED_WORKSPACE, migrateRecordToV2, snapshotOf, swapCurrentPrevious, type GenerationPreviewSnapshot } from './domain/records.js'
import { DEFAULT_MINDMAP_CONFIG as DEFAULT_CONFIG } from './domain/settings.js'

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
  schemaVersion: 2
  recordVersion: number
  libraryId: string
  title: string
  workspaceKey?: string
  current: MindmapDocument
  previous?: MindmapDocument
  previewCurrent?: GenerationPreviewSnapshot
  previewPrevious?: GenerationPreviewSnapshot
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

export { DEFAULT_MINDMAP_CONFIG as DEFAULT_CONFIG } from './domain/settings.js'
const MAX_TITLE_LENGTH = 120
const MAX_SOURCE_STRING_LENGTH = 500
const MAX_METADATA_ENTRIES = 32
const MAX_METADATA_VALUE_LENGTH = 500
const MAX_MAP_COUNT = 1_000
const MAX_TOTAL_STORAGE_BYTES = 100 * 1024 * 1024
const LIST_CONCURRENCY = 8
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
interface SummaryIndexEntry {
  libraryId: string
  title: string
  source?: MindmapSource
  config: MindmapConfig
  createdAt: string
  updatedAt: string
  hasPrevious: boolean
  archived: boolean
  nodeCount: number
  workspaceKey?: string
}


function summaryPath(): string { return join(rootPath(), 'summaries.json') }

async function readSummaryIndex(): Promise<SummaryIndexEntry[]> {
  const value = await readJson<unknown>(summaryPath(), [])
  if (!Array.isArray(value)) throw new Error(`invalid mindmap summary index in ${summaryPath()}`)
  return value.filter(isRecord).map((item) => item as unknown as SummaryIndexEntry).filter((item) => typeof item.libraryId === 'string' && safeId(item.libraryId))
}

async function writeSummaryIndex(entries: SummaryIndexEntry[]): Promise<void> {
  await atomicJson(summaryPath(), entries)
}

function summaryOf(record: MindmapRecord): SummaryIndexEntry {
  return {
    libraryId: record.libraryId,
    title: record.title,
    source: record.source,
    config: record.config,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    hasPrevious: Boolean(record.previous),
    archived: Boolean(record.archived),
    nodeCount: countMindmapNodes(record.current.root),
    ...(record.workspaceKey ? { workspaceKey: record.workspaceKey } : {}),
  }
}

async function ensureStorageBudget(id: string, nextBytes: number): Promise<void> {
  const ids = await readIndex()
  if (!ids.includes(id) && ids.length >= MAX_MAP_COUNT) throw new Error(`mindmap library limit reached (${MAX_MAP_COUNT} maps)`)
  let total = ids.includes(id) ? 0 : nextBytes
  for (const currentId of ids) {
    if (currentId === id) total += nextBytes
    else total += await stat(mapPath(currentId)).then((value) => value.size).catch(() => 0)
    if (total > MAX_TOTAL_STORAGE_BYTES) throw new Error(`mindmap storage limit reached (${MAX_TOTAL_STORAGE_BYTES} bytes)`)
  }
  if (!ids.includes(id) && total === 0 && nextBytes > MAX_TOTAL_STORAGE_BYTES) throw new Error('mindmap record exceeds storage limit')
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

function normalizeSnapshot(value: unknown): GenerationPreviewSnapshot | undefined {
  if (!isRecord(value) || typeof value.revisionId !== 'string' || typeof value.generatedAt !== 'string') return undefined
  try {
    return { revisionId: value.revisionId, document: validateMindmapDocument(value.document, { maxNodes: 2_000, maxDepth: 32 }), generatedAt: value.generatedAt }
  } catch {
    return undefined
  }
}

function validateMindmapRecord(value: unknown, expectedId: string, path: string): MindmapRecord {
  if (!isRecord(value) || value.libraryId !== expectedId || typeof value.title !== 'string' || value.title.length > MAX_TITLE_LENGTH ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || typeof value.archived !== 'boolean' && typeof value.archived !== 'undefined') {
    throw new Error(`invalid mindmap record in ${path}`)
  }
  const current = validateMindmapDocument(value.current, { maxNodes: 2_000, maxDepth: 32 })
  const previous = typeof value.previous === 'undefined' ? undefined : validateMindmapDocument(value.previous, { maxNodes: 2_000, maxDepth: 32 })
  const config = normalizeConfig(value.config)
  // Only records persisted as V2 keep their stored snapshots here; genuine V1
  // files must fall through to lazy migration so previews are synthesized.
  const wasPersistedAsV2 = isSchemaV2Record(value)
  const record = {
    libraryId: expectedId,
    title: value.title,
    current,
    ...(previous ? { previous } : {}),
    config,
    ...(value.source ? { source: normalizeSource(value.source) } : {}),
    ...(value.archived ? { archived: true } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  } as unknown as MindmapRecord
  const rawRecordVersion = value.recordVersion
  record.recordVersion = typeof rawRecordVersion === 'number' && Number.isInteger(rawRecordVersion) && rawRecordVersion > 0 ? rawRecordVersion : 1
  record.workspaceKey = typeof value.workspaceKey === 'string' && value.workspaceKey.length > 0 ? value.workspaceKey.slice(0, 64) : LEGACY_UNSCOPED_WORKSPACE
  if (wasPersistedAsV2) {
    record.schemaVersion = 2
    const previewCurrent = normalizeSnapshot(value.previewCurrent)
    if (previewCurrent) record.previewCurrent = previewCurrent
    const previewPrevious = normalizeSnapshot(value.previewPrevious)
    if (previewPrevious) record.previewPrevious = previewPrevious
  }
  return migrateRecordToV2(record)
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

async function persistMindmapRecord(record: MindmapRecord): Promise<void> {
  const serialized = JSON.stringify(record)
  await ensureStorageBudget(record.libraryId, Buffer.byteLength(serialized, 'utf8'))
  await atomicJson(mapPath(record.libraryId), record)
  const ids = await readIndex()
  if (!ids.includes(record.libraryId)) ids.push(record.libraryId)
  await atomicJson(indexPath(), ids)
  const summaries = (await readSummaryIndex()).filter((entry) => entry.libraryId !== record.libraryId)
  summaries.push(summaryOf(record))
  await writeSummaryIndex(summaries)
}

export async function listMindmaps(filters?: { workspaceId?: string; sessionId?: string; archived?: boolean }): Promise<MindmapSummary[]> {
  const sourceMatches = (summary: SummaryIndexEntry) => summaryMatches(summary, filters)
  const ids = await readIndex()
  const summaries = await readSummaryIndex()
  // The summary index is a derived cache. Records present in the main index
  // but missing from the cache (legacy fixtures, interrupted writes) trigger a
  // full rebuild instead of silently staying invisible.
  const known = new Set(summaries.map((entry) => entry.libraryId))
  if (!ids.some((id) => !known.has(id))) return summaries.filter(sourceMatches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const records: MindmapRecord[] = []
  for (let offset = 0; offset < ids.length; offset += LIST_CONCURRENCY) {
    const batch = await Promise.all(ids.slice(offset, offset + LIST_CONCURRENCY).map(readRecord))
    records.push(...batch.filter((record): record is MindmapRecord => record !== null))
  }
  const next = records.map(summaryOf)
  await writeSummaryIndex(next)
  return next.filter(sourceMatches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function summaryMatches(summary: SummaryIndexEntry, filters?: { workspaceId?: string; sessionId?: string; archived?: boolean }): boolean {
  return (filters?.archived === undefined ? !summary.archived : summary.archived === filters.archived) &&
    (!filters?.workspaceId || summary.source?.workspaceId === filters.workspaceId) &&
    (!filters?.sessionId || summary.source?.sessionId === filters.sessionId)
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
  expectedUpdatedAt?: string
  expectedRecordVersion?: number
}): Promise<MindmapRecord> {
  return enqueueWrite(async () => {
    const id = input.libraryId ? safeId(input.libraryId) : uid()
    const existing = await readRecord(id)
    // Optimistic concurrency: when a record version is supplied it alone
    // decides (it is the stricter, generation-aware token); the legacy
    // updatedAt token only applies when no version was provided.
    if (typeof input.expectedRecordVersion === 'number') {
      if (!existing || existing.recordVersion !== input.expectedRecordVersion) throw new Error('mindmap conflict')
    } else if (input.expectedUpdatedAt && existing?.updatedAt !== input.expectedUpdatedAt) throw new Error('mindmap conflict')
    const config = normalizeConfig({ ...existing?.config, ...input.config })
    const document = validateMindmapDocument(input.document, { maxNodes: config.maxNodes, maxDepth: 32 })
    const now = new Date().toISOString()
    // Generation commits rotate by default; explicit rotatePrevious:false is a
    // manual-edit commit and keeps previous plus both preview generations.
    const rotating = input.rotatePrevious !== false
    const previous = existing ? (rotating ? existing.current : existing.previous) : undefined
    const previewPrevious = existing ? (rotating ? existing.previewCurrent : existing.previewPrevious) : undefined
    const previewCurrent = existing && !rotating && existing.previewCurrent ? existing.previewCurrent : snapshotOf(document, now)
    const record: MindmapRecord = {
      schemaVersion: 2,
      recordVersion: existing?.recordVersion ?? 0,
      libraryId: id,
      title: boundedString(input.title || document.title, document.title, MAX_TITLE_LENGTH),
      workspaceKey: existing?.workspaceKey ?? LEGACY_UNSCOPED_WORKSPACE,
      current: document,
      ...(previous ? { previous } : {}),
      previewCurrent,
      ...(previewPrevious ? { previewPrevious } : {}),
      config,
      source: normalizeSource(input.source) ?? existing?.source,
      archived: input.archived ?? existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    record.recordVersion += 1
    if (!record.recordVersion || record.recordVersion < 1) record.recordVersion = 1
    await persistMindmapRecord(record)
    return record
  })
}

export async function updateMindmap(id: string, patch: {
  title?: string
  document?: MindmapDocument
  config?: Partial<MindmapConfig>
  archived?: boolean
  rotatePrevious?: boolean
  expectedRecordVersion?: number
}): Promise<MindmapRecord | null> {
  return enqueueWrite(async () => {
    const safeLibraryId = safeId(id)
    const existing = await readRecord(safeLibraryId)
    if (!existing) return null
    if (typeof patch.expectedRecordVersion === 'number' && existing.recordVersion !== patch.expectedRecordVersion) throw new Error('mindmap conflict')
    const config = normalizeConfig({ ...existing.config, ...patch.config })
    const document = patch.document ? validateMindmapDocument(patch.document, { maxNodes: config.maxNodes, maxDepth: 32 }) : existing.current
    const now = new Date().toISOString()
    // Product constraint: manual edits only update `current`. Rotation of
    // previous/previews happens exclusively on explicit generation commits.
    const rotating = patch.rotatePrevious === true && Boolean(patch.document)
    const previous = rotating ? existing.current : existing.previous
    const previewCurrent = rotating ? snapshotOf(document, now) : existing.previewCurrent
    const previewPrevious = rotating ? existing.previewCurrent : existing.previewPrevious
    const record: MindmapRecord = {
      schemaVersion: 2,
      recordVersion: existing.recordVersion + 1,
      libraryId: existing.libraryId,
      title: boundedString(patch.title ?? existing.title, existing.title, MAX_TITLE_LENGTH),
      workspaceKey: existing.workspaceKey ?? LEGACY_UNSCOPED_WORKSPACE,
      current: document,
      ...(previous ? { previous } : {}),
      previewCurrent,
      ...(previewPrevious ? { previewPrevious } : {}),
      config,
      source: existing.source,
      archived: patch.archived ?? existing.archived ?? false,
      createdAt: existing.createdAt,
      updatedAt: now,
    }
    await persistMindmapRecord(record)
    return record
  })
}

export async function restorePreviousMindmap(id: string, options?: { expectedRecordVersion?: number }): Promise<MindmapRecord | null> {
  return enqueueWrite(async () => {
    const safeLibraryId = safeId(id)
    const existing = await readRecord(safeLibraryId)
    if (!existing) return null
    if (typeof options?.expectedRecordVersion === 'number' && existing.recordVersion !== options.expectedRecordVersion) throw new Error('mindmap conflict')
    const swapped = swapCurrentPrevious(existing)
    swapped.recordVersion = existing.recordVersion + 1
    swapped.updatedAt = new Date().toISOString()
    await persistMindmapRecord(swapped)
    return swapped
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
    const summaries = (await readSummaryIndex()).filter((entry) => entry.libraryId !== safeLibraryId)
    await writeSummaryIndex(summaries)
    return true
  })
}
