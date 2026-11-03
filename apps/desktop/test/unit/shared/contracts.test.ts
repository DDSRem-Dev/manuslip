import { defaultMarkdownPlugins } from '@manuslip/core/conventions'
import { defaultEditorPreferences } from '@manuslip/editor/preferences'
import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  parseBootstrap,
  parseClipboardAction,
  parseExternalLink,
  parseResult,
  parseSettings,
} from '../../../src/shared/contracts'

describe('bridge boundary validation', () => {
  it('limits native editing to clipboard actions instead of arbitrary window methods', () => {
    for (const value of ['cut', 'copy', 'paste']) expect(parseClipboardAction(value)).toBe(value)
    for (const value of ['executeJavaScript', 'close', '__proto__', null, [], { action: 'paste' }])
      expect(() => parseClipboardAction(value)).toThrow('Invalid clipboard action')
  })
  it('allows only bounded credential-free HTTPS browser links', () => {
    expect(parseExternalLink('https://example.com/path?q=hello#world')).toBe(
      'https://example.com/path?q=hello#world',
    )
    for (const value of [
      'http://example.com',
      'file:///C:/secret',
      'javascript:alert(1)',
      'https://user:secret@example.com',
      'https://example.com\n',
      '//example.com',
      `https://example.com/${'a'.repeat(8192)}`,
      null,
    ])
      expect(() => parseExternalLink(value)).toThrow()
  })
  it.each([
    null,
    [],
    {},
    { ...defaultSettings, schemaVersion: 2 },
    { ...defaultSettings, theme: 'surprise' },
    { ...defaultSettings, locale: 42 },
    { ...defaultSettings, spellcheck: 'true' },
    { ...defaultSettings, spellcheck: null },
    { ...defaultSettings, path: '/etc/passwd' },
    { ...defaultSettings, theme: { toString: () => 'dark' } },
  ])('rejects malformed preferences: %j', (input) => {
    expect(() => parseSettings(input)).toThrow('Invalid settings')
  })

  it('validates success and failure envelopes before exposing results', () => {
    expect(parseResult({ ok: true, value: defaultSettings }, parseSettings)).toEqual({
      ok: true,
      value: defaultSettings,
    })
    expect(parseResult({ ok: false, error: 'Try again' }, parseSettings)).toEqual({
      ok: false,
      error: 'Try again',
    })
    for (const input of [null, { ok: 'true' }, { ok: true, value: {} }, { ok: false, error: {} }]) {
      expect(() => parseResult(input, parseSettings)).toThrow()
    }
    expect(() =>
      parseBootstrap({ settings: defaultSettings, settingsRecovered: false, runtime: { app: 1 } }),
    ).toThrow()
  })
  it('accepts optional preference domains and copies them across the bridge', () => {
    const input = {
      ...defaultSettings,
      editor: { ...defaultEditorPreferences },
      reading: { layout: 'interlinear' as const },
      markdown: { ...defaultMarkdownPlugins },
    }
    const parsed = parseSettings(input)
    expect(parsed).toEqual(input)
    input.editor.tabSize = 8
    input.markdown.github = true
    expect(parsed.editor?.tabSize).toBe(4)
    expect(parsed.markdown?.github).toBe(false)
  })
  it.each([
    { editor: null },
    { editor: { ...defaultEditorPreferences, wrapLines: 'yes' } },
    { editor: { ...defaultEditorPreferences, tabSize: 3 } },
    { editor: { ...defaultEditorPreferences, tabSize: '4' } },
    { editor: { ...defaultEditorPreferences, extension: 'unknown' } },
    { editor: { ...defaultEditorPreferences, typewriter: true } },
    { reading: { layout: 'unknown' } },
    { reading: { layout: 'replace', network: true } },
  ])('rejects malformed preference domains: %j', (domain) => {
    expect(() => parseSettings({ ...defaultSettings, ...domain })).toThrow('Invalid settings')
  })
  it.each([
    null,
    { opt: true },
    { ...defaultMarkdownPlugins, latex: 'yes' },
    { ...defaultMarkdownPlugins, executable: 'untrusted' },
  ])('rejects malformed Markdown plugin preferences: %j', (markdown) => {
    expect(() => parseSettings({ ...defaultSettings, markdown })).toThrow(
      'Invalid Markdown plugins',
    )
  })
})
