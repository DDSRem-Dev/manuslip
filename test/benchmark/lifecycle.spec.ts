import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from '../e2e/helpers'
import {
  attachHeapProbe,
  closeFile,
  detachHeapProbe,
  fixture,
  machine,
  openFile,
  report,
  resources,
  settled,
  stop,
  waitForStartup,
} from './helpers'

test('retained source and semantic resources after 50 open/close cycles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-lifecycle-'))
  const fixtures = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      fixture(
        directory,
        `cycle-${index}`,
        `# Cycle ${index}\n\n` +
          'A paragraph with **formatting**, [a link][r], English, 中文 and العربية.\n\n'.repeat(
            850,
          ) +
          '\n[r]: https://example.invalid/\n',
      ),
    ),
  )
  const application = await launchDesktop(join(directory, 'profile'))
  const samples = []
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    await attachHeapProbe(application)
    const settledResources = async () => {
      let snapshot: Awaited<ReturnType<typeof resources>> | undefined
      const filesystemPendingSamples: number[] = []
      await expect
        .poll(
          async () => {
            snapshot = await resources(application)
            const pending = Object.entries(snapshot.resources).reduce(
              (sum, [name, count]) => sum + (/^FSReq/.test(name) ? count : 0),
              0,
            )
            filesystemPendingSamples.push(pending)
            return pending
          },
          { timeout: 5000, message: 'Closed-file filesystem requests settle before sampling' },
        )
        .toBe(0)
      if (!snapshot) throw new Error('Missing settled resource sample')
      return { ...snapshot, filesystemPendingSamples }
    }
    const cycle = async (index: number): Promise<void> => {
      const path = fixtures[index % fixtures.length]
      if (!path) throw new Error('Missing fixture')
      await openFile(application, page, path)
      expect(await settled(page)).toBe('ready')
      await closeFile(page, path)
      await expect(page.locator('.cm-editor')).toHaveCount(0)
    }
    for (let index = 0; index < 10; index++) await cycle(index)
    const baseline = await settledResources()
    for (let index = 0; index < 50; index++) {
      await cycle(index)
      if ((index + 1) % 10 === 0) samples.push({ cycles: index + 1, ...(await settledResources()) })
    }
    await report(test.info(), 'lifecycle', {
      machine: await machine(application),
      method:
        '10 fixture warmup, 50 cycles, forced GC in main/renderer/semantic worker before each sample; wait at most 5s for FSReq resources to settle and retain every observed pending count; JS + external/embedder/backing storage, process RSS reported separately',
      fixtureCount: fixtures.length,
      baseline,
      samples,
    })
    expect(
      baseline.targets.some(
        (target) => target.type === 'worker' && target.url.includes('semantic.worker'),
      ),
    ).toBe(true)
    for (const sample of samples) {
      expect(sample.retained, `retained bytes after ${sample.cycles} cycles`).toBeLessThan(
        250_000_000,
      )
      expect(
        sample.retained / baseline.retained,
        `growth after ${sample.cycles} cycles`,
      ).toBeLessThan(1.1)
      expect(sample.ipcListeners).toEqual(baseline.ipcListeners)
      expect(sample.contentsListeners).toEqual(baseline.contentsListeners)
      const watchers = (record: Record<string, number>) =>
        Object.fromEntries(Object.entries(record).filter(([name]) => /FS|watch/i.test(name)))
      expect(watchers(sample.resources)).toEqual(watchers(baseline.resources))
      expect(
        Object.keys(sample.resources).filter((name) => /FSEvent|FSWatcher|watch/i.test(name)),
        'Closed files release native watcher handles',
      ).toEqual([])
      expect(sample.targets.map((target) => target.type).sort()).toEqual(
        baseline.targets.map((target) => target.type).sort(),
      )
    }
  } finally {
    await detachHeapProbe(application)
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
