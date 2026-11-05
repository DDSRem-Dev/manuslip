import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses'

/** Playwright requires Node inspection. Instrument an isolated copy, never a distributable. */
export async function automationPackage(executable) {
  const source = await realpath(executable)
  const mac = process.platform === 'darwin'
  const sourceRoot = mac ? resolve(source, '../../..') : dirname(source)
  const outputs = fileURLToPath(new URL('../packaging/result', import.meta.url))
  await mkdir(outputs, { recursive: true })
  const destination = await mkdtemp(join(outputs, 'automation-'))
  const target = join(destination, mac ? basename(sourceRoot) : 'app')
  await cp(sourceRoot, target, { recursive: true, dereference: false })
  const binary = mac
    ? target
    : join(target, process.platform === 'linux' ? 'manuslip-bin' : basename(source))
  await flipFuses(binary, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
    resetAdHocDarwinSignature: mac,
  })
  if (mac)
    await promisify(execFile)('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', target])
  const entry = join(target, relative(sourceRoot, source))
  if (!entry.startsWith(`${destination}${sep}`))
    throw new Error('Automation copy escaped its directory')
  return { executable: entry, directory: destination }
}
