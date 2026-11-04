import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  globalSetup: './setup.mjs',
  outputDir: fileURLToPath(new URL('./result', import.meta.url)),
  use: { trace: 'retain-on-failure' },
})
