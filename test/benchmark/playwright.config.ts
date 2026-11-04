import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// Hardware-dependent gates are an explicit packaged run, separate from correctness E2E.
export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: fileURLToPath(
    new URL(`./result/${process.env.MANUSLIP_BENCH_RUN ?? 'latest'}`, import.meta.url),
  ),
  use: { trace: 'retain-on-failure' },
})
