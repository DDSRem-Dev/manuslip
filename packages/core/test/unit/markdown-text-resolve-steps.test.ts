import { parse, preprocess } from 'micromark'
import type { Chunk, Event, TokenizeContext } from 'micromark-util-types'
import { expect, it } from 'vitest'
import { markdownTextResolveSteps } from '../../src/markdown-text-resolve-steps'

type PrivateParser = ReturnType<typeof parse> & {
  _manuslipBlockTokenSteps?: boolean
  _manuslipTextResolveSteps?: (
    ...input: Parameters<typeof markdownTextResolveSteps>
  ) => IterableIterator<void, Event[] | undefined, undefined>
}
type PrivateContext = TokenizeContext & {
  parser: PrivateParser
  _manuslipWriteSteps(chunks: Chunk[]): Generator<void, Event[]>
}

function tokenizer(privateSteps: boolean, field: 'text' | 'string' = 'text') {
  const parser: PrivateParser = parse()
  if (privateSteps) {
    parser._manuslipBlockTokenSteps = true
    parser._manuslipTextResolveSteps = markdownTextResolveSteps
  }
  return parser[field]() as PrivateContext
}

function finish(steps: Generator<void, Event[]>): Event[] {
  while (true) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

function values(events: Event[]) {
  return events.map(([phase, token, context]) => ({
    phase,
    token: { ...token },
    stream: context.sliceStream(token),
    text: context.sliceSerialize(token),
    expanded: context.sliceSerialize(token, true),
  }))
}

function compare(source: string, field: 'text' | 'string' = 'text', trailing = false) {
  const ordinary = tokenizer(false, field)
  const stepped = tokenizer(true, field)
  ordinary._contentTypeTextTrailing = trailing
  stepped._contentTypeTextTrailing = trailing
  const before = ordinary.write(preprocess()(source, undefined, true))
  const after = finish(stepped._manuslipWriteSteps(preprocess()(source, undefined, true)))
  expect(values(after)).toEqual(values(before))
}

const cases = [
  '',
  'plain',
  'a\\q\\z &bogus; &#xzz; last',
  'a  \nb \n  \nend  ',
  'a\t\n\tb \t \nend\t',
  'a\r\nb  \r\nc \rending   ',
  '\t  \r\n\r\n',
  '  a\\\nb \\\r\nend',
  '*open **strong** close* ~~data~~ [link](/target "Title")',
  '`code  ` &amp; \\* &#32; \u0000 😀 العربية 中文  \nend',
  'a\t \t \t  \n   ',
  'a\r   b\n\t  c\r\n  end',
]
for (const field of ['text', 'string'] as const)
  it.each(cases)(`preserves complete native ${field} events for %j`, (source) => {
    compare(source, field)
  })

it('preserves native events through seeded escapes, whitespace, references and markers', () => {
  const pieces = ['a', '\\q', '\\*', '&amp;', '&bad;', ' ', '  ', '\t', '\r\n', '*x*', '[a]', '😀']
  let seed = 0x56ab392
  for (let test = 0; test < 256; test++) {
    let source = ''
    for (let index = 0; index < 32; index++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      source += pieces[(seed >>> 0) % pieces.length]
    }
    compare(source, test % 2 ? 'text' : 'string', test % 3 === 0)
  }
})

it.each([false, true])('preserves final-trailing-whitespace policy %s', (trailing) => {
  compare('first  \r\nnext\t  \r\nfinal  \t    ', 'text', trailing)
})

it('yields during the native EOF trailing-space scan, beyond input-tokenization checkpoints', () => {
  const context = tokenizer(true)
  let resolvingPauses = 0
  context.parser._manuslipTextResolveSteps = function* (
    input: Event[],
    owner: TokenizeContext,
    suffixes: boolean,
  ) {
    const steps = markdownTextResolveSteps(input, owner, suffixes)
    try {
      while (true) {
        const next = steps.next()
        if (next.done) return next.value
        resolvingPauses++
        yield
      }
    } finally {
      steps.return()
    }
  }
  const source = `tail${' '.repeat(8192)}`
  const after = finish(context._manuslipWriteSteps([source, null]))
  const ordinary = tokenizer(false)
  expect(values(after)).toEqual(values(ordinary.write([source, null])))
  expect(resolvingPauses).toBeGreaterThanOrEqual(32)
})

it('keeps linked nonfinal tokenizer state until its final private EOF resolution', () => {
  const context = tokenizer(true)
  expect(finish(context._manuslipWriteSteps(['before **bo']))).toEqual([])
  expect(context.parser).toBeDefined()
  const after = finish(context._manuslipWriteSteps(['ld**  \r\nlast\t  ', null]))
  const ordinary = tokenizer(false)
  ordinary.write(['before **bo'])
  expect(values(after)).toEqual(values(ordinary.write(['ld**  \r\nlast\t  ', null])))
})

it.each(['return', 'throw'] as const)(
  'closes an actual native tokenizer during EOF scanning on %s',
  (cancel) => {
    const context = tokenizer(true)
    let active: ReturnType<typeof markdownTextResolveSteps> | undefined
    context.parser._manuslipTextResolveSteps = (
      input: Event[],
      owner: TokenizeContext,
      suffixes: boolean,
    ) => {
      active = markdownTextResolveSteps(input, owner, suffixes)
      return active
    }
    const steps = context._manuslipWriteSteps([`tail${' '.repeat(8192)}`, null])
    while (!active) expect(steps.next().done).toBe(false)
    expect(context.events.length).toBeGreaterThan(0)
    if (cancel === 'throw') {
      const reason = new Error('cancel native EOF resolver')
      expect(() => steps.throw(reason)).toThrow(reason)
    } else steps.return([])
    expect(Object.keys(context)).toEqual([])
    expect(active.next()).toEqual({ done: true, value: undefined })
    expect(steps.next()).toEqual({ done: true, value: undefined })
  },
)

it.each(['return', 'throw'] as const)(
  'revokes unstarted private text-resolution input on %s',
  (cancel) => {
    const context = tokenizer(false)
    const input = context.write(['text  ', null])
    const steps = markdownTextResolveSteps(input, context, true)
    if (cancel === 'throw') {
      const reason = new Error('cancel unstarted text resolver')
      expect(() => steps.throw(reason)).toThrow(reason)
    } else steps.return()
    expect(input).toEqual([])
    expect(context.parser).toBeDefined()
    expect(steps.next()).toEqual({ done: true, value: undefined })
  },
)
