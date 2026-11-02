import { join } from 'node:path'
import { type BrowserWindow, safeStorage } from 'electron'
import { parseId } from '../../shared/file-contracts'
import { parseTranslationRequest, translationChannels } from '../../shared/translation-contracts'
import type { FileSessions } from '../files/sessions'
import { TranslationCacheWorker } from './cache'
import { TranslationConfiguration } from './configuration'
import { TranslationCredentials } from './credentials'
import { TranslationService } from './service'

export function registerTranslationHandlers(
  register: <T>(channel: string, operation: (input: unknown) => T | Promise<T>) => void,
  getWindow: () => BrowserWindow | null,
  files: FileSessions,
  directory: string,
): TranslationService {
  const changed = (): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(translationChannels.changed)
  }
  const service = new TranslationService(
    new TranslationConfiguration(join(directory, 'translation-settings.json')),
    new TranslationCredentials(join(directory, 'translation-credential.json'), {
      available: async () => {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
        return (
          process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
        )
      },
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value),
    }),
    new TranslationCacheWorker(join(directory, 'translation-cache.sqlite'), changed),
    changed,
  )
  const noInput = (input: unknown): void => {
    if (input !== null) throw new Error('Expected no input')
  }
  register(translationChannels.state, (input) => {
    noInput(input)
    return service.state()
  })
  register(translationChannels.configure, (input) => service.configure(input))
  register(translationChannels.languages, (input) => {
    noInput(input)
    return service.loadLanguages()
  })
  register(translationChannels.credential, (input) => service.setCredential(input))
  register(translationChannels.clear, (input) => {
    noInput(input)
    return service.clear()
  })
  register(translationChannels.unit, (input) => {
    const request = parseTranslationRequest(input)
    const owner = getWindow()?.webContents.id
    if (owner === undefined) throw new Error('Window closed')
    files.describe(owner, request.documentId)
    return service.request(owner, request)
  })
  register(translationChannels.cancel, (input) => {
    const id = parseId(input)
    const owner = getWindow()?.webContents.id
    if (owner !== undefined) service.cancel(owner, id)
    return null
  })
  return service
}
