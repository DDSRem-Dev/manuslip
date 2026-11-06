import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { atomicWrite, readDisk } from '../../../../src/main/files/disk'

const execute = promisify(execFile)
async function acl(path: string, protect = false): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force",
    '$acl = Get-Acl -LiteralPath $env:MANUSLIP_TEST_ACL_PATH',
    ...(protect
      ? [
          '$acl.SetAccessRuleProtection($true, $true)',
          'Set-Acl -LiteralPath $env:MANUSLIP_TEST_ACL_PATH -AclObject $acl',
        ]
      : []),
    '(Get-Acl -LiteralPath $env:MANUSLIP_TEST_ACL_PATH).Sddl',
  ].join('\n')
  return (
    await execute(
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
        timeout: 15000,
        env: {
          ...process.env,
          PSModulePath: join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32/WindowsPowerShell/v1.0/Modules',
          ),
          MANUSLIP_TEST_ACL_PATH: path,
        },
      },
    )
  ).stdout.trim()
}

it.skipIf(process.platform !== 'win32')(
  'preserves an explicitly protected Windows ACL on replacement',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manuslip-acl-'))
    const path = join(directory, 'protected.md')
    try {
      await writeFile(path, 'original')
      const before = await acl(path, true)
      expect(before).toContain('D:PAI')
      await atomicWrite(path, Buffer.from('edited'), (await readDisk(path)).fingerprint)
      expect(await acl(path)).toBe(before)
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  },
  45000,
)

it.skipIf(process.platform !== 'win32')(
  'preserves an inherited Windows ACL when saving a file on the workspace volume',
  async () => {
    const logs = join(process.cwd(), 'apps/desktop/test/unit/result')
    await mkdir(logs, { recursive: true })
    const directory = await mkdtemp(join(logs, 'manuslip-inherited-acl-'))
    const path = join(directory, 'inherited 世界.md')
    try {
      await writeFile(path, 'original')
      const before = await acl(path)
      expect(before).not.toContain('D:P')
      await atomicWrite(path, Buffer.from('edited'), (await readDisk(path)).fingerprint)
      expect(await readFile(path, 'utf8')).toBe('edited')
      expect(await acl(path)).toBe(before)
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  },
  45000,
)
