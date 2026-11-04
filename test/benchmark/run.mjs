import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { packagedExecutable } from '../helpers/packaged-executable.mjs'

const executable = packagedExecutable()
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
