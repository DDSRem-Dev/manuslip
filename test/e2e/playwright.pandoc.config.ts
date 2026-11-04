import { defineConfig } from '@playwright/test'
import common from './playwright.config'

export default defineConfig({
  ...common,
  testMatch: ['**/pandoc.spec.ts', '**/pandoc-reading.spec.ts'],
  grep: /@pandoc/,
  grepInvert: undefined,
})
