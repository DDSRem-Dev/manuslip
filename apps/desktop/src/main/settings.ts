import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rename } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import Store from 'electron-store'
import { defaultSettings, parseSettings, type Settings } from '../shared/contracts'

export class SettingsRepository {
  private current: Settings = { ...defaultSettings }
  private queue: Promise<void> = Promise.resolve()
  recovered = false
  readOnly = false
  private store: Store<Settings> | null = null

  constructor(private readonly path: string) {}

  async load(): Promise<Settings> {
    let source: string | undefined
    try {
      source = await readFile(this.path, 'utf8')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if (source !== undefined) {
      let parsed: unknown
      try {
        parsed = JSON.parse(source)
      } catch {
        parsed = null
      }
      const backup = `${this.path}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'schemaVersion' in parsed &&
        typeof parsed.schemaVersion === 'number' &&
        parsed.schemaVersion > 1
      ) {
        // Never instantiate the store on future data: defaults/schema validation can write it.
        await copyFile(this.path, backup)
        this.readOnly = true
        return this.get()
      }
      try {
        this.current = parseSettings(parsed)
      } catch {
        await rename(this.path, backup)
        this.recovered = true
      }
    }
    this.store = new Store<Settings>({
      cwd: dirname(this.path),
      name: basename(this.path, '.json'),
      projectVersion: '0.1.0',
      defaults: defaultSettings,
      accessPropertiesByDotNotation: false,
      schema: {
        schemaVersion: { type: 'number', const: 1 },
        theme: { type: 'string', enum: ['system', 'light', 'dark'] },
        locale: { type: 'string', enum: ['en', 'zh-CN'] },
        spellcheck: { type: 'boolean' },
      },
    })
    this.current = parseSettings(this.store.store)
    return this.get()
  }

  get(): Settings {
    return { ...this.current }
  }

  async save(input: Settings): Promise<Settings> {
    const settings = parseSettings(input)
    const operation = this.queue.then(async () => {
      if (this.readOnly) throw new Error('Preferences require a newer version of Manuslip')
      if (!this.store) throw new Error('Preferences are not initialized')
      this.store.store = settings
      this.current = settings
    })
    this.queue = operation.catch(() => {})
    await operation
    return this.get()
  }
}
