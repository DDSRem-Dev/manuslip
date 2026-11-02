import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { DiagramRequest } from '@manuslip/renderer/diagram'
import { app, BrowserWindow, type IpcMainEvent, ipcMain, session } from 'electron'
import { diagramChannels, parseDiagramHostResult } from '../../shared/diagram-contracts'
import { FileOperationError } from '../files/errors'
import type { DiagramHost, HostFactory } from './broker'
import { diagramAssetPath, diagramCsp } from './policy'

const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}
/** A fresh session and custom origin prevent Chromium from sharing the editor's process. */
export class ElectronDiagramFactory implements HostFactory {
  private host: BrowserWindow | null = null
  private reject: ((error: Error) => void) | null = null
  private cleanup: (() => void) | null = null
  private readonly partition: Electron.Session
  private readonly url: string
  constructor(
    private readonly owner: number,
    private readonly editorProcess: () => number,
  ) {
    this.partition = session.fromPartition(`manuslip-diagram-${owner}-${Date.now()}`, {
      cache: false,
    })
    const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
    this.url = developmentUrl
      ? `${developmentUrl.replace(/\/$/, '')}/diagram/index.html`
      : 'manuslip-diagram://render/diagram/index.html'
    this.partition.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )
    this.partition.setPermissionCheckHandler(() => false)
    this.partition.webRequest.onBeforeRequest((details, callback) => {
      const allowed = developmentUrl
        ? details.url.startsWith(`${developmentUrl.replace(/\/$/, '')}/`)
        : Boolean(diagramAssetPath(details.url))
      callback({ cancel: !allowed })
    })
    this.partition.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [diagramCsp] },
      }),
    )
    if (!developmentUrl)
      this.partition.protocol.handle('manuslip-diagram', async (request) => {
        const path = diagramAssetPath(request.url)
        if (!path || request.method !== 'GET') return new Response(null, { status: 404 })
        try {
          const bytes = await readFile(join(import.meta.dirname, '../renderer', path))
          return new Response(bytes, {
            headers: {
              'Content-Type': path.endsWith('.html')
                ? 'text/html'
                : mime[extname(path)] || 'application/octet-stream',
              'Content-Security-Policy': diagramCsp,
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch {
          return new Response(null, { status: 404 })
        }
      })
  }
  create(): Promise<DiagramHost> {
    this.destroy()
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      title: 'Manuslip diagram renderer',
      skipTaskbar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/diagram.cjs'),
        session: this.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    })
    this.host = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    const trusted = (event: IpcMainEvent): boolean =>
      this.host === window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame?.url === this.url
    return new Promise<DiagramHost>((resolve, reject) => {
      this.reject = reject
      let active: { id: string; resolve(svg: string): void; reject(error: Error): void } | null =
        null
      const ready = (event: IpcMainEvent): void => {
        if (!trusted(event)) return
        if (window.webContents.getOSProcessId() === this.editorProcess()) {
          this.destroy()
          return
        }
        resolve({
          render: (request: DiagramRequest) =>
            new Promise<string>((resolve, reject) => {
              if (this.host !== window || window.isDestroyed() || active) {
                reject(new FileOperationError('diagram-process'))
                return
              }
              active = { id: request.jobId, resolve, reject }
              window.webContents.send(diagramChannels.job, request)
            }),
          destroy: () => this.destroy(),
        })
      }
      const result = (event: IpcMainEvent, input: unknown): void => {
        if (!trusted(event) || !active) return
        try {
          const output = parseDiagramHostResult(input)
          if (output.jobId !== active.id) throw new Error('Mismatched diagram')
          const job = active
          active = null
          if ('svg' in output) job.resolve(output.svg)
          else job.reject(new FileOperationError(output.error))
        } catch {
          this.destroy()
        }
      }
      const gone = (): void => {
        reject(new FileOperationError('diagram-process'))
        active?.reject(new FileOperationError('diagram-process'))
        active = null
      }
      ipcMain.on(diagramChannels.ready, ready)
      ipcMain.on(diagramChannels.result, result)
      window.webContents.once('render-process-gone', gone)
      window.once('closed', gone)
      this.cleanup = () => {
        ipcMain.removeListener(diagramChannels.ready, ready)
        ipcMain.removeListener(diagramChannels.result, result)
        gone()
      }
      void window.loadURL(this.url).catch(() => {
        if (this.host === window) this.destroy()
      })
    })
  }
  destroy(): void {
    const window = this.host
    this.host = null
    this.reject?.(new FileOperationError('diagram-process'))
    this.reject = null
    this.cleanup?.()
    this.cleanup = null
    if (window && !window.isDestroyed()) {
      if (
        window.webContents.getOSProcessId() &&
        window.webContents.getOSProcessId() !== this.editorProcess()
      )
        window.webContents.forcefullyCrashRenderer()
      window.destroy()
    }
  }
  dispose(): void {
    this.destroy()
    this.partition.webRequest.onBeforeRequest(null)
    this.partition.webRequest.onHeadersReceived(null)
    void this.partition.protocol.unhandle('manuslip-diagram')
    void this.partition.clearStorageData()
  }
  get ownerId(): number {
    return this.owner
  }
}
