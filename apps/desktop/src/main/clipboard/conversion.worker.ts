import { parentPort } from 'node:worker_threads'
import { convertHtml } from './conversion'

parentPort?.once('message', (html: string) => {
  try {
    parentPort?.postMessage({ ok: true, value: convertHtml(html) })
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error:
        error instanceof Error && error.message === 'paste-large' ? 'paste-large' : 'paste-failed',
    })
  }
})
