import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig(config, {
  testMatch: ['search.spec.ts', 'workspace.spec.ts', 'resources.spec.ts'],
  testIgnore: [],
  outputDir: fileURLToPath(
    new URL(`./result/main/${process.env.MANUSLIP_BENCH_RUN ?? 'latest'}`, import.meta.url),
  ),
  use: { trace: 'off' },
})
