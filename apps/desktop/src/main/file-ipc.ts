import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../shared/contracts'
import {
  fileChannels,
  parseCheckpoint,
  parseId,
  parseRevision,
  parseSaveRequest,
  record,
  string,
} from '../shared/file-contracts'
import { FileOperationError } from './files/errors'
import type { RecoveryRepository } from './files/recovery'
import { FileSessions } from './files/sessions'
import { nativeStrings } from './native-strings'
import { withOwnedWindow } from './owned-window'

type Register = <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void
export function registerFileHandlers(
  register: Register,
  getWindow: () => BrowserWindow | null,
  locale: () => Locale,
  closeWindow: (proceed: boolean) => void,
  recovery: RecoveryRepository,
  closed: (owner: number, id: string) => void = () => {},
): FileSessions {
  const window = (): BrowserWindow => {
    const current = getWindow()
    if (!current) throw new FileOperationError('file-session')
    return current
  }
  const files = new FileSessions((owner, id) => {
    const current = getWindow()
    if (current?.webContents.id === owner && !current.isDestroyed())
      current.webContents.send(fileChannels.changed, id)
  })
  register(fileChannels.checkpoint, async (input) => {
    const request = parseCheckpoint(input)
    await recovery.checkpoint(request, files.describe(window().webContents.id, request.id))
    return null
  })
  register(fileChannels.clearRecovery, async (input) => {
    const value = record(input)
    if (Object.keys(value).some((key) => !['id', 'revision'].includes(key)))
      throw new Error('Invalid recovery removal')
    const id = parseId(value.id)
    files.describe(window().webContents.id, id)
    await recovery.clear(id, parseRevision(value.revision))
    return null
  })
  register(fileChannels.recoveries, async (input) => {
    if (input !== null) throw new Error('Invalid recovery list')
    await recovery.retryLoad()
    return recovery.list()
  })
  register(fileChannels.restoreRecovery, async (input) => {
    const current = window()
    const frame = current.webContents.mainFrame
    const id = parseId(input)
    const text = await recovery.restore(id)
    if (getWindow() !== current || current.isDestroyed() || current.webContents.mainFrame !== frame)
      throw new FileOperationError('file-session')
    const snapshot = files.create(current.webContents.id)
    try {
      recovery.claim(id, snapshot.info.id)
    } catch (error) {
      await files.close(current.webContents.id, snapshot.info.id)
      throw error
    }
    return { info: snapshot.info, text }
  })
  register(fileChannels.discardRecovery, async (input) => {
    await recovery.discard(parseId(input))
    return null
  })
  register(fileChannels.create, (input) => {
    if (input !== null) throw new Error('Invalid new command')
    return files.create(window().webContents.id)
  })
  register(fileChannels.open, async (input) => {
    if (input !== null) throw new Error('Invalid open command')
    return withOwnedWindow(
      getWindow,
      (owner) => files.closeOwner(owner),
      async (current) => {
        const frame = current.webContents.mainFrame
        const text = nativeStrings(locale())
        const result = await dialog.showOpenDialog(current, {
          title: text.open,
          properties: ['openFile'],
          filters: [
            { name: text.markdown, extensions: ['md', 'markdown', 'mdown', 'txt'] },
            { name: text.all, extensions: ['*'] },
          ],
        })
        const path = result.filePaths[0]
        if (
          getWindow() !== current ||
          current.isDestroyed() ||
          current.webContents.mainFrame !== frame
        )
          throw new FileOperationError('file-session')
        return result.canceled || !path
          ? null
          : files.open(current.webContents.id, path, undefined, true)
      },
    )
  })
  register(fileChannels.save, async (input) => {
    const request = parseSaveRequest(input)
    const current = window()
    const text = nativeStrings(locale())
    return files.save(current.webContents.id, request, {
      open: async () => null,
      save: async (suggestedPath) => {
        const result = await dialog.showSaveDialog(current, {
          title: request.action === 'save-copy' ? text.copy : text.saveAs,
          defaultPath: suggestedPath,
          filters: [
            { name: text.markdown, extensions: ['md'] },
            { name: text.all, extensions: ['*'] },
          ],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })
        return result.canceled ? null : result.filePath || null
      },
      overwrite: async () =>
        (
          await dialog.showMessageBox(current, {
            type: 'warning',
            message: text.overwrite,
            detail: text.overwriteDetail,
            buttons: [text.replace, text.cancel],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          })
        ).response === 0,
    })
  })
  register(fileChannels.reload, (input) => {
    const value = record(input)
    if (Object.keys(value).some((key) => !['id', 'encoding'].includes(key)))
      throw new Error('Invalid reload request')
    return files.reload(
      window().webContents.id,
      parseId(value.id),
      value.encoding === undefined ? undefined : string(value.encoding, 80),
    )
  })
  register(fileChannels.close, async (input) => {
    const owner = window().webContents.id
    const id = parseId(input)
    await files.close(owner, id)
    closed(owner, id)
    return null
  })
  register(fileChannels.confirmClose, async (input) => {
    const current = window()
    const info = files.describe(current.webContents.id, parseId(input))
    const text = nativeStrings(locale())
    const result = await dialog.showMessageBox(current, {
      type: 'warning',
      message: text.unsaved,
      detail: `${info.displayPath || info.name}\n\n${text.unsavedDetail}`,
      buttons: [text.save, text.discard, text.cancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    return (['save', 'discard', 'cancel'] as const)[result.response] || 'cancel'
  })
  register(fileChannels.closeWindow, (input) => {
    if (typeof input !== 'boolean') throw new Error('Invalid close command')
    closeWindow(input)
    return null
  })
  return files
}
