import assert from 'node:assert/strict'

// Serialization already visits every private event. Record whether list-item
// synthesis is needed there; listless spans can consume that same owned array.
// The original list algorithm, handler contexts and cooperative quotas stay intact.
function update(source, dev, inverse) {
  const end = dev ? '' : ';'
  const change = (value, before, after) => {
    if (inverse) [before, after] = [after, before]
    assert.equal(value.split(before).length, 2, before)
    return value.replace(before, after)
  }
  const from = source.indexOf('  function* compileBlockSpans(streamEvents) {')
  const to = source.indexOf('  // End Manuslip span compiler.\n', from)
  assert.ok(from > 0 && to > from, 'Missing private block-stream compiler')
  let compile = source.slice(from, to)
  compile = change(
    compile,
    `      let streamEvents${end}\n      try {`,
    `      let streamEvents${end}\n      let prepareLists = true${end}\n      try {`,
  )
  compile = change(
    compile,
    `        streamEvents = yield* serializationEventSteps(streamEvents)${end}`,
    `        prepareLists = yield* serializationEventSteps(streamEvents)${end}`,
  )
  compile = change(
    compile,
    `    /** @type {Array<number>} */\n    const listStack = []${end}`,
    `    // Manuslip listless span ownership.\n    if (prepareLists) {\n    /** @type {Array<number>} */\n    const listStack = []${end}`,
  )
  compile = change(
    compile,
    `    streamEvents = prepared${end}`,
    `    streamEvents = prepared${end}\n    } else if (input !== streamEvents) input.length = 0${end}\n    // End Manuslip listless span ownership.`,
  )
  source = source.slice(0, from) + compile + source.slice(to)

  const helperFrom = source.indexOf('function* serializationEventSteps(events) {')
  assert.ok(helperFrom > 0, 'Missing cooperative serialization helper')
  let helper = source.slice(helperFrom)
  helper = change(
    helper,
    `  let advances = 0${end}`,
    `  let advances = 0${end}\n  let hasLists = false${end}`,
  )
  helper = change(
    helper,
    `    advances++${end}`,
    `    advances++${end}\n    if (event[1].type === 'listOrdered' || event[1].type === 'listUnordered') hasLists = true${end}`,
  )
  helper = change(helper, `  return events${end}`, `  return hasLists${end}`)
  return source.slice(0, helperFrom) + helper
}

export function listlessSpanPreparation(source, variant) {
  return variant.kind === 'compiler' ? update(source, variant.dev, false) : source
}

// Exact predecessor reconstruction still checks independently recorded upstream
// hashes. Also used by the real installer upgrade tests for both export variants.
export function withCopiedListlessSpans(source, dev) {
  return source.includes('// Manuslip listless span ownership.')
    ? update(source, dev, true)
    : source
}
