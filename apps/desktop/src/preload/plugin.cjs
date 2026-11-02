const { contextBridge, ipcRenderer } = require('electron')

// The untrusted command gets only this frozen API. Bound strings before crossing IPC.
const limit = 2097152,
  encoder = new TextEncoder()
let registered = false,
  active = null,
  calls = 0,
  pending = new Map()
function text(value, cap = limit) {
  if (
    typeof value !== 'string' ||
    value.length > cap ||
    !value.isWellFormed() ||
    encoder.encode(value).byteLength > cap
  )
    throw new Error('Plugin text limit')
  return value
}
function call(kind, input) {
  if (!active || pending.size || ++calls > 16) return Promise.reject(new Error('Plugin host busy'))
  const payload =
    kind === 'fetchText'
      ? { url: text(input.url, 2048), method: input.method, body: text(input.body || '', 65536) }
      : kind === 'writeTextFile'
        ? { text: text(input) }
        : null
  if (kind === 'fetchText' && !['GET', 'POST'].includes(payload.method))
    return Promise.reject(new Error('Invalid method'))
  const id = calls
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ipcRenderer.send('manuslip:plugin-host:call', { jobId: active, id, kind, input: payload })
  })
}
ipcRenderer.on('manuslip:plugin-host:reply', (_event, reply) => {
  if (!reply || reply.jobId !== active || !Number.isSafeInteger(reply.id)) return
  const operation = pending.get(reply.id)
  if (!operation) return
  pending.delete(reply.id)
  if (reply.ok) operation.resolve(reply.value)
  else operation.reject(new Error('Plugin action unavailable or denied'))
})
contextBridge.exposeInMainWorld(
  'manuslipPlugin',
  Object.freeze({
    apiVersion: 1,
    register: (handler) => {
      if (registered || typeof handler !== 'function')
        throw new Error('Register one command handler')
      registered = true
      ipcRenderer.once('manuslip:plugin-host:job', async (_event, input) => {
        active = input.jobId
        try {
          const result = text(
            await handler(
              Object.freeze({
                commandId: input.commandId,
                ...(input.document ? { document: input.document } : {}),
              }),
            ),
          )
          ipcRenderer.send('manuslip:plugin-host:result', { jobId: active, ok: true, text: result })
        } catch {
          ipcRenderer.send('manuslip:plugin-host:result', { jobId: active, ok: false })
        } finally {
          active = null
          for (const operation of pending.values()) operation.reject(new Error('Plugin finished'))
          pending.clear()
        }
      })
      ipcRenderer.send('manuslip:plugin-host:ready')
    },
    readTextFile: () => call('readTextFile', null),
    writeTextFile: (value) => call('writeTextFile', value),
    fetchText: (url, options = {}) =>
      call('fetchText', { url, method: options.method || 'GET', body: options.body || '' }),
  }),
)
