import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { collectedNodeMemory, observeNodeWatchers } from '../../../../../test/benchmark/node-memory'

it('observes retained buffer storage and its release after cleanup', async () => {
  const baseline = await collectedNodeMemory()
  let buffer: Buffer | null = Buffer.alloc(16 * 1024 * 1024, 65)
  const held = await collectedNodeMemory()
  expect(buffer.at(-1)).toBe(65)
  expect(held.bytes - baseline.bytes).toBeGreaterThan(8 * 1024 * 1024)
  expect(held.external - baseline.external).toBeGreaterThan(8 * 1024 * 1024)
  buffer = null
  const released = await collectedNodeMemory()
  expect(released.external - baseline.external).toBeLessThan(1024 * 1024)
})

it('observes unreferenced native watchers until their handles close', async () => {
  const observed = observeNodeWatchers()
  const watcher = watch(tmpdir(), { persistent: false }, () => {})
  try {
    expect(observed.count()).toBe(1)
    watcher.close()
    await expect.poll(observed.count).toBe(0)
  } finally {
    watcher.close()
    observed.dispose()
  }
})
