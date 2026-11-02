import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { packagedExecutable } from '../helpers/packaged-executable.mjs'

const executable = packagedExecutable()
const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url))
const result = spawnSync(
  process.execPath,
  [cli, 'test', '--config', 'test/e2e/playwright.config.ts', ...process.argv.slice(2)],
  {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    stdio: 'inherit',
    env: { ...process.env, MANUSLIP_PACKAGED_EXECUTABLE: executable },
    shell: false,
  },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
