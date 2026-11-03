import { describe, expect, it } from 'vitest'
import { parseSpellingCorrection } from '../../../src/shared/spelling-contracts'

describe('native spelling correction boundary', () => {
  it('copies bounded Unicode corrections without interpreting their contents', () => {
    const input = { word: 'café', replacement: 'cafés' }
    expect(parseSpellingCorrection(input)).toEqual(input)
    expect(parseSpellingCorrection(input)).not.toBe(input)
    expect(parseSpellingCorrection({ word: 'a'.repeat(256), replacement: '<word>&' })).toEqual({
      word: 'a'.repeat(256),
      replacement: '<word>&',
    })
  })

  it.each([
    null,
    [],
    'word',
    {},
    { word: 'wrong' },
    { word: 'wrong', replacement: 'right', path: '/file' },
    { word: 1, replacement: 'right' },
    { word: 'wrong', replacement: null },
    { word: '', replacement: 'right' },
    { word: 'wrong', replacement: '' },
    { word: 'a'.repeat(257), replacement: 'right' },
    { word: 'wrong', replacement: 'a'.repeat(257) },
    { word: 'wrong\n', replacement: 'right' },
    { word: 'wrong', replacement: 'right\t' },
    { word: 'wrong', replacement: '\u0000right' },
    { word: 'wrong', replacement: 'right\u007f' },
  ])('rejects invalid or unbounded corrections: %j', (value) => {
    expect(() => parseSpellingCorrection(value)).toThrow('Invalid spelling correction')
  })
})
