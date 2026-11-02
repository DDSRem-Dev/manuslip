import type { BrowserWindow } from 'electron'
import { parseId } from '../../shared/file-contracts'
import {
  parseSearchOpen,
  parseSearchPoll,
  parseSearchRequest,
  searchChannels,
} from '../../shared/search-contracts'
import type { FileSessions } from '../files/sessions'
import { withOwnedWindow } from '../owned-window'
import type { WorkspaceRepository } from '../workspace/repository'
import type { SearchRepository } from './repository'

type Register = <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void
export function registerSearchHandlers(
  register: Register,
  getWindow: () => BrowserWindow | null,
  workspace: WorkspaceRepository,
  searches: SearchRepository,
  files: FileSessions,
): void {
  const owned = <T>(operation: (owner: number) => Promise<T> | T): Promise<T> =>
    withOwnedWindow(
      getWindow,
      async (owner) => {
        workspace.closeOwner(owner)
        await files.closeOwner(owner)
      },
      async (window) => operation(window.webContents.id),
    )
  register(searchChannels.start, (input) => {
    const request = parseSearchRequest(input)
    return owned((owner) => {
      searches.start(owner, request, workspace.searchGrant(owner, request.rootId))
      return null
    })
  })
  register(searchChannels.poll, (input) => {
    const request = parseSearchPoll(input)
    return owned((owner) => searches.poll(owner, request.id, request.cursor))
  })
  register(searchChannels.cancel, (input) => {
    const id = parseId(input)
    return owned((owner) => {
      searches.cancel(owner, id)
      return null
    })
  })
  register(searchChannels.open, (input) => {
    const request = parseSearchOpen(input)
    return owned((owner) => searches.open(owner, request.id, request.entryId))
  })
}
