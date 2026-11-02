import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'
import type { TranslationSettings } from '@manuslip/translate'
import { parseTranslationSettings, type TranslationState } from '../../shared/translation-contracts'
import { TranslationFailure } from './errors'
import { writePrivateJson } from './json-file'

export class TranslationConfiguration {
  current: TranslationSettings | null = null
  status: TranslationState['configuration'] = 'ready'
  private loaded: Promise<void> | null = null
  constructor(private readonly path: string) {}
  load(): Promise<void> {
    this.loaded ??= this.read()
    return this.loaded
  }
  private async read(): Promise<void> {
    let source: string
    try {
      const file = await import('../files/disk')
      const snapshot = await file.maybeDisk(this.path, 256 * 1024)
      if (!snapshot) return
      source = snapshot.bytes.toString('utf8')
    } catch {
      this.status = 'read-only'
      return
    }
    try {
      const value = JSON.parse(source)
      if (typeof value?.schemaVersion === 'number' && value.schemaVersion > 2) {
        this.status = 'read-only'
        return
      }
      if (
        ![1, 2].includes(value?.schemaVersion) ||
        Object.keys(value).some((key) => !['schemaVersion', 'settings'].includes(key))
      )
        throw new Error('Invalid configuration')
      this.current = parseTranslationSettings(value.settings)
    } catch {
      try {
        await rename(this.path, `${this.path}.invalid-${randomUUID()}`)
        this.status = 'recovered'
      } catch {
        this.status = 'read-only'
      }
    }
  }
  async save(settings: TranslationSettings): Promise<void> {
    await this.load()
    if (this.status === 'read-only') throw new TranslationFailure('translation-storage')
    try {
      await writePrivateJson(this.path, { schemaVersion: 2, settings })
    } catch {
      throw new TranslationFailure('translation-storage')
    }
    this.current = structuredClone(settings)
  }
}
