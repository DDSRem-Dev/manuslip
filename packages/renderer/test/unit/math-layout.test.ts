import { expect, it } from 'vitest'
import { renderMath } from '../../src/math'
import { inlineMathBaseline } from '../../src/math-layout'

it.each([
  'x',
  'x^2',
  'x_i',
  'x_i^2',
  '\\frac{1}{2}',
  '\\dfrac{a}{b}',
  '\\sqrt{x}',
  '\\int_0^1 f(x)\\,dx',
])('recovers MathJax baseline depth after style attributes are stripped: %s', (source) => {
  const svg = renderMath(source, false)
  const height = /\bheight="([^"]+)"/.exec(svg)?.[1] ?? null
  const viewBox = /\bviewBox="([^"]+)"/.exec(svg)?.[1] ?? null
  const native = /style="vertical-align:\s*([-\d.]+)ex/.exec(svg)?.[1]
  expect(native).toBeDefined()
  const baseline = inlineMathBaseline(height, viewBox)
  expect(baseline).toBeDefined()
  expect(Number.parseFloat(baseline ?? 'NaN')).toBeCloseTo(Number(native), 2)
})

it.each([
  [null, null],
  ['10px', '0 -10 10 20'],
  ['10ex', '0 0 10 0'],
  ['10ex', '0 0 10 NaN'],
  ['10ex', '0 0 10 20 30'],
  ['1ex; color:red', '0 -10 10 20'],
])('ignores invalid or non-MathJax geometry: %s %s', (height, viewBox) => {
  expect(inlineMathBaseline(height, viewBox)).toBeUndefined()
})
