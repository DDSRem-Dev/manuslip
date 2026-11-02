import { SemanticService } from './service'

let service: SemanticService | null = null
export function getSemanticService(): SemanticService {
  service ??= new SemanticService(() => {
    const worker = new Worker(new URL('./semantic.worker.ts', import.meta.url), {
      type: 'module',
      name: 'manuslip-markdown',
    })
    return {
      onMessage: (listener) => {
        worker.onmessage = (event: MessageEvent<unknown>) => listener(event.data)
      },
      onFailure: (listener) => {
        worker.onerror = (event) => {
          event.preventDefault()
          listener('worker-error')
        }
        worker.onmessageerror = () => listener('message-error')
      },
      post: (request) => worker.postMessage(request),
      terminate: () => worker.terminate(),
    }
  })
  return service
}

if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    service?.dispose()
    service = null
  })
