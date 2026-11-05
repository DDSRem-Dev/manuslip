import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type BrowserWindow, type ContextMenuParams, Menu } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { installEditingMenu, prepareDictionary } from '../../../src/main/spellcheck'
import { spellingChannel } from '../../../src/shared/spelling-contracts'

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
}))
const directories: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

function editingMenu() {
  type Context = Pick<ContextMenuParams, 'isEditable' | 'misspelledWord' | 'dictionarySuggestions'>
  let open = (_event: unknown, _params: Context): void => {}
  const active = { enabled: true, destroyed: false }
  const send = vi.fn()
  const replaceMisspelling = vi.fn()
  const window = {
    isDestroyed: () => active.destroyed,
    webContents: {
      on: (_event: string, listener: typeof open) => {
        open = listener
      },
      send,
      replaceMisspelling,
    },
  } as unknown as BrowserWindow
  installEditingMenu(
    window,
    () => 'en',
    () => active.enabled,
  )
  return {
    active,
    send,
    replaceMisspelling,
    open: (params: Context) => {
      open({}, params)
      return vi.mocked(Menu.buildFromTemplate).mock.lastCall?.[0] ?? []
    },
  }
}

it('sends bounded native suggestions as literal, undoable editor corrections', () => {
  const menu = editingMenu()
  const items = menu.open({
    isEditable: true,
    misspelledWord: 'mispell',
    dictionarySuggestions: ['misspell', 'A&B', 'a'.repeat(257), 'bad\nword', 'word', 'ignored'],
  })
  expect(items.filter((item) => item.id?.startsWith('spelling-'))).toHaveLength(3)
  expect(items.find((item) => item.id === 'spelling-1')?.label).toBe('A&&B')
  const click = items.find((item) => item.id === 'spelling-1')?.click
  if (!click) throw new Error('Missing native correction')
  Reflect.apply(click, undefined, [])
  expect(menu.replaceMisspelling).toHaveBeenCalledExactlyOnceWith('A&B')
  expect(menu.replaceMisspelling.mock.invocationCallOrder[0]).toBeLessThan(
    menu.send.mock.invocationCallOrder[0] ?? 0,
  )
  expect(menu.send).toHaveBeenCalledExactlyOnceWith(spellingChannel, {
    word: 'mispell',
    replacement: 'A&B',
  })
})

it('ignores native suggestions after spelling is disabled or its window closes', () => {
  const menu = editingMenu()
  const items = menu.open({
    isEditable: true,
    misspelledWord: 'mispell',
    dictionarySuggestions: ['misspell'],
  })
  const click = items.find((item) => item.id === 'spelling-0')?.click
  if (!click) throw new Error('Missing native correction')
  menu.active.enabled = false
  Reflect.apply(click, undefined, [])
  menu.active.enabled = true
  menu.active.destroyed = true
  Reflect.apply(click, undefined, [])
  expect(menu.send).not.toHaveBeenCalled()
  expect(menu.replaceMisspelling).not.toHaveBeenCalled()
})

it('keeps ordinary edit commands available without accepting invalid or disabled spelling', () => {
  const menu = editingMenu()
  const params = {
    isEditable: true,
    misspelledWord: 'mispell',
    dictionarySuggestions: ['misspell'],
  }
  menu.active.enabled = false
  expect(menu.open(params).some((item) => item.id?.startsWith('spelling-'))).toBe(false)
  menu.active.enabled = true
  const invalid = menu.open({ ...params, misspelledWord: 'a'.repeat(257) })
  expect(invalid.some((item) => item.id?.startsWith('spelling-'))).toBe(false)
  expect(invalid.some((item) => item.role === 'undo')).toBe(true)
  vi.mocked(Menu.buildFromTemplate).mockClear()
  menu.open({ ...params, isEditable: false })
  expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
})
it('seeds a verified offline dictionary, preserves valid caches and replaces damaged copies', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-dictionary-'))
  directories.push(profile)
  const assets = resolve('apps/desktop/vendor/dictionaries')
  const target = join(profile, 'Dictionaries', 'en-US-10-2.bdic')
  expect(await prepareDictionary(assets, profile)).toBe(true)
  const expected = await readFile(join(assets, 'en-US-10-2.bdic'))
  expect((await readFile(target)).equals(expected)).toBe(true)
  expect(await prepareDictionary(assets, profile)).toBe(true)
  await writeFile(target, 'damaged')
  expect(await prepareDictionary(assets, profile)).toBe(true)
  expect((await readFile(target)).equals(expected)).toBe(true)
})
it('disables spelling when the packaged dictionary is missing or fails size/hash verification', async () => {
  const assets = await mkdtemp(join(tmpdir(), 'manuslip-dictionary-assets-'))
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-dictionary-profile-'))
  directories.push(assets, profile)
  expect(await prepareDictionary(assets, profile)).toBe(false)
  await writeFile(join(assets, 'en-US-10-2.bdic'), 'incorrect')
  expect(await prepareDictionary(assets, profile)).toBe(false)
  await writeFile(join(assets, 'en-US-10-2.bdic'), Buffer.alloc(451982))
  expect(await prepareDictionary(assets, profile)).toBe(false)
})
