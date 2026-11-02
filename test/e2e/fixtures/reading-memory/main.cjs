const { app, BrowserWindow } = require('electron')

app.setPath('userData', process.env.MANUSLIP_READING_MEMORY_PROFILE)
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  void window.loadURL(process.env.MANUSLIP_READING_MEMORY_URL)
})
app.on('window-all-closed', () => app.quit())
