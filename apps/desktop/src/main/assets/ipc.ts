import type { BrowserWindow } from 'electron'
import {
  assetChannels,
  parseCaptureRequest,
  parseHtmlRequest,
  parseLocalRequest,
} from '../../shared/asset-contracts'
import { parseId } from '../../shared/file-contracts'
import type { ClipboardConverter } from '../clipboard/converter'
import type { FileSessions } from '../files/sessions'
import { withOwnedWindow } from '../owned-window'
import type { LocalAssets } from './repository'

export function registerAssetHandlers(
  register: <T>(channel: string, operation: (input: unknown) => T | Promise<T>) => void,
  getWindow: () => BrowserWindow | null,
  files: FileSessions,
  assets: LocalAssets,
  converter: ClipboardConverter,
): void {
  const owned = <T>(operation: (owner: number) => Promise<T>): Promise<T> =>
    withOwnedWindow(
      getWindow,
      async (owner) => {
        assets.revokeOwner(owner)
        converter.closeOwner(owner)
      },
      (window) => operation(window.webContents.id),
    )
  register(assetChannels.load, (input) => {
    const { id, reference } = parseLocalRequest(input)
    return owned((owner) => assets.load(owner, id, reference))
  })
  register(assetChannels.capture, (input) => {
    const id = parseId(input)
    return owned(async (owner) => assets.capture(owner, id))
  })
  register(assetChannels.import, (input) => {
    const { id, captureId } = parseCaptureRequest(input)
    return owned((owner) => assets.import(owner, id, captureId))
  })
  register(assetChannels.discard, (input) => {
    const { id, captureId } = parseCaptureRequest(input)
    return owned(async (owner) => {
      assets.discard(owner, id, captureId)
      return null
    })
  })
  register(assetChannels.convert, (input) => {
    const { id, html } = parseHtmlRequest(input)
    return owned(async (owner) => {
      files.describe(owner, id)
      const markdown = await converter.convert(owner, id, html)
      files.describe(owner, id)
      return markdown
    })
  })
}
