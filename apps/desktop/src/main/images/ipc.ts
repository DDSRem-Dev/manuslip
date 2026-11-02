import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../../shared/contracts'
import {
  imageChannels,
  parseImagePermission,
  parseImageRequest,
} from '../../shared/image-contracts'
import type { FileSessions } from '../files/sessions'
import { nativeStrings } from '../native-strings'
import type { ImageRepository } from './repository'

export function registerImageHandlers(
  register: <T>(channel: string, operation: (input: unknown) => T | Promise<T>) => void,
  getWindow: () => BrowserWindow | null,
  locale: () => Locale,
  files: FileSessions,
  images: ImageRepository,
): void {
  const prompts = new Map<string, { promise: Promise<boolean>; valid: boolean }>()
  register(imageChannels.permission, async (input) => {
    const request = parseImagePermission(input)
    const window = getWindow()
    if (!window) throw new Error('image-session')
    const owner = window.webContents.id
    files.describe(owner, request.id)
    if (!request.enabled) {
      const pending = prompts.get(request.id)
      if (pending) pending.valid = false
      images.permission(owner, request.id, false)
      return false
    }
    const existing = prompts.get(request.id)
    if (existing) return existing.promise
    const frame = window.webContents.mainFrame
    const text = nativeStrings(locale())
    const prompt = (async (): Promise<boolean> => {
      const answer = await dialog.showMessageBox(window, {
        type: 'question',
        message: text.remoteImages,
        detail: text.remoteImagesDetail,
        buttons: [text.allowImages, text.cancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (getWindow() !== window || window.isDestroyed() || window.webContents.mainFrame !== frame)
        throw new Error('image-session')
      files.describe(owner, request.id)
      if (!prompts.get(request.id)?.valid) return false
      const enabled = answer.response === 0
      images.permission(owner, request.id, enabled)
      return enabled
    })()
    prompts.set(request.id, { promise: prompt, valid: true })
    try {
      return await prompt
    } finally {
      prompts.delete(request.id)
    }
  })
  register(imageChannels.load, (input) => {
    const request = parseImageRequest(input)
    const owner = getWindow()?.webContents.id
    if (owner === undefined) throw new Error('image-session')
    files.describe(owner, request.id)
    return images.load(owner, request.id, request.url)
  })
}
