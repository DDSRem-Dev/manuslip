import { describe, expect, it, vi } from 'vitest'
import { semanticLimits, sourceHash } from '../../src/contracts'
import * as blockStream from '../../src/markdown-block-stream'
import { packValue, unpackValue } from '../../src/packing'
import {
  packMarkdownDocumentSteps,
  packPreparedMarkdownDocumentSteps,
} from '../../src/packing-markdown'
import { PackedSource, packedSourceSteps } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { working: 32 * MiB, nodes: 800000, depth: 512 }
const packet = (source: string, syntax: 'manuslip' | 'commonmark' = 'manuslip') => {
  const result = finishPackedSteps(packMarkdownDocumentSteps(source, 8 * MiB, limits, syntax))
  if (!result) throw new Error('Missing Markdown packet')
  return result
}
const exact = (source: string, syntax: 'manuslip' | 'commonmark') => {
  // Timings are measured by both actual parsers; freeze only the clock so every other
  // complete-document field and the independent ordinary encoding must match byte for byte.
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  try {
    const ordinary = parseMarkdown(source, syntax)
    const actual = packet(source, syntax)
    expect(new Uint8Array(actual)).toEqual(new Uint8Array(packValue(ordinary, 8 * MiB, limits)))
    expect(
      unpackValue(actual, { bytes: 8 * MiB, retained: 32 * MiB, staging: 8 * MiB }).value,
    ).toEqual(ordinary)
  } finally {
    clock.mockRestore()
  }
}
const extension =
  '---\ntitle: 世界\n---\n\n# 😀 heading\n\n> > **bold** [late][r] and note[^n].\n\n- ordinary\n- [x] task\n\n| A | B |\n| - | - |\n| $x$ | www.example.invalid |\n\n$$\nx+y\n$$\n\n<div>html</div>\n\n[r]: /target "title"\n\n[^n]: footnote with [r]\n'

it.each(['manuslip', 'commonmark'] as const)(
  'encodes a cooperatively prepared source with every ordinary %s field',
  (syntax) => {
    const source = finishPackedSteps(
      packedSourceSteps(
        {
          generation: 0,
          documentId: 'prepared',
          revision: 0,
          parserVersion: 'parser',
          rendererVersion: 'renderer',
          options: '{}',
        },
        extension,
      ),
    )
    if (!source) throw new Error('Missing prepared source')
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      const actual = finishPackedSteps(
        packPreparedMarkdownDocumentSteps(source, 8 * MiB, limits, syntax),
      )
      expect(new Uint8Array(actual as ArrayBuffer)).toEqual(
        new Uint8Array(packValue(parseMarkdown(extension, syntax), 8 * MiB, limits)),
      )
    } finally {
      clock.mockRestore()
    }
  },
)

it('reuses genuine source facts before encoding without rescanning the text', () => {
  const text = 'word '.repeat(4096)
  const source = new PackedSource(
    {
      generation: 0,
      documentId: 'prepared',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: 'parser',
      rendererVersion: 'renderer',
      options: '{}',
    },
    text,
  )
  const original = String.prototype.charCodeAt
  let reads = 0
  const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === text) reads++
    return original.call(this, index)
  })
  try {
    const work = packPreparedMarkdownDocumentSteps(source, 8 * MiB, limits)
    expect(reads).toBe(0)
    work.return()
    expect(reads).toBe(0)
    expect(() => packMarkdownDocumentSteps(text, 3, limits)).toThrow('byte limit')
    expect(reads).toBeGreaterThan(text.length)
  } finally {
    observed.mockRestore()
  }
})

it('rejects prototype and proxy forgeries before either prepared parser or encoder can skip guards', () => {
  const source = new PackedSource(
    {
      generation: 0,
      documentId: 'prepared',
      revision: 0,
      sourceHash: sourceHash('x'),
      parserVersion: 'parser',
      rendererVersion: 'renderer',
      options: '{}',
    },
    'x',
  )
  const forged = Object.assign(Object.create(PackedSource.prototype), source) as PackedSource
  for (const value of [forged, new Proxy(source, {})]) {
    expect(() => blockStream.markdownPreparedBlockSteps(value)).toThrow(
      'Invalid prepared packed source',
    )
    expect(() => packPreparedMarkdownDocumentSteps(value, 8 * MiB, limits)).toThrow(
      'Invalid prepared packed source',
    )
  }
})

describe.each(['manuslip', 'commonmark'] as const)('complete streamed %s packets', (syntax) => {
  for (const example of examples)
    it(`preserves all root and metadata bytes for CommonMark ${example.example}`, () => {
      exact(example.markdown, syntax)
    })
  it.each([
    '',
    '\ufeff',
    '\r\n\r\n',
    '\t\t\t',
    'English words.\n\n中文段落。\n\n日本語の文章。\n\nالعربية للقراءة.\n',
    'a@b.example www.example.invalid https://example.invalid\n',
    '[forward][r]\n\n[r]: /later\n',
    'call[^a]\n\n[^a]: first\n\n    second\n\nlast\n',
    '> [r]: /first\n\n[r]: /duplicate\n\n[r]\n',
    extension,
    extension.replaceAll('\n', '\r\n'),
    `\ufeff${extension}`,
    '界😀\ud800\twords\rnext\n\udfff',
  ])('preserves complete positions, counts, descriptors and extensions for %j', (source) => {
    exact(source, syntax)
  })
})

it.each(['before', 'suspended', 'complete', 'wire failure', 'factory failure'] as const)(
  'closes the actual parser handle after %s without leaving a partial result usable',
  (phase) => {
    const original = blockStream.markdownBlockSteps
    let parser: ReturnType<typeof original> | undefined
    const spy = vi.spyOn(blockStream, 'markdownBlockSteps').mockImplementation((...args) => {
      parser = original(...args)
      return parser
    })
    try {
      const source = '# title\n\nfirst\n\nsecond\n'
      if (phase === 'factory failure')
        expect(() => packMarkdownDocumentSteps(source, 3, limits)).toThrow('byte limit')
      else {
        const work = packMarkdownDocumentSteps(source, phase === 'wire failure' ? 64 : MiB, limits)
        if (phase === 'suspended') expect(work.next().done).toBe(false)
        if (phase === 'complete') expect(finishPackedSteps(work)).toBeInstanceOf(ArrayBuffer)
        if (phase === 'wire failure') expect(() => finishPackedSteps(work)).toThrow(/limit/)
        work.return()
        work.return()
        expect(work.next()).toEqual({ done: true, value: undefined })
      }
      expect(parser).toBeDefined()
      expect(parser?.next()).toEqual({ done: true, value: undefined })
    } finally {
      spy.mockRestore()
    }
  },
)

it('keeps the existing exact UTF-8 source guard before starting encoding', () => {
  expect(() =>
    packMarkdownDocumentSteps('界'.repeat(semanticLimits.previewBytes / 3), MiB, limits).return(),
  ).not.toThrow()
  expect(() =>
    packMarkdownDocumentSteps(
      '界'.repeat(Math.floor(semanticLimits.previewBytes / 3) + 1),
      MiB,
      limits,
    ),
  ).toThrow('size limit')
})
