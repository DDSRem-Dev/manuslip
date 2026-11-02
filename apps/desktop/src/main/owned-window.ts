import type { BrowserWindow } from 'electron'
import { FileOperationError } from './files/errors'

/** Revoke late async results after their originating window/frame has gone away. */
export async function withOwnedWindow<T>(
  getWindow: () => BrowserWindow | null,
  revoke: (owner: number) => Promise<void>,
  operation: (window: BrowserWindow) => Promise<T>,
): Promise<T> {
  const window = getWindow()
  if (!window || window.isDestroyed()) throw new FileOperationError('file-session')
  const owner = window.webContents.id
  const frame = window.webContents.mainFrame
  const alive = (): boolean =>
    getWindow() === window && !window.isDestroyed() && window.webContents.mainFrame === frame
  try {
    const result = await operation(window)
    if (!alive()) throw new FileOperationError('file-session')
    return result
  } finally {
    if (!alive()) await revoke(owner)
  }
}
