import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

const execute = promisify(execFile)

export function packagePaths(directory, platform = process.platform, arch = process.arch) {
  const app =
    platform === 'darwin'
      ? join(directory, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Manuslip.app')
      : null
  const root = app || join(directory, platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
  return {
    root,
    executable: app
      ? join(app, 'Contents/MacOS/Manuslip')
      : join(root, platform === 'win32' ? 'Manuslip.exe' : 'manuslip'),
    binary: app || join(root, platform === 'win32' ? 'Manuslip.exe' : 'manuslip-bin'),
    asar: join(root, app ? 'Contents/Resources/app.asar' : 'resources/app.asar'),
  }
}

/** Check the actual binary, not just the builder configuration. */
export async function verifyPackage(directory, platform = process.platform, arch = process.arch) {
  const paths = packagePaths(directory, platform, arch)
  const wire = await getCurrentFuseWire(paths.binary)
  const expected = {
    RunAsNode: false,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: platform !== 'linux',
    OnlyLoadAppFromAsar: true,
    GrantFileProtocolExtraPrivileges: false,
  }
  for (const [name, enabled] of Object.entries(expected))
    assert.equal(wire[FuseV1Options[name]], enabled ? 49 : 48, `Unexpected Electron fuse: ${name}`)
  const archive = await lstat(paths.asar)
  assert.ok(archive.isFile() && !archive.isSymbolicLink(), 'Expected a regular app.asar')
  await access(paths.executable)
  return { platform, arch, fuses: expected, embeddedIntegritySupported: platform !== 'linux' }
}

export async function verifySignatures(
  directory,
  installers,
  platform = process.platform,
  arch = process.arch,
) {
  const paths = packagePaths(directory, platform, arch)
  if (platform === 'win32') {
    for (const path of [paths.executable, ...installers]) {
      // Pass the path in the environment; no artifact name is interpolated into PowerShell code.
      await execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference = 'Stop'; $signature = Get-AuthenticodeSignature -LiteralPath $env:MANUSLIP_SIGNED_FILE; if ($signature.Status -ne 'Valid') { throw 'Invalid Authenticode signature' }",
        ],
        { env: { ...process.env, MANUSLIP_SIGNED_FILE: path }, windowsHide: true, timeout: 120000 },
      )
    }
  } else if (platform === 'darwin') {
    await execute('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      paths.root,
    ])
    await execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', paths.root])
    for (const path of installers.filter((path) => path.endsWith('.dmg')))
      await execute('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path])
    for (const path of [paths.root, ...installers.filter((path) => path.endsWith('.dmg'))])
      await execute('/usr/bin/xcrun', ['stapler', 'validate', path])
  } else throw new Error('Native signature verification requires Windows or macOS')
  return { platform, verified: true }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const directory = process.argv[2] || join(root, 'apps/desktop/release')
  verifyPackage(directory).then(
    (report) => console.log(JSON.stringify(report, null, 2)),
    (error) => {
      console.error(error.message)
      process.exitCode = 1
    },
  )
}
