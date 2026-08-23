import { createHash } from 'node:crypto'
import { DomainError } from './errors.js'

/**
 * Deterministic workspace identity per the technical design §6.2: the Host
 * only exposes an absolute cwd, so the scope key is a normalized, hashed cwd.
 * Normalization is pure — no realpath, no filesystem IO — so deleted
 * workspaces and network drives cannot break scoping.
 */
export function normalizeWorkspaceCwd(cwd: string, platform: NodeJS.Platform = process.platform): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new DomainError('INVALID_REQUEST', 'workspace cwd is required')
  let value = cwd.trim()
  if (platform === 'win32') {
    if (/^\\\\\?\\UNC\\/i.test(value)) value = `\\\\${value.slice(8)}`
    else value = value.replace(/^\\\\\?\\/i, '')
    value = value.replace(/\//g, '\\')
    const unc = value.startsWith('\\\\')
    value = unc ? `\\${value.replace(/\\{2,}/g, '\\')}` : value.replace(/\\{2,}/g, '\\')
    if (!unc && !/^[a-z]:\\/i.test(value)) throw new DomainError('INVALID_REQUEST', 'workspace cwd must be an absolute path')
    if (unc && !/^\\\\[^\\]+\\.*/.test(value)) throw new DomainError('INVALID_REQUEST', 'workspace cwd must be an absolute path')
    if (value.length > 3 && value.endsWith('\\')) value = value.slice(0, -1)
    return value.toLowerCase()
  }
  if (!value.startsWith('/')) throw new DomainError('INVALID_REQUEST', 'workspace cwd must be an absolute path')
  value = `${value.replaceAll(/\/{2,}/g, '/')}`
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value
}

export function workspaceKeyOf(cwd: string, platform: NodeJS.Platform = process.platform): string {
  return createHash('sha256').update(normalizeWorkspaceCwd(cwd, platform), 'utf8').digest('hex').slice(0, 32)
}
