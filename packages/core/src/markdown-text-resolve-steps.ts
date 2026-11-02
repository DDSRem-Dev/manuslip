/* Adapted from micromark 4.0.3 (lib/initialize/text.js): data merging and
 * line-suffix resolution, with cooperative scans and event edits.
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
import { MarkdownEventBudget, MarkdownEventBuffer } from './markdown-event-buffer'
import { PackedWork } from './packing-work'

interface TextResolution {
  input: Event[] | undefined
  context: TokenizeContext | undefined
  lineSuffixes: boolean
  budget: MarkdownEventBudget
  complete: boolean
}

/** Private native EOF callback. One quota covers event scans, trailing-space
 * reads, copies and gap edits. Source slicing, allocations and other resolvers
 * remain opaque. Cancellation never publishes partially resolved events.
 */
export function markdownTextResolveSteps(
  input: Event[],
  context: TokenizeContext,
  lineSuffixes: boolean,
  budget = new MarkdownEventBudget(),
): PackedWork<Event[]> {
  const owner: TextResolution = { input, context, lineSuffixes, budget, complete: false }
  return new PackedWork(resolveTextSteps(owner), () => {
    if (!owner.complete && owner.input) owner.input.length = 0
    owner.input = undefined
    owner.context = undefined
  })
}

function* resolveTextSteps(owner: TextResolution): Generator<void, Event[]> {
  const input = owner.input as Event[]
  const context = owner.context as TokenizeContext
  const budget = owner.budget
  const events = new MarkdownEventBuffer<Event>()
  try {
    yield* events.load(input, budget)
    let enter: number | undefined
    for (let index = 0; index <= events.length; index++) {
      if (budget.advance()) yield
      if (enter === undefined) {
        if (index < events.length && events.get(index)[1].type === 'data') {
          enter = index
          index++
        }
      } else if (index === events.length || events.get(index)[1].type !== 'data') {
        if (index !== enter + 2) {
          events.get(enter)[1].end = events.get(index - 1)[1].end
          yield* events.splice(enter + 2, index - enter - 2, [], budget)
          index = enter + 2
        }
        enter = undefined
      }
    }
    if (owner.lineSuffixes) yield* lineSuffixSteps(events, context, budget)
    const length = events.length
    for (let index = 0; index < length; index++) {
      if (budget.advance()) yield
      input[index] = events.get(index)
    }
    input.length = length
    owner.complete = true
    return input
  } finally {
    events.close()
  }
}

function* lineSuffixSteps(
  events: MarkdownEventBuffer<Event>,
  context: TokenizeContext,
  budget: MarkdownEventBudget,
): Generator<void> {
  // Native resolution records insertions against the original indexes and applies
  // them afterwards. They are already ordered, so no whole-array sort is needed.
  const insertions: { index: number; token: Token }[] = []
  try {
    for (let eventIndex = 1; eventIndex <= events.length; eventIndex++) {
      if (budget.advance()) yield
      if (
        (eventIndex === events.length || events.get(eventIndex)[1].type === 'lineEnding') &&
        events.get(eventIndex - 1)[1].type === 'data'
      ) {
        const data = events.get(eventIndex - 1)[1]
        const chunks = context.sliceStream(data)
        let index = chunks.length
        let bufferIndex = -1
        let size = 0
        let tabs: boolean | undefined
        while (index--) {
          if (budget.advance()) yield
          const chunk = chunks[index]
          if (typeof chunk === 'string') {
            bufferIndex = chunk.length
            while (true) {
              if (budget.advance()) yield
              if (chunk.charCodeAt(bufferIndex - 1) !== 32) break
              size++
              bufferIndex--
            }
            if (bufferIndex) break
            bufferIndex = -1
          } else if (chunk === -2) {
            tabs = true
            size++
          } else if (chunk !== -1) {
            index++
            break
          }
        }
        if (context._contentTypeTextTrailing && eventIndex === events.length) size = 0
        if (size) {
          const token: Token = {
            type:
              eventIndex === events.length || tabs || size < 2 ? 'lineSuffix' : 'hardBreakTrailing',
            start: {
              _bufferIndex: index ? bufferIndex : data.start._bufferIndex + bufferIndex,
              _index: data.start._index + index,
              line: data.end.line,
              column: data.end.column - size,
              offset: data.end.offset - size,
            },
            end: { ...data.end },
          }
          data.end = { ...token.start }
          if (data.start.offset === data.end.offset) Object.assign(data, token)
          else insertions.push({ index: eventIndex, token })
        }
        eventIndex++
      }
    }
    for (let index = insertions.length - 1; index >= 0; index--) {
      if (budget.advance()) yield
      const insertion = insertions[index] as (typeof insertions)[number]
      yield* events.splice(
        insertion.index,
        0,
        [
          ['enter', insertion.token, context],
          ['exit', insertion.token, context],
        ],
        budget,
      )
    }
  } finally {
    insertions.length = 0
  }
}
