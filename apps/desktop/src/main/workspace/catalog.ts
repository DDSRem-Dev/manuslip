import { randomUUID } from 'node:crypto'
import { opendir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  type WorkspaceNode,
  type WorkspacePage,
  type WorkspaceRoot,
  workspaceLimits,
} from '../../shared/workspace-contracts'
import { FileOperationError } from '../files/errors'
import { type RootGrant, resolveNode } from './paths'
import { WorkspaceWatcher } from './watcher'

interface Node extends WorkspaceNode {
  relative: string
  depth: number
}
interface Listing {
  nodes: WorkspaceNode[]
  truncated: boolean
  skippedLinks: boolean
}
const nameOrder = new Intl.Collator(undefined, { numeric: true })

export class WorkspaceCatalog {
  readonly root: WorkspaceRoot
  private readonly nodes = new Map<string, Node>()
  private readonly listings = new Map<string, Promise<Listing>>()
  private readonly children = new Map<string, Map<string, Node>>()
  private readonly watcher: WorkspaceWatcher
  private bytes = 0
  private disposed = false
  constructor(
    readonly grant: RootGrant,
    private readonly changed: (directoryId: string) => void = () => {},
  ) {
    this.root = {
      id: randomUUID(),
      name: basename(grant.path) || grant.path,
      kind: 'directory',
      displayPath: grant.path,
    }
    this.nodes.set(this.root.id, { ...this.root, relative: '', depth: 0 })
    this.watcher = new WorkspaceWatcher((id) => this.invalidate(id))
  }
  invalidate(id?: string): void {
    if (this.disposed) return
    const directories = id
      ? [id]
      : new Set([this.root.id, ...this.listings.keys(), ...this.children.keys()])
    for (const directoryId of directories) {
      if (!this.nodes.has(directoryId)) continue
      this.listings.delete(directoryId)
      this.changed(directoryId)
    }
  }
  dispose(): void {
    this.disposed = true
    this.watcher.dispose()
    this.listings.clear()
    this.children.clear()
    this.nodes.clear()
  }
  async path(id: string, directory: boolean): Promise<string> {
    const node = this.nodes.get(id)
    if (this.disposed || !node || (node.kind === 'directory') !== directory)
      throw new FileOperationError('workspace-session')
    return resolveNode(this.grant, join(this.grant.path, node.relative), directory)
  }
  async list(id: string, offset: number): Promise<WorkspacePage> {
    const path = await this.path(id, true)
    const node = this.nodes.get(id)
    if (!node) throw new FileOperationError('workspace-session')
    let pending = this.listings.get(id)
    if (!pending) {
      this.watcher.watch(id, path)
      pending = this.scan(path, node)
      this.listings.set(id, pending)
      const listing = pending
      pending.catch(() => {
        if (this.listings.get(id) === listing) this.listings.delete(id)
      })
    }
    const listing = await pending
    if (this.disposed) throw new FileOperationError('workspace-session')
    // A filesystem event during a scan must not publish the obsolete listing.
    if (this.listings.get(id) !== pending) return this.list(id, offset)
    const next = offset + workspaceLimits.page
    return {
      nodes: listing.nodes.slice(offset, next),
      next: next < listing.nodes.length ? next : null,
      truncated: listing.truncated,
      skippedLinks: listing.skippedLinks,
    }
  }
  private async scan(path: string, parent: Node): Promise<Listing> {
    const listing: Listing = { nodes: [], truncated: false, skippedLinks: false }
    if (parent.depth >= workspaceLimits.depth) return { ...listing, truncated: true }
    const candidates: Pick<Node, 'name' | 'kind'>[] = []
    const directory = await opendir(path)
    let scanned = 0
    for await (const entry of directory) {
      if (++scanned > workspaceLimits.scan) {
        listing.truncated = true
        break
      }
      if (entry.isSymbolicLink()) {
        listing.skippedLinks = true
        continue
      }
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      if (entry.isDirectory()) candidates.push({ name: entry.name, kind: 'directory' })
      else if (entry.isFile() && /\.(?:md|markdown|mdown|txt)$/i.test(entry.name))
        candidates.push({ name: entry.name, kind: 'file' })
    }
    await resolveNode(this.grant, path, true)
    if (this.disposed || !this.nodes.has(parent.id))
      throw new FileOperationError('workspace-session')
    candidates.sort((a, b) =>
      a.kind === b.kind ? nameOrder.compare(a.name, b.name) : a.kind === 'directory' ? -1 : 1,
    )
    const previous = this.children.get(parent.id) || new Map<string, Node>()
    const kinds = new Map(candidates.map((candidate) => [candidate.name, candidate.kind]))
    for (const node of previous.values()) if (kinds.get(node.name) !== node.kind) this.remove(node)
    const children = new Map<string, Node>()
    for (const candidate of candidates) {
      const relative = join(parent.relative, candidate.name)
      const weight = 256 + (relative.length + candidate.name.length) * 2
      const existing = previous.get(candidate.name)
      if (
        !existing &&
        (this.nodes.size >= workspaceLimits.nodes ||
          this.bytes + weight > workspaceLimits.catalogBytes)
      ) {
        listing.truncated = true
        break
      }
      const node: Node =
        existing?.kind === candidate.kind
          ? existing
          : { ...candidate, id: randomUUID(), relative, depth: parent.depth + 1 }
      if (!this.nodes.has(node.id)) {
        this.nodes.set(node.id, node)
        this.bytes += weight
      }
      children.set(node.name, node)
      listing.nodes.push({ id: node.id, name: node.name, kind: node.kind })
    }
    for (const node of previous.values())
      if (children.get(node.name)?.id !== node.id) this.remove(node)
    this.children.set(parent.id, children)
    return listing
  }
  private remove(node: Node): void {
    if (!this.nodes.has(node.id)) return
    for (const child of this.children.get(node.id)?.values() || []) this.remove(child)
    this.children.delete(node.id)
    this.listings.delete(node.id)
    this.watcher.remove(node.id)
    this.nodes.delete(node.id)
    this.bytes -= 256 + (node.relative.length + node.name.length) * 2
  }
}
