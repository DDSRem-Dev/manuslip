import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { localImagePath } from '@manuslip/renderer/urls'
import { assetLimits } from '../../shared/asset-contracts'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { containsPath, resolveNode } from '../workspace/paths'
import { rasterInfo } from './image'

export type AssetContext = Awaited<ReturnType<FileSessions['assetContext']>>
/** Reads only a captured, canonical file grant. Used by preview and immutable exports. */
export async function readScopedAsset(context: AssetContext, reference: string) {
  const tail = localImagePath(reference)
  if (!tail) throw new FileOperationError('asset-type')
  const resolved = resolve(dirname(context.path), tail)
  if (!containsPath(context.root.path, resolved)) throw new FileOperationError('asset-outside')
  const path = await resolveNode(context.root, resolved, false)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  let bytes: Buffer
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(assetLimits.bytes))
      throw new FileOperationError('asset-large')
    // An externally growing file cannot make readFile allocate unbounded memory.
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let length = 0
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    await resolveNode(context.root, path, false)
    const named = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const current = await named.stat({ bigint: true })
      if (current.dev !== after.dev || current.ino !== after.ino)
        throw new FileOperationError('file-changed')
    } finally {
      await named.close()
    }
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      length !== Number(before.size)
    )
      throw new FileOperationError('file-changed')
    bytes = buffer.subarray(0, length)
  } finally {
    await handle.close()
  }
  const { mime, weight } = rasterInfo(bytes)
  return { path, bytes, mime, weight }
}
