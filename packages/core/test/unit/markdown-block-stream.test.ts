import type { Root, RootContent } from 'mdast'
import { type Extension, fromMarkdown } from 'mdast-util-from-markdown'
import type { Code, Construct, Event, State } from 'micromark-util-types'
import { describe, expect, it, vi } from 'vitest'
import { semanticLimits, sourceHash } from '../../src/contracts'
import {
  type MarkdownBlockSummary,
  markdownBlockPause,
  markdownBlockSteps,
  markdownPreparedBlockSteps,
} from '../../src/markdown-block-stream'
import * as descriptionModule from '../../src/markdown-description-steps'
import { markdownPostprocessSteps } from '../../src/markdown-postprocess-steps'
import { PackedSource, packedSourceSteps } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'
import * as grammarModule from '../../src/parse'
import { parseMarkdownNative as parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

function collect(source: string, syntax: 'commonmark' | 'manuslip') {
  const stream = markdownBlockSteps(source, syntax)
  const children: RootContent[] = []
  while (true) {
    const step = stream.next()
    if (step.done) {
      if (!step.value) throw new Error('Missing stream summary')
      const { root, ...metadata } = step.value
      return { ...metadata, root: Object.assign({ type: 'root' as const, children }, root) }
    }
    if (step.value !== markdownBlockPause) children.push(step.value)
  }
}

function nextBlock(stream: ReturnType<typeof markdownBlockSteps>) {
  while (true) {
    const step = stream.next()
    if (step.done) return step
    if (step.value !== markdownBlockPause) return { done: false as const, value: step.value }
  }
}

const compilerSpans = [
  {
    name: 'listless',
    source: `> > ${'**strong** and [text](https://example.invalid). '.repeat(100)}\n`,
  },
  {
    name: 'nested lists',
    source: `> > Before.\n> >\n> > 1. ${'**strong** and text. '.repeat(100)}\n> >    - nested\n> >\n> >      spread\n> > 2. second\n> >\n> > After.\n`,
  },
]

it.each(compilerSpans)(
  'preserves native handlers and bounded dispatch for $name spans',
  ({ source }) => {
    function run(stepped: boolean) {
      const trace: unknown[] = []
      const extension: Extension = {
        beforeEnter(token) {
          trace.push([
            'enter',
            token.type,
            token.start,
            token.type === 'data' ? this.sliceSerialize(token) : undefined,
          ])
        },
        afterExit(token) {
          trace.push([
            'exit',
            token.type,
            token.end,
            token.type === 'data' ? this.sliceSerialize(token) : undefined,
          ])
        },
      }
      const options = {
        mdastExtensions: [extension],
        _manuslipEventSpans: stepped,
        _manuslipBlockStream: stepped,
        _manuslipBlockCompileSteps: stepped,
        _manuslipBlockPostprocessSteps: markdownPostprocessSteps,
        _manuslipBlockTransforms: [],
      }
      if (!stepped) return { root: fromMarkdown(source, options), trace }
      const stream = fromMarkdown(source, options) as unknown as Generator<
        RootContent | undefined,
        Root | undefined
      >
      const children: RootContent[] = []
      try {
        while (true) {
          const previous = trace.length
          const next = stream.next()
          expect(trace.length - previous).toBeLessThanOrEqual(16)
          if (next.done) {
            if (!next.value) throw new Error('Missing compiler summary')
            return { root: { ...next.value, children }, trace }
          }
          if (next.value) children.push(next.value)
        }
      } finally {
        stream.return(undefined)
      }
    }
    expect(run(true)).toEqual(run(false))
  },
)

for (const cancellation of ['return', 'throw'] as const)
  it.each(compilerSpans)(
    `clears private arrays and compiler state after ${cancellation} in $name spans`,
    ({ source }) => {
      let events: Event[] | undefined
      let context: Parameters<NonNullable<Extension['beforeEnter']>> | undefined
      let state: { stack: unknown[]; tokenStack: unknown[]; data: object } | undefined
      let handled = 0
      const extension: Extension = {
        beforeEnter(...args) {
          context = args
          state = this
          handled++
        },
      }
      const options = {
        mdastExtensions: [extension],
        _manuslipEventSpans: true,
        _manuslipBlockStream: true,
        _manuslipBlockCompileSteps: true,
        _manuslipBlockTransforms: [],
        _manuslipBlockPostprocessSteps: function* (input: Event[]) {
          events = yield* markdownPostprocessSteps(input)
          return events
        },
      }
      const stream = fromMarkdown(source, options) as unknown as Generator<
        RootContent | undefined,
        Root | undefined
      >
      try {
        while (!handled) expect(stream.next()).toEqual({ done: false, value: undefined })
        expect(context).toBeDefined()
        expect(state?.stack.length).toBeGreaterThan(0)
        if (cancellation === 'throw') {
          const error = new Error('cancel compiler with pending events')
          expect(() => stream.throw(error)).toThrow(error)
        } else stream.return(undefined)
        const cancelled = handled
        expect(stream.next()).toEqual({ done: true, value: undefined })
        expect(handled).toBe(cancelled)
        expect(events).toEqual([])
        expect(state?.stack).toEqual([])
        expect(state?.tokenStack).toEqual([])
        expect(state?.data).toEqual({})
      } finally {
        stream.return(undefined)
      }
    },
  )

it.each(['before', 'hashing', 'throw'] as const)(
  'closes actual block metadata work when its parent is cancelled %s',
  (phase) => {
    const source = 'x'.repeat(16384)
    const factory = descriptionModule.markdownDescriptionSteps
    let metadata: ReturnType<typeof factory> | undefined
    const observed = vi
      .spyOn(descriptionModule, 'markdownDescriptionSteps')
      .mockImplementation((...args) => {
        metadata = factory(...args)
        return metadata
      })
    const stream = markdownBlockSteps(source)
    try {
      while (!metadata) expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
      if (phase !== 'before')
        expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
      if (phase === 'throw') {
        const failure = new Error('cancel block metadata')
        expect(() => stream.throw(failure)).toThrow(failure)
      } else stream.return()
      expect(stream.next()).toEqual({ done: true, value: undefined })
      expect(metadata.next()).toEqual({ done: true, value: undefined })
    } finally {
      stream.return()
      observed.mockRestore()
    }
  },
)

it('rejects an incomplete metadata child without handing off the native block', () => {
  const factory = descriptionModule.markdownDescriptionSteps
  const observed = vi
    .spyOn(descriptionModule, 'markdownDescriptionSteps')
    .mockImplementation((...args) => {
      const work = factory(...args)
      work.return()
      return work
    })
  const stream = markdownBlockSteps('first\n\nsecond\n')
  try {
    expect(() => {
      while (true) {
        const next = stream.next()
        if (next.done) throw new Error('Unexpected summary')
        expect(next.value).toBe(markdownBlockPause)
      }
    }).toThrow('Incomplete Markdown block descriptions')
    expect(stream.next()).toEqual({ done: true, value: undefined })
  } finally {
    stream.return()
    observed.mockRestore()
  }
})

it.each(['before', 'suspended', 'selected', 'throw'] as const)(
  'closes actual grammar work when block parsing is cancelled %s',
  (phase) => {
    const source = phase === 'selected' ? 'plain source' : 'plain source '.repeat(1024)
    const factory = grammarModule.markdownGrammarSteps
    let grammar: ReturnType<typeof factory> | undefined
    const observed = vi
      .spyOn(grammarModule, 'markdownGrammarSteps')
      .mockImplementation((...args) => {
        grammar = factory(...args)
        return grammar
      })
    const stream = markdownBlockSteps(source)
    const slice = String.prototype.slice
    let slices = 0
    const sourceReads = vi.spyOn(String.prototype, 'slice').mockImplementation(function (
      this: string,
      start?: number,
      end?: number,
    ) {
      if (this === source) slices++
      return slice.call(this, start, end)
    })
    try {
      if (phase !== 'before')
        expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
      if (phase === 'throw') {
        const failure = new Error('cancel grammar before native parsing')
        expect(() => stream.throw(failure)).toThrow(failure)
      } else stream.return()
      expect(stream.next()).toEqual({ done: true, value: undefined })
      if (phase === 'before') expect(grammar).toBeUndefined()
      else expect(grammar?.next()).toEqual({ done: true, value: undefined })
      expect(slices).toBe(phase === 'before' ? 0 : 1)
    } finally {
      stream.return()
      sourceReads.mockRestore()
      observed.mockRestore()
    }
  },
)

it('cancels native block tokenization before consuming the remaining source or constructing mdast', () => {
  let consumed = 0
  let entered = 0
  const probe: Construct = {
    name: 'tokenization-probe',
    tokenize(effects, ok) {
      return start
      function start(code: Code): State | undefined {
        effects.enter('paragraph')
        return inside(code)
      }
      function inside(code: Code): State | undefined {
        if (code === 122) {
          consumed++
          effects.consume(code)
          return inside
        }
        effects.exit('paragraph')
        return ok(code)
      }
    },
  }
  const options = {
    _manuslipEventSpans: true,
    _manuslipBlockStream: true,
    _manuslipBlockTokenSteps: true,
    _manuslipBlockTransforms: [],
    extensions: [{ flow: { 122: probe } }],
    mdastExtensions: [
      {
        beforeEnter() {
          entered++
        },
      } satisfies Extension,
    ],
  }
  const stream = fromMarkdown('z\n'.repeat(20000), options) as unknown as Generator<
    RootContent | undefined,
    Root | undefined
  >
  try {
    const first = stream.next()
    expect(consumed).toBeGreaterThan(0)
    expect(consumed).toBeLessThan(20000)
    expect(entered).toBe(0)
    expect(first).toEqual({ done: false, value: undefined })
    const previous = consumed
    expect(stream.next()).toEqual({ done: false, value: undefined })
    expect(consumed).toBeGreaterThan(previous)
    expect(consumed).toBeLessThan(20000)
    expect(entered).toBe(0)
  } finally {
    stream.return(undefined)
  }
  const cancelledAt = consumed
  expect(stream.next()).toEqual({ done: true, value: undefined })
  expect(consumed).toBe(cancelledAt)
  expect(entered).toBe(0)
})

it('can cancel preprocessing before dispatching any tokenizer input or constructing mdast', () => {
  let consumed = 0
  let entered = 0
  const probe: Construct = {
    name: 'preprocessing-cancellation-probe',
    tokenize(effects, ok) {
      return start
      function start(code: Code): State | undefined {
        effects.enter('paragraph')
        return inside(code)
      }
      function inside(code: Code): State | undefined {
        if (code === 122) {
          consumed++
          effects.consume(code)
          return inside
        }
        effects.exit('paragraph')
        return ok(code)
      }
    },
  }
  const options = {
    _manuslipEventSpans: true,
    _manuslipBlockStream: true,
    _manuslipBlockTokenSteps: true,
    _manuslipBlockPreprocessSteps: true,
    _manuslipBlockTransforms: [],
    extensions: [{ flow: { 122: probe } }],
    mdastExtensions: [
      {
        beforeEnter() {
          entered++
        },
      } satisfies Extension,
    ],
  }
  const stream = fromMarkdown('z\n'.repeat(20000), options) as unknown as Generator<
    RootContent | undefined,
    Root | undefined
  >
  try {
    expect(stream.next()).toEqual({ done: false, value: undefined })
    expect(stream.next()).toEqual({ done: false, value: undefined })
    expect(consumed).toBe(0)
    expect(entered).toBe(0)
  } finally {
    stream.return(undefined)
  }
  expect(stream.next()).toEqual({ done: true, value: undefined })
  expect(consumed).toBe(0)
  expect(entered).toBe(0)
})

it.each([
  { first: 'first\n\n', paragraphs: 1 },
  { first: '> - **first**\n>\n>   continuation\n>\n> - second\n\n', paragraphs: 3 },
])(
  'hands off $paragraphs completed paragraphs before constructing later siblings',
  ({ first, paragraphs }) => {
    const source = first + 'later\n\n'.repeat(2000)
    let entered = 0
    let closed = 0
    const extension: Extension = {
      beforeEnter(token) {
        if (token.type === 'paragraph') entered++
      },
      afterExit(token) {
        if (token.type === 'paragraph') closed++
      },
    }
    const options = {
      _manuslipEventSpans: true,
      _manuslipBlockStream: true,
      _manuslipBlockTransforms: [],
      mdastExtensions: [extension],
    }
    const stream = fromMarkdown(source, options) as unknown as Generator<RootContent, Root>
    try {
      const step = stream.next()
      expect(step.done).toBe(false)
      expect(step.value).toEqual(fromMarkdown(source).children[0])
      expect(entered).toBe(paragraphs)
      expect(closed).toBe(paragraphs)
    } finally {
      stream.return({ type: 'root', children: [] })
    }
    expect(entered).toBe(paragraphs)
    expect(closed).toBe(paragraphs)
    expect(stream.next()).toEqual({ done: true, value: undefined })
  },
)

for (const syntax of ['commonmark', 'manuslip'] as const)
  describe(`complete Markdown block construction in ${syntax}`, () => {
    it.each(examples)('matches every semantic field for CommonMark $example', ({ markdown }) => {
      const { timings: expectedTimings, ...expected } = parseMarkdown(markdown, syntax)
      const { timings, ...actual } = collect(markdown, syntax)
      expect(actual).toEqual(expected)
      expect(Object.keys(actual.root)).toEqual(Object.keys(expected.root))
      expect(timings.parse).toBeGreaterThanOrEqual(0)
      expect(timings.describe).toBeGreaterThanOrEqual(0)
      expect(expectedTimings.parse).toBeGreaterThanOrEqual(0)
    })
    const extension =
      '---\ntitle: 世界\n---\n\n# 😀 heading\n\n> > **bold** [late][r] and note[^n].\n\n- ordinary\n- [x] task\n\n| A | B |\n| - | - |\n| $x$ | www.example.invalid |\n\n$$\nx+y\n$$\n\n<div>html</div>\n\n[r]: /target "title"\n\n[^n]: footnote with [r]\n'
    it.each([
      '',
      'a\n\nb\n\nc\n',
      '- ordinary\n- second\n',
      'word  \nbreak\n\nother\n',
      'a@b.example www.example.invalid https://example.invalid\n',
      `${'a'.repeat(4095)}\ud83d\ude00 end\n\n[late][r]\n\n[r]: /target\n`,
      `${'a'.repeat(4095)}\r\n\r\n> [late][r]\n\n[r]: /target\n`,
      `${'\t'.repeat(1400)}code\n\ncall[^n]\n\n[^n]: later\n`,
      `${'a'.repeat(4095)}\0&copy;\rnext\n`,
      `${'a'.repeat(4094)} [r]\n\n[r]: /target\n`,
      `${'a'.repeat(4093)} [^n]\n\n[^n]: note\n`,
      '[forward][r]\n\n[r]: /later\n',
      'call[^a]\n\n[^a]: first\n\n    second\n\nlast\n',
      '> [r]: /first\n\n[r]: /duplicate\n\n[r]\n',
      extension,
      extension.replaceAll('\n', '\r\n'),
      `\ufeff${extension}`,
      '界😀\ud800\twords\rnext\n\udfff',
    ])('preserves extension and boundary semantics for %j', (source) => {
      const { timings: _expectedTimings, ...expected } = parseMarkdown(source, syntax)
      const { timings: _timings, ...actual } = collect(source, syntax)
      expect(actual).toEqual(expected)
    })
  })

it('segments the complete prose once after all blocks have been handed off', () => {
  const source = 'English words.\n\n中文段落。\n\n日本語の文章。\n\nالعربية للقراءة.\n'
  const expected = parseMarkdown(source)
  const segmenter = vi.spyOn(Intl, 'Segmenter')
  try {
    const stream = markdownBlockSteps(source)
    let summary: MarkdownBlockSummary | undefined
    for (let index = 0; index < 4; index++) {
      expect(nextBlock(stream).done).toBe(false)
      expect(segmenter).not.toHaveBeenCalled()
    }
    const final = nextBlock(stream)
    if (final.done) summary = final.value
    expect(summary?.counts).toEqual(expected.counts)
    expect(segmenter).toHaveBeenCalledTimes(1)
  } finally {
    segmenter.mockRestore()
  }
})

function observeWordIterations() {
  const probe = new Intl.Segmenter(undefined, { granularity: 'word' })
    .segment('')
    [Symbol.iterator]()
  const prototype = Object.getPrototypeOf(probe) as { next: typeof probe.next }
  const original = prototype.next
  let calls = 0
  let done = false
  const spy = vi.spyOn(prototype, 'next').mockImplementation(function (this: typeof probe) {
    calls++
    const step = original.call(this)
    if (step.done) done = true
    return step
  })
  return {
    get done() {
      return done
    },
    get calls() {
      return calls
    },
    reset() {
      calls = 0
    },
    restore() {
      spy.mockRestore()
    },
  }
}

for (const preparation of ['constructor', 'steps'] as const)
  it.each(['commonmark', 'manuslip'] as const)(
    `reuses admitted source metadata after whole-prose counting in %s with ${preparation}`,
    (syntax) => {
      const source = `${'x'.repeat(4095)}😀\ud800x\udfff\n\n# **Heading** 中文\n\n${'word '.repeat(900)}`
      const expected = parseMarkdown(source, syntax)
      const identity = {
        generation: 1,
        documentId: 'prepared-character-count',
        revision: 1,
        sourceHash: sourceHash(source),
        parserVersion: expected.parserVersion,
        rendererVersion: 'test',
        options: '{}',
      }
      const prepared =
        preparation === 'constructor'
          ? new PackedSource(identity, source)
          : finishPackedSteps(packedSourceSteps(identity, source))
      if (!prepared) throw new Error('Missing prepared source')
      const words = observeWordIterations()
      const original = String.prototype.charCodeAt
      let finalSourceReads = 0
      const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
        this: string,
        index: number,
      ) {
        if (words.done && this === source) finalSourceReads++
        return original.call(this, index)
      })
      const stream = markdownPreparedBlockSteps(prepared, syntax)
      const children: RootContent[] = []
      try {
        while (true) {
          const step = stream.next()
          if (step.done) {
            if (!step.value) throw new Error('Missing stream summary')
            const { root, ...metadata } = step.value
            expect({
              ...metadata,
              root: { ...root, children },
              timings: { parse: 0, describe: 0 },
            }).toEqual({ ...expected, timings: { parse: 0, describe: 0 } })
            expect(words.done).toBe(true)
            expect(finalSourceReads).toBe(0)
            break
          }
          if (step.value !== markdownBlockPause) children.push(step.value)
        }
      } finally {
        stream.return()
        observed.mockRestore()
        words.restore()
      }
    },
  )

it('makes at most 16 native word-iterator calls per advance, including EOF', () => {
  const source = 'English 中文 日本語 العربية ภาษาไทย ကမ္ဘာ é 🇸🇬 👩‍👩‍👧‍👧.\n\n'.repeat(256)
  const expected = parseMarkdown(source)
  const observed = observeWordIterations()
  const stream = markdownBlockSteps(source)
  let total = 0
  try {
    while (true) {
      observed.reset()
      const step = stream.next()
      expect(observed.calls).toBeLessThanOrEqual(16)
      total += observed.calls
      if (step.done) {
        expect(step.value?.counts).toEqual(expected.counts)
        expect(step.value?.sourceHash).toBe(expected.sourceHash)
        break
      }
    }
    expect(total).toBeGreaterThan(16)
  } finally {
    stream.return()
    observed.restore()
  }
})

it.each(['return', 'throw'] as const)('cancels whole-prose counting through %s', (operation) => {
  const observed = observeWordIterations()
  const stream = markdownBlockSteps('one two three 中文 ภาษาไทย.\n\n'.repeat(256))
  try {
    while (observed.calls < 16) expect(stream.next().done).toBe(false)
    expect(observed.calls).toBe(16)
    if (operation === 'throw') {
      const failure = new Error('cancel counting')
      expect(() => stream.throw(failure)).toThrow(failure)
    } else stream.return()
    expect(stream.next()).toEqual({ done: true, value: undefined })
    expect(observed.calls).toBe(16)
  } finally {
    stream.return()
    observed.restore()
  }
})

it('allows cancellation before joining prose or creating the segmenter', () => {
  const segmenter = vi.spyOn(Intl, 'Segmenter')
  const stream = markdownBlockSteps('first\n\nsecond\n')
  try {
    expect(nextBlock(stream).done).toBe(false)
    expect(nextBlock(stream).done).toBe(false)
    expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
    expect(segmenter).not.toHaveBeenCalled()
    stream.return()
    expect(stream.next()).toEqual({ done: true, value: undefined })
    expect(segmenter).not.toHaveBeenCalled()
  } finally {
    stream.return()
    segmenter.mockRestore()
  }
})

it('excludes time parked at checkpoints from parse and describe timings', () => {
  let time = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(function (this: Performance) {
    expect(this).toBe(performance)
    return time
  })
  const stream = markdownBlockSteps('one two three 中文.\n\n'.repeat(256))
  expect(clock).not.toHaveBeenCalled()
  try {
    while (true) {
      const step = stream.next()
      if (step.done) {
        expect(step.value?.timings).toEqual({ parse: 0, describe: 0 })
        break
      }
      time += 10000
    }
    expect(time).toBeGreaterThan(10000)
  } finally {
    stream.return()
    clock.mockRestore()
  }
})

it('closes the stream after a native iterator failure between counting batches', () => {
  const probe = new Intl.Segmenter(undefined, { granularity: 'word' })
    .segment('')
    [Symbol.iterator]()
  const prototype = Object.getPrototypeOf(probe) as { next: typeof probe.next }
  const original = prototype.next
  const failure = new Error('native iterator failed')
  let calls = 0
  const spy = vi.spyOn(prototype, 'next').mockImplementation(function (this: typeof probe) {
    if (++calls === 17) throw failure
    return original.call(this)
  })
  const stream = markdownBlockSteps('one two three.\n\n'.repeat(256))
  try {
    expect(() => {
      while (!stream.next().done) {}
    }).toThrow(failure)
    expect(calls).toBe(17)
    expect(stream.next()).toEqual({ done: true, value: undefined })
    expect(calls).toBe(17)
  } finally {
    stream.return()
    spy.mockRestore()
  }
})

function beforeSourceMetrics(source: string) {
  const observed = observeWordIterations()
  const stream = markdownBlockSteps(source)
  try {
    while (!observed.done) expect(stream.next().done).toBe(false)
    return stream
  } catch (error) {
    stream.return()
    throw error
  } finally {
    observed.restore()
  }
}

it.each([4095, 4096, 4097, 8192, 8193])(
  'bounds the final source scan at 4,096 UTF-16 reads for %i units',
  (length) => {
    const source = `${'x'.repeat(length - 5)}😀\ud800x\udfff`
    const expected = parseMarkdown(source)
    const stream = beforeSourceMetrics(source)
    const original = String.prototype.charCodeAt
    const reads: number[] = []
    const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
      this: string,
      index: number,
    ) {
      if (this === source) reads.push(index)
      return original.call(this, index)
    })
    let pauses = 0
    try {
      while (true) {
        const before = reads.length
        const step = stream.next()
        expect(reads.length - before).toBeLessThanOrEqual(4096)
        if (step.done) {
          expect(step.value?.counts).toEqual(expected.counts)
          expect(step.value?.sourceHash).toBe(expected.sourceHash)
          break
        }
        expect(step.value).toBe(markdownBlockPause)
        expect(reads.length - before).toBe(4096)
        pauses++
      }
      expect(reads).toEqual(Array.from({ length }, (_, index) => index))
      expect(pauses).toBe(Math.floor(length / 4096))
    } finally {
      stream.return()
      spy.mockRestore()
    }
  },
)

it('keeps a surrogate pair intact across a source-metric checkpoint', () => {
  const source = `${'x'.repeat(4095)}😀\ud800a\udfff\r\n界`
  const expected = parseMarkdown(source)
  const stream = beforeSourceMetrics(source)
  try {
    expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
    const step = stream.next()
    expect(step.done).toBe(true)
    if (!step.done) throw new Error('Missing final source metrics')
    expect(step.value?.counts.characters).toBe([...source].length)
    expect(step.value?.counts).toEqual(expected.counts)
    expect(step.value?.sourceHash).toBe(expected.sourceHash)
  } finally {
    stream.return()
  }
})

it.each(['return', 'throw'] as const)('cancels a partial source scan through %s', (operation) => {
  const source = 'source text '.repeat(1024)
  const stream = beforeSourceMetrics(source)
  const original = String.prototype.charCodeAt
  let reads = 0
  const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === source) reads++
    return original.call(this, index)
  })
  try {
    expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
    expect(reads).toBe(4096)
    if (operation === 'throw') {
      const failure = new Error('cancel source metrics')
      expect(() => stream.throw(failure)).toThrow(failure)
    } else stream.return()
    expect(stream.next()).toEqual({ done: true, value: undefined })
    expect(reads).toBe(4096)
  } finally {
    stream.return()
    spy.mockRestore()
  }
})

it('closes after a source read fails between metric batches', () => {
  const source = 'source text '.repeat(1024)
  const stream = beforeSourceMetrics(source)
  const original = String.prototype.charCodeAt
  const failure = new Error('source metric read failed')
  let reads = 0
  const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === source && ++reads === 4097) throw failure
    return original.call(this, index)
  })
  try {
    expect(stream.next()).toEqual({ done: false, value: markdownBlockPause })
    expect(() => stream.next()).toThrow(failure)
    expect(stream.next()).toEqual({ done: true, value: undefined })
    expect(reads).toBe(4097)
  } finally {
    stream.return()
    spy.mockRestore()
  }
})

it('keeps handed-off positions independent from later blocks and root metadata', () => {
  const source = 'first\n\nsecond\n'
  const expected = parseMarkdown(source)
  const stream = markdownBlockSteps(source)
  const first = nextBlock(stream)
  expect(first.done).toBe(false)
  if (first.done || !first.value.position) throw new Error('Missing first block')
  first.value.position.start.line = 999
  first.value.position.end.offset = 999
  const second = nextBlock(stream)
  expect(second.value).toEqual(expected.root.children[1])
  const final = nextBlock(stream)
  if (!final.done || !final.value) throw new Error('Missing final summary')
  expect(final.value.root.position).toEqual(expected.root.position)
  expect(final.value.blocks).toEqual(expected.blocks)
})

it('keeps interleaved streams independent when one is cancelled', () => {
  const firstSource = '[a][r]\n\n[r]: /first\n\ncall[^n]\n\n[^n]: first note\n'
  const secondSource = '[b][r]\n\n[r]: /second\n\ncall[^n]\n\n[^n]: second note\n'
  const first = markdownBlockSteps(firstSource)
  const second = markdownBlockSteps(secondSource)
  const expected = parseMarkdown(secondSource)
  const children: RootContent[] = []
  expect(first.next().done).toBe(false)
  const initial = nextBlock(second)
  if (initial.done) throw new Error('Missing second stream block')
  children.push(initial.value)
  first.return()
  let final: MarkdownBlockSummary | undefined
  while (true) {
    const step = nextBlock(second)
    if (step.done) {
      final = step.value
      break
    }
    children.push(step.value)
  }
  expect(children).toEqual(expected.root.children)
  expect(final?.blocks).toEqual(expected.blocks)
  expect(final?.counts).toEqual(expected.counts)
  expect(first.next()).toEqual({ done: true, value: undefined })
})

it.each(['before', 'suspended', 'complete', 'throw'] as const)(
  'revokes a held stream after %s closure',
  (phase) => {
    const stream = markdownBlockSteps('first\n\nsecond\n')
    if (phase === 'suspended' || phase === 'throw') stream.next()
    if (phase === 'complete') while (!stream.next().done) {}
    const failure = new Error('consumer failed')
    if (phase === 'throw') expect(() => stream.throw(failure)).toThrow(failure)
    else stream.return()
    expect(stream.next()).toEqual({ done: true, value: undefined })
    expect(stream.return()).toEqual({ done: true, value: undefined })
    expect(collect('fresh\n', 'manuslip').counts.words).toBe(1)
  },
)

it('keeps existing source and descriptor limits and closes after a partial-input failure', () => {
  expect(() => markdownBlockSteps('x'.repeat(semanticLimits.previewBytes + 1))).toThrow(
    'size limit',
  )
  const stream = markdownBlockSteps('p\n\n'.repeat(semanticLimits.blocks + 1))
  expect(() => {
    while (!stream.next().done) {}
  }).toThrow('block limit')
  expect(stream.next()).toEqual({ done: true, value: undefined })
  stream.return()
})

it('rejects unregistered transforms before executing a block transform', () => {
  const transform = vi.fn(() => {})
  const options = {
    _manuslipEventSpans: true,
    _manuslipBlockStream: true,
    _manuslipBlockTransforms: [],
    mdastExtensions: [{ transforms: [transform] } satisfies Extension],
  }
  const stream = fromMarkdown('first\n\nsecond\n', options) as unknown as Generator
  expect(() => stream.next()).toThrow('Unsupported private block-stream transform')
  expect(transform).not.toHaveBeenCalled()
  expect(stream.next()).toEqual({ done: true, value: undefined })
})

it('rejects replacement roots and closes without yielding a partial block', () => {
  const transform = () => ({ type: 'root' as const, children: [] })
  const options = {
    _manuslipEventSpans: true,
    _manuslipBlockStream: true,
    _manuslipBlockTransforms: [transform],
    mdastExtensions: [{ transforms: [transform] } satisfies Extension],
  }
  const stream = fromMarkdown('first\n\nsecond\n', options) as unknown as Generator
  expect(() => stream.next()).toThrow('Unsupported private block-stream root replacement')
  expect(stream.next()).toEqual({ done: true, value: undefined })
})
