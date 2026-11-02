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
})
