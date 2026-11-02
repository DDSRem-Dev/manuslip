import { parseRequest } from '../../../../apps/desktop/src/renderer/src/semantics/protocol'
import { semanticLimits } from '../../../../packages/core/src/contracts'
import { packValueSteps } from '../../../../packages/core/src/packing'
import { parseMarkdown } from '../../../../packages/core/src/parse'
import { renderProjectionLayout } from '../../../../packages/renderer/src/projection-layout'

// Diagnostic only. This includes actual native producer work previously excluded by the
// fixture loader; it neither enables packed semantic transport nor bounds parser/HAST memory.
const suspended = new Map<string, unknown>()
const tasks = new MessageChannel()
let resume: (() => void) | undefined
tasks.port1.onmessage = () => {
  const next = resume
  resume = undefined
  next?.()
}
const yieldTask = () =>
  new Promise<void>((resolve) => {
    resume = resolve
    tasks.port2.postMessage(0)
  })
self.onmessage = async (event: MessageEvent<unknown>) => {
  let encoding: ReturnType<typeof packValueSteps> | undefined
  try {
    if (suspended.size) throw new Error('Diagnostic producer already suspended')
    const request = parseRequest(event.data)
    const started = performance.now()
    self.postMessage({ kind: 'phase', phase: 'parsing' })
    const document = parseMarkdown(request.source)
    const parsed = performance.now()
    self.postMessage({ kind: 'phase', phase: 'rendering' })
    const { projection, layout } = renderProjectionLayout(
      document.root,
      request.options,
      semanticLimits.rendererBytes,
    )
    const rendered = performance.now()
    // The controller can terminate this worker with a complete native graph still live.
    // The promise deliberately never resolves; no payload can be published on that path.
    if (Reflect.get(event.data as object, 'pauseBeforeEncode') === true) {
      // The event handler retains this map, so even an unreachable unresolved promise
      // cannot allow GC to collect the supposedly suspended native graph.
      suspended.set('snapshot', { request, document, projection, layout })
      self.postMessage({ kind: 'phase', phase: 'paused-native-snapshot' })
      await new Promise<never>(() => {})
    }
    self.postMessage({ kind: 'phase', phase: 'encoding' })
    encoding = packValueSteps(
      { document, projection, layout },
      semanticLimits.messageBytes - 1024,
      {
        working: 32 * 1024 * 1024,
        nodes: 800000,
        depth: 512,
      },
    )
    let steps = 0,
      largestStepMs = 0,
      activeMs = 0,
      batchStarted = performance.now()
    while (true) {
      const before = performance.now()
      const next = encoding.next()
      const elapsed = performance.now() - before
      largestStepMs = Math.max(largestStepMs, elapsed)
      activeMs += elapsed
      steps++
      if (next.done) {
        if (!next.value) throw new Error('Incomplete producer encoding')
        const payload = next.value
        const report = {
          parseMs: parsed - started,
          renderMs: rendered - parsed,
          totalMs: performance.now() - started,
          encodingActiveMs: activeMs,
          encodingSteps: steps,
          largestEncodingStepMs: largestStepMs,
          payloadBytes: payload.byteLength,
          descriptors: document.blocks.length,
          widgets: projection.blocks.length,
        }
        if (
          new TextEncoder().encode(JSON.stringify({ kind: 'payload', producer: report })).length >
          1024
        )
          throw new Error('Producer metadata exceeds envelope reserve')
        self.postMessage({ kind: 'payload', payload, producer: report }, { transfer: [payload] })
        self.postMessage({ kind: 'detached', bytes: payload.byteLength })
        return
      }
      if (performance.now() - batchStarted >= 2) {
        await yieldTask()
        batchStarted = performance.now()
      }
    }
  } catch (error) {
    self.postMessage({ kind: 'error', message: String(error) })
  } finally {
    encoding?.return()
  }
}
