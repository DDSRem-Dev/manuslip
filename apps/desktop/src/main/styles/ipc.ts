import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../../shared/contracts'
import { parseId } from '../../shared/file-contracts'
import {
  parseStyleReset,
  parseTypographyRequest,
  styleChannels,
} from '../../shared/style-contracts'
import { FileOperationError } from '../files/errors'
import type { WritingStyles } from './service'

type Register = <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void
export function registerStyleHandlers(
  register: Register,
  getWindow: () => BrowserWindow | null,
  locale: () => Locale,
  styles: WritingStyles,
): void {
  function owned(): { owner: number; window: BrowserWindow; authorize(): void } {
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
  register(styleChannels.get, (input) => {
    const context = owned()
    return styles.get(context.owner, parseId(input), context.authorize)
  })
  register(styleChannels.set, (input) => {
    const context = owned(),
      request = parseTypographyRequest(input)
    return styles.set(context.owner, request.id, request.typography, context.authorize)
  })
  register(styleChannels.reset, (input) => {
    const context = owned(),
      request = parseStyleReset(input)
    return styles.reset(context.owner, request.id, request.stylesheetOnly, context.authorize)
  })
  register(styleChannels.import, (input) => {
    const context = owned()
    return styles.import(
      context.owner,
      parseId(input),
      async () => {
        const result = await dialog.showOpenDialog(context.window, {
          title: locale() === 'zh-CN' ? '导入文档样式' : 'Import document stylesheet',
          properties: ['openFile'],
          filters: [{ name: 'CSS', extensions: ['css'] }],
        })
        context.authorize()
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      context.authorize,
    )
  })
}
