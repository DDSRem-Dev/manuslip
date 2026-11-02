import assert from 'node:assert/strict'
import { withSynchronousInlineResolution } from './parser-inline-resolve-steps.mjs'

function changes(kind, dev) {
  const end = dev ? '' : ';'
  if (kind === 'text-resolver')
    return [
      [
        `function createResolver(extraResolver) {\n  return resolveAllText${end}`,
        `function createResolver(extraResolver) {\n  // Manuslip private text-resolver identity.\n  resolveAllText._manuslipTextResolve = Boolean(extraResolver)${end}\n  return resolveAllText${end}`,
      ],
    ]
  if (kind === 'compiler')
    return [
      [
        `        parser._manuslipReleaseCompleted = true${end}`,
        `        parser._manuslipReleaseCompleted = true${end}\n        parser._manuslipTextResolveSteps = options._manuslipBlockTextResolveSteps${end}`,
      ],
    ]
  if (kind === 'tokenizer')
    return [
      [
        `      context.events = resolveAll(resolveAllConstructs, context.events, context)${end}`,
        `      // Manuslip private cooperative EOF resolution.\n      context.events = parser._manuslipTextResolveSteps\n        ? yield* resolvePrivateEventSteps(resolveAllConstructs, context.events, context)\n        : resolveAll(resolveAllConstructs, context.events, context)${end}`,
      ],
    ]
  return []
}

function resolverSteps(dev) {
  const end = dev ? '' : ';'
  return `
// Manuslip cooperative private EOF resolvers.
function* resolvePrivateEventSteps(constructs, events, context) {
  const called = new Set()${end}
  let advances = 0${end}
  let complete = false${end}
  try {
    for (const construct of constructs) {
      if (advances++ === 256) {
        advances = 1${end}
        yield${end}
      }
      const resolve = construct.resolveAll${end}
      if (resolve && !called.has(resolve)) {
        // Separate opaque resolver calls from each other and from input dispatch.
        yield${end}
        const resolved = typeof resolve._manuslipTextResolve === 'boolean'
          ? yield* context.parser._manuslipTextResolveSteps(events, context, resolve._manuslipTextResolve)
          : resolve(events, context)${end}
        if (!Array.isArray(resolved)) throw new Error('Incomplete private EOF resolver')${end}
        events = resolved${end}
        called.add(resolve)${end}
        yield${end}
      }
    }
    complete = true${end}
    return events${end}
  } finally {
    called.clear()${end}
    if (!complete) events.length = 0${end}
  }
}
// End Manuslip cooperative private EOF resolvers.
`
}

/** Private opt-in only; native resolver function identities select the audited text path. */
export function textResolverSteps(source, variant) {
  for (const [before, after] of changes(variant.kind, variant.dev)) {
    assert.equal(source.split(before).length, 2, 'Missing text-resolution patch site')
    source = source.replace(before, after)
  }
  return variant.kind === 'tokenizer' ? source + resolverSteps(variant.dev) : source
}

/** Restore the exact preceding sources for upgrades and published-source reconstruction. */
export function withSynchronousTextResolution(source, dev) {
  source = withSynchronousInlineResolution(source, dev)
  let kind
  if (source.includes('// Manuslip private text-resolver identity.')) kind = 'text-resolver'
  else if (source.includes('parser._manuslipTextResolveSteps = options.')) kind = 'compiler'
  else if (source.includes('// Manuslip private cooperative EOF resolution.')) kind = 'tokenizer'
  else return source
  if (kind === 'tokenizer') {
    const suffix = resolverSteps(dev)
    assert.ok(source.endsWith(suffix), 'Missing private EOF resolver helper')
    source = source.slice(0, -suffix.length)
  }
  for (const [before, after] of changes(kind, dev).reverse()) {
    assert.equal(source.split(after).length, 2, 'Duplicate text-resolution patch site')
    source = source.replace(after, before)
  }
  return source
}
