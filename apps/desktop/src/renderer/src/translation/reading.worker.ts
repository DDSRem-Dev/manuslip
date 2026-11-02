import { ReadingProcessor } from './engine'
import type { ReadingOperation } from './protocol'

const processor = new ReadingProcessor()
let running = false
self.onmessage = (event: MessageEvent<{ sequence: number; operation: ReadingOperation }>): void => {
  const { sequence, operation } = event.data
  if (running) throw new Error('Unexpected parallel translation work')
  running = true
  void processor
    .respond(operation, sequence, (response) => self.postMessage(response))
    .catch((error: unknown) => {
      if (operation.kind !== 'render') processor.clear()
      self.postMessage({
        sequence,
        error:
          error instanceof Error &&
          (error.message === 'translation-view-limit' || error.message === 'translation-limit')
            ? 'translation-view-limit'
            : 'translation-view-worker',
      })
    })
    .finally(() => {
      running = false
    })
}
