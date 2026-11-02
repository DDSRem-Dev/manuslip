import assert from 'node:assert/strict'
import { withSynchronousTextResolution } from './parser-text-resolve-steps.mjs'

function cancelledTokenizerChanges(end) {
  return [
    [
      '    function* writeSteps(slice) {\n',
      `    function writeSteps(slice) {
      // Manuslip private cancelled-tokenizer release.
      const input = {slice, complete: false}${end}
      slice = undefined${end}
      const steps = writeInputSteps(input)${end}
      const close = steps.return${end}
      const fail = steps.throw${end}
      steps.return = function(value) {
        try { return close.call(steps, value)${end} }
        finally { if (!input.complete) releaseCancelledInput(input)${end} }
      }${end}
      steps.throw = function(error) {
        try { return fail.call(steps, error)${end} }
        finally { if (!input.complete) releaseCancelledInput(input)${end} }
      }${end}
      return steps${end}
    }
    function* writeInputSteps(input) {
      try {
`,
    ],
    [
      `      chunks = push(chunks, slice)${end}`,
      `      chunks = push(chunks, input.slice)${end}\n      input.slice = undefined${end}`,
    ],
    [`        return []${end}`, `        input.complete = true${end}\n        return []${end}`],
    [
      `      return context.events${end}\n    }`,
      `      input.complete = true${end}
      return context.events${end}
      } finally {
        if (!input.complete) releaseCancelledInput(input)${end}
      }
    }
    function releaseCancelledInput(input) {
      // The actual generator keeps only a cleared owner in its argument slot.
      input.slice = undefined${end}
      chunks = []${end}
      serialization.chunks = chunks${end}
      stack = []${end}
      columnStart = {}${end}
      resolveAllConstructs = []${end}
      point = undefined${end}
      state = undefined${end}
      parser = undefined${end}
      initialize = undefined${end}
      from = undefined${end}
      for (const key of Object.keys(context)) Reflect.deleteProperty(context, key)${end}
    }`,
    ],
  ]
}

function tokenizerCancellation(source, dev, inverse) {
  const end = dev ? '' : ';'
  const change = (value, before, after) => {
    if (inverse) [before, after] = [after, before]
    assert.equal(value.split(before).length, 2, before)
    return value.replace(before, after)
  }
  for (const name of ['columnStart = {}', 'resolveAllConstructs = []'])
    source = change(source, `  const ${name}${end}`, `  let ${name}${end}`)
  const from = source.indexOf(`    function${inverse ? '' : '*'} writeSteps(slice) {`)
  const to = source.indexOf('    function mainSteps() {', from)
  assert.ok(from > 0 && to > from)
  let write = source.slice(from, to)
  const changes = cancelledTokenizerChanges(end)
  if (inverse) changes.reverse()
  for (const [before, after] of changes) write = change(write, before, after)
  return source.slice(0, from) + write + source.slice(to)
}

export function cancelledTokenizerSteps(source, variant) {
  return variant.kind === 'tokenizer' ? tokenizerCancellation(source, variant.dev, false) : source
}

export function withRetainedCancelledTokenizer(source, dev) {
  source = withSynchronousTextResolution(source, dev)
  return source.includes('// Manuslip private cancelled-tokenizer release.')
    ? tokenizerCancellation(source, dev, true)
    : source
}

function postprocessCall(dev) {
  const end = dev ? '' : ';'
  return [
    `      streamEvents = postprocess(input)${end}`,
    `      streamEvents = options._manuslipBlockPostprocessSteps
        ? yield* options._manuslipBlockPostprocessSteps(input)
        : postprocess(input)${end}`,
  ]
}

export function postprocessBlockSteps(source, variant) {
  if (variant.kind !== 'compiler') return source
  const [before, after] = postprocessCall(variant.dev)
  assert.equal(source.split(before).length, 2, 'Missing private postprocessing call')
  source = source.replace(before, after)
  const cleanup = `          document.events.length = 0${variant.dev ? '' : ';'}`
  assert.equal(source.split(cleanup).length, 2, 'Missing private document cleanup')
  return source.replace(
    cleanup,
    cleanup.replace('document.events.length', 'if (document.events) document.events.length'),
  )
}

export function withSynchronousBlockPostprocessing(source, dev) {
  source = withSynchronousTextResolution(source, dev)
  const [before, after] = postprocessCall(dev)
  if (!source.includes(after)) return source
  assert.equal(source.split(after).length, 2, 'Duplicate private postprocessing call')
  source = source.replace(after, before)
  const cleanup = `          document.events.length = 0${dev ? '' : ';'}`
  const guarded = cleanup.replace(
    'document.events.length',
    'if (document.events) document.events.length',
  )
  assert.equal(source.split(guarded).length, 2, 'Missing guarded private document cleanup')
  return source.replace(guarded, cleanup)
}

export function compileEventSteps(source, variant) {
  if (variant.kind !== 'compiler') return source
  const end = variant.dev ? '' : ';'
  const change = (value, before, after) => {
    assert.equal(value.split(before).length, 2, before)
    return value.replace(before, after)
  }
  const call = `compile(eventSpans(events))${end}`
  source = change(
    source,
    call,
    `compile(options._manuslipBlockCompileSteps ? eventSpanSteps(events) : eventSpans(events))${end}`,
  )
  const branchFrom = source.indexOf('  // Manuslip private block-stream path.\n')
  const branchTo = source.indexOf('  // End Manuslip private block-stream path.\n', branchFrom)
  const eager = 'eventSpans(parse(options).document().write(preprocess()(value, encoding, true)))'
  const branch = change(
    source.slice(branchFrom, branchTo),
    eager,
    `(options._manuslipBlockCompileSteps ? eventSpanSteps : eventSpans)(parse(options).document().write(preprocess()(value, encoding, true)))`,
  )
  source = source.slice(0, branchFrom) + branch + source.slice(branchTo)

  const from = source.indexOf('  function* compileBlockSpans(streamEvents) {')
  const to = source.indexOf('  // End Manuslip span compiler.\n', from)
  assert.ok(from > 0 && to > from)
  let compile = source.slice(from, to)
  for (const [before, after] of compilationChanges(end)) compile = change(compile, before, after)

  source = source.slice(0, from) + compile + source.slice(to)

  const listFrom = source.indexOf('  function prepareList(events, start) {')
  const listTo = source.indexOf('\n  /**\n   * Create an opener handle.', listFrom)
  assert.ok(listFrom > 0 && listTo > listFrom)
  let list = source.slice(listFrom, listTo)
  list = change(
    list,
    'function prepareList(events, start)',
    'function* prepareListSteps(events, start, budget)',
  )
  const tick = `if (budget.count === 256) {\n        budget.count = 0${end}\n        yield${end}\n      }\n      budget.count++${end}`
  list = change(
    list,
    '    while (++index <= end) {\n      const event',
    `    try {
    while (++index <= end) {
      ${tick}
      const event`,
  )
  list = change(
    list,
    '          while (tailIndex--) {\n            const tailEvent',
    `          while (tailIndex--) {
            ${tick.replaceAll('\n      ', '\n            ')}
            const tailEvent`,
  )
  const merge = list.indexOf('    // The list is at the end of `events`:')
  assert.ok(merge > 0)
  list =
    list.slice(0, merge) +
    `    // Merge backwards in place: preserve insertion order without copying the list.
    let insertion = insertions.length - 1${end}
    let target = events.length + insertions.length - 1${end}
    events.length = target + 1${end}
    index = end${end}
    while (index >= start) {
      ${tick}
      events[target--] = events[index]${end}
      while (insertion >= 0 && insertions[insertion].at === index) {
        ${tick.replaceAll('\n      ', '\n        ')}
        events[target--] = insertions[insertion--].event${end}
      }
      index--${end}
    }
    events[start][1]._spread = listSpread${end}
    } finally {
      insertions.length = 0${end}
    }
  }
`
  source =
    source.slice(0, listTo) +
    '\n  // Manuslip cooperative private list preparation.\n' +
    list +
    source.slice(listTo)

  const spanFrom = source.indexOf('function* eventSpans(events) {')
  const spanTo = source.indexOf('\n// Manuslip cooperative preprocessing.', spanFrom)
  assert.ok(spanFrom > 0 && spanTo > spanFrom)
  let spans = source.slice(spanFrom, spanTo)
  spans = change(spans, 'function* eventSpans(events)', 'function* eventSpanSteps(events)')
  spans = change(
    spans,
    `  let batch = []${end}`,
    `  let batch = []${end}\n  let advances = 0${end}`,
  )
  spans = change(
    spans,
    '    for (let index = 0; index < events.length; index++) {',
    `    for (let index = 0; index < events.length; index++) {
      if (advances === 256) {
        advances = 0${end}
        yield${end}
      }
      advances++${end}`,
  )
  source += `
// Manuslip cooperative private compilation.
${spans}
function* serializationEventSteps(events) {
  const contexts = new WeakMap()${end}
  let advances = 0${end}
  for (const event of events) {
    if (advances === 256) {
      advances = 0${end}
      yield${end}
    }
    advances++${end}
    const original = event[2]${end}
    let context = contexts.get(original)${end}
    if (!context) {
      context = {sliceSerialize: original.sliceSerialize}${end}
      contexts.set(original, context)${end}
    }
    event[2] = context${end}
  }
  return events${end}
}
// End Manuslip cooperative private compilation.
`
  return source
}

function compilationChanges(end) {
  return [
    [
      `    let firstPoint, penultimateEnd, lastEnd${end}`,
      `    let firstPoint, penultimateEnd, lastEnd${end}
    const preparation = {count: 0}${end}
    let handled = 0${end}`,
    ],
    [
      `    for (const input of streamEvents) {\n      let streamEvents = serializationEvents(postprocess(input))${end}`,
      `    for (const input of streamEvents) {
      if (input === undefined) {
        yield${end}
        continue${end}
      }
      let streamEvents${end}
      try {
      if (options._manuslipBlockCompileSteps) yield${end}
      streamEvents = postprocess(input)${end}
      if (options._manuslipBlockCompileSteps) {
        yield${end}
        streamEvents = yield* serializationEventSteps(streamEvents)${end}
        yield${end}
        preparation.count = 0${end}
      } else streamEvents = serializationEvents(streamEvents)${end}`,
    ],
    [
      '    while (++index < streamEvents.length) {\n      prepared.push',
      `    while (++index < streamEvents.length) {
      if (options._manuslipBlockCompileSteps) {
        if (preparation.count === 256) {
          preparation.count = 0${end}
          yield${end}
        }
        preparation.count++${end}
      }
      prepared.push`,
    ],
    [
      `          prepareList(prepared, tail)${end}`,
      `          if (options._manuslipBlockCompileSteps) yield* prepareListSteps(prepared, tail, preparation)${end}
          else prepareList(prepared, tail)${end}`,
    ],
    [
      `    streamEvents = prepared${end}`,
      `    streamEvents = prepared${end}
    if (options._manuslipBlockCompileSteps) {
      handled = 0${end}
      yield${end}
    }`,
    ],
    [
      '    while (++index < streamEvents.length) {\n      const handler',
      `    while (++index < streamEvents.length) {
      if (options._manuslipBlockCompileSteps) {
        if (handled === 16) {
          handled = 0${end}
          yield${end}
        }
        handled++${end}
      }
      const handler`,
    ],
    [
      `        throw new Error('Unclosed private block-stream span')${end}\n\n    }`,
      `        throw new Error('Unclosed private block-stream span')${end}
      } finally {
        input.length = 0${end}
        if (streamEvents) streamEvents.length = 0${end}
      }
    }`,
    ],
  ]
}

/** Restore the exact preceding compiler for pinned upgrade fixtures and independent
 * original-source reconstruction. Forward and inverse share only spelling edits;
 * callers must still verify their independently recorded original source hashes.
 */
export function withSynchronousBlockCompilation(source, dev) {
  source = withSynchronousBlockPostprocessing(source, dev)
  const marker = '\n// Manuslip cooperative private compilation.\n'
  if (!source.includes(marker)) return source
  assert.ok(source.endsWith('// End Manuslip cooperative private compilation.\n'))
  source = source.slice(0, source.indexOf(marker))
  const end = dev ? '' : ';'
  const change = (value, before, after) => {
    assert.equal(value.split(after).length, 2, after)
    return value.replace(after, before)
  }
  source = change(
    source,
    `compile(eventSpans(events))${end}`,
    `compile(options._manuslipBlockCompileSteps ? eventSpanSteps(events) : eventSpans(events))${end}`,
  )
  const eager = 'eventSpans(parse(options).document().write(preprocess()(value, encoding, true)))'
  source = change(
    source,
    eager,
    '(options._manuslipBlockCompileSteps ? eventSpanSteps : eventSpans)(parse(options).document().write(preprocess()(value, encoding, true)))',
  )
  const listFrom = source.indexOf('\n  // Manuslip cooperative private list preparation.\n')
  const listTo = source.indexOf('\n  /**\n   * Create an opener handle.', listFrom)
  assert.ok(listFrom > 0 && listTo > listFrom)
  source = source.slice(0, listFrom) + source.slice(listTo)
  const from = source.indexOf('  function* compileBlockSpans(streamEvents) {')
  const to = source.indexOf('  // End Manuslip span compiler.\n', from)
  assert.ok(from > 0 && to > from)
  let compile = source.slice(from, to)
  for (const [before, after] of compilationChanges(end).reverse())
    compile = change(compile, before, after)
  return source.slice(0, from) + compile + source.slice(to)
}
