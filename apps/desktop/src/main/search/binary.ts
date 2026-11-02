import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { sep } from 'node:path'
import { FileOperationError } from '../files/errors'

/** Resolve the runtime architecture directly; never consult PATH or npm_config_arch. */
export async function searchBinary(): Promise<string> {
  try {
    const require = createRequire(import.meta.url)
    const name = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const suffix = `${sep}@vscode${sep}ripgrep-${process.platform}-${process.arch}${sep}bin${sep}${name}`
    const resolved = require
      .resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/${name}`)
      .replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    const canonical = await realpath(resolved)
    const metadata = await stat(canonical)
    if (!canonical.endsWith(suffix) || !metadata.isFile() || metadata.size > 64 * 1024 * 1024)
      throw new Error('Invalid search binary')
    await access(canonical, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return canonical
  } catch {
    throw new FileOperationError('search-binary')
  }
}
