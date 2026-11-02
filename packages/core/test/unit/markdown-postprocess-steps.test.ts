import type { Root, RootContent } from 'mdast'
import {
  fromMarkdown,
  type Extension as MdastExtension,
  type Transform,
} from 'mdast-util-from-markdown'
import { parse, preprocess } from 'micromark'
import type { Chunk, Event, Extension, TokenizeContext } from 'micromark-util-types'
import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import { expect, it } from 'vitest'
import { markdownPostprocessSteps } from '../../src/markdown-postprocess-steps'

function privateTextTokenizer() {
  const parser = parse() as ReturnType<typeof parse> & { _manuslipBlockTokenSteps?: boolean }
  parser._manuslipBlockTokenSteps = true
  return parser.text() as TokenizeContext & {
    _manuslipWriteSteps(stream: Chunk[]): Generator<void, Event[]>
  }
}

it.each([
  ['not-started', 'return'],
  ['not-started', 'throw'],
  ['active', 'return'],
  ['active', 'throw'],
] as const)('revokes a %s native private write directly on %s', (phase, cancel) => {
  const context = privateTextTokenizer()
  const steps = context._manuslipWriteSteps(['**Text** '.repeat(2000), null])
  if (phase === 'active') expect(steps.next().done).toBe(false)
  if (cancel === 'throw') {
    const reason = new Error('close native private input')
    expect(() => steps.throw(reason)).toThrow(reason)
  } else steps.return([])
  expect(Object.keys(context)).toEqual([])
  expect(steps.next()).toEqual({ done: true, value: undefined })
})

it('preserves the child context after a successful nonfinal write for its next linked chunk', () => {
  const context = privateTextTokenizer()
  const first: Chunk[] = ['Before **bo']
  const last: Chunk[] = ['ld** &amp; after', null]
  expect(context._manuslipWriteSteps(first).next()).toEqual({ done: true, value: [] })
  expect(typeof context._manuslipWriteSteps).toBe('function')
  expect(context.parser).toBeDefined()
  const completed = context._manuslipWriteSteps(last).next()
  expect(completed.done).toBe(true)
  const ordinary = parse().text()
  ordinary.write(['Before **bo'])
  const expected = ordinary.write(['ld** &amp; after', null])
  const values = (events: Event[]) =>
    events.map(([phase, token, tokenizer]) => [
      phase,
      token.type,
      token.start,
      token.end,
      tokenizer.sliceSerialize(token),
    ])
  expect(values(completed.value as Event[])).toEqual(values(expected))
})

it.each([1, 17, 257])(
  'preserves GFM hooks, linked chunks, complete positions, and late references through %i items',
  (length) => {
    const grammar = unified().use(remarkGfm).freeze().data()
    const source =
      '# Header\r\n\r\n' +
      Array.from(
        { length },
        (_, index) =>
          `- [${index % 2 ? 'x' : ' '}] **Item ${index}** [link][later]\r\n\r\n` +
          '  > Quote with *emphasis*, ~~deletion~~ and a note[^end].\r\n' +
          '  >\r\n  > Last line.\r\n\r\n' +
          '  | A | B |\r\n  | - | -: |\r\n  | &amp; | `code` |\r\n\r\n',
      ).join('') +
      '[later]: /target "Title"\r\n\r\n[^end]: Footnote **content**.\r\n'
    let postprocessCalls = 0
    let pauses = 0
    const transforms: Transform[] = []
    function collect(extensions: (MdastExtension | MdastExtension[])[]): void {
      for (const extension of extensions)
        if (Array.isArray(extension)) collect(extension)
        else transforms.push(...(extension.transforms ?? []))
    }
    collect(grammar.fromMarkdownExtensions ?? [])
    const ordinaryOptions = {
      extensions: grammar.micromarkExtensions,
      mdastExtensions: grammar.fromMarkdownExtensions,
    }
    const options = {
      ...ordinaryOptions,
      _manuslipEventSpans: true,
      _manuslipBlockStream: true,
      _manuslipBlockTokenSteps: true,
      _manuslipBlockPreprocessSteps: true,
      _manuslipBlockCompileSteps: true,
      _manuslipBlockTransforms: transforms,
      *_manuslipBlockPostprocessSteps(input: Parameters<typeof markdownPostprocessSteps>[0]) {
        postprocessCalls++
        for (const _pause of markdownPostprocessSteps(input)) {
          pauses++
          yield
        }
        return input
      },
    }
    const stream = fromMarkdown(source, options) as unknown as Generator<
      RootContent | undefined,
      Root | undefined
    >
    const children: RootContent[] = []
    try {
      while (true) {
        const next = stream.next()
        if (next.done) {
          expect({ ...next.value, children }).toEqual(fromMarkdown(source, ordinaryOptions))
          break
        }
        if (next.value) children.push(next.value)
      }
      expect(postprocessCalls).toBeGreaterThan(1)
      expect(pauses).toBeGreaterThan(length * 3)
    } finally {
      stream.return(undefined)
    }
  },
)

it.each(['return', 'throw'] as const)(
  'revokes a native child tokenizer while paused inside its input walk on %s',
  (cancel) => {
    const contexts = new Set<TokenizeContext>()
    const extension: Extension = {
      text: {
        64: {
          name: 'observeNativeChild',
          tokenize(_effects, _ok, nok) {
            contexts.add(this)
            return nok
          },
        },
      },
    }
    const source = `@${'emphasis *text* &amp; [link](/target) '.repeat(700)}\n`
    const events = parse({ extensions: [extension] })
      .document()
      .write(preprocess()(source, undefined, true))
    expect(contexts.size).toBe(0)
    const steps = markdownPostprocessSteps(events)
    try {
      while (contexts.size === 0) expect(steps.next().done).toBe(false)
      for (const context of contexts) {
        expect(context.events.length).toBeGreaterThan(0)
        expect(context.parser).toBeDefined()
        expect(context.parser).not.toHaveProperty('_manuslipBlockTokenSteps')
      }
      if (cancel === 'throw') {
        const reason = new Error('cancel native child tokenizer')
        expect(() => steps.throw(reason)).toThrow(reason)
      } else steps.return([])
      expect(events).toEqual([])
      for (const context of contexts) expect(Object.keys(context)).toEqual([])
      expect(steps.next()).toEqual({ done: true, value: undefined })
    } finally {
      steps.return([])
    }
  },
)
