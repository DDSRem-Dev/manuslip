import type { BrowserWindow } from 'electron'
import { parseId } from '../shared/file-contracts'
import { incomingChannels } from '../shared/incoming-contracts'
import { FileOperationError } from './files/errors'
import type { FileSessions } from './files/sessions'
import { type IncomingFiles, parseDroppedPaths } from './incoming'
import { withOwnedWindow } from './owned-window'

type Register = <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void
export function registerIncomingHandlers(
  register: Register,
  getWindow: () => BrowserWindow | null,
  incoming: IncomingFiles,
  files: FileSessions,
): void {
  const owner = (): number => {
    const window = getWindow()
    if (!window || window.isDestroyed()) throw new FileOperationError('file-session')
    return window.webContents.id
  }
  register(incomingChannels.list, (input) => {
    if (input !== null) throw new Error('Invalid incoming list')
    return incoming.list(owner())
  })
  register(incomingChannels.open, (input) => {
    const id = parseId(input)
    return withOwnedWindow(
      getWindow,
      async (owner) => {
        incoming.closeOwner(owner)
        await files.closeOwner(owner)
      },
      (window) =>
        incoming.open(window.webContents.id, id, (path) =>
          files.open(window.webContents.id, path, undefined, true),
        ),
    )
  })
  register(incomingChannels.dismiss, (input) => {
    incoming.dismiss(owner(), input === null ? null : parseId(input))
    return null
  })
  register(incomingChannels.drop, (input) => {
    owner()
    incoming.enqueue(parseDroppedPaths(input))
    return null
  })
}
