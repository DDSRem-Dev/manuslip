import { parse, preprocess } from 'micromark'
import type { Chunk, Event, Extension, Resolver, TokenizeContext } from 'micromark-util-types'
import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import { expect, it } from 'vitest'
import { createMarkdownResolverSteps } from '../../src/markdown-inline-resolve-steps'

type PrivateContext = TokenizeContext & {
  _manuslipWriteSteps(chunks: Chunk[]): Generator<void, Event[]>
}
function create(stepped: boolean, gfm = true, extra: Extension[] = [], singleTilde = true) {
  const extensions = gfm
    ? (unified().use(remarkGfm, { singleTilde }).freeze().data('micromarkExtensions') ?? [])
    : []
  extensions.push(...extra)
  const parser = parse({ extensions })
  const capability = createMarkdownResolverSteps(extensions, gfm)
  if (stepped)
    Object.assign(parser, { _manuslipBlockTokenSteps: true, _manuslipTextResolveSteps: capability })
  return { context: parser.text() as PrivateContext, capability }
}

function finish(work: Generator<void, Event[]>): Event[] {
  while (true) {
    const step = work.next()
    if (step.done) return step.value
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
function compare(source: string, gfm = true, singleTilde = true) {
  const before = create(false, gfm, [], singleTilde).context
  const after = create(true, gfm, [], singleTilde).context
  expect(values(finish(after._manuslipWriteSteps(preprocess()(source, undefined, true))))).toEqual(
    values(before.write(preprocess()(source, undefined, true))),
  )
}

const cases = [
  '',
  'plain text',
  '*emphasis* and **strong** and ***both***',
  '_one_ __two__ ___three___',
  'a_b_c a__b__c a***b***c',
  '**a *b* c** *a **b** c*',
  '***a** b* *a **b*** **a* b**',
  '*a _b* c_ __a **b__ c**',
  '**a*b**c* ***a*b**c*',
  '*a***b***c* **a****b****c**',
  '*open _open **open ~~open',
  '~~one~~ ~two~ ~~~three~~~',
  '~~*inside* **strong**~~ *~~inside~~*',
  '*~~cross* outside~~ ~~*cross~~ outside*',
  '~~a ~b~ c~~ ~a ~~b~~ c~',
  '*[link](/target "title")* **![alt](image.png)**',
  '[*label* ~~removed~~](https://example.com) [ref][missing]',
  '\\*literal* &ast; &#42; *actual* `*code*`',
  '*中文* **العربية** ~~😀 e\u0301~~ _עברית_',
  '*a  \r\nb* ~~c\t \r\nd~~ final  ',
  '*a\r\nb* **c\rd** ~~e\nf~~',
  `${'*'.repeat(8193)}a${'*'.repeat(8193)}`,
]
for (const gfm of [false, true])
  it.each(
    cases.map((source) => ({
      source,
      label: source.length > 100 ? `long paired delimiter run (${source.length} units)` : source,
    })),
  )(
    `preserves complete native inline events (GFM ${gfm}) for $label`,
    ({ source }) => compare(source, gfm),
    // Long paired runs also exercise the quadratic ordinary native baseline.
    // Allow instrumentation overhead for this complete-fidelity oracle comparison.
    120_000,
  )

it.each([false, true])('preserves native single-tilde configuration %s', (single) => {
  compare('~one~ ~~two~~ ~*nested*~ ~~**nested**~~', true, single)
})

it('preserves seeded mixed delimiters, nesting, escapes, entities and Unicode', () => {
  const pieces = [
    'a',
    ' ',
    '*',
    '**',
    '***',
    '_',
    '__',
    '~',
    '~~',
    '`x`',
    '\\*',
    '&amp;',
    '[a](/b)',
    '\t',
    '\r\n',
    '😀',
    'العربية',
  ]
  let seed = 0x7b18da9
  for (let test = 0; test < 512; test++) {
    let source = ''
    for (let index = 0; index < 32; index++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      source += pieces[(seed >>> 0) % pieces.length]
    }
    compare(source, test % 3 !== 0, test % 2 === 0)
  }
})

it('preserves native points and serialization behavior across every linked-write split', () => {
  const source = '***a ~~b~~ c*** **d _e_** ~~*f*~~ 😀'
  let nativeFailures = 0
  let nativeSuccesses = 0
  const serialized = (events: Event[]) =>
    events.map(([phase, token, context]) => {
      let slices: unknown
      try {
        slices = {
          stream: context.sliceStream(token),
          text: context.sliceSerialize(token),
          expanded: context.sliceSerialize(token, true),
        }
        nativeSuccesses++
      } catch (error) {
        // Arbitrarily split raw delimiter chunks can give the ordinary native
        // resolver negative buffer indexes. Preserve its exact points and failure;
        // application preprocessing keeps a delimiter run in one source chunk.
        if (!(error instanceof Error)) throw error
        slices = { name: error.name, message: error.message }
        nativeFailures++
      }
      return { phase, token: { ...token }, slices }
    })
  for (let split = 1; split < source.length; split++) {
    const before = create(false).context
    const after = create(true).context
    before.write([source.slice(0, split)])
    finish(after._manuslipWriteSteps([source.slice(0, split)]))
    expect(serialized(finish(after._manuslipWriteSteps([source.slice(split), null])))).toEqual(
      serialized(before.write([source.slice(split), null])),
    )
  }
  expect(nativeFailures).toBeGreaterThan(0)
  expect(nativeSuccesses).toBeGreaterThan(0)
})

it('retains native global event observations for unknown inside-span resolvers', () => {
  const observe = (steps: boolean) => {
    const observations: unknown[] = []
    const extension: Extension = {
      insideSpan: {
        null: [
          {
            resolveAll(events, context) {
              observations.push({
                local: events.length,
                global: context.events.length,
                tokens: context.events.map((event) => event[1].type),
              })
              return events
            },
          },
        ],
      },
    }
    const { context } = create(steps, true, [extension])
    const source = '*a* **b** ~~*c*~~ *d **e** f*'
    const chunks = preprocess()(source, undefined, true)
    const events = steps ? finish(context._manuslipWriteSteps(chunks)) : context.write(chunks)
    return { events: values(events), observations }
  }
  expect(observe(true)).toEqual(observe(false))
})

for (const method of ['return', 'throw'] as const)
  it(`closes the actual native parent and inline work on ${method} during EOF resolution`, () => {
    const { context, capability } = create(true)
    const resolve = capability.resolveAll
    const attention = parse().constructs.text[42]
    const construct = Array.isArray(attention) ? attention[0] : attention
    let selected: ReturnType<typeof resolve> | undefined
    let advances = 0
    capability.resolveAll = (resolver, input, owner) => {
      const work = resolve(resolver, input, owner)
      if (resolver === construct?.resolveAll) selected = work
      return work
    }
    const source = '*outer **inside** ~~removed~~ end* '.repeat(700)
    const work = context._manuslipWriteSteps(preprocess()(source, undefined, true))
    while (true) {
      const step = work.next()
      expect(step.done).toBe(false)
      if (selected && ++advances === 6) break
    }
    if (method === 'return') work.return([])
    else
      expect(() => work.throw(new Error('cancel inline resolution'))).toThrow(
        'cancel inline resolution',
      )
    expect(Object.keys(context)).toEqual([])
    expect(selected?.next().done).toBe(true)
    expect(work.next().done).toBe(true)
  })

it.each(['return', 'throw'] as const)('releases unstarted inline input on %s', (method) => {
  const { context, capability } = create(false)
  const events = context.write(preprocess()('*text*', undefined, true))
  const attention = parse().constructs.text[42]
  const construct = Array.isArray(attention) ? attention[0] : attention
  const work = capability.resolveAll(construct?.resolveAll as Resolver, events, context)
  if (method === 'return') work.return()
  else expect(() => work.throw(new Error('unstarted'))).toThrow('unstarted')
  expect(events).toEqual([])
  expect(work.next().done).toBe(true)
})
