/* Adapted from micromark-core-commonmark 2.0.4 (label-end).
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
import type { Event, Token, TokenizeContext } from 'micromark-util-types'
import type { MarkdownEventBudget } from './markdown-event-buffer'
import type { InlineResolveCoroutine, InlineResolveFrame } from './markdown-inline-resolve-types'

function* append(
  target: Event[],
  source: readonly Event[],
  from: number,
  to: number,
  budget: MarkdownEventBudget,
): Generator<void> {
  for (let index = from; index < to; index++) {
    if (budget.advance()) yield
    target.push(source[index] as Event)
  }
}

/** Preserve the native whole-event view until committing the resolved label. */
export function* labelEndSteps(
  frame: InlineResolveFrame,
  budget: MarkdownEventBudget,
): InlineResolveCoroutine {
  const events = frame.input as Event[]
  const context = frame.context as TokenizeContext
  let index = events.length
  let offset = 0
  let open: number | undefined
  let close: number | undefined
  const media: Event[] = []
  let inside: Event[] | undefined
  try {
    while (index--) {
      if (budget.advance()) yield
      const token = (events[index] as Event)[1]
      // Native truthiness is intentional: an opener at zero follows its own path.
      if (open) {
        if (token.type === 'link' || (token.type === 'labelLink' && token._inactive)) break
        if (events[index]?.[0] === 'enter' && token.type === 'labelLink') token._inactive = true
      } else if (close) {
        if (
          events[index]?.[0] === 'enter' &&
          (token.type === 'labelImage' || token.type === 'labelLink') &&
          !token._balanced
        ) {
          open = index
          if (token.type !== 'labelLink') {
            offset = 2
            break
          }
        }
      } else if (token.type === 'labelEnd') close = index
    }
    if (open === undefined || close === undefined) throw new Error('Incomplete private link label')
    const opening = (events[open] as Event)[1]
    const closing = (events[close] as Event)[1]
    const group: Token = {
      type: opening.type === 'labelLink' ? 'link' : 'image',
      start: { ...opening.start },
      end: { ...(events[events.length - 1] as Event)[1].end },
    }
    const label: Token = {
      type: 'label',
      start: { ...opening.start },
      end: { ...closing.end },
    }
    const text: Token = {
      type: 'labelText',
      start: { ...(events[open + offset + 2] as Event)[1].end },
      end: { ...(events[close - 2] as Event)[1].start },
    }
    media.push(['enter', group, context], ['enter', label, context])
    yield* append(media, events, open + 1, open + offset + 3, budget)
    media.push(['enter', text, context])
    inside = []
    yield* append(inside, events, open + offset + 4, close - 3, budget)
    inside = yield { input: inside, constructs: context.parser.constructs.insideSpan.null ?? [] }
    if (!inside) throw new Error('Incomplete private link label')
    yield* append(media, inside, 0, inside.length, budget)
    inside.length = 0
    inside = undefined
    media.push(['exit', text, context], events[close - 2] as Event, events[close - 1] as Event, [
      'exit',
      label,
      context,
    ])
    yield* append(media, events, close + 1, events.length, budget)
    media.push(['exit', group, context])
    for (let cursor = 0; cursor < media.length; cursor++) {
      if (budget.advance()) yield
      events[open + cursor] = media[cursor] as Event
    }
    events.length = open + media.length
    return events
  } finally {
    if (inside) inside.length = 0
    media.length = 0
  }
}

/** Native EOF cleanup, including the skipped link/image marker events. */
export function* labelCleanupSteps(
  frame: InlineResolveFrame,
  budget: MarkdownEventBudget,
): InlineResolveCoroutine {
  const events = frame.input as Event[]
  const next: Event[] = []
  try {
    for (let index = 0; index < events.length; index++) {
      if (budget.advance()) yield
      const event = events[index] as Event
      const token = event[1]
      next.push(event)
      if (token.type === 'labelImage' || token.type === 'labelLink' || token.type === 'labelEnd') {
        index += token.type === 'labelImage' ? 4 : 2
        token.type = 'data'
      }
    }
    if (events.length !== next.length) {
      for (let index = 0; index < next.length; index++) {
        if (budget.advance()) yield
        events[index] = next[index] as Event
      }
      events.length = next.length
    }
    return events
  } finally {
    next.length = 0
  }
}
