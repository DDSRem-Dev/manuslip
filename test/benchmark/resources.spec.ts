import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { matchEntries, type StoredEntry } from '../../apps/desktop/src/main/search/records'
import { SearchRecordStream } from '../../apps/desktop/src/main/search/stream'
import { WorkspaceCatalog } from '../../apps/desktop/src/main/workspace/catalog'
import { grantRoot, type RootGrant } from '../../apps/desktop/src/main/workspace/paths'
import { workspaceLimits } from '../../apps/desktop/src/shared/workspace-contracts'
import { MiB, report } from './helpers'
import { collectedNodeMemory, nodeMemory, observeNodeWatchers } from './node-memory'

function searchCycle(index: number): number {
  const line = `${'界😀a'.repeat(9000)}${'needle '.repeat(500)} ${index}`
  const start = Buffer.byteLength('界😀a'.repeat(9000))
  const input = Buffer.from(
    `${JSON.stringify({
      type: 'match',
      data: {
        path: { text: `notes-${index}.md` },
        lines: { text: line },
        line_number: 1,
        submatches: Array.from({ length: 500 }, (_, match) => ({
          start: start + match * 7,
          end: start + match * 7 + 6,
        })),
      },
    })}\n`,
  )
  const stream = new SearchRecordStream(10)
  const results: StoredEntry[] = []
  const accept = (record: Buffer) => {
    const outcome = matchEntries(resolve('workspace'), record, (entry) => {
      results.push(entry)
      return true
    })
    if (!outcome.keep || outcome.skipped) throw new Error('Invalid search result')
    return true
  }
  let peak = nodeMemory().bytes
  for (let offset = 0; offset < input.length; offset += 256) {
    if (!stream.push(input.subarray(offset, offset + 256), accept))
      throw new Error('Unexpected truncation')
    if (offset % 8192 === 0) peak = Math.max(peak, nodeMemory().bytes)
  }
  if (!stream.finish(accept) || results.length !== 500) throw new Error('Missing search results')
  peak = Math.max(peak, nodeMemory().bytes)
  stream.clear()
  return peak
}

async function workspaceCycle(grant: RootGrant): Promise<number> {
  const catalog = new WorkspaceCatalog(grant)
  try {
    const page = await catalog.list(catalog.root.id, 0)
    if (page.truncated || page.nodes.length !== workspaceLimits.page)
      throw new Error('Incomplete workspace scan')
    return nodeMemory().bytes
  } finally {
    catalog.dispose()
  }
}

test('search framing and result lifetimes stay within memory budgets', async () => {
  searchCycle(-1)
  const baseline = await collectedNodeMemory()
  const budgets = { peak: 16 * MiB, retained: 4 * MiB }
  const samples = []
  for (let cycle = 0; cycle < 20; cycle++) {
    const peak = searchCycle(cycle)
    const retained = await collectedNodeMemory()
    samples.push({
      cycle: cycle + 1,
      peakGrowth: peak - baseline.bytes,
      retainedGrowth: retained.bytes - baseline.bytes,
    })
  }
  await report(test.info(), 'search-memory', {
    runtime: process.versions,
    platform: platform(),
    cpu: cpus()[0]?.model,
    method:
      'Twenty distinct fragmented native JSON records with 500 Unicode matches each. Observed heap + external storage at framing checkpoints and after result publication; two GCs after each completed cycle. Memory sampling runs separately from latency gates.',
    baseline,
    budgets,
    samples,
  })
  for (const sample of samples) {
    expect(sample.peakGrowth, `observed search memory in cycle ${sample.cycle}`).toBeLessThan(
      budgets.peak,
    )
    expect(
      sample.retainedGrowth,
      `retained search memory after cycle ${sample.cycle}`,
    ).toBeLessThan(budgets.retained)
  }
})

test('workspace catalog disposal releases memory and native watchers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-workspace-memory-'))
  const watchers = observeNodeWatchers()
  try {
    for (let start = 0; start < workspaceLimits.scan; start += 100)
      await Promise.all(
        Array.from({ length: Math.min(100, workspaceLimits.scan - start) }, (_, offset) =>
          writeFile(join(directory, `chapter-${start + offset + 1}.md`), ''),
        ),
      )
    const grant = await grantRoot(directory)
    await workspaceCycle(grant)
    await expect.poll(watchers.count).toBe(0)
    const baseline = await collectedNodeMemory()
    const budgets = { peak: 32 * MiB, retained: 4 * MiB }
    const samples = []
    for (let cycle = 0; cycle < 10; cycle++) {
      const peak = await workspaceCycle(grant)
      await expect.poll(watchers.count).toBe(0)
      const retained = await collectedNodeMemory()
      samples.push({
        cycle: cycle + 1,
        peakGrowth: peak - baseline.bytes,
        retainedGrowth: retained.bytes - baseline.bytes,
      })
    }
    await report(test.info(), 'workspace-memory', {
      runtime: process.versions,
      platform: platform(),
      cpu: cpus()[0]?.model,
      method:
        'Ten fresh catalogs, each listing 5,000 files before disposal. Observed live heap + external storage after each listing; watcher counts return to baseline and two GCs run after disposal. Filesystem fixtures and GC are outside latency gates.',
      baseline,
      budgets,
      samples,
    })
    for (const sample of samples) {
      expect(sample.peakGrowth, `observed workspace memory in cycle ${sample.cycle}`).toBeLessThan(
        budgets.peak,
      )
      expect(
        sample.retainedGrowth,
        `retained workspace memory after cycle ${sample.cycle}`,
      ).toBeLessThan(budgets.retained)
    }
  } finally {
    watchers.dispose()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
