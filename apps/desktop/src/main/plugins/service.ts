import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { Locale } from '../../shared/contracts'
import type {
  PluginCandidate,
  PluginOutcome,
  PluginPermission,
  PluginRunRequest,
  PluginState,
} from '../../shared/plugin-contracts'
import { pluginLimits } from '../../shared/plugin-contracts'
import { readDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { type PluginBundle, parsePluginBundle, pluginFingerprint } from './bundle'
import { PluginCapabilities } from './capabilities'
import { PluginHost } from './host'
import type { PluginRepository } from './repository'

interface Candidate {
  token: string
  bundle: PluginBundle
  expires: number
}
interface Job {
  pluginId: string
  jobId: string
  controller: AbortController
}
export class Plugins {
  private readonly candidates = new Map<number, Candidate>()
  private readonly pickers = new Set<number>()
  private readonly jobs = new Map<number, Job>()
  private mutation = false
  constructor(
    private readonly repository: PluginRepository,
    private readonly files: FileSessions,
  ) {}
  state(): PluginState {
    return this.repository.state()
  }
  async choose(
    owner: number,
    choose: () => Promise<string | null>,
    authorize: () => void,
  ): Promise<PluginCandidate | null> {
    authorize()
    if (this.pickers.has(owner)) throw new FileOperationError('plugin-busy')
    this.pickers.add(owner)
    this.candidates.delete(owner)
    try {
      const path = await choose()
      authorize()
      if (!path) return null
      const disk = await readDisk(path, pluginLimits.bundle)
      authorize()
      const bundle = parsePluginBundle(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(disk.bytes)),
      )
      const token = randomUUID()
      this.candidates.set(owner, { token, bundle, expires: Date.now() + 5 * 60_000 })
      return { token, plugin: { ...bundle.manifest, fingerprint: pluginFingerprint(bundle) } }
    } catch (error) {
      if (
        error instanceof FileOperationError &&
        ['plugin-busy', 'file-session'].includes(error.code)
      )
        throw error
      throw new FileOperationError('plugin-invalid')
    } finally {
      this.pickers.delete(owner)
    }
  }
  private revoke(id: string): void {
    for (const job of this.jobs.values())
      if (job.pluginId === id) job.controller.abort(new FileOperationError('plugin-cancelled'))
  }
  async install(
    owner: number,
    token: string,
    grants: PluginPermission[],
    authorize: () => void,
  ): Promise<PluginState> {
    authorize()
    const candidate = this.candidates.get(owner)
    if (!candidate || token !== candidate.token || candidate.expires < Date.now())
      throw new FileOperationError('plugin-unavailable')
    if (grants.some((permission) => !candidate.bundle.manifest.permissions.includes(permission)))
      throw new FileOperationError('plugin-permission')
    if (this.mutation) throw new FileOperationError('plugin-busy')
    this.mutation = true
    this.revoke(candidate.bundle.manifest.id)
    try {
      await this.repository.mutate(
        (rows) => [
          ...rows.filter((row) => row.bundle.manifest.id !== candidate.bundle.manifest.id),
          { bundle: candidate.bundle, enabled: true, grants },
        ],
        authorize,
      )
      this.candidates.delete(owner)
      return this.state()
    } finally {
      this.mutation = false
    }
  }
  async change(
    id: string,
    change: { enabled: boolean } | { grants: PluginPermission[] } | null,
    authorize: () => void,
  ): Promise<PluginState> {
    authorize()
    if (this.mutation) throw new FileOperationError('plugin-busy')
    const current = this.state().plugins.find((row) => row.id === id)
    if (!current) throw new FileOperationError('plugin-unavailable')
    if (
      change &&
      'grants' in change &&
      change.grants.some((permission) => !current.permissions.includes(permission))
    )
      throw new FileOperationError('plugin-permission')
    this.mutation = true
    this.revoke(id)
    try {
      await this.repository.mutate(
        (rows) =>
          rows.flatMap((row) =>
            row.bundle.manifest.id !== id ? [row] : change ? [{ ...row, ...change }] : [],
          ),
        authorize,
      )
      return this.state()
    } finally {
      this.mutation = false
    }
  }
  async run(
    window: BrowserWindow,
    request: PluginRunRequest,
    authorize: () => void,
    locale: Locale = 'en',
  ): Promise<PluginOutcome> {
    const owner = window.webContents.id
    authorize()
    this.files.describe(owner, request.documentId)
    if (this.mutation) throw new FileOperationError('plugin-busy')
    if (this.jobs.has(owner)) throw new FileOperationError('plugin-busy')
    const installation = this.repository.capture(request.pluginId),
      manifest = installation.bundle.manifest
    const command = manifest.commands.find((command) => command.id === request.commandId)
    if (!command) throw new FileOperationError('plugin-invalid')
    if (command.kind === 'transform' && !installation.grants.includes('document.write'))
      throw new FileOperationError('plugin-permission')
    const controller = new AbortController(),
      signal = controller.signal
    const current = (): void => {
      authorize()
      signal.throwIfAborted()
      this.files.describe(owner, request.documentId)
    }
    const host = new PluginHost(() =>
      window.isDestroyed() ? 0 : window.webContents.getOSProcessId(),
    )
    const capabilities = new PluginCapabilities(
      window,
      manifest,
      installation.grants,
      this.files,
      signal,
      current,
      locale,
    )
    this.jobs.set(owner, { pluginId: request.pluginId, jobId: request.jobId, controller })
    const timer = setTimeout(
      () => controller.abort(new FileOperationError('plugin-timeout')),
      pluginLimits.totalMs,
    )
    try {
      const text = await host.run(
        installation.bundle.code,
        {
          jobId: request.jobId,
          commandId: request.commandId,
          ...(installation.grants.includes('document.read')
            ? { document: { text: request.text, selections: request.selections } }
            : {}),
        },
        (kind, input) => capabilities.call(kind, input),
        signal,
      )
      current()
      return {
        kind: command.kind,
        text,
        revision: request.revision,
        pluginId: manifest.id,
        fingerprint: pluginFingerprint(installation.bundle),
      }
    } catch (error) {
      if (signal.aborted && signal.reason instanceof FileOperationError) throw signal.reason
      if (error instanceof FileOperationError) throw error
      throw new FileOperationError('plugin-failed')
    } finally {
      clearTimeout(timer)
      controller.abort(new FileOperationError('plugin-cancelled'))
      this.jobs.delete(owner)
    }
  }
  cancel(owner: number, jobId: string): void {
    const job = this.jobs.get(owner)
    if (job?.jobId === jobId) job.controller.abort(new FileOperationError('plugin-cancelled'))
  }
  closeOwner(owner: number): void {
    this.candidates.delete(owner)
    this.jobs.get(owner)?.controller.abort(new FileOperationError('file-session'))
  }
}
