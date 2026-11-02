import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, type IpcMainEvent, ipcMain, session } from 'electron'
import { pluginHostChannels, pluginLimits, pluginText } from '../../shared/plugin-contracts'
import { FileOperationError } from '../files/errors'
import { pluginAsset, pluginCsp, pluginHostHtml, pluginOrigin } from './policy'

export interface PluginHostInput {
  jobId: string
  commandId: string
  document?: { text: string; selections: { anchor: number; head: number }[] }
}
export type PluginHostCall = (kind: string, input: unknown) => Promise<unknown>
/** Each invocation owns a distinct sandboxed renderer, session and code origin. */
export class PluginHost {
  private window: BrowserWindow | null = null
  private readonly partition = session.fromPartition(`manuslip-plugin-${randomUUID()}`, {
    cache: false,
  })
  private readonly origin = pluginOrigin()
  constructor(private readonly editorProcess: () => number) {}
  async run(
    code: string,
    input: PluginHostInput,
    call: PluginHostCall,
    signal: AbortSignal,
  ): Promise<string> {
    const url = `${this.origin}/index.html`,
      calls = new Set<Promise<void>>()
    this.partition.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
    this.partition.setPermissionCheckHandler(() => false)
    this.partition.webRequest.onBeforeRequest((details, reply) =>
      reply({ cancel: !pluginAsset(details.url, this.origin) }),
    )
    this.partition.webRequest.onHeadersReceived((_details, reply) =>
      reply({ responseHeaders: { 'Content-Security-Policy': [pluginCsp] } }),
    )
    this.partition.protocol.handle('manuslip-plugin', (request) => {
      const asset = pluginAsset(request.url, this.origin)
      if (!asset || request.method !== 'GET') return new Response(null, { status: 404 })
      return new Response(asset === 'host' ? pluginHostHtml : code, {
        headers: {
          'Content-Type':
            asset === 'host' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
          'Content-Security-Policy': pluginCsp,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    })
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 320,
      height: 240,
      title: 'Manuslip plugin command',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/plugin.cjs'),
        session: this.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    })
    this.window = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-frame-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    const trusted = (event: IpcMainEvent): boolean =>
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame?.url === url
    let cleanup = (): void => {}
    try {
      return await new Promise<string>((resolve, reject) => {
        let finished = false,
          started = false,
          callsMade = 0
        const fail = (
          code: 'plugin-failed' | 'plugin-cancelled' | 'plugin-limit' = 'plugin-failed',
        ): void => finish(new FileOperationError(code))
        const finish = (error?: unknown, text?: string): void => {
          if (finished) return
          finished = true
          this.destroy()
          if (error) reject(error)
          else resolve(text || '')
        }
        const abort = (): void =>
          finish(
            signal.reason instanceof FileOperationError
              ? signal.reason
              : new FileOperationError('plugin-cancelled'),
          )
        const gone = (): void => fail()
        const ready = (event: IpcMainEvent): void => {
          if (!trusted(event) || finished) return
          if (
            started ||
            !window.webContents.getOSProcessId() ||
            window.webContents.getOSProcessId() === this.editorProcess()
          ) {
            fail()
            return
          }
          started = true
          window.webContents.send(pluginHostChannels.job, input)
        }
        const result = (event: IpcMainEvent, output: unknown): void => {
          if (!trusted(event) || !started || finished) return
          try {
            if (
              !output ||
              typeof output !== 'object' ||
              !('jobId' in output) ||
              output.jobId !== input.jobId ||
              !('ok' in output)
            ) {
              fail()
              return
            }
            if (output.ok !== true || !('text' in output)) {
              fail()
              return
            }
            finish(undefined, pluginText(output.text))
          } catch {
            fail('plugin-limit')
          }
        }
        const request = (event: IpcMainEvent, value: unknown): void => {
          if (!trusted(event) || !started || finished) return
          if (
            !value ||
            typeof value !== 'object' ||
            !('jobId' in value) ||
            value.jobId !== input.jobId ||
            !('id' in value) ||
            !Number.isSafeInteger(value.id) ||
            !('kind' in value) ||
            typeof value.kind !== 'string' ||
            !('input' in value) ||
            calls.size ||
            ++callsMade > pluginLimits.calls
          ) {
            fail('plugin-limit')
            return
          }
          const valueId = value.id
          const operation = Promise.resolve()
            .then(() => call(value.kind as string, value.input))
            .then(
              (value) => {
                if (!finished && !window.isDestroyed())
                  window.webContents.send(pluginHostChannels.reply, {
                    jobId: input.jobId,
                    id: valueId,
                    ok: true,
                    value,
                  })
              },
              () => {
                if (!finished && !window.isDestroyed())
                  window.webContents.send(pluginHostChannels.reply, {
                    jobId: input.jobId,
                    id: valueId,
                    ok: false,
                  })
              },
            )
          calls.add(operation)
          void operation.finally(() => calls.delete(operation)).catch(() => fail())
        }
        ipcMain.on(pluginHostChannels.ready, ready)
        ipcMain.on(pluginHostChannels.result, result)
        ipcMain.on(pluginHostChannels.call, request)
        window.webContents.once('render-process-gone', gone)
        window.once('closed', gone)
        signal.addEventListener('abort', abort, { once: true })
        cleanup = () => {
          ipcMain.removeListener(pluginHostChannels.ready, ready)
          ipcMain.removeListener(pluginHostChannels.result, result)
          ipcMain.removeListener(pluginHostChannels.call, request)
          signal.removeEventListener('abort', abort)
          if (!window.isDestroyed()) window.webContents.removeListener('render-process-gone', gone)
          window.removeListener('closed', gone)
        }
        if (signal.aborted) abort()
        else void window.loadURL(url).catch(() => fail())
      })
    } finally {
      cleanup()
      this.destroy()
      await Promise.allSettled(calls)
      this.partition.webRequest.onBeforeRequest(null)
      this.partition.webRequest.onHeadersReceived(null)
      await this.partition.protocol.unhandle('manuslip-plugin')
      await this.partition.clearStorageData().catch(() => {})
    }
  }
  private destroy(): void {
    const window = this.window
    this.window = null
    if (!window || window.isDestroyed()) return
    if (
      window.webContents.getOSProcessId() &&
      window.webContents.getOSProcessId() !== this.editorProcess()
    )
      window.webContents.forcefullyCrashRenderer()
    window.destroy()
  }
}
