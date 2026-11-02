const worker = new Worker(new URL('./reading.worker.ts', import.meta.url), { type: 'module' })
let sequence = 0
const pending = new Map<
  number,
  {
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }
>()
worker.onmessage = ({ data }) => {
  const request = pending.get(data.sequence)
  if (!request) throw new Error('Unknown owned reading diagnostic response')
  pending.delete(data.sequence)
  clearTimeout(request.timer)
  if (data.error) request.reject(new Error(data.error))
  else request.resolve(data.value)
}
worker.onerror = (event) => {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error(event.message))
  }
  pending.clear()
}
Object.defineProperty(window, 'ownedReadingMemory', {
  value: {
    request(operation: DiagnosticRequest) {
      const id = ++sequence
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('Owned reading diagnostic timed out'))
        }, 30000)
        pending.set(id, { resolve, reject, timer })
      })
      const payload = operation.payload
      worker.postMessage({ sequence: id, operation }, payload ? [payload] : [])
      return promise.then((value) => ({ value, detached: payload?.byteLength === 0 }))
    },
  },
})
interface DiagnosticRequest {
  payload?: ArrayBuffer
  [key: string]: unknown
}
declare global {
  interface Window {
    ownedReadingMemory: {
      request(operation: DiagnosticRequest): Promise<{ value: unknown; detached: boolean }>
    }
  }
}

export {}
