import type { Root, RootContent } from 'mdast'
import { type CompileContext, type Extension, fromMarkdown } from 'mdast-util-from-markdown'
import { expect, it } from 'vitest'

function compile(source: string, extension?: Extension) {
  const options = {
    _manuslipEventSpans: true,
    _manuslipBlockStream: true,
    _manuslipBlockTokenSteps: true,
    _manuslipBlockPreprocessSteps: true,
    _manuslipBlockCompileSteps: true,
    _manuslipBlockTransforms: [],
    mdastExtensions: extension ? [extension] : [],
  }
  return fromMarkdown(source, options) as unknown as Generator<
    RootContent | undefined,
    Root | undefined
  >
}

const largeList = `${Array.from(
  { length: 400 },
  (_, index) =>
    `- **Item ${index}** [reference][later]\n\n  > Quoted *text* &amp; content.\n\n  1. Nested item\n  2. Second item\n\n`,
).join('')}[later]: /destination "Forward definition"\n`

it('pauses inside a complete large block after at most sixteen compiler event dispatches', () => {
  let events = 0
  const stream = compile(largeList, {
    beforeEnter() {
      events++
    },
    afterExit() {
      events++
    },
  })
  const children: RootContent[] = []
  let final: Root | undefined
  let pausedInside = 0
  try {
    while (true) {
      const before = events
      const next = stream.next()
      expect(events - before).toBeLessThanOrEqual(16)
      if (next.done) {
        final = next.value
        break
      }
      if (next.value) children.push(next.value)
      else if (events > 0 && children.length === 0) pausedInside++
    }
    expect(events).toBeGreaterThan(10000)
    expect(pausedInside).toBeGreaterThan(100)
    expect(final).toBeDefined()
    expect({ ...final, children }).toEqual(fromMarkdown(largeList))
  } finally {
    stream.return(undefined)
  }
})

it.each(['return', 'throw'] as const)(
  'clears shared compiler stacks and data when cancelled inside a large block with %s',
  (cancel) => {
    let events = 0
    let context: CompileContext | undefined
    const stream = compile(largeList, {
      beforeEnter() {
        events++
        context = this
      },
    })
    try {
      while (events < 32) {
        const next = stream.next()
        expect(next).toEqual({ done: false, value: undefined })
      }
      expect(context?.stack.length).toBeGreaterThan(1)
      expect(context?.tokenStack.length).toBeGreaterThan(0)
      if (cancel === 'throw') {
        const reason = new Error('cancel partial compiler')
        expect(() => stream.throw(reason)).toThrow(reason)
      } else stream.return(undefined)
      const completed = events
      expect(context?.stack).toEqual([])
      expect(context?.tokenStack).toEqual([])
      expect(context?.data).toEqual({})
      expect(stream.next()).toEqual({ done: true, value: undefined })
      expect(events).toBe(completed)
    } finally {
      stream.return(undefined)
    }
  },
)

it.each([1, 2, 17, 257])(
  'preserves complete nested, empty, tight and loose list positions through %i list items',
  (length) => {
    const source =
      '# Lists\r\n\r\n' +
      Array.from(
        { length },
        (_, index) =>
          `${index + 1}. First\r\n\r\n   - Nested\r\n   -\r\n\r\n   > Quote\r\n   >\r\n   > last [link][forward]\r\n\r\n`,
      ).join('') +
      '[forward]: /target\r\n\r\nEnd\r\n'
    const stream = compile(source)
    const children: RootContent[] = []
    try {
      while (true) {
        const next = stream.next()
        if (next.done) {
          expect({ ...next.value, children }).toEqual(fromMarkdown(source))
          break
        }
        if (next.value) children.push(next.value)
      }
    } finally {
      stream.return(undefined)
    }
  },
)
