import { parentPort, workerData } from 'node:worker_threads'
import { type CacheOperation, cacheLimits, TranslationCacheStore } from './cache-store'

const store = new TranslationCacheStore(workerData.path)
const timer = setInterval(() => store.flush(), cacheLimits.touchMs)
timer.unref()
parentPort?.on('message', (message: { id: number; operation: CacheOperation }) => {
  parentPort?.postMessage({ id: message.id, reply: store.execute(message.operation) })
})
parentPort?.once('close', () => {
  clearInterval(timer)
  store.close()
})
