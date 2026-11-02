import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { record } from '../../shared/file-contracts'
import { pandocLimits } from '../../shared/pandoc-contracts'
import { FileOperationError } from '../files/errors'

export interface PandocTool {
  path: string
  fingerprint: string
  version: string
}
export function parsePandocTool(input: unknown): PandocTool | null {
  if (input === null) return null
  const value = record(input)
  if (
    Object.keys(value).length !== 3 ||
    typeof value.path !== 'string' ||
    value.path.length > 32768 ||
    !isAbsolute(value.path) ||
    [...value.path].some((character) => character.charCodeAt(0) < 32) ||
    basename(value.path).length > 256 ||
    typeof value.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    typeof value.version !== 'string' ||
    !/^3\.\d+(?:\.\d+){0,2}$/.test(value.version)
  )
    throw new FileOperationError('pandoc-tool')
  return { path: value.path, fingerprint: value.fingerprint, version: value.version }
}
/** Stream the executable; do not retain a second full binary in main memory. */
export async function inspectPandocBinary(
  selected: string,
  signal: AbortSignal,
): Promise<{ path: string; fingerprint: string }> {
  signal.throwIfAborted()
  if (
    !isAbsolute(selected) ||
    selected.length > 32768 ||
    (process.platform === 'win32' && extname(selected).toLowerCase() !== '.exe')
  )
    throw new FileOperationError('pandoc-tool')
  try {
    const path = await realpath(selected)
    signal.throwIfAborted()
    const handle = await open(path, 'r')
    try {
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || before.size <= 0n || before.size > BigInt(pandocLimits.executable))
        throw new FileOperationError('pandoc-tool')
      const digest = createHash('sha256'),
        buffer = Buffer.allocUnsafe(64 * 1024)
      let total = 0
      for (;;) {
        signal.throwIfAborted()
        const { bytesRead } = await handle.read(buffer, 0, buffer.length)
        if (!bytesRead) break
        total += bytesRead
        if (total > pandocLimits.executable) throw new FileOperationError('pandoc-tool')
        digest.update(buffer.subarray(0, bytesRead))
      }
      const after = await handle.stat({ bigint: true })
      if (
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        BigInt(total) !== after.size
      )
        throw new FileOperationError('pandoc-changed')
      signal.throwIfAborted()
      const fingerprint = createHash('sha256')
        .update(
          [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs, after.mode].join(':'),
        )
        .update(digest.digest())
        .digest('hex')
      return { path, fingerprint }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason
    throw error instanceof FileOperationError ? error : new FileOperationError('pandoc-tool')
  }
}
export async function assertPandocTool(tool: PandocTool, signal: AbortSignal): Promise<void> {
  try {
    const current = await inspectPandocBinary(tool.path, signal)
    if (current.path !== tool.path || current.fingerprint !== tool.fingerprint)
      throw new FileOperationError('pandoc-changed')
  } catch (error) {
    if (signal.aborted) throw signal.reason
    throw error instanceof FileOperationError && error.code === 'pandoc-changed'
      ? error
      : new FileOperationError('pandoc-changed')
  }
}
