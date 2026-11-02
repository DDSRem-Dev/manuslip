import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultEditorPreferences } from '@manuslip/editor/preferences'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsRepository } from '../../../src/main/settings'
import { defaultSettings } from '../../../src/shared/contracts'

describe('versioned local preferences', () => {
  let directory: string
  let path: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-settings-'))
    path = join(directory, 'preferences.json')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('starts with defaults, then restores saved values', async () => {
    const repository = new SettingsRepository(path)
    expect(await repository.load()).toEqual(defaultSettings)
    await repository.save({ schemaVersion: 1, theme: 'dark', locale: 'zh-CN' })
    expect(await new SettingsRepository(path).load()).toEqual({
      schemaVersion: 1,
      theme: 'dark',
      locale: 'zh-CN',
    })
    expect(await readdir(directory)).toEqual(['preferences.json'])
  })
  it('keeps older settings valid and persists explicit spelling opt-in and opt-out', async () => {
    await writeFile(path, JSON.stringify({ ...defaultSettings, theme: 'dark' }))
    const repository = new SettingsRepository(path)
    expect(await repository.load()).toEqual({ ...defaultSettings, theme: 'dark' })
    expect(repository.recovered).toBe(false)
    await repository.save({ ...repository.get(), spellcheck: true })
    expect((await new SettingsRepository(path).load()).spellcheck).toBe(true)
    await repository.save({ ...repository.get(), spellcheck: false })
    expect((await new SettingsRepository(path).load()).spellcheck).toBe(false)
  })

  it.each(['{broken', '{"schemaVersion":1,"theme":"unknown","locale":"en"}'])(
    'preserves invalid data before resetting: %s',
    async (text) => {
      await writeFile(path, text)
      const repository = new SettingsRepository(path)
      expect(await repository.load()).toEqual(defaultSettings)
      expect(repository.recovered).toBe(true)
      const files = await readdir(directory)
      const backup = files.find((name) => name.includes('.backup-'))
      expect(backup).toBeDefined()
      expect(await readFile(join(directory, backup || ''), 'utf8')).toBe(text)
    },
  )

  it('keeps future schemas read-only and preserves the exact original plus a dated backup', async () => {
    const text = '{"schemaVersion":2,"theme":"dark","locale":"en","newPreference":true}'
    await writeFile(path, text)
    const repository = new SettingsRepository(path)
    await repository.load()
    expect(repository.readOnly).toBe(true)
    expect(repository.recovered).toBe(false)
    await expect(repository.save(defaultSettings)).rejects.toThrow('newer version')
    expect(await readFile(path, 'utf8')).toBe(text)
    const backup = (await readdir(directory)).find((name) => name.includes('.backup-'))
    expect(backup).toMatch(/backup-\d{4}-\d{2}-\d{2}T/)
    expect(await readFile(join(directory, backup || ''), 'utf8')).toBe(text)
  })

  it('serializes concurrent saves and commits the last successful value', async () => {
    const repository = new SettingsRepository(path)
    await repository.load()
    await Promise.all([
      repository.save({ ...defaultSettings, theme: 'dark' }),
      repository.save({ ...defaultSettings, theme: 'light' }),
      repository.save({ ...defaultSettings, locale: 'zh-CN' }),
    ])
    expect(await new SettingsRepository(path).load()).toEqual({
      ...defaultSettings,
      locale: 'zh-CN',
    })
  })
  it('persists editor and reading domains without exposing mutable repository state', async () => {
    const repository = new SettingsRepository(path)
    await repository.load()
    const saved = await repository.save({
      ...defaultSettings,
      editor: { ...defaultEditorPreferences, tabSize: 2 },
      reading: { layout: 'side-by-side' },
    })
    const restored = await new SettingsRepository(path).load()
    expect(restored).toEqual(saved)
    if (!saved.editor) throw new Error('Missing editor preferences')
    saved.editor.tabSize = 8
    expect(repository.get().editor?.tabSize).toBe(2)
  })

  it.each([true, false])(
    'retires saved typewriter=%s without resetting other preferences',
    async (typewriter) => {
      const settings = {
        ...defaultSettings,
        theme: 'dark',
        locale: 'zh-CN',
        spellcheck: true,
        editor: { lineNumbers: false, wrapLines: false, tabSize: 8 },
        reading: { layout: 'interlinear' },
      }
      await writeFile(
        path,
        JSON.stringify({ ...settings, editor: { ...settings.editor, typewriter } }),
      )
      const repository = new SettingsRepository(path)
      expect(await repository.load()).toEqual(settings)
      expect(repository.recovered).toBe(false)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(settings)
      expect(await new SettingsRepository(path).load()).toEqual(settings)
      expect(await readdir(directory)).toEqual(['preferences.json'])
    },
  )

  it('does not advance in-memory state after a failed write', async () => {
    const repository = new SettingsRepository(path)
    await repository.load()
    await rm(path)
    await rm(directory, { recursive: true })
    await writeFile(directory, 'not a directory')
    await expect(repository.save({ ...defaultSettings, theme: 'dark' })).rejects.toThrow()
    expect(repository.get()).toEqual(defaultSettings)
    await rm(directory)
    await repository.save({ ...defaultSettings, theme: 'dark' })
    expect(repository.get().theme).toBe('dark')
  })
})
