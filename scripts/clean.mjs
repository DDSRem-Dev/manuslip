import { rm } from 'node:fs/promises'

// These literal paths are always relative to this repository, never shell input.
for (const path of [
  '../apps/desktop/out',
  '../apps/desktop/release',
  '../apps/desktop/test/artifacts',
  '../coverage',
  '../test/artifacts',
  '../test/e2e/results',
  '../test/e2e/report',
  '../test/benchmark/results',
  '../test/packaging/results',
]) {
  await rm(new URL(path, import.meta.url), { recursive: true, force: true })
}
