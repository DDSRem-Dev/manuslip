import { PackedProducerHost } from '../../../../apps/desktop/src/renderer/src/semantics/packed-producer-host'

// Exercises the application scheduling host over a real transferable Worker channel.
// This diagnostic cannot activate the ordinary application's semantic transport.
const tasks = new MessageChannel()
let resume: (() => void) | undefined
tasks.port1.onmessage = () => {
  const next = resume
  resume = undefined
  next?.()
}
const failed = (error: unknown) =>
  self.postMessage({ kind: 'error', message: String(error), stats: host.stats })
const host = new PackedProducerHost(
  {
    post(value, transfer) {
      self.postMessage({ ...value, stats: host.stats }, { transfer })
    },
    failed,
  },
  {
    now: () => performance.now(),
    defer(run) {
      resume = run
      tasks.port2.postMessage(0)
    },
  },
  true,
)
self.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
  try {
    if (event.data.kind === 'ack') {
      host.acknowledge(event.data.acknowledgement)
      self.postMessage({ kind: 'acknowledged', stats: host.stats })
    } else if (event.data.kind === 'cache') host.cache()
    else if (event.data.kind === 'prepare') host.prepare(event.data.input, event.data.exchange)
    else throw new Error('Invalid diagnostic operation')
  } catch (error) {
    failed(error)
  }
}
