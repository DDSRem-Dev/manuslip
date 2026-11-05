import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { verifyPackage } from '../../scripts/verify-package.mjs'
import { automationPackage } from '../helpers/automation-package.mjs'
import { packagedExecutable } from '../helpers/packaged-executable.mjs'

const source = packagedExecutable()
await verifyPackage(
  process.env.MANUSLIP_PACKAGE_DIRECTORY ||
    fileURLToPath(new URL('../../apps/desktop/release', import.meta.url)),
)
const automation = await automationPackage(source)
try {
  const executable = automation.executable
  const args = process.argv.slice(2)
  const caseArg = args.indexOf('--case')
  const corpusCase = caseArg >= 0 ? args.splice(caseArg, 2)[1] : ''
  if (caseArg >= 0 && !corpusCase) throw new Error('--case requires a corpus name')
  const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url))
  const result = spawnSync(
    process.execPath,
    [cli, 'test', '--config', 'test/benchmark/playwright.config.ts', ...args],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...process.env,
        MANUSLIP_PACKAGED_EXECUTABLE: executable,
        MANUSLIP_BENCH_CASE: corpusCase,
        MANUSLIP_BENCH_RUN: `${Date.now()}-${randomUUID()}`,
      },
      shell: false,
    },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(automation.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
