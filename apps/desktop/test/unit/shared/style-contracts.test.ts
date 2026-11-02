import { describe, expect, it } from 'vitest'
import {
  defaultTypography,
  parseStyleReset,
  parseTypography,
  parseTypographyRequest,
  parseWritingStyle,
  parseWritingStyleState,
  styleLimits,
} from '../../../src/shared/style-contracts'

describe('narrow document appearance contracts', () => {
  const id = '12345678-1234-1234-1234-123456789abc'
  it('accepts bounded choices and rejects paths, extra fields and malformed resets', () => {
    expect(parseTypography({ ...defaultTypography, size: 28, leading: 2, measure: 640 }).size).toBe(
      28,
    )
    for (const raw of [
      { ...defaultTypography, size: 100 },
      { ...defaultTypography, size: '20' },
      { ...defaultTypography, font: 'url(x)' },
      { ...defaultTypography, css: 'x' },
    ])
      expect(() => parseTypography(raw)).toThrow()
    expect(parseTypographyRequest({ id, typography: defaultTypography }).id).toBe(id)
    expect(() =>
      parseTypographyRequest({ id, typography: defaultTypography, path: 'C:/secret' }),
    ).toThrow()
    expect(() => parseStyleReset({ id, stylesheetOnly: 1 })).toThrow()
    expect(() => parseStyleReset({ id: '../secret', stylesheetOnly: true })).toThrow()
  })
  it('bounds persisted UTF-8 CSS, names and returned styles without accepting HTML', () => {
    expect(() =>
      parseWritingStyle({
        typography: defaultTypography,
        stylesheet: { name: '../bad', source: 'p{color:red}' },
      }),
    ).toThrow()
    expect(() =>
      parseWritingStyle({
        typography: defaultTypography,
        stylesheet: { name: 'ok.css', source: '中'.repeat(styleLimits.input / 2) },
      }),
    ).toThrow()
    const state = {
      version: 0,
      typography: defaultTypography,
      name: null,
      css: 'article > p{color:red}',
      storage: 'saved',
      error: null,
    }
    expect(parseWritingStyleState(state)).toEqual(state)
    expect(() => parseWritingStyleState({ ...state, css: '</style>' })).toThrow()
    expect(() => parseWritingStyleState({ ...state, error: 'arbitrary' })).toThrow()
  })
})
