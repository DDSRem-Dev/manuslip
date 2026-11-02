const { app, BrowserWindow } = require('electron')

app.setPath('userData', process.env.MANUSLIP_WIDGET_TEST_PROFILE)
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  void window.loadURL(process.env.MANUSLIP_WIDGET_TEST_URL)
})
app.on('window-all-closed', () => app.quit())
