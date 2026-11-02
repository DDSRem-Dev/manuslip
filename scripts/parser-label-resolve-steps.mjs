import assert from 'node:assert/strict'
import { withCopiedListlessSpans } from './parser-list-preparation.mjs'

function changes(dev) {
  const end = dev ? '' : ';'
  const pairs = [
    [
      `  const serialization = {chunks}${end}`,
      `  const serialization = {chunks}${end}
  // Manuslip private construct-resolution handoff.
  let privateDispatch = false${end}
  let pendingResolution${end}`,
    ],
    [
      `      while (!mainSteps()) yield${end}`,
      `      while (true) {
        let done${end}
        privateDispatch = true${end}
        try { done = mainSteps() }
        finally { privateDispatch = false }
        if (pendingResolution) {
          // Keep construct resolution separate from input dispatch.
          yield${end}
          const resolved = yield* pendingResolution${end}
          if (!Array.isArray(resolved)) throw new Error('Incomplete private construct resolver')${end}
          context.events = resolved${end}
          pendingResolution = undefined${end}
          yield${end}
        }
        if (done) break${end}
        yield${end}
      }`,
    ],
    [
      `    function releaseCancelledInput(input) {
      // The actual generator keeps only a cleared owner in its argument slot.`,
      `    function releaseCancelledInput(input) {
      const resolution = pendingResolution${end}
      pendingResolution = undefined${end}
      privateDispatch = false${end}
      // The actual generator keeps only a cleared owner in its argument slot.`,
    ],
    [
      `      for (const key of Object.keys(context)) Reflect.deleteProperty(context, key)${end}`,
      `      for (const key of Object.keys(context)) Reflect.deleteProperty(context, key)${end}
      resolution?.return()${end}`,
    ],
    [
      `    if (construct.resolveTo) {
      context.events = construct.resolveTo(context.events, context)${end}
    }`,
      `    if (construct.resolveTo) {
      const steps = privateDispatch && parser._manuslipTextResolveSteps${end}
      const work = steps?.resolveTo?.(construct.resolveTo, context.events, context)${end}
      if (work) {
        if (pendingResolution) throw new Error('Overlapping private construct resolution')${end}
        pendingResolution = work${end}
      } else {
        context.events = construct.resolveTo(context.events, context)${end}
      }
    }`,
    ],
  ]
  // These complete sites occur only in the private input loop.
  for (const call of ['go(chunk.charCodeAt(point._bufferIndex))', 'go(chunk)']) {
    const before = `if (++steps > 4096) return false${end}\n            ${call}${end}`
    pairs.push([before, `${before}\n            if (pendingResolution) return false${end}`])
  }
  return pairs
}

/** Park a successful private construct before its caller processes the next code. */
export function labelResolverSteps(source, variant) {
  if (variant.kind !== 'tokenizer') return source
  for (const [before, after] of changes(variant.dev)) {
    assert.equal(source.split(before).length, 2, 'Missing private construct-resolution patch site')
    source = source.replace(before, after)
  }
  return source
}

/** Reconstruct the exact preceding tokenizer for upgrades and independent fixtures. */
export function withSynchronousLabelResolution(source, dev) {
  source = withCopiedListlessSpans(source, dev)
  if (!source.includes('// Manuslip private construct-resolution handoff.')) return source
  for (const [before, after] of changes(dev).reverse()) {
    assert.equal(source.split(after).length, 2, 'Duplicate private construct-resolution patch site')
    source = source.replace(after, before)
  }
  return source
}
