import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { record } from '../../shared/file-contracts'
import { pandocLimits } from '../../shared/pandoc-contracts'
import { atomicWrite, maybeDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import { type PandocTool, parsePandocTool } from './binary'

export class PandocRepository {
  private tool: PandocTool | null = null
  private fingerprint: string | null = null
  private queue: Promise<void> = Promise.resolve()
  recovered = false
  readOnly = false
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    let parsed: unknown
    try {
      const disk = await maybeDisk(this.path, pandocLimits.profile)
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
          value.schemaVersion !== 1 ||
          Object.keys(value).some((key) => !['schemaVersion', 'tool'].includes(key))
        )
          throw new Error('Invalid tool profile')
        this.tool = parsePandocTool(value.tool)
      } catch {
        await rename(this.path, backup)
        this.fingerprint = null
        this.recovered = true
      }
    } catch {
      this.readOnly = true
    }
  }
  get(): PandocTool | null {
    return this.tool ? { ...this.tool } : null
  }
  set(input: PandocTool | null, current: () => void = () => {}): Promise<void> {
    const tool = parsePandocTool(input)
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        current()
        if (this.readOnly) throw new FileOperationError('pandoc-storage')
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, tool }))
        if (bytes.length > pandocLimits.profile) throw new FileOperationError('pandoc-storage')
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        const disk = await atomicWrite(this.path, bytes, this.fingerprint, {
          maximumBytes: pandocLimits.profile,
          beforeWrite: async () => current(),
          beforeCommit: current,
          beforeReplace: async () => current(),
        })
        this.fingerprint = disk.fingerprint
        this.tool = tool
      })
    this.queue = operation
    return operation
  }
}
