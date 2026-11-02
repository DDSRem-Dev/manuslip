import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error('Run with node --expose-gc test/benchmark/profiles/profile-packed-encoding.mjs')
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null },
})
try {
  const { packValueSteps } = await server.ssrLoadModule('/packages/core/src/packing.ts')
  const closed = [],
    results = []
  function scenario(advances, finish = false) {
    const input = {
      text: '界😀\n'.repeat(100000),
      children: Array.from({ length: 8000 }, (_, index) => ({ index, value: `block ${index}` })),
    }
    const refs = [
      new WeakRef(input),
      new WeakRef(input.children),
      new WeakRef(input.children[4000]),
    ]
    const work = packValueSteps(input, 8 * 1024 * 1024)
    let count = 0,
      largestStepMs = 0,
      bytes = 0
    while (finish || count < advances) {
      const start = performance.now()
      const step = work.next()
      largestStepMs = Math.max(largestStepMs, performance.now() - start)
      if (step.done) {
        assert.ok(finish && step.value)
        bytes = step.value.byteLength
        break
      }
      count++
    }
    if (!finish) work.return()
    assert.deepEqual(work.next(), { done: true, value: undefined })
    closed.push(work)
    return { refs, count, largestStepMs, bytes }
  }
  async function collected(refs) {
    for (let round = 0; round < 12; round++) {
      await immediate()
      global.gc()
      await immediate()
    }
    return refs.filter((ref) => ref.deref()).length
  }
  for (const advances of [0, 1, 40, 200, 1000]) {
    const { refs, ...result } = scenario(advances)
    const alive = await collected(refs)
    assert.equal(alive, 0, `Native encoding input after cancellation at ${advances}`)
    results.push({ cancelledAfter: advances, ...result, observed: refs.length, alive })
  }
  const { refs, ...complete } = scenario(0, true)
  const alive = await collected(refs)
  assert.equal(alive, 0, 'Native encoding input after completion')
  results.push({ completed: true, ...complete, observed: refs.length, alive })
  assert.equal(closed.length, 6)
  const output = {
    date: new Date().toISOString(),
    runtime: process.versions,
    results,
    retainedClosedHandles: closed.length,
  }
  await mkdir('test/artifacts/logs', { recursive: true })
  await writeFile(
    'test/artifacts/logs/packed-encoding-profile.json',
    `${JSON.stringify(output, null, 2)}\n`,
  )
  console.log(JSON.stringify(output, null, 2))
} finally {
  await server.close()
}
