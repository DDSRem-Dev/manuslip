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

interface Node extends WorkspaceNode {
  relative: string
  depth: number
}
interface Listing {
  nodes: WorkspaceNode[]
  truncated: boolean
  skippedLinks: boolean
}
export class WorkspaceCatalog {
  readonly root: WorkspaceRoot
  private readonly nodes = new Map<string, Node>()
  private readonly listings = new Map<string, Promise<Listing>>()
  private bytes = 0
  constructor(readonly grant: RootGrant) {
    this.root = {
      id: randomUUID(),
      name: basename(grant.path) || grant.path,
      kind: 'directory',
      displayPath: grant.path,
    }
    this.nodes.set(this.root.id, { ...this.root, relative: '', depth: 0 })
  }
  async path(id: string, directory: boolean): Promise<string> {
    const node = this.nodes.get(id)
    if (!node || (node.kind === 'directory') !== directory)
      throw new FileOperationError('workspace-session')
    return resolveNode(this.grant, join(this.grant.path, node.relative), directory)
  }
  async list(id: string, offset: number): Promise<WorkspacePage> {
    const path = await this.path(id, true)
    const node = this.nodes.get(id)
    if (!node) throw new FileOperationError('workspace-session')
    let pending = this.listings.get(id)
    if (!pending) {
      pending = this.scan(path, node)
      this.listings.set(id, pending)
      pending.catch(() => {
        this.listings.delete(id)
      })
    }
    const listing = await pending
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
    candidates.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.kind === 'directory'
          ? -1
          : 1,
    )
    for (const candidate of candidates) {
      const relative = join(parent.relative, candidate.name)
      const weight = 256 + (relative.length + candidate.name.length) * 2
      if (
        this.nodes.size >= workspaceLimits.nodes ||
        this.bytes + weight > workspaceLimits.catalogBytes
      ) {
        listing.truncated = true
        break
      }
      const node: Node = { ...candidate, id: randomUUID(), relative, depth: parent.depth + 1 }
      this.nodes.set(node.id, node)
      this.bytes += weight
      listing.nodes.push({ id: node.id, name: node.name, kind: node.kind })
    }
    return listing
  }
}
