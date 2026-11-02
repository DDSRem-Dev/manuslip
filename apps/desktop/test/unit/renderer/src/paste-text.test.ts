import { EditorState, maxDocumentBytes } from '@manuslip/editor'
import { describe, expect, it } from 'vitest'
import { preparePasteText } from '../../../../src/renderer/src/paste-text'

function prepared(source: string) {
  const iterator = preparePasteText(source)
  let result = iterator.next()
  while (!result.done) result = iterator.next()
  return result.value
}

describe('clipboard text preparation', () => {
  it.each([
    '',
    'one\r\ntwo\rthree\nfour\n',
    `${'x'.repeat(65535)}\r\n中文😀\n`,
    `${'x'.repeat(65535)}😀\r\nend`,
    `${'\r\n中文😀\r'.repeat(30000)}end\n`,
  ])('equals the native whole-text normalization, including boundary characters', (source) => {
    expect(prepared(source).eq(EditorState.create().toText(source))).toBe(true)
  })

  it('bounds normalized UTF-8 bytes rather than UTF-16 characters', () => {
    const source = '中'.repeat(Math.floor(maxDocumentBytes / 3) + 1)
    expect(source.length).toBeLessThan(maxDocumentBytes)
    expect(() => prepared(source)).toThrow('file-large')
  })
})
