import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, lstat, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { documentLimit } from '../../shared/file-contracts'
import { FileOperationError, fileError } from './errors'

const executeFile = promisify(execFile)
export interface DiskSnapshot {
  bytes: Buffer
  fingerprint: string
  identity: string
  links: bigint
}

export async function readDisk(path: string, maximumBytes = documentLimit): Promise<DiskSnapshot> {
  const handle = await open(path, 'r')
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw new FileOperationError('file-io')
    if (before.size > BigInt(maximumBytes)) throw new FileOperationError('file-large')
    const chunks: Buffer[] = []
    let length = 0
    while (length <= maximumBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - length))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length)
      if (!bytesRead) break
      length += bytesRead
      if (length > maximumBytes) throw new FileOperationError('file-large')
      chunks.push(chunk.subarray(0, bytesRead))
    }
    const after = await handle.stat({ bigint: true })
    if (
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.size !== after.size
    )
      throw new FileOperationError('file-changed')
    const bytes = Buffer.concat(chunks, length)
    const identity = `${after.dev}:${after.ino}`
    const metadata = [
      identity,
      after.size,
      after.mtimeNs,
      after.ctimeNs,
      after.mode,
      after.uid,
      after.gid,
      after.nlink,
    ].join(':')
    return {
      bytes,
      identity,
      links: after.nlink,
      fingerprint: createHash('sha256').update(metadata).update(bytes).digest('hex'),
    }
  } finally {
    await handle.close()
  }
}

export async function maybeDisk(
  path: string,
  maximumBytes = documentLimit,
): Promise<DiskSnapshot | null> {
  try {
    return await readDisk(path, maximumBytes)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
}

// Clone metadata before writing the new content. All process arguments come from
// main-owned dialog paths; no shell is used and no document text enters a command.
async function copyWithMetadata(source: string, target: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await copyFile(source, target)
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "Import-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force",
        '$acl = Get-Acl -LiteralPath $env:MANUSLIP_ACL_SOURCE',
        // Avoid rewriting an identical inherited descriptor: Set-Acl can add the AI
        // control flag even when no access rules change, breaking exact preservation.
        'if ((Get-Acl -LiteralPath $env:MANUSLIP_ACL_TARGET).Sddl -ne $acl.Sddl) { Set-Acl -LiteralPath $env:MANUSLIP_ACL_TARGET -AclObject $acl }',
        'if ((Get-Acl -LiteralPath $env:MANUSLIP_ACL_TARGET).Sddl -ne $acl.Sddl) { throw "Metadata differs" }',
      ].join('\n')
      await executeFile(
        join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 64 * 1024,
          env: {
            ...process.env,
            PSModulePath: join(
              process.env.SystemRoot || 'C:\\Windows',
              'System32/WindowsPowerShell/v1.0/Modules',
            ),
            MANUSLIP_ACL_SOURCE: source,
            MANUSLIP_ACL_TARGET: target,
          },
        },
      )
    } else {
      const args =
        process.platform === 'darwin'
          ? ['-p', source, target]
          : ['--preserve=mode,ownership,timestamps,xattr', '--reflink=auto', '--', source, target]
      await executeFile('/bin/cp', args, { timeout: 5000, maxBuffer: 64 * 1024 })
    }
  } catch (error) {
    throw new FileOperationError('file-metadata', { cause: error })
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export interface WriteHooks {
  maximumBytes?: number
  beforeWrite?: () => Promise<void>
  beforeReplace?: () => Promise<void>
  beforeCommit?: () => void
  replace?: typeof rename
}

export async function atomicWrite(
  path: string,
  bytes: Buffer,
  expected: string | null,
  hooks: WriteHooks = {},
): Promise<DiskSnapshot> {
  const maximumBytes = hooks.maximumBytes ?? documentLimit
  if (bytes.byteLength > maximumBytes) throw new FileOperationError('file-large')
  // Keep the sibling name bounded even when the destination is near a path/name limit.
  const temporary = join(dirname(path), `.manuslip-${randomUUID()}.tmp`)
  const check = async (): Promise<void> => {
    const current = await maybeDisk(path, maximumBytes)
    if ((current?.fingerprint || null) !== expected) throw new FileOperationError('file-changed')
    if (current && ((await lstat(path)).isSymbolicLink() || current.links > 1n))
      throw new FileOperationError('file-metadata')
  }
  try {
    await check()
    const reservation = await open(temporary, 'wx', 0o600)
    await reservation.close()
    if (expected) await copyWithMetadata(path, temporary)
    await hooks.beforeWrite?.()
    const handle = await open(temporary, constants.O_RDWR | (constants.O_NOFOLLOW || 0))
    try {
      await handle.writeFile(bytes)
      await handle.truncate(bytes.length)
      await handle.sync()
    } finally {
      await handle.close()
    }
    const retries = [0, 50, 150, 400]
    for (let attempt = 0; attempt < retries.length; attempt++) {
      if (retries[attempt]) await delay(retries[attempt])
      await hooks.beforeReplace?.()
      await check()
      hooks.beforeCommit?.()
      try {
        if (expected === null) {
          // Atomic, exclusive publication: a file created since the dialog must survive.
          await link(temporary, path)
          await rm(temporary)
        } else {
          await (hooks.replace || rename)(temporary, path)
        }
        break
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(String(code)) || attempt === retries.length - 1)
          throw error
      }
    }
    await syncDirectory(dirname(path))
    const written = await readDisk(await realpath(path), maximumBytes)
    if (!written.bytes.equals(bytes)) throw new FileOperationError('file-changed')
    return written
  } catch (error) {
    throw fileError(error)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
