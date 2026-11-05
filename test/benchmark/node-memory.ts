import { createHook } from 'node:async_hooks'
import { Session } from 'node:inspector'

export function nodeMemory() {
  const { heapUsed, external, arrayBuffers } = process.memoryUsage()
  // Node includes ArrayBuffer backing storage in external; count it only once.
  return { heapUsed, external, arrayBuffers, bytes: heapUsed + external }
}

export async function collectedNodeMemory() {
  const session = new Session()
  session.connect()
  try {
    // A second collection observes backing stores released by the first GC's finalizers.
    for (let pass = 0; pass < 2; pass++) {
      await new Promise<void>((resolve, reject) =>
        session.post('HeapProfiler.collectGarbage', (error) => (error ? reject(error) : resolve())),
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  } finally {
    session.disconnect()
  }
  return nodeMemory()
}

export function observeNodeWatchers() {
  const resources = new Set<number>()
  // Unlike getActiveResourcesInfo(), hooks include persistent:false watchers.
  const hook = createHook({
    init(id, type) {
      if (type === 'FSEVENTWRAP') resources.add(id)
    },
    destroy(id) {
      resources.delete(id)
    },
  }).enable()
  return {
    count: () => resources.size,
    dispose: () => {
      hook.disable()
      resources.clear()
    },
  }
}
