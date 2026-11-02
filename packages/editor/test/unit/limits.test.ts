import { EditorState, Text } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { documentBytes, textByteLength } from '../../src/limits'

describe('UTF-8 accounting over editor rope pieces', () => {
  const encoder = new TextEncoder()
  it('counts initial state without flattening its rope or allocating encoded output', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => `${index}: 界😀\ud800 e\u0301\udfff`)
    const expected = encoder.encode(lines.join('\n')).byteLength
    const doc = Text.of(lines)
    const flat = vi.spyOn(doc, 'toString').mockImplementation(() => {
      throw new Error('Flattened document')
    })
    const slice = vi.spyOn(doc, 'sliceString').mockImplementation(() => {
      throw new Error('Flattened range')
    })
    const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => {
      throw new Error('Encoded size-only buffer')
    })
    try {
      const state = EditorState.create({ doc, extensions: [documentBytes] })
      expect(state.field(documentBytes)).toBe(expected)
    } finally {
      flat.mockRestore()
      slice.mockRestore()
      encode.mockRestore()
    }
  })
  it('matches independent encoding across all UTF-16 subranges including surrogate splits', () => {
    const source = '\ud800😀\udfff\n界\n\udbff\udfff\n\ud800\n\udc00'
    const doc = Text.of(source.split('\n'))
    for (let from = 0; from <= source.length; from++)
      for (let to = from; to <= source.length; to++)
        expect(textByteLength(doc, from, to)).toBe(
          encoder.encode(source.slice(from, to)).byteLength,
        )
  })
  it('preserves incremental accounting through tree edits, joins and separated replacements', () => {
    let state = EditorState.create({
      doc: Array.from({ length: 1000 }, () => '界😀\ud800text\udfff').join('\n'),
      extensions: [documentBytes],
    })
    for (let index = 0; index < 50; index++) {
      const middle = Math.floor(state.doc.length / 2)
      state = state.update({
        changes: [
          { from: index, to: index + 1, insert: index % 2 ? '\ud800' : '😀\n' },
          { from: middle, to: middle + 2, insert: '\udc00界' },
        ],
      }).state
      expect(state.field(documentBytes)).toBe(encoder.encode(state.doc.toString()).byteLength)
    }
  })
})
