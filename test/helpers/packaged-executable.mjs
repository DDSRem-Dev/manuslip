import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function packagedExecutable() {
  const relative = {
    win32: '../../apps/desktop/release/win-unpacked/Manuslip.exe',
    linux: '../../apps/desktop/release/linux-unpacked/manuslip',
    darwin: `../../apps/desktop/release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Manuslip.app/Contents/MacOS/Manuslip`,
  }[process.platform]
  if (!relative) throw new Error(`Unsupported platform: ${process.platform}`)
  const executable = fileURLToPath(new URL(relative, import.meta.url))
  if (!existsSync(executable))
    throw new Error('Packaged executable is missing. Run npm run build first.')
  return executable
}
