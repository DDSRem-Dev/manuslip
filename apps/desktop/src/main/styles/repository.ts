import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { record } from '../../shared/file-contracts'
import {
  defaultTypography,
  parseWritingStyle,
  styleLimits,
  type WritingStyle,
} from '../../shared/style-contracts'
import { maybeDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import { compileStylesheet } from './css'

export function defaultWritingStyle(): WritingStyle {
  return { typography: { ...defaultTypography }, stylesheet: null }
}
function isDefault(style: WritingStyle): boolean {
  return (
    style.stylesheet === null &&
    Object.entries(defaultTypography).every(
      ([key, value]) => style.typography[key as keyof typeof defaultTypography] === value,
    )
  )
}
export class WritingStyleRepository {
  private entries: Record<string, WritingStyle> = {}
  private queue: Promise<void> = Promise.resolve()
  recovered = false
  readOnly = false
  unavailable = false
  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    let parsed: unknown
    try {
      const disk = await maybeDisk(this.path, styleLimits.storage)
      if (!disk) return
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(disk.bytes))
    } catch {
      parsed = null
    }
    const backup = `${this.path}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
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
        const input = record(parsed),
          entries = record(input.entries)
        if (
          input.schemaVersion !== 1 ||
          Object.keys(input).some((key) => !['schemaVersion', 'entries'].includes(key)) ||
          Object.keys(entries).length > styleLimits.documents
        )
          throw new Error('Invalid appearance store')
        const valid: Record<string, WritingStyle> = {}
        for (const [key, raw] of Object.entries(entries)) {
          if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid appearance key')
          const style = parseWritingStyle(raw)
          if (style.stylesheet) compileStylesheet(style.stylesheet.source, 'article')
          valid[key] = style
        }
        this.entries = valid
      } catch {
        await rename(this.path, backup)
        this.recovered = true
      }
    } catch {
      this.readOnly = true
      this.unavailable = true
    }
  }
  get(key: string): WritingStyle {
    return structuredClone(this.entries[key] ?? defaultWritingStyle())
  }
  set(key: string, value: WritingStyle, current: () => void = () => {}): Promise<void> {
    const style = parseWritingStyle(value)
    if (style.stylesheet) compileStylesheet(style.stylesheet.source, 'article')
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        current()
        if (this.readOnly) throw new FileOperationError('style-readonly')
        if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid appearance key')
        const entries = { ...this.entries }
        if (isDefault(style)) delete entries[key]
        else entries[key] = style
        if (Object.keys(entries).length > styleLimits.documents)
          throw new FileOperationError('style-capacity')
        const text = JSON.stringify({ schemaVersion: 1, entries })
        if (Buffer.byteLength(text) > styleLimits.storage)
          throw new FileOperationError('style-capacity')
        const temporary = `${this.path}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
          const handle = await open(temporary, 'wx', 0o600)
          try {
            await handle.writeFile(text, 'utf8')
            await handle.sync()
          } finally {
            await handle.close()
          }
          current()
          await rename(temporary, this.path)
          this.entries = entries
        } finally {
          await rm(temporary, { force: true }).catch(() => {})
        }
      })
    this.queue = operation
    return operation
  }
}
