import assert from 'node:assert/strict'
import { withSynchronousLabelResolution } from './parser-label-resolve-steps.mjs'

function changes(dev) {
  const end = dev ? '' : ';'
  const before = `        const resolved = typeof resolve._manuslipTextResolve === 'boolean'
          ? yield* context.parser._manuslipTextResolveSteps(events, context, resolve._manuslipTextResolve)
          : resolve(events, context)${end}`
  const after = `        // Manuslip audited private inline-resolver capability.
        const steps = context.parser._manuslipTextResolveSteps${end}
        const resolved = steps.resolveAll
          ? yield* steps.resolveAll(resolve, events, context)
          : typeof resolve._manuslipTextResolve === 'boolean'
            ? yield* steps(events, context, resolve._manuslipTextResolve)
            : resolve(events, context)${end}`
  return { before, after }
}

export function inlineResolverSteps(source, variant) {
  if (variant.kind !== 'tokenizer') return source
  const { before, after } = changes(variant.dev)
  assert.equal(source.split(before).length, 2, 'Missing private inline resolver dispatch')
  return source.replace(before, after)
}

export function withSynchronousInlineResolution(source, dev) {
  source = withSynchronousLabelResolution(source, dev)
  if (!source.includes('// Manuslip audited private inline-resolver capability.')) return source
  const { before, after } = changes(dev)
  assert.equal(source.split(after).length, 2, 'Duplicate private inline resolver dispatch')
  return source.replace(after, before)
}
