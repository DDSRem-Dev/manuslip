import { createHash } from 'node:crypto'
import { parseSyncUrl } from '../../shared/sync-contracts'
import { FileOperationError } from '../files/errors'

export type SyncAdapterCode =
  | 'sync-invalid'
  | 'sync-network'
  | 'sync-auth'
  | 'sync-changed'
  | 'sync-validator'
  | 'sync-limit'
  | 'sync-verify'
export class SyncAdapterFailure extends FileOperationError {
  constructor(code: SyncAdapterCode) {
    super(code)
  }
}
export interface RemoteSnapshot {
  bytes: Buffer
  hash: string
  version: string | null
}
export const syncHash = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')
export function webDavUrl(input: string): URL {
  try {
    return parseSyncUrl(input)
  } catch {
    throw new SyncAdapterFailure('sync-invalid')
  }
}
export function strongEntityTag(input: string | null): string | null {
  if (!input || input.length > 512 || !input.startsWith('"') || !input.endsWith('"')) return null
  for (const c of input.slice(1, -1)) {
    const code = c.charCodeAt(0)
    if (code < 33 || code === 34 || code === 127 || code > 255) return null
  }
  return input
}

/** One exact remote resource. Callers own the combined deadline, journal and recovery copies. */
export class WebDavAdapter {
  readonly url: URL
  private readonly authorization: () => string | null
  private readonly maximumBytes: number
  constructor(input: string, authorization: () => string | null, maximumBytes = 50 * 1024 * 1024) {
    this.authorization = authorization
    this.maximumBytes = maximumBytes
    this.url = webDavUrl(input)
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 50 * 1024 * 1024)
      throw new SyncAdapterFailure('sync-invalid')
  }
  private async request(
    method: 'GET' | 'PUT',
    signal: AbortSignal,
    current: () => void,
    conditions: Record<string, string> = {},
    bytes?: Buffer,
  ): Promise<Response> {
    current()
    signal.throwIfAborted()
    const authorization = this.authorization()
    if (authorization && (authorization.length > 8192 || /[\r\n]/.test(authorization)))
      throw new SyncAdapterFailure('sync-invalid')
    let response: Response
    try {
      response = await fetch(this.url, {
        method,
        signal,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          Accept: 'application/octet-stream',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          ...(authorization ? { Authorization: authorization } : {}),
          ...conditions,
          ...(method === 'PUT' ? { 'Content-Type': 'application/octet-stream' } : {}),
        },
        ...(bytes ? { body: new Uint8Array(bytes) } : {}),
      })
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof SyncAdapterFailure) throw error
      throw new SyncAdapterFailure('sync-network')
    }
    try {
      current()
      signal.throwIfAborted()
    } catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
    return response
  }
  private async refused(response: Response): Promise<never> {
    await response.body?.cancel().catch(() => {})
    throw new SyncAdapterFailure(
      response.status === 401 || response.status === 403
        ? 'sync-auth'
        : response.status === 412
          ? 'sync-changed'
          : 'sync-network',
    )
  }
  async read(signal: AbortSignal, current: () => void): Promise<RemoteSnapshot | null> {
    const response = await this.request('GET', signal, current)
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {})
      return null
    }
    if (response.status !== 200) return this.refused(response)
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > this.maximumBytes)) {
      await response.body?.cancel().catch(() => {})
      throw new SyncAdapterFailure('sync-limit')
    }
    const chunks: Buffer[] = [],
      reader = response.body?.getReader()
    let length = 0
    try {
      if (reader)
        while (true) {
          const chunk = await reader.read()
          current()
          signal.throwIfAborted()
          if (chunk.done) break
          length += chunk.value.byteLength
          if (length > this.maximumBytes) throw new SyncAdapterFailure('sync-limit')
          chunks.push(Buffer.from(chunk.value))
        }
      const bytes = Buffer.concat(chunks, length)
      return {
        bytes,
        hash: syncHash(bytes),
        version: strongEntityTag(response.headers.get('etag')),
      }
    } finally {
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
    }
  }
  async write(
    bytes: Buffer,
    expected: RemoteSnapshot | null,
    signal: AbortSignal,
    current: () => void,
  ): Promise<RemoteSnapshot> {
    if (bytes.length > this.maximumBytes) throw new SyncAdapterFailure('sync-limit')
    const version = expected && strongEntityTag(expected.version)
    if (expected && !version) throw new SyncAdapterFailure('sync-validator')
    const response = await this.request(
      'PUT',
      signal,
      current,
      version ? { 'If-Match': version } : { 'If-None-Match': '*' },
      bytes,
    )
    if (![200, 201, 204].includes(response.status)) return this.refused(response)
    await response.body?.cancel().catch(() => {})
    current()
    signal.throwIfAborted()
    const actual = await this.read(signal, current)
    if (!actual || actual.hash !== syncHash(bytes)) throw new SyncAdapterFailure('sync-verify')
    return actual
  }
}
