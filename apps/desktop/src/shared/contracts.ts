import type { EditorPreferences } from '@manuslip/editor/preferences'
import type { AssetBridge } from './asset-contracts'
import type { DiagramBridge } from './diagram-contracts'
import type { ExportBridge } from './export-contracts'
import type { FileBridge } from './file-contracts'
import type { ImageBridge } from './image-contracts'
import type { IncomingBridge } from './incoming-contracts'
import type { PandocBridge } from './pandoc-contracts'
import type { PluginBridge } from './plugin-contracts'
import type { SearchBridge } from './search-contracts'
import type { StyleBridge } from './style-contracts'
import type { SyncBridge } from './sync-contracts'
import type { TranslationBridge } from './translation-contracts'
import type { WorkspaceBridge } from './workspace-contracts'

export const channels = {
  bootstrap: 'manuslip:bootstrap',
  settings: 'manuslip:settings',
  openLink: 'manuslip:open-link',
  edit: 'manuslip:edit',
} as const

export type Theme = 'system' | 'light' | 'dark'
export type Locale = 'en' | 'zh-CN'
export type ClipboardAction = 'cut' | 'copy' | 'paste'
export function parseClipboardAction(value: unknown): ClipboardAction {
  if (value !== 'cut' && value !== 'copy' && value !== 'paste')
    throw new Error('Invalid clipboard action')
  return value
}
export interface Settings {
  schemaVersion: 1
  theme: Theme
  locale: Locale
  spellcheck?: boolean
  editor?: EditorPreferences
  reading?: { layout: 'replace' | 'side-by-side' | 'interlinear' }
}
export interface RuntimeInfo {
  app: string
  electron: string
  node: string
  chrome: string
}
export interface Bootstrap {
  settings: Settings
  runtime: RuntimeInfo
  settingsRecovered: boolean
  settingsReadOnly: boolean
  spellcheckAvailable: boolean
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string }
export interface DesktopBridge
  extends FileBridge,
    ImageBridge,
    WorkspaceBridge,
    IncomingBridge,
    SearchBridge,
    AssetBridge,
    DiagramBridge,
    ExportBridge,
    TranslationBridge,
    StyleBridge,
    PandocBridge,
    PluginBridge,
    SyncBridge {
  openLink(url: string): Promise<Result<null>>
  bootstrap(): Promise<Result<Bootstrap>>
  updateSettings(settings: Settings): Promise<Result<Settings>>
  edit(action: ClipboardAction): Promise<Result<null>>
}

export function parseExternalLink(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 8192 ||
    [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('Invalid external link')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Invalid external link')
  return url.href
}

export const defaultSettings: Settings = { schemaVersion: 1, theme: 'system', locale: 'en' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSettings(value: unknown): Settings {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !['schemaVersion', 'theme', 'locale', 'spellcheck', 'editor', 'reading'].includes(key),
    ) ||
    (value.spellcheck !== undefined && typeof value.spellcheck !== 'boolean') ||
    value.schemaVersion !== 1 ||
    typeof value.theme !== 'string' ||
    !['system', 'light', 'dark'].includes(value.theme) ||
    typeof value.locale !== 'string' ||
    !['en', 'zh-CN'].includes(value.locale)
  ) {
    throw new Error('Invalid settings')
  }
  const editor = value.editor
  if (
    editor !== undefined &&
    (!isRecord(editor) ||
      Object.keys(editor).some((key) => !['lineNumbers', 'wrapLines', 'tabSize'].includes(key)) ||
      typeof editor.lineNumbers !== 'boolean' ||
      typeof editor.wrapLines !== 'boolean' ||
      ![2, 4, 8].includes(editor.tabSize as number))
  )
    throw new Error('Invalid settings')
  const reading = value.reading
  if (
    reading !== undefined &&
    (!isRecord(reading) ||
      Object.keys(reading).some((key) => key !== 'layout') ||
      !['replace', 'side-by-side', 'interlinear'].includes(reading.layout as string))
  )
    throw new Error('Invalid settings')
  return {
    schemaVersion: 1,
    theme: value.theme as Theme,
    locale: value.locale as Locale,
    ...(value.spellcheck === undefined ? {} : { spellcheck: value.spellcheck as boolean }),
    ...(editor === undefined ? {} : { editor: { ...(editor as unknown as EditorPreferences) } }),
    ...(reading === undefined
      ? {}
      : {
          reading: {
            layout: (reading as { layout: NonNullable<Settings['reading']>['layout'] }).layout,
          },
        }),
  }
}

export function parseBootstrap(value: unknown): Bootstrap {
  if (
    !isRecord(value) ||
    !isRecord(value.runtime) ||
    typeof value.settingsRecovered !== 'boolean' ||
    typeof value.settingsReadOnly !== 'boolean' ||
    typeof value.spellcheckAvailable !== 'boolean'
  ) {
    throw new Error('Invalid application response')
  }
  const runtime = value.runtime
  for (const key of ['app', 'electron', 'node', 'chrome']) {
    if (typeof runtime[key] !== 'string' || runtime[key].length > 100) {
      throw new Error('Invalid runtime information')
    }
  }
  return {
    settings: parseSettings(value.settings),
    runtime: runtime as unknown as RuntimeInfo,
    settingsRecovered: value.settingsRecovered,
    settingsReadOnly: value.settingsReadOnly,
    spellcheckAvailable: value.spellcheckAvailable,
  }
}

export function parseResult<T>(value: unknown, parse: (input: unknown) => T): Result<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') throw new Error('Invalid bridge response')
  if (value.ok) return { ok: true, value: parse(value.value) }
  if (typeof value.error !== 'string' || value.error.length > 500) {
    throw new Error('Invalid bridge error')
  }
  if (
    value.code !== undefined &&
    (typeof value.code !== 'string' || !/^[a-z-]{1,80}$/.test(value.code))
  )
    throw new Error('Invalid error code')
  return value.code === undefined
    ? { ok: false, error: value.error }
    : { ok: false, error: value.error, code: value.code as string }
}
