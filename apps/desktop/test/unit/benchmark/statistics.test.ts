import { expect, it } from 'vitest'
import { percentile, summary } from '../../../../../test/benchmark/statistics'

it.each([Number.NaN, Infinity, -Infinity, -1])('rejects invalid timing samples: %s', (invalid) => {
  const samples = [...Array<number>(19).fill(1), invalid]
  expect(() => summary(samples)).toThrow(/sample/i)
  expect(() => percentile(samples)).toThrow(/sample/i)
})

it('rejects missing samples instead of counting array holes as measurements', () => {
  expect(() => summary(Array<number>(20))).toThrow(/sample/i)
})

it('preserves nearest-rank percentiles without changing the supplied measurements', () => {
  const samples = Array.from({ length: 20 }, (_, index) => 20 - index)
  expect(summary(samples)).toEqual({ n: 20, p50: 10, p95: 19, max: 20 })
  expect(percentile(samples, 1)).toBe(20)
  expect(samples[0]).toBe(20)
})

it('reports absent measurements explicitly and accepts zero-duration samples', () => {
  expect(summary([])).toEqual({ n: 0, p50: null, p95: null, max: null })
  expect(summary([0])).toEqual({ n: 1, p50: 0, p95: 0, max: 0 })
})

it.each([0, -0.1, 1.1, Number.NaN, Infinity])('rejects invalid percentile ranks: %s', (rank) => {
  expect(() => percentile([1, 2, 3], rank)).toThrow(/percentile/i)
})
