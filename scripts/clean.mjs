import { rm } from 'node:fs/promises'

// These literal paths are always relative to this repository, never shell input.
for (const path of [
  '../apps/desktop/out',
  '../apps/desktop/release',
  '../apps/desktop/test/unit/result',
  '../coverage',
  '../test/e2e/result',
  '../test/benchmark/result',
  '../test/packaging/result',
  '../apps/desktop/test/integration/result',
]) {
  await rm(new URL(path, import.meta.url), { recursive: true, force: true })
}
