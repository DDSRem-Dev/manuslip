import { availableParallelism } from 'node:os'
import { configDefaults, defineConfig } from 'vitest/config'

const pandocTests = ['apps/desktop/test/integration/main/pandoc/converter-native.test.ts']

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      ...['desktop', 'core', 'editor', 'renderer', 'translate'].map((name) => ({
        extends: true as const,
        test: {
          name,
          include: [`${name === 'desktop' ? 'apps' : 'packages'}/${name}/test/unit/**/*.test.ts`],
        },
      })),
      {
        extends: true,
        test: {
          name: 'desktop-integration',
          include: ['apps/desktop/test/integration/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...pandocTests],
        },
      },
      {
        extends: true,
        test: { name: 'pandoc', include: pandocTests },
      },
      {
        extends: true,
        test: { name: 'packaging', include: ['test/packaging/**/*.test.ts'] },
      },
    ],
    // Filesystem boundary fixtures create thousands of files. Avoid runner contention
    // while preserving their assertions and normal per-test deadlines.
    maxWorkers: Math.min(4, availableParallelism()),
  },
})
