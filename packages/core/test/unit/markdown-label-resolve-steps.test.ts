import { parse, preprocess } from 'micromark'
import type { Chunk, Event, Extension, TokenizeContext } from 'micromark-util-types'
import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import { expect, it } from 'vitest'
import { createMarkdownResolverSteps } from '../../src/markdown-inline-resolve-steps'

type PrivateContext = TokenizeContext & {
  _manuslipWriteSteps(chunks: Chunk[]): Generator<void, Event[]>
}
function create(stepped: boolean, gfm = true, extra: Extension[] = []) {
  const extensions = gfm
    ? (unified().use(remarkGfm).freeze().data('micromarkExtensions') ?? [])
    : []
  extensions.push(...extra)
  const parser = parse({ extensions })
  parser.defined.push('REF', 'A B', 'LABEL')
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
  return events.map(([phase, token, context]) => {
    let slices: unknown
    try {
      slices = {
        stream: context.sliceStream(token),
        text: context.sliceSerialize(token),
        expanded: context.sliceSerialize(token, true),
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      slices = { name: error.name, message: error.message }
    }
    return { phase, token: { ...token }, slices }
  })
}

const cases = [
  '[]() ![]()',
  '[label](/url "title") ![alt](image.png)',
  '[**strong** *emphasis* ~~removed~~](/url)',
  '*[**inside** ~~strike~~](/url)* ~~[link](/other)~~',
  '[outer [inner](/i) end](/o)',
  '[![**image**](image.png "alt")](/target)',
  '![outer [**link**](/i) end](image.png)',
  '[a [b [c] d] e](/url) [later](/u)',
  'unmatched [a [b ] ] [c ![d ] e',
  '[literal\\] bracket](/url) [escaped\\* *real*](/u)',
  '[`code ]` &amp; &#x5d; *label*](<a(b)> "title")',
  '[中文 😀 e\u0301 العربية עברית](/url)',
  '[**a\r\nb**\t ~~c~~](<url>\r\n "title")',
  '[a  \r\nb](/url) ![a\t \r\nb](image)',
  '[label][ref] [ref][] [REF] [a b] [a\r\n b][]',
  '[missing][] [missing] [a][missing] ![missing]',
  '[<https://example.com> **text**](/url)',
  `${'*x* '.repeat(700)}[**label** ~~removed~~](/url) end`,
  `[${'*'.repeat(1025)}a${'*'.repeat(1025)}](/url) end`,
  `[${'**strong** ~~strike~~ '.repeat(450)}](/url) end`,
]
for (const gfm of [false, true])
  it.each(cases.map((source, index) => ({ source, label: index + 1 })))(
    `preserves complete native link/image/marker events (GFM ${gfm}) case $label`,
    ({ source }) => {
      const before = create(false, gfm).context
      const after = create(true, gfm).context
      expect(
        values(finish(after._manuslipWriteSteps(preprocess()(source, undefined, true)))),
      ).toEqual(values(before.write(preprocess()(source, undefined, true))))
    },
  )

it('keeps native points, label state and serialization across every linked-write split', () => {
  const source = '[**label** ~~a~~](<u> "t") [![image](/i)](/o) [ref][]'
  let successes = 0
  let failures = 0
  for (let split = 1; split < source.length; split++) {
    const run = (stepped: boolean) => {
      const { context } = create(stepped)
      try {
        const write = (chunks: Chunk[]) =>
          stepped ? finish(context._manuslipWriteSteps(chunks)) : context.write(chunks)
        write([source.slice(0, split)])
        return { events: values(write([source.slice(split), null])) }
      } catch (error) {
        // Arbitrary raw chunks also expose native label-start negative indexes.
        // Preserve complete successful output and exact native failures.
        if (!(error instanceof Error)) throw error
        return { error: { name: error.name, message: error.message } }
      }
    }
    const before = run(false)
    if (before.error) failures++
    else successes++
    expect(run(true)).toEqual(before)
  }
  expect(successes).toBeGreaterThan(0)
  expect(failures).toBeGreaterThan(0)
})

it('parks the next input character until cooperative label resolution finishes', () => {
  const { context, capability } = create(true)
  const resolve = capability.resolveTo
  const offsets: number[] = []
  const source = `[${'**label** ~~strike~~ '.repeat(400)}](/url)after`
  capability.resolveTo = (resolver, input, owner) => {
    const work = resolve(resolver, input, owner)
    if (work) {
      const next = work.next.bind(work)
      work.next = () => {
        offsets.push(owner.now().offset)
        return next()
      }
    }
    return work
  }
  const result = finish(context._manuslipWriteSteps(preprocess()(source, undefined, true)))
  expect(offsets.length).toBeGreaterThan(100)
  expect(new Set(offsets)).toEqual(new Set([source.length - 'after'.length]))
  expect(values(result)).toEqual(
    values(create(false).context.write(preprocess()(source, undefined, true))),
  )
})

it('retains ordinary writing and compatibility with private callbacks lacking resolveTo', () => {
  const source = '[*label* ~~strike~~](/url) ![image](/i) unmatched [label'
  const ordinary = values(create(false).context.write(preprocess()(source, undefined, true)))
  const publicWrite = create(true)
  publicWrite.capability.resolveTo = () => {
    throw new Error('Public writer invoked private resolution')
  }
  expect(values(publicWrite.context.write(preprocess()(source, undefined, true)))).toEqual(ordinary)
  const legacy = create(true)
  Reflect.deleteProperty(legacy.capability, 'resolveTo')
  expect(
    values(finish(legacy.context._manuslipWriteSteps(preprocess()(source, undefined, true)))),
  ).toEqual(ordinary)
})

it('retains whole native event observations for unknown inside-span resolvers in labels', () => {
  const run = (stepped: boolean) => {
    const observations: unknown[] = []
    const extension: Extension = {
      insideSpan: {
        null: [
          {
            resolveAll(events, context) {
              observations.push({
                local: events.map(([phase, token]) => [phase, token.type]),
                global: context.events.map(([phase, token]) => [phase, token.type]),
                point: context.now(),
              })
              return events
            },
          },
        ],
      },
    }
    const { context } = create(stepped, true, [extension])
    const chunks = preprocess()('prefix *a* [**b** ~~c~~](/u) ![*d*](/i) suffix', undefined, true)
    const events = stepped ? finish(context._manuslipWriteSteps(chunks)) : context.write(chunks)
    return { observations, events: values(events) }
  }
  expect(run(true)).toEqual(run(false))
})

for (const method of ['return', 'throw'] as const)
  it.each([0, 1, 5, 25, 100])(
    `revokes the parked native parent and label work on ${method} after %s advances`,
    (pauses) => {
      const { context, capability } = create(true)
      const resolve = capability.resolveTo
      let selected: ReturnType<typeof resolve>
      let input: Event[] | undefined
      capability.resolveTo = (resolver, events, owner) => {
        selected = resolve(resolver, events, owner)
        if (selected) input = events
        return selected
      }
      const source = `[${'**strong** ~~strike~~ '.repeat(800)}](/url) tail`
      const parent = context._manuslipWriteSteps(preprocess()(source, undefined, true))
      while (!selected) expect(parent.next().done).toBe(false)
      for (let index = 0; index < pauses; index++) expect(parent.next().done).toBe(false)
      expect(input?.length).toBeGreaterThan(0)
      if (method === 'return') parent.return([])
      else expect(() => parent.throw(new Error('cancel label'))).toThrow('cancel label')
      expect(Object.keys(context)).toEqual([])
      expect(input).toEqual([])
      expect(selected.next().done).toBe(true)
      expect(parent.next().done).toBe(true)
    },
  )
