import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rename } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import Store from 'electron-store'
import { defaultSettings, parseSettings, type Settings } from '../shared/contracts'

function migrateSavedSettings(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('editor' in value) ||
    typeof value.editor !== 'object' ||
    value.editor === null ||
    !('typewriter' in value.editor) ||
    typeof value.editor.typewriter !== 'boolean'
  )
    return value
  const editor = { ...value.editor }
  delete (editor as { typewriter?: boolean }).typewriter
  return { ...value, editor }
}

export class SettingsRepository {
  private current: Settings = { ...defaultSettings }
  private queue: Promise<void> = Promise.resolve()
  recovered = false
  readOnly = false
  private store: Store<Settings> | null = null

  constructor(private readonly path: string) {}

  async load(): Promise<Settings> {
    let source: string | undefined
    let migrated = false
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
        const normalized = migrateSavedSettings(parsed)
        this.current = parseSettings(normalized)
        migrated = normalized !== parsed
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
      deserialize: (text) => parseSettings(migrateSavedSettings(JSON.parse(text))),
      schema: {
        schemaVersion: { type: 'number', const: 1 },
        theme: { type: 'string', enum: ['system', 'light', 'dark'] },
        locale: { type: 'string', enum: ['en', 'zh-CN'] },
        spellcheck: { type: 'boolean' },
        editor: {
          type: 'object',
          additionalProperties: false,
          required: ['lineNumbers', 'wrapLines', 'tabSize'],
          properties: {
            lineNumbers: { type: 'boolean' },
            wrapLines: { type: 'boolean' },
            tabSize: { type: 'number', enum: [2, 4, 8] },
          },
        },
        reading: {
          type: 'object',
          additionalProperties: false,
          required: ['layout'],
          properties: {
            layout: { type: 'string', enum: ['replace', 'side-by-side', 'interlinear'] },
          },
        },
      },
    })
    this.current = parseSettings(this.store.store)
    if (migrated) this.store.store = this.current
    return this.get()
  }

  get(): Settings {
    return structuredClone(this.current)
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
