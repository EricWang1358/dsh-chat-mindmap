// S4-W2: REST access over the canonical v5 surface.
const API_BASE = '/@ericwang1358/dsh-chat-mindmap'

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

type ApiPayload<T> = { ok?: boolean; value?: T; error?: { code?: string; message?: string } | string }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, { ...init, headers: { 'x-dsh-chat-mindmap-request': '1', ...(init?.headers ?? {}) } })
  const payload = await response.json() as ApiPayload<T>
  if (!response.ok || !payload.ok || payload.value === undefined) {
    const raw = payload.error
    const code = typeof raw === 'object' && raw !== null && typeof raw.code === 'string' ? raw.code : 'INVALID_REQUEST'
    const message = typeof raw === 'object' && raw !== null && typeof raw.message === 'string' ? raw.message : typeof raw === 'string' ? raw : '脑图服务请求失败'
    throw new ApiError(response.status, code, message)
  }
  return payload.value
}

/** §13.1: session-first list scope; workspace is the explicit second tier. */
export function listQueryOf(scope: 'session' | 'workspace', sessionId: string | undefined, archived?: boolean): string {
  const params = new URLSearchParams()
  params.set('scope', scope === 'workspace' ? 'workspace' : 'session')
  if (sessionId) params.set('sessionId', sessionId)
  if (archived !== undefined) params.set('archived', archived ? 'true' : 'false')
  return '/maps?' + params.toString()
}