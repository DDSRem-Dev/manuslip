import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { readPackedProcessMemory, summarizePackedProcessMemory } from './packed-process-memory.mjs'

/** OS observations include the actual semantic Worker sharing the mounted renderer process.
 * Keep the sampling loop in the driver/main process, without renderer polling or forced GC
 * during application work. Checkpoints are successive observations, not atomic attribution.
 */
export async function startSemanticServiceMemory(application, page) {
  const read = () => application.evaluate(readPackedProcessMemory)
  const initialDebug = await page.context().newCDPSession(page)
  let baselineRendererHeap
  try {
    baselineRendererHeap = await initialDebug.send('Runtime.getHeapUsage')
  } finally {
    await initialDebug.detach()
  }
  const baseline = await read()
  const samples = []
  const checkpoints = []
  let phase = 'before-request',
    revision = -1,
    active = true,
    failure
  async function sample() {
    const label = { phase, revision }
    const memory = await read()
    const workers = page.workers().map((worker) => worker.url())
    const observation = { ...memory, ...label, workers }
    samples.push(observation)
    return observation
  }
  const running = (async () => {
    try {
      while (active) {
        await sample()
        if (active) await delay(20)
      }
    } catch (error) {
      failure = { error }
    }
  })()
  return {
    async checkpoint(nextPhase, nextRevision, receiver) {
      phase = nextPhase
      revision = nextRevision
      checkpoints.push({ ...(await sample()), receiver })
    },
    async finish() {
      active = false
      await running
      if (failure) throw failure.error
      const deadline = Date.now() + 5000
      while (page.workers().length) {
        assert.ok(Date.now() < deadline, 'Application semantic Worker survived disposal')
        await delay(20)
      }
      phase = 'workers-stopped'
      const workersStopped = await sample()
      const debug = await page.context().newCDPSession(page)
      let disposedRendererHeap
      try {
        for (let index = 0; index < 3; index++) await debug.send('HeapProfiler.collectGarbage')
        disposedRendererHeap = await debug.send('Runtime.getHeapUsage')
      } finally {
        await debug.detach()
      }
      phase = 'disposed-post-gc'
      const disposedPostGc = await sample()
      const phases = [...new Set(samples.map((sample) => sample.phase))].map((name) => ({
        phase: name,
        ...summarizePackedProcessMemory(
          samples.filter((sample) => sample.phase === name),
          baseline,
        ),
      }))
      assert.ok(
        samples.some((sample) => sample.workers.length === 1),
        'Missing actual application Worker memory observation',
      )
      assert.ok(
        samples.every((sample) => sample.workers.length <= 1),
        'Overlapping service Workers',
      )
      const disposed = checkpoints.findLast((checkpoint) => checkpoint.phase === 'disposed')
      assert.equal(disposed?.receiver.retainedBytes, 0, 'Receiver ownership survived disposal')
      const firstReady = checkpoints.find(
        (checkpoint) => checkpoint.phase === 'ready' && checkpoint.revision === 0,
      )
      assert.ok(firstReady, 'Missing first preview readiness memory checkpoint')
      const intervals = checkpoints
        .filter((checkpoint) => ['request', 'ready', 'cached', 'hashed'].includes(checkpoint.phase))
        .map((checkpoint) => ({
          phase: checkpoint.phase,
          revision: checkpoint.revision,
          ...summarizePackedProcessMemory(
            samples.filter(
              (sample) =>
                sample.phase === checkpoint.phase && sample.revision === checkpoint.revision,
            ),
            baseline,
          ),
        }))
      return {
        baseline,
        baselineRendererHeap,
        summary: summarizePackedProcessMemory(samples, baseline),
        // Excludes the native full-output hash expansion and all subsequent contamination.
        coldThroughReady: summarizePackedProcessMemory(
          samples.filter((sample) => sample.observedAt <= firstReady.observedAt),
          baseline,
        ),
        phases,
        intervals,
        checkpoints,
        workersStopped,
        disposedPostGc,
        disposedRendererHeap,
        samples,
      }
    },
  }
}
