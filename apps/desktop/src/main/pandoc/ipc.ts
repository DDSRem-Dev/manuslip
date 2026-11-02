import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../../shared/contracts'
import { pandocChannels } from '../../shared/pandoc-contracts'
import { FileOperationError } from '../files/errors'
import type { PandocTools } from './tools'

export function registerPandocHandlers(
  register: <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void,
  getWindow: () => BrowserWindow | null,
  locale: () => Locale,
  tools: PandocTools,
): void {
  function owned(input: unknown): { owner: number; window: BrowserWindow; authorize(): void } {
    if (input !== null) throw new FileOperationError('pandoc-invalid')
    const window = getWindow()
    if (!window || window.isDestroyed()) throw new FileOperationError('file-session')
    const frame = window.webContents.mainFrame
    return {
      owner: window.webContents.id,
      window,
      authorize: () => {
        if (
          getWindow() !== window ||
          window.isDestroyed() ||
          window.webContents.mainFrame !== frame
        )
          throw new FileOperationError('file-session')
      },
    }
  }
  register(pandocChannels.get, (input) => {
    owned(input).authorize()
    return tools.state()
  })
  register(pandocChannels.select, (input) => {
    const context = owned(input)
    return tools.select(
      context.owner,
      async () => {
        const result = await dialog.showOpenDialog(context.window, {
          title: locale() === 'zh-CN' ? '选择 Pandoc 应用程序' : 'Choose Pandoc application',
          properties: ['openFile'],
          ...(process.platform === 'win32'
            ? { filters: [{ name: 'Pandoc', extensions: ['exe'] }] }
            : {}),
        })
        context.authorize()
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      context.authorize,
    )
  })
  register(pandocChannels.forget, (input) => tools.forget(owned(input).authorize))
  register(pandocChannels.retry, (input) => tools.retry(owned(input).authorize))
}
