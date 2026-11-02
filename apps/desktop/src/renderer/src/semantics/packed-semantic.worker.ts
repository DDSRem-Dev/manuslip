import { PackedWorkerEndpoint } from './packed-worker-endpoint'

const tasks = new MessageChannel()
let resume: (() => void) | undefined
tasks.port1.onmessage = () => {
  const run = resume
  resume = undefined
  run?.()
}
const endpoint = new PackedWorkerEndpoint(
  {
    post: (value, transfer) => self.postMessage(value, { transfer }),
  },
  {
    now: performance.now.bind(performance),
    defer(run) {
      resume = run
      tasks.port2.postMessage(0)
    },
  },
)
self.onmessage = (event: MessageEvent<unknown>) => endpoint.receiveCooperative(event.data)
