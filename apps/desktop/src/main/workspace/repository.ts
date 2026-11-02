import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { FileSnapshot } from '../../shared/file-contracts'
import {
  type RememberDocuments,
  type RestoreFile,
  type WorkspaceBootstrap,
  type WorkspacePage,
  workspaceLimits,
} from '../../shared/workspace-contracts'
import { FileOperationError, fileError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { WorkspaceCatalog } from './catalog'
import {
  authorizeRestoredFile,
  authorizeWorkspaceFile,
  grantRoot,
  type RootGrant,
  resolveNode,
} from './paths'
import type { WorkspaceStateRepository } from './state'

/** Grants belong to an owner; renderer requests contain IDs rather than paths. */
export class WorkspaceRepository {
  private readonly catalogs = new Map<number, WorkspaceCatalog>()
  private readonly recentIds = new Map<string, string>()
  private readonly restores = new Map<string, RestoreFile & { path: string; opened: boolean }>()
  private readonly started = new Set<number>()
  private readonly forgetting = new Set<string>()
  private missingRoot = false
  private listing = false
  private readonly listingWaiters: (() => void)[] = []
  constructor(
    private readonly state: WorkspaceStateRepository,
    private readonly files: FileSessions,
    private readonly changed: (owner: number) => void = () => {},
  ) {
    this.resetRestores()
  }
  private resetRestores(): void {
    this.forgetting.clear()
    this.restores.clear()
    const saved = this.state.get()
    for (const path of saved.documents) {
      const id = randomUUID()
      this.restores.set(id, {
        id,
        name: basename(path),
        displayPath: path,
        path,
        active: path === saved.activePath,
        opened: false,
      })
    }
  }
  async bootstrap(owner: number): Promise<WorkspaceBootstrap> {
    if (!this.started.has(owner)) {
      this.started.add(owner)
      const path = this.state.get().root
      if (path) {
        try {
          const grant = await grantRoot(path)
          if (grant.path !== path) throw new FileOperationError('workspace-changed')
          this.catalogs.set(owner, new WorkspaceCatalog(grant))
        } catch {
          this.missingRoot = true
        }
      }
    }
    return this.describe(owner)
  }
  describe(owner: number): WorkspaceBootstrap {
    return {
      root: this.catalogs.get(owner)?.root || null,
      recents: this.state.get().recents.map((path) => {
        let id = [...this.recentIds].find(([, value]) => value === path)?.[0]
        if (!id) {
          id = randomUUID()
          this.recentIds.set(id, path)
        }
        return { id, name: basename(path) || path, displayPath: path }
      }),
      restore: [...this.restores.values()]
        .filter((item) => !item.opened)
        .map(({ path: _path, opened: _opened, ...entry }) => entry),
      recovered: this.state.recovered,
      readOnly: this.state.readOnly,
      persistenceError: this.state.persistenceError,
      missingRoot: this.missingRoot,
    }
  }
  async choose(owner: number, path: string): Promise<WorkspaceBootstrap> {
    const grant = await grantRoot(path)
    this.changed(owner)
    this.catalogs.set(owner, new WorkspaceCatalog(grant))
    this.started.add(owner)
    this.missingRoot = false
    const recents = [
      grant.path,
      ...this.state.get().recents.filter((entry) => entry !== grant.path),
    ].slice(0, workspaceLimits.recent)
    await this.state.save({ root: grant.path, recents }).catch(() => {})
    for (const [id, path] of this.recentIds) if (!recents.includes(path)) this.recentIds.delete(id)
    return this.describe(owner)
  }
  async recent(owner: number, id: string): Promise<WorkspaceBootstrap> {
    const path = this.recentIds.get(id)
    if (!path) throw new FileOperationError('workspace-session')
    return this.choose(owner, path)
  }
  async refresh(owner: number): Promise<WorkspaceBootstrap> {
    const catalog = this.catalogs.get(owner)
    if (!catalog) return this.bootstrap(owner)
    await catalog.path(catalog.root.id, true)
    this.changed(owner)
    this.catalogs.set(owner, new WorkspaceCatalog(catalog.grant))
    return this.describe(owner)
  }
  async list(owner: number, id: string, offset: number): Promise<WorkspacePage> {
    const catalog = this.catalogs.get(owner)
    if (!catalog) throw new FileOperationError('workspace-session')
    if (this.listing) {
      if (this.listingWaiters.length >= workspaceLimits.listingQueue)
        throw new FileOperationError('workspace-busy')
      await new Promise<void>((resolve) => this.listingWaiters.push(resolve))
    } else this.listing = true
    try {
      if (this.catalogs.get(owner) !== catalog) throw new FileOperationError('workspace-session')
      const result = await catalog.list(id, offset)
      if (this.catalogs.get(owner) !== catalog) throw new FileOperationError('workspace-session')
      return result
    } catch (error) {
      throw fileError(error)
    } finally {
      const next = this.listingWaiters.shift()
      if (next) next()
      else this.listing = false
    }
  }
  async open(owner: number, id: string): Promise<FileSnapshot> {
    const catalog = this.catalogs.get(owner)
    if (!catalog) throw new FileOperationError('workspace-session')
    const path = await catalog.path(id, false)
    return this.files.open(
      owner,
      path,
      undefined,
      true,
      authorizeWorkspaceFile(catalog.grant, path),
      catalog.grant,
    )
  }
  async restore(owner: number, id: string): Promise<FileSnapshot> {
    const entry = this.restores.get(id)
    if (!entry) throw new FileOperationError('workspace-session')
    let root = this.catalogs.get(owner)?.grant
    if (root) {
      try {
        await resolveNode(root, entry.path, false)
      } catch {
        root = undefined
      }
    }
    const snapshot = await this.files.open(
      owner,
      entry.path,
      undefined,
      true,
      authorizeRestoredFile(entry.path),
      root,
    )
    entry.opened = true
    return snapshot
  }
  async forget(id: string): Promise<void> {
    const entry = this.restores.get(id)
    if (!entry || entry.opened) throw new FileOperationError('workspace-session')
    this.forgetting.add(id)
    const saved = this.state.get()
    const documents = saved.documents.filter((path) => path !== entry.path)
    await this.state.save({
      documents,
      activePath: saved.activePath === entry.path ? null : saved.activePath,
    })
    this.restores.delete(id)
  }
  async remember(owner: number, input: RememberDocuments): Promise<void> {
    const paths = input.ids
      .map((id) => this.files.describe(owner, id).displayPath)
      .filter((path): path is string => path !== null)
    const unavailable = [...this.restores.values()]
      .filter((entry) => !entry.opened && !this.forgetting.has(entry.id))
      .map((entry) => entry.path)
    const documents = [...new Set([...paths, ...unavailable])]
    if (documents.length > 32) throw new FileOperationError('workspace-restore-limit')
    const activePath = input.activeId
      ? this.files.describe(owner, input.activeId).displayPath
      : null
    await this.state.save({ documents, activePath })
  }
  closeOwner(owner: number): void {
    this.changed(owner)
    this.catalogs.delete(owner)
    this.started.delete(owner)
    if (!this.started.size) this.resetRestores()
  }
  searchGrant(owner: number, rootId: string): RootGrant {
    const catalog = this.catalogs.get(owner)
    if (!catalog || catalog.root.id !== rootId) throw new FileOperationError('workspace-session')
    return catalog.grant
  }
}
