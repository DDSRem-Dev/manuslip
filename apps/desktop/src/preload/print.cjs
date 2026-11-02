const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld(
  'manuslipPrintHost',
  Object.freeze({
    ready: () => ipcRenderer.send('manuslip:export-host:ready'),
    onJob: (listener) =>
      ipcRenderer.on('manuslip:export-host:job', (_event, payload) => listener(payload)),
    asset: (jobId, reference) =>
      ipcRenderer.invoke(`manuslip:export-host:asset:${jobId}`, { jobId, reference }),
    result: (jobId, result) =>
      ipcRenderer.send('manuslip:export-host:result', { jobId, ...result }),
  }),
)
