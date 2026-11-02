import { type Extension, fromMarkdown } from 'mdast-util-from-markdown'
import { parse as parseMicromark, preprocess } from 'micromark'
import { expect, it } from 'vitest'

it.each([false, true])(
  'keeps streaming contexts until EOF and detaches only private completed state: %s',
  (privateRelease) => {
    function run(release: boolean) {
      const parser = parseMicromark() as ReturnType<typeof parseMicromark> & {
        _manuslipReleaseCompleted?: boolean
      }
      if (release) parser._manuslipReleaseCompleted = true
      const context = parser.flow()
      const feed = preprocess()
      context.write(feed('plain\ttext\r\n', undefined, false))
      expect(typeof context.write).toBe('function')
      expect(typeof context.now).toBe('function')
      expect(typeof context.defineSkip).toBe('function')
      context.write(feed('continued &amp; text\n', undefined, true))
      const events = context.events.map(([kind, token, owner]) => ({
        kind,
        type: token.type,
        start: token.start,
        end: token.end,
        stream: owner.sliceStream(token),
        text: owner.sliceSerialize(token),
        expanded: owner.sliceSerialize(token, true),
      }))
      expect(context.events.every((event) => event[2].parser === parser)).toBe(true)
      expect(context.parser).toBe(parser)
      return { context, events }
    }
    const ordinary = run(false)
    const actual = run(privateRelease)
    expect(actual.events).toEqual(ordinary.events)
    if (privateRelease)
      expect(Object.keys(actual.context).sort()).toEqual([
        'events',
        'parser',
        'sliceSerialize',
        'sliceStream',
      ])
    else
      for (const key of ['write', 'now', 'defineSkip', 'sliceStream', 'sliceSerialize'] as const)
        expect(typeof actual.context[key]).toBe('function')
  },
)

it('preserves listener order, shared compiler data and one whole-root transform across spans', () => {
  const source =
    '> - first **strong** [late][r]\n>\n>   continued\n\nOutside.\n\n- second\n\n  spread\n\n[r]: /target\n'
  function run(spans: boolean) {
    const trace: unknown[] = []
    const data = new Set<unknown>()
    let transforms = 0
    const extension: Extension = {
      beforeEnter(token) {
        data.add(this.data)
        trace.push(['enter', token.type, token.start.offset, this.stack.map((node) => node.type)])
      },
      afterExit(token) {
        data.add(this.data)
        trace.push(['exit', token.type, token.end.offset, this.stack.map((node) => node.type)])
      },
      transforms: [
        (tree) => {
          transforms++
          trace.push(['transform', tree.children.map((node) => node.type), tree.position])
          return tree
        },
      ],
    }
    const options = { mdastExtensions: [extension], _manuslipEventSpans: spans }
    const tree = fromMarkdown(source, options)
    expect(data.size).toBe(1)
    expect(transforms).toBe(1)
    return { tree, trace }
  }
  expect(run(true)).toEqual(run(false))
})
