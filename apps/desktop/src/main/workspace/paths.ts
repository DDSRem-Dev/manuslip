import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { FileOperationError, fileError } from '../files/errors'
import type { FileAuthorization } from '../files/sessions'

export interface RootGrant {
  path: string
  identity: string
}
export function containsPath(root: string, path: string): boolean {
  const tail = relative(root, path)
  return !isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`)
}
export async function grantRoot(path: string): Promise<RootGrant> {
  try {
    const canonical = await realpath(path)
    const metadata = await stat(canonical, { bigint: true })
    if (!metadata.isDirectory()) throw new FileOperationError('workspace-directory')
    return { path: canonical, identity: `${metadata.dev}:${metadata.ino}` }
  } catch (error) {
    throw fileError(error)
  }
}
export async function verifyRoot(root: RootGrant): Promise<void> {
  const metadata = await lstat(root.path, { bigint: true })
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(root.path)) !== root.path ||
    `${metadata.dev}:${metadata.ino}` !== root.identity
  )
    throw new FileOperationError('workspace-changed')
}
export async function resolveNode(
  root: RootGrant,
  path: string,
  directory: boolean,
): Promise<string> {
  try {
    await verifyRoot(root)
    const tail = relative(root.path, path)
    if (!containsPath(root.path, path)) throw new FileOperationError('workspace-changed')
    let current = root.path
    for (const part of tail ? tail.split(sep) : []) {
      current = join(current, part)
      if ((await lstat(current)).isSymbolicLink()) throw new FileOperationError('workspace-link')
    }
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) throw new FileOperationError('workspace-link')
    if (directory ? !metadata.isDirectory() : !metadata.isFile())
      throw new FileOperationError('workspace-changed')
    const canonical = await realpath(path)
    if (
      canonical !== path &&
      !(process.platform === 'win32' && canonical.toLowerCase() === path.toLowerCase())
    )
      throw new FileOperationError('workspace-changed')
    return canonical
  } catch (error) {
    throw fileError(error)
  }
}
export function authorizeWorkspaceFile(root: RootGrant, path: string): FileAuthorization {
  return async (canonical, identity) => {
    if (canonical !== path) throw new FileOperationError('workspace-changed')
    await resolveNode(root, path, false)
    if (identity) {
      const metadata = await stat(path, { bigint: true })
      if (`${metadata.dev}:${metadata.ino}` !== identity)
        throw new FileOperationError('file-changed')
    }
  }
}
export function authorizeRestoredFile(path: string): FileAuthorization {
  return async (canonical, identity) => {
    if (
      canonical !== path ||
      (await realpath(path)) !== path ||
      (await lstat(path)).isSymbolicLink()
    )
      throw new FileOperationError('workspace-changed')
    if (identity) {
      const metadata = await stat(path, { bigint: true })
      if (`${metadata.dev}:${metadata.ino}` !== identity)
        throw new FileOperationError('file-changed')
    }
  }
}
