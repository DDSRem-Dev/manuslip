const { app, BrowserWindow } = require('electron')

app.setPath('userData', process.env.MANUSLIP_PACKED_MEMORY_PROFILE)
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Packed diagnostic renderer exited:', JSON.stringify(details))
  })
  void window.loadURL(process.env.MANUSLIP_PACKED_MEMORY_URL)
})
app.on('window-all-closed', () => app.quit())
