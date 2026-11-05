import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { WorkspaceCatalog } from '../../apps/desktop/src/main/workspace/catalog'
import { grantRoot } from '../../apps/desktop/src/main/workspace/paths'
import { workspaceLimits } from '../../apps/desktop/src/shared/workspace-contracts'
import { report, summary } from './helpers'

test('large workspace listings stay within the refresh latency budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-workspace-bench-'))
  let catalog: WorkspaceCatalog | undefined
  try {
    // Bound setup I/O separately from the measured scan, sort and publication.
    for (let start = 0; start < workspaceLimits.scan; start += 100) {
      await Promise.all(
        Array.from({ length: Math.min(100, workspaceLimits.scan - start) }, (_, offset) =>
          writeFile(join(directory, `chapter-${start + offset + 1}.md`), ''),
        ),
      )
    }
    catalog = new WorkspaceCatalog(await grantRoot(directory))
    const samples: number[] = []
    for (let iteration = 0; iteration < 12; iteration++) {
      catalog.invalidate()
      const begin = performance.now()
      const page = await catalog.list(catalog.root.id, 0)
      const elapsed = performance.now() - begin
      expect(page.truncated).toBe(false)
      expect(page.next).toBe(workspaceLimits.page)
      expect(page.nodes.map((node) => node.name)).toEqual(
        Array.from({ length: workspaceLimits.page }, (_, index) => `chapter-${index + 1}.md`),
      )
      if (iteration >= 2) samples.push(elapsed)
    }
    const latency = summary(samples)
    await report(test.info(), 'workspace-listing', {
      runtime: process.versions,
      platform: platform(),
      cpu: cpus()[0]?.model,
      files: workspaceLimits.scan,
      latency,
    })
    expect(latency.p95).toBeLessThan(50)
  } finally {
    catalog?.dispose()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
