import { parentPort, workerData } from 'node:worker_threads'
import { type CacheOperation, TranslationCacheStore } from './cache-store'

const store = new TranslationCacheStore(workerData.path)
parentPort?.on('message', (message: { id: number; operation: CacheOperation }) => {
  parentPort?.postMessage({ id: message.id, reply: store.execute(message.operation) })
})
parentPort?.once('close', () => store.close())
