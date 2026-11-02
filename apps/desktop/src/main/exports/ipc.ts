import { type BrowserWindow, dialog } from 'electron'
import { exportChannels, parseExportRequest } from '../../shared/export-contracts'
import { parseId } from '../../shared/file-contracts'
import { FileOperationError } from '../files/errors'
import { withOwnedWindow } from '../owned-window'
import { pandocExtension } from '../pandoc/arguments'
import type { ExportManager } from './manager'

export function registerExportHandlers(
  register: <T>(channel: string, operation: (input: unknown) => T | Promise<T>) => void,
  getWindow: () => BrowserWindow | null,
  manager: ExportManager,
): void {
  register(exportChannels.start, (input) => {
    let request: ReturnType<typeof parseExportRequest>
    try {
      request = parseExportRequest(input)
    } catch (error) {
      throw new FileOperationError(
        error instanceof Error && error.message === 'export-limit'
          ? 'export-limit'
          : 'export-invalid',
      )
    }
    return withOwnedWindow(
      getWindow,
      async (owner) => manager.closeOwner(owner),
      async (window) =>
        manager.start(window, request, async (defaultPath) => {
          const format =
            request.format === 'pandoc' && request.pandoc
              ? request.pandoc.format.toUpperCase()
              : request.format.toUpperCase()
          const extension =
            request.format === 'pandoc' && request.pandoc
              ? pandocExtension(request.pandoc)
              : request.format
          const result = await dialog.showSaveDialog(window, {
            title: request.locale === 'zh-CN' ? `导出 ${format}` : `Export ${format}`,
            defaultPath,
            filters: [
              {
                name: format,
                extensions: request.format === 'jpeg' ? ['jpeg', 'jpg'] : [extension],
              },
            ],
          })
          return result.canceled ? null : result.filePath || null
        }),
    )
  })
  register(exportChannels.cancel, (input) => {
    const id = parseId(input)
    const owner = getWindow()?.webContents.id
    if (owner !== undefined) manager.cancel(owner, id)
    return null
  })
}
