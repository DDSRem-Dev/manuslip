import { join } from 'node:path'
import { type BrowserWindow, dialog, safeStorage } from 'electron'
import type { Locale } from '../../shared/contracts'
import { parseId, record } from '../../shared/file-contracts'
import {
  parseSyncChoice,
  parseSyncConnect,
  parseSyncCredential,
  parseSyncRecoveryId,
  syncChannels,
} from '../../shared/sync-contracts'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { SyncRecoveryRepository } from './recovery'
import { SyncRepository } from './repository'
import { type SyncDialogs, SyncService } from './service'

export function registerSyncHandlers(
  register: <T>(channel: string, operation: (input: unknown) => T | Promise<T>) => void,
  getWindow: () => BrowserWindow | null,
  files: FileSessions,
  directory: string,
  locale: () => Locale,
): SyncService {
  const service = new SyncService(
    new SyncRepository(join(directory, 'sync-connections.json')),
    new SyncRecoveryRepository(join(directory, 'sync-recovery')),
    files,
    {
      available: async () =>
        (await safeStorage.isAsyncEncryptionAvailable()) &&
        (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value),
    },
  )
  function context(): { owner: number; authorize(): void; dialogs: SyncDialogs } {
    const window = getWindow()
    if (!window || window.isDestroyed()) throw new FileOperationError('file-session')
    const frame = window.webContents.mainFrame
    const authorize = (): void => {
      if (getWindow() !== window || window.isDestroyed() || window.webContents.mainFrame !== frame)
        throw new FileOperationError('file-session')
    }
    return {
      owner: window.webContents.id,
      authorize,
      dialogs: {
        folder: async () => {
          const selected = await dialog.showOpenDialog(window, {
            title: locale() === 'zh-CN' ? '选择同步文件夹' : 'Choose sync folder',
            properties: ['openDirectory'],
          })
          authorize()
          return selected.canceled ? null : selected.filePaths[0] || null
        },
        save: async (name, artifact) => {
          const selected = await dialog.showSaveDialog(window, {
            title: locale() === 'zh-CN' ? '导出同步恢复副本' : 'Export sync recovery copy',
            defaultPath: name,
            filters: artifact
              ? [{ name: 'Recovery artifact', extensions: ['sync-copy'] }]
              : [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
          })
          authorize()
          return selected.canceled ? null : selected.filePath || null
        },
      },
    }
  }
  function parse<T>(parser: (input: unknown) => T, input: unknown): T {
    try {
      return parser(input)
    } catch {
      throw new FileOperationError('sync-invalid')
    }
  }
  register(syncChannels.state, (input) => {
    const owner = context()
    return service.state(owner.owner, parse(parseId, input), owner.authorize)
  })
  register(syncChannels.connect, (input) => {
    const owner = context()
    return service.connect(
      owner.owner,
      parse(parseSyncConnect, input),
      owner.dialogs,
      owner.authorize,
    )
  })
  register(syncChannels.credential, (input) => {
    const owner = context()
    return service.credential(owner.owner, parse(parseSyncCredential, input), owner.authorize)
  })
  register(syncChannels.review, (input) => {
    const owner = context()
    return service.review(owner.owner, parse(parseId, input), owner.authorize)
  })
  register(syncChannels.resolve, (input) => {
    const owner = context(),
      value = record(input)
    if (Object.keys(value).sort().join() !== 'choice,token')
      throw new FileOperationError('sync-invalid')
    return service.resolve(
      owner.owner,
      parse(parseId, value.token),
      parse(parseSyncChoice, value.choice),
      owner.dialogs,
      owner.authorize,
    )
  })
  register(syncChannels.cancel, (input) => {
    const owner = context()
    service.cancel(owner.owner, parse(parseId, input))
    return null
  })
  register(syncChannels.disconnect, (input) => {
    const owner = context()
    return service.disconnect(owner.owner, parse(parseId, input), owner.authorize)
  })
  register(syncChannels.export, (input) => {
    const owner = context()
    return service.exportRecovery(
      owner.owner,
      parse(parseSyncRecoveryId, input),
      owner.dialogs,
      owner.authorize,
    )
  })
  register(syncChannels.remove, async (input) => {
    const owner = context()
    await service.removeRecovery(owner.owner, parse(parseSyncRecoveryId, input), owner.authorize)
    return null
  })
  return service
}
