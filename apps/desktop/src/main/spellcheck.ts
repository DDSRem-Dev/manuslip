import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type BrowserWindow, Menu, type MenuItemConstructorOptions, type Session } from 'electron'
import type { Locale } from '../shared/contracts'
import {
  parseSpellingCorrection,
  type SpellingCorrection,
  spellingChannel,
} from '../shared/spelling-contracts'
import { nativeStrings } from './native-strings'

const dictionary = 'en-US-10-2.bdic'
const checksum = 'b0d80e6b6c5491879365e176ecbd98074602a663429bcfcfb0a5a8375c051f13'
const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex')

/** Seed Chromium's private cache before creating a session; no internet dictionary loader. */
export async function prepareDictionary(assets: string, profile: string): Promise<boolean> {
  let temporary: string | null = null
  try {
    const source = join(assets, dictionary)
    const metadata = await stat(source)
    if (!metadata.isFile() || metadata.size !== 451982) return false
    const bytes = await readFile(source)
    if (hash(bytes) !== checksum) return false
    const directory = join(profile, 'Dictionaries'),
      target = join(directory, dictionary)
    await mkdir(directory, { recursive: true })
    try {
      if ((await stat(target)).size === bytes.length && hash(await readFile(target)) === checksum)
        return true
    } catch {
      /* An absent or damaged app-owned cache is replaced atomically. */
    }
    temporary = join(directory, `.manuslip-${randomUUID()}.tmp`)
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
    temporary = null
    return true
  } catch {
    return false
  } finally {
    if (temporary) await rm(temporary, { force: true }).catch(() => {})
  }
}

export function configureSpellcheck(session: Session, assets: string, enabled: boolean): void {
  session.setSpellCheckerEnabled(false)
  // Only the packaged local URL can be requested if Chromium needs a different cache version.
  // A failed local read must never fall back to the default Chromium CDN.
  session.setSpellCheckerDictionaryDownloadURL(pathToFileURL(assets + sep).href)
  if (process.platform !== 'darwin') session.setSpellCheckerLanguages(['en-US'])
  session.setSpellCheckerEnabled(enabled)
}

export function installEditingMenu(
  window: BrowserWindow,
  locale: () => Locale,
  enabled: () => boolean,
): void {
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return
    const items: MenuItemConstructorOptions[] = []
    if (enabled() && params.misspelledWord) {
      for (const [index, suggestion] of params.dictionarySuggestions.slice(0, 5).entries()) {
        let correction: SpellingCorrection
        try {
          correction = parseSpellingCorrection({
            word: params.misspelledWord,
            replacement: suggestion,
          })
        } catch {
          continue
        }
        items.push({
          id: `spelling-${index}`,
          label: suggestion.replace(/&/g, '&&'),
          click: () => {
            if (!window.isDestroyed() && enabled()) {
              // Preserve Chromium's correction for ordinary text fields too.
              window.webContents.replaceMisspelling(correction.replacement)
              // CodeMirror may redraw native spelling markers when it paints the
              // selected word. Apply through its validated, undoable source edit.
              window.webContents.send(spellingChannel, correction)
            }
          },
        })
      }
      if (!items.length)
        items.push({ label: nativeStrings(locale()).noSuggestions, enabled: false })
      items.push({ type: 'separator' })
    }
    items.push(
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    )
    Menu.buildFromTemplate(items).popup({ window })
  })
}
