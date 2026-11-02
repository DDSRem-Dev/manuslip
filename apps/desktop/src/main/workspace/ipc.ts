import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../../shared/contracts'
import { parseId } from '../../shared/file-contracts'
import {
  parseRememberDocuments,
  parseWorkspaceList,
  workspaceChannels,
} from '../../shared/workspace-contracts'
import type { FileSessions } from '../files/sessions'
import { nativeStrings } from '../native-strings'
import { withOwnedWindow } from '../owned-window'
import type { WorkspaceRepository } from './repository'

type Register = <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void
export function registerWorkspaceHandlers(
  register: Register,
  getWindow: () => BrowserWindow | null,
  locale: () => Locale,
  workspaces: WorkspaceRepository,
  files: FileSessions,
): void {
  const owned = <T>(operation: (window: BrowserWindow) => Promise<T>): Promise<T> =>
    withOwnedWindow(
      getWindow,
      async (owner) => {
        workspaces.closeOwner(owner)
        await files.closeOwner(owner)
      },
      operation,
    )
  const empty = (input: unknown): void => {
    if (input !== null) throw new Error('Expected no workspace input')
  }
  register(workspaceChannels.bootstrap, (input) => {
    empty(input)
    return owned((window) => workspaces.bootstrap(window.webContents.id))
  })
  register(workspaceChannels.choose, (input) => {
    empty(input)
    return owned(async (window) => {
      const frame = window.webContents.mainFrame
      const result = await dialog.showOpenDialog(window, {
        title: nativeStrings(locale()).openFolder,
        properties: ['openDirectory'],
      })
      if (
        getWindow() !== window ||
        window.isDestroyed() ||
        window.webContents.mainFrame !== frame ||
        result.canceled ||
        !result.filePaths[0]
      )
        return null
      return workspaces.choose(window.webContents.id, result.filePaths[0])
    })
  })
  register(workspaceChannels.recent, (input) => {
    const id = parseId(input)
    return owned((window) => workspaces.recent(window.webContents.id, id))
  })
  register(workspaceChannels.refresh, (input) => {
    empty(input)
    return owned((window) => workspaces.refresh(window.webContents.id))
  })
  register(workspaceChannels.list, (input) => {
    const request = parseWorkspaceList(input)
    return owned((window) => workspaces.list(window.webContents.id, request.id, request.offset))
  })
  register(workspaceChannels.open, (input) => {
    const id = parseId(input)
    return owned((window) => workspaces.open(window.webContents.id, id))
  })
  register(workspaceChannels.restore, (input) => {
    const id = parseId(input)
    return owned((window) => workspaces.restore(window.webContents.id, id))
  })
  register(workspaceChannels.forget, (input) => {
    const id = parseId(input)
    return owned(async () => {
      await workspaces.forget(id)
      return null
    })
  })
  register(workspaceChannels.remember, (input) => {
    const request = parseRememberDocuments(input)
    return owned(async (window) => {
      await workspaces.remember(window.webContents.id, request)
      return null
    })
  })
}
