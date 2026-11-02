import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { record } from '../../shared/file-contracts'
import {
  type InstalledPlugin,
  type PluginPermission,
  type PluginState,
  parsePluginGrants,
  pluginLimits,
} from '../../shared/plugin-contracts'
import { atomicWrite, maybeDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import { type PluginBundle, parsePluginBundle, pluginFingerprint } from './bundle'

interface Installation {
  bundle: PluginBundle
  enabled: boolean
  grants: PluginPermission[]
}
function parseInstallation(input: unknown): Installation {
  const value = record(input)
  if (Object.keys(value).length !== 3 || typeof value.enabled !== 'boolean')
    throw new Error('Invalid installation')
  const bundle = parsePluginBundle(value.bundle),
    grants = parsePluginGrants(value.grants)
  if (grants.some((permission) => !bundle.manifest.permissions.includes(permission)))
    throw new Error('Invalid grants')
  return { bundle, enabled: value.enabled, grants }
}
const summary = ({ bundle, enabled, grants }: Installation): InstalledPlugin => ({
  ...bundle.manifest,
  fingerprint: pluginFingerprint(bundle),
  enabled,
  grants,
})
export class PluginRepository {
  private installs: Installation[] = []
  private fingerprint: string | null = null
  private queue: Promise<void> = Promise.resolve()
  recovered = false
  readOnly = false
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    let parsed: unknown
    try {
      const disk = await maybeDisk(this.path, pluginLimits.repository)
      if (!disk) return
      this.fingerprint = disk.fingerprint
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(disk.bytes))
    } catch {
      parsed = null
    }
    const backup = `${this.path}.backup-${randomUUID()}`
    try {
      if (
        parsed &&
        typeof parsed === 'object' &&
        'schemaVersion' in parsed &&
        typeof parsed.schemaVersion === 'number' &&
        parsed.schemaVersion > 1
      ) {
        this.readOnly = true
        await copyFile(this.path, backup)
        return
      }
      try {
        const value = record(parsed)
        if (
          Object.keys(value).length !== 2 ||
          value.schemaVersion !== 1 ||
          !Array.isArray(value.plugins) ||
          value.plugins.length > pluginLimits.installed
        )
          throw new Error('Invalid repository')
        const installations = value.plugins.map(parseInstallation)
        if (
          new Set(installations.map((row) => row.bundle.manifest.id)).size !== installations.length
        )
          throw new Error('Duplicate plugin')
        this.installs = installations
      } catch {
        await rename(this.path, backup)
        this.fingerprint = null
        this.recovered = true
      }
    } catch {
      this.readOnly = true
    }
  }
  state(): PluginState {
    return structuredClone({
      plugins: this.installs.map(summary),
      recovered: this.recovered,
      readOnly: this.readOnly,
    })
  }
  capture(id: string): Installation {
    const installation = this.installs.find((row) => row.bundle.manifest.id === id)
    if (!installation?.enabled) throw new FileOperationError('plugin-unavailable')
    return structuredClone(installation)
  }
  mutate(
    change: (current: Installation[]) => Installation[],
    authorize: () => void,
  ): Promise<void> {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        authorize()
        if (this.readOnly) throw new FileOperationError('plugin-readonly')
        const next = change(structuredClone(this.installs)).map(parseInstallation)
        if (
          next.length > pluginLimits.installed ||
          new Set(next.map((row) => row.bundle.manifest.id)).size !== next.length
        )
          throw new FileOperationError('plugin-limit')
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: next }))
        if (bytes.length > pluginLimits.repository) throw new FileOperationError('plugin-limit')
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        const disk = await atomicWrite(this.path, bytes, this.fingerprint, {
          maximumBytes: pluginLimits.repository,
          beforeWrite: async () => authorize(),
          beforeCommit: authorize,
          beforeReplace: async () => authorize(),
        })
        this.fingerprint = disk.fingerprint
        this.installs = next
      })
      .catch((error) => {
        if (
          error instanceof FileOperationError &&
          [
            'plugin-readonly',
            'plugin-limit',
            'plugin-unavailable',
            'file-session',
            'plugin-cancelled',
          ].includes(error.code)
        )
          throw error
        throw new FileOperationError('plugin-storage')
      })
    this.queue = operation
    return operation
  }
}
