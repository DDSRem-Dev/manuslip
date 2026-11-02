/* Adapted from micromark-util-subtokenize 2.1.0 (index.js), with cooperative
 * walks, transactional storage, and private child-tokenizer stepping.
 *
 * (The MIT License)
 * Copyright (c) Titus Wormer <tituswormer@gmail.com>
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
import type { Chunk, Event, Token, TokenizeContext } from 'micromark-util-types'
import { MarkdownEventBudget, MarkdownEventBuffer } from './markdown-event-buffer'

type SteppedTokenizer = TokenizeContext & {
  _manuslipWriteSteps?: (stream: Chunk[]) => Generator<void, Event[]>
}

/** Private block compiler callback. Input, partial edits and output stay owned by
 * the compiler until this generator completes. The quota covers event visits, not
 * native EOF resolvers, individual constructs, source slicing, or allocations.
 */
export function* markdownPostprocessSteps(input: Event[]): Generator<void, Event[]> {
  const budget = new MarkdownEventBudget()
  let complete = false
  try {
    while (!(yield* subtokenizeSteps(input, budget))) {}
    complete = true
    return input
  } finally {
    if (!complete) input.length = 0
  }
}

function* subtokenizeSteps(input: Event[], budget: MarkdownEventBudget): Generator<void, boolean> {
  const events = new MarkdownEventBuffer<Event>()
  const jumps: Record<number, number> = {}
  let more = false
  try {
    yield* events.load(input, budget)
    for (let index = 0; index < events.length; index++) {
      if (budget.advance()) yield
      while (index in jumps) {
        if (budget.advance()) yield
        index = jumps[index] as number
      }
      const event = events.get(index)
      // Preserve the native first-content hook used by GFM task list items.
      if (
        index &&
        event[1].type === 'chunkFlow' &&
        events.get(index - 1)[1].type === 'listItemPrefix'
      ) {
        const subevents = (event[1]._tokenizer as TokenizeContext).events
        let other = 0
        if (other < subevents.length && (subevents[other] as Event)[1].type === 'lineEndingBlank')
          other += 2
        if (other < subevents.length && (subevents[other] as Event)[1].type === 'content') {
          while (++other < subevents.length) {
            if (budget.advance()) yield
            const subevent = subevents[other] as Event
            if (subevent[1].type === 'content') break
            if (subevent[1].type === 'chunkText') {
              subevent[1]._isInFirstContentOfListItem = true
              other++
            }
          }
        }
      }
      if (event[0] === 'enter') {
        if (event[1].contentType) {
          yield* subcontentSteps(events, index, jumps, budget)
          index = jumps[index] as number
          more = true
        }
      } else if (event[1]._container) {
        let other = index
        let line: number | undefined
        while (other--) {
          if (budget.advance()) yield
          const preceding = events.get(other)
          if (preceding[1].type === 'lineEnding' || preceding[1].type === 'lineEndingBlank') {
            if (preceding[0] === 'enter') {
              if (line) events.get(line)[1].type = 'lineEndingBlank'
              preceding[1].type = 'lineEnding'
              line = other
            }
          } else if (preceding[1].type !== 'linePrefix' && preceding[1].type !== 'listItemIndent') {
            break
          }
        }
        if (line) {
          event[1].end = { ...events.get(line)[1].start }
          const parameters = yield* events.slice(line, index, budget, [event])
          try {
            yield* events.splice(line, index - line + 1, parameters, budget)
          } finally {
            parameters.length = 0
          }
        }
      }
    }
    const length = events.length
    for (let index = 0; index < length; index++) {
      if (budget.advance()) yield
      input[index] = events.get(index)
    }
    input.length = length
    return !more
  } finally {
    events.close()
  }
}

function childTokenizer(token: Token, context: TokenizeContext): SteppedTokenizer {
  const parser = context.parser as TokenizeContext['parser'] & {
    _manuslipBlockTokenSteps?: boolean
  }
  const previous = parser._manuslipBlockTokenSteps
  try {
    parser._manuslipBlockTokenSteps = true
    if (!token.contentType) throw new Error('Missing Markdown content type')
    const tokenizer: SteppedTokenizer = parser[token.contentType](token.start)
    if (token._contentTypeTextTrailing) tokenizer._contentTypeTextTrailing = true
    return tokenizer
  } finally {
    if (previous === undefined) delete parser._manuslipBlockTokenSteps
    else parser._manuslipBlockTokenSteps = previous
  }
}

function* subcontentSteps(
  events: MarkdownEventBuffer<Event>,
  eventIndex: number,
  gaps: Record<number, number>,
  budget: MarkdownEventBudget,
): Generator<void> {
  const token = events.get(eventIndex)[1]
  const context = events.get(eventIndex)[2]
  const owned = !token._tokenizer
  const tokenizer: SteppedTokenizer = token._tokenizer ?? childTokenizer(token, context)
  // Capture the same array as native subtokenize, before writes can replace it.
  const childEvents = tokenizer.events
  const starts: number[] = []
  const breaks = [0]
  const jumps: [number, number][] = []
  let current: Token | undefined = token
  let previous: Token | undefined
  let position = eventIndex - 1
  let stream: Chunk[] | undefined
  let complete = false
  try {
    while (current) {
      if (budget.advance()) yield
      do {
        if (budget.advance()) yield
        position++
      } while (events.get(position)[1] !== current)
      starts.push(position)
      if (!current._tokenizer) {
        stream = context.sliceStream(current)
        if (!current.next) stream.push(null)
        if (previous) tokenizer.defineSkip(current.start)
        if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = true
        if (!tokenizer._manuslipWriteSteps) throw new Error('Missing private child tokenizer steps')
        // Separate short writes as well as forwarding the native 4,096-dispatch pauses.
        yield
        const write = tokenizer._manuslipWriteSteps(stream)
        try {
          yield* write
        } finally {
          write.return([])
          if (current._isInFirstContentOfListItem)
            tokenizer._gfmTasklistFirstContentOfListItem = undefined
        }
        yield
        stream = undefined
      }
      previous = current
      current = current.next
    }
    current = token
    for (let index = 0; index < childEvents.length; index++) {
      if (budget.advance()) yield
      const event = childEvents[index] as Event
      if (
        event[0] === 'exit' &&
        (childEvents[index - 1] as Event)[0] === 'enter' &&
        event[1].type === (childEvents[index - 1] as Event)[1].type &&
        event[1].start.line !== event[1].end.line
      ) {
        breaks.push(index + 1)
        const linked = current as Token
        linked._tokenizer = undefined
        linked.previous = undefined
        current = linked.next
      }
    }
    tokenizer.events = []
    if (current) {
      current._tokenizer = undefined
      current.previous = undefined
    } else breaks.pop()
    for (let index = breaks.length - 1; index >= 0; index--) {
      if (budget.advance()) yield
      const slice: Event[] = []
      try {
        const end = breaks[index + 1] ?? childEvents.length
        for (let child = breaks[index] as number; child < end; child++) {
          if (budget.advance()) yield
          slice.push(childEvents[child] as Event)
        }
        const start = starts.pop() as number
        jumps.push([start, start + slice.length - 1])
        yield* events.splice(start, 2, slice, budget)
      } finally {
        slice.length = 0
      }
    }
    let adjust = 0
    for (let index = jumps.length - 1; index >= 0; index--) {
      if (budget.advance()) yield
      const [from, to] = jumps[index] as [number, number]
      gaps[adjust + from] = adjust + to
      adjust += to - from - 1
    }
    complete = true
  } finally {
    starts.length = 0
    breaks.length = 0
    jumps.length = 0
    if (!complete && owned) {
      // This context belongs exclusively to the abandoned private parse. Revoke
      // methods that close over input/state; completed contexts retain serializers.
      childEvents.length = 0
      if (tokenizer.events) tokenizer.events.length = 0
      if (stream) stream.length = 0
      for (const key of Object.keys(tokenizer)) Reflect.deleteProperty(tokenizer, key)
    }
  }
}
