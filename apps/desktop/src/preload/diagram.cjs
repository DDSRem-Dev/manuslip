const { contextBridge, ipcRenderer } = require('electron')

// Kept as one self-contained sandbox preload: no shared CommonJS chunks or file APIs.
contextBridge.exposeInMainWorld(
  'manuslipDiagramHost',
  Object.freeze({
    ready: () => ipcRenderer.send('manuslip:diagram-host:ready'),
    onJob: (listener) => {
      const handler = (_event, input) => listener(input)
      ipcRenderer.on('manuslip:diagram-host:job', handler)
      return () => ipcRenderer.removeListener('manuslip:diagram-host:job', handler)
    },
    result: (input) => {
      if (
        !input ||
        typeof input !== 'object' ||
        typeof input.jobId !== 'string' ||
        (typeof input.svg !== 'string' && typeof input.error !== 'string') ||
        (typeof input.svg === 'string' && input.svg.length > 2097152)
      )
        throw new Error('Invalid diagram result')
      ipcRenderer.send('manuslip:diagram-host:result', {
        jobId: input.jobId,
        ...(typeof input.svg === 'string' ? { svg: input.svg } : { error: input.error }),
      })
    },
  }),
)
