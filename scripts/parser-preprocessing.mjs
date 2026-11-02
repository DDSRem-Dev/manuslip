import assert from 'node:assert/strict'

/** Match micromark's EOF flush order: a pending CR precedes the final literal chunk. */
export function finalCarriageReturn(source, dev, inverse = false) {
  if (!source.includes('// Manuslip cooperative preprocessing.')) return source
  const end = dev ? '' : ';'
  const before = `      if (endPosition === value.length) {\n        chunks.push(value.slice(startPosition))${end}\n`
  const after = `      if (endPosition === value.length) {
        // Manuslip final carriage-return flush.
        if (atCarriageReturn) {
          chunks.push(-5)${end}
          atCarriageReturn = undefined${end}
        }
        chunks.push(value.slice(startPosition))${end}
`
  const [from, to] = inverse ? [after, before] : [before, after]
  assert.equal(source.split(from).length, 2, 'Missing final preprocessing chunk')
  return source.replace(from, to)
}

/** Exact predecessor for isolated upgrades and source reconstruction. */
export function withPendingFinalCarriageReturn(source, dev) {
  return source.includes('// Manuslip final carriage-return flush.')
    ? finalCarriageReturn(source, dev, true)
    : source
}
