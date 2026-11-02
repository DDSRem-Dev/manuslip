/* Adapted from micromark-core-commonmark 2.0.4 (attention) and
 * micromark-extension-gfm-strikethrough 2.1.0 (syntax).
 *
 * (The MIT License)
 * Copyright (c) Titus Wormer <tituswormer@gmail.com>
 * Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { parse } from 'micromark'
import type {
  Event,
  Extension,
  Point,
  Resolver,
  Token,
  TokenizeContext,
} from 'micromark-util-types'
import { MarkdownEventBudget, MarkdownEventBuffer } from './markdown-event-buffer'
import type {
  InlineResolveCoroutine as Coroutine,
  InlineResolveFrame as Frame,
  InlineResolveRequest as Request,
  InlineResolverKind as Kind,
} from './markdown-inline-resolve-types'
import { labelCleanupSteps, labelEndSteps } from './markdown-label-resolve-steps'
import { markdownTextResolveSteps } from './markdown-text-resolve-steps'
import { PackedWork } from './packing-work'

type NativeResolver = Resolver & { _manuslipTextResolve?: boolean }
interface Resolution {
  input: Event[] | undefined
  context: TokenizeContext | undefined
  pending: Event[] | undefined
  frames: Frame[]
  complete: boolean
}

/** Capability for the application's fixed grammar. The GFM identity comes from the
 * actual extension instance used by this parse, rather than another factory call.
 * Unknown inside-span resolvers retain the complete native resolver path.
 */
export function createMarkdownResolverSteps(extensions: readonly Extension[], gfm: boolean) {
  // Resolve the pinned built-in identity only when creating this private capability.
  const native = parse().constructs.text
  const nativeAttention = native[42]
  const attention = (
    Array.isArray(nativeAttention) ? nativeAttention : nativeAttention ? [nativeAttention] : []
  ).find((construct) => construct.name === 'attention')?.resolveAll
  if (!attention) throw new Error('Unsupported native attention construct')
  const known = new Map<Resolver, Kind>([[attention, 'attention']])
  const nativeLabel = native[93]
  const label = (Array.isArray(nativeLabel) ? nativeLabel : nativeLabel ? [nativeLabel] : []).find(
    (construct) => construct.name === 'labelEnd',
  )
  if (!label?.resolveTo || !label.resolveAll) throw new Error('Unsupported native label construct')
  known.set(label.resolveTo, 'labelEnd')
  known.set(label.resolveAll, 'labelCleanup')
  const strikes = new Set<Resolver>()
  for (const extension of extensions) {
    const span = extension.insideSpan?.null
    const inside = Array.isArray(span) ? span : span ? [span] : []
    const text = extension.text?.[126]
    for (const construct of Array.isArray(text) ? text : text ? [text] : []) {
      if (construct.name === 'strikethrough' && construct.resolveAll && inside.includes(construct))
        strikes.add(construct.resolveAll)
    }
  }
  if (strikes.size !== (gfm ? 1 : 0)) throw new Error('Unsupported native strikethrough constructs')
  for (const resolver of strikes) known.set(resolver, 'strikethrough')
  const createWork = (resolver: Resolver, input: Event[], context: TokenizeContext) => {
    const owner: Resolution = {
      input,
      context,
      pending: undefined,
      frames: [],
      complete: false,
    }
    return new PackedWork(resolveSteps(owner, resolver, known), () => {
      if (!owner.complete && owner.input) owner.input.length = 0
      if (owner.pending) owner.pending.length = 0
      owner.input = undefined
      owner.context = undefined
      owner.pending = undefined
    })
  }
  return Object.assign(
    (input: Event[], context: TokenizeContext, suffixes: boolean) =>
      markdownTextResolveSteps(input, context, suffixes),
    {
      resolveAll: createWork,
      resolveTo(resolver: Resolver, input: Event[], context: TokenizeContext) {
        return resolver === label.resolveTo ? createWork(resolver, input, context) : undefined
      },
    },
  )
}

function release(frame: Frame): void {
  try {
    frame.work?.return([])
  } finally {
    if (!frame.complete && frame.input) frame.input.length = 0
    frame.input = undefined
    frame.context = undefined
    frame.resolver = undefined
    frame.constructs = undefined
    frame.work = undefined
  }
}

function* resolveSteps(
  owner: Resolution,
  resolver: Resolver,
  known: ReadonlyMap<Resolver, Kind>,
): Generator<void, Event[]> {
  const budget = new MarkdownEventBudget()
  const push = (request: Request): void => {
    const frame: Frame = {
      ...request,
      context: owner.context,
      resolver: request.resolver,
      constructs: request.constructs,
      complete: false,
      work: undefined,
    }
    frame.work = request.constructs
      ? resolveAllSteps(frame, budget)
      : resolveOneSteps(frame, known, budget)
    owner.frames.push(frame)
  }
  push({ resolver, input: owner.input as Event[] })
  try {
    while (owner.frames.length) {
      if (budget.advance()) yield
      const frame = owner.frames[owner.frames.length - 1] as Frame
      const pending = owner.pending
      owner.pending = undefined
      const step = (frame.work as Coroutine).next(pending)
      if (step.done) {
        if (!Array.isArray(step.value)) throw new Error('Incomplete private inline resolver')
        frame.complete = true
        owner.pending = step.value
        owner.frames.pop()
        release(frame)
      } else if (step.value) push(step.value)
      else yield
    }
    const result = owner.pending as Event[]
    owner.pending = undefined
    owner.complete = true
    return result
  } finally {
    for (let index = owner.frames.length - 1; index >= 0; index--)
      release(owner.frames[index] as Frame)
    owner.frames.length = 0
  }
}

function* resolveAllSteps(frame: Frame, budget: MarkdownEventBudget): Coroutine {
  let events = frame.input as Event[]
  const called = new Set<Resolver>()
  try {
    for (const construct of frame.constructs ?? []) {
      if (budget.advance()) yield
      const resolver = construct.resolveAll
      if (resolver && !called.has(resolver)) {
        const resolved = yield { resolver, input: events }
        if (!resolved) throw new Error('Incomplete private inline resolver')
        events = resolved
        frame.input = events
        called.add(resolver)
      }
    }
    return events
  } finally {
    called.clear()
  }
}

function* resolveOneSteps(
  frame: Frame,
  known: ReadonlyMap<Resolver, Kind>,
  budget: MarkdownEventBudget,
): Coroutine {
  const resolver = frame.resolver as NativeResolver
  const context = frame.context as TokenizeContext
  const kind = known.get(resolver)
  if (kind === 'labelCleanup') return yield* labelCleanupSteps(frame, budget)
  let supported = true
  for (const construct of context.parser.constructs.insideSpan.null ?? []) {
    if (budget.advance()) yield
    const resolve = construct.resolveAll as NativeResolver | undefined
    if (resolve && !known.has(resolve) && typeof resolve._manuslipTextResolve !== 'boolean')
      supported = false
  }
  if (kind === 'labelEnd' && supported) return yield* labelEndSteps(frame, budget)
  if ((kind === 'attention' || kind === 'strikethrough') && supported)
    return yield* spanSteps(frame, kind, budget)
  if (typeof resolver._manuslipTextResolve === 'boolean')
    return yield* textSteps(frame, resolver._manuslipTextResolve, budget)
  // Calls outside the audited grammar remain opaque and keep native array/context semantics.
  yield
  const result = resolver(frame.input as Event[], context)
  if (!Array.isArray(result)) throw new Error('Incomplete private inline resolver')
  frame.input = result
  yield
  return result
}

function* textSteps(frame: Frame, suffixes: boolean, budget: MarkdownEventBudget): Coroutine {
  const work = markdownTextResolveSteps(
    frame.input as Event[],
    frame.context as TokenizeContext,
    suffixes,
    budget,
  )
  try {
    while (true) {
      const step = work.next()
      if (step.done) {
        if (!step.value) throw new Error('Incomplete private text resolver')
        return step.value
      }
      yield
    }
  } finally {
    work.return()
  }
}

function move(point: Point, amount: number): void {
  point.column += amount
  point.offset += amount
  point._bufferIndex += amount
}

function* marker(
  token: Token,
  context: TokenizeContext,
  budget: MarkdownEventBudget,
): Generator<void, number> {
  if (budget.advance()) yield
  // Attention sequences contain one repeated ASCII marker. Read its first unit
  // without copying the whole run. Raw writes can split a run across chunks;
  // native point movement can then leave empty or negative-index slices. Keep
  // that native serialization behavior for those exceptional slices.
  if (
    token.start._bufferIndex >= 0 &&
    (token.start._index < token.end._index ||
      (token.start._index === token.end._index &&
        token.start._bufferIndex < token.end._bufferIndex))
  ) {
    const end = { ...token.start }
    move(end, 1)
    const first = context.sliceSerialize({ start: token.start, end })
    if (first) return first.charCodeAt(0)
  }
  return context.sliceSerialize(token).charCodeAt(0)
}

function* append(
  target: Event[],
  input: readonly Event[],
  budget: MarkdownEventBudget,
): Generator<void> {
  for (const event of input) {
    if (budget.advance()) yield
    target.push(event)
  }
}

function* spanSteps(
  frame: Frame,
  kind: 'attention' | 'strikethrough',
  budget: MarkdownEventBudget,
): Coroutine {
  const input = frame.input as Event[]
  const context = frame.context as TokenizeContext
  const events = new MarkdownEventBuffer<Event>()
  const temporary = kind === 'attention' ? 'attentionSequence' : 'strikethroughSequenceTemporary'
  const nextEvents: Event[] = []
  let inside: Event[] | undefined
  try {
    yield* events.load(input, budget)
    for (let index = 0; index < events.length; index++) {
      if (budget.advance()) yield
      const close = events.get(index)
      if (close[0] !== 'enter' || close[1].type !== temporary || !close[1]._close) continue
      for (let open = index - 1; open >= 0; open--) {
        if (budget.advance()) yield
        const opening = events.get(open)
        if (opening[0] !== 'exit' || opening[1].type !== temporary || !opening[1]._open) continue
        const opener = opening[1],
          closer = close[1]
        const openSize = opener.end.offset - opener.start.offset
        const closeSize = closer.end.offset - closer.start.offset
        if (kind === 'attention') {
          if ((yield* marker(opener, context, budget)) !== (yield* marker(closer, context, budget)))
            continue
          if ((opener._close || closer._open) && closeSize % 3 && !((openSize + closeSize) % 3))
            continue
        } else if (openSize !== closeSize) continue
        let openingSequence: Token, closingSequence: Token, text: Token, group: Token
        let remainder = 0
        if (kind === 'attention') {
          const use = openSize > 1 && closeSize > 1 ? 2 : 1
          const start = { ...opener.end },
            end = { ...closer.start }
          move(start, -use)
          move(end, use)
          openingSequence = {
            type: use > 1 ? 'strongSequence' : 'emphasisSequence',
            start,
            end: { ...opener.end },
          }
          closingSequence = { type: openingSequence.type, start: { ...closer.start }, end }
          text = {
            type: use > 1 ? 'strongText' : 'emphasisText',
            start: { ...opener.end },
            end: { ...closer.start },
          }
          group = {
            type: use > 1 ? 'strong' : 'emphasis',
            start: { ...openingSequence.start },
            end: { ...closingSequence.end },
          }
          opener.end = { ...openingSequence.start }
          closer.start = { ...closingSequence.end }
          if (opener.end.offset - opener.start.offset)
            yield* append(
              nextEvents,
              [
                ['enter', opener, context],
                ['exit', opener, context],
              ],
              budget,
            )
          if (closer.end.offset - closer.start.offset) remainder = 2
        } else {
          opener.type = closer.type = 'strikethroughSequence'
          openingSequence = opener
          closingSequence = closer
          text = { type: 'strikethroughText', start: { ...opener.end }, end: { ...closer.start } }
          group = { type: 'strikethrough', start: { ...opener.start }, end: { ...closer.end } }
        }
        yield* append(
          nextEvents,
          [
            ['enter', group, context],
            ['enter', openingSequence, context],
            ['exit', openingSequence, context],
            ['enter', text, context],
          ],
          budget,
        )
        inside = yield* events.slice(open + 1, index, budget)
        inside = yield {
          constructs: context.parser.constructs.insideSpan.null ?? [],
          input: inside,
        }
        if (!inside) throw new Error('Incomplete private inline resolver')
        yield* append(nextEvents, inside, budget)
        inside.length = 0
        inside = undefined
        yield* append(
          nextEvents,
          [
            ['exit', text, context],
            ['enter', closingSequence, context],
            ['exit', closingSequence, context],
            ['exit', group, context],
          ],
          budget,
        )
        if (remainder)
          yield* append(
            nextEvents,
            [
              ['enter', closer, context],
              ['exit', closer, context],
            ],
            budget,
          )
        yield* events.splice(open - 1, index - open + 3, nextEvents, budget)
        index = open + nextEvents.length - remainder - 2
        nextEvents.length = 0
        break
      }
    }
    for (let index = 0; index < events.length; index++) {
      if (budget.advance()) yield
      if (events.get(index)[1].type === temporary) events.get(index)[1].type = 'data'
    }
    const length = events.length
    for (let index = 0; index < length; index++) {
      if (budget.advance()) yield
      input[index] = events.get(index)
    }
    input.length = length
    return input
  } finally {
    if (inside) inside.length = 0
    nextEvents.length = 0
    events.close()
  }
}
