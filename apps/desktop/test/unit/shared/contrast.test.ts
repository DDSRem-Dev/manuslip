import { expect, it } from 'vitest'
import { contrast } from '../../../../../test/helpers/contrast'

it('calculates WCAG black/white contrast independently of channel serialization or order', () => {
  expect(contrast('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21)
  expect(contrast('color(srgb 1 1 1)', 'color(srgb 0 0 0)')).toBe(21)
  expect(contrast('rgb(128, 128, 128)', 'rgb(128, 128, 128)')).toBe(1)
  expect(contrast('rgb(255, 255, 255)', 'rgb(0, 0, 0)')).toBe(21)
})

it('measures normalized color-mix markers correctly against light and dark editor surfaces', () => {
  expect(contrast('color(srgb 0.624078 0.624078 0.598275)', 'rgb(36, 36, 36)')).toBeCloseTo(5.84, 2)
  expect(contrast('color(srgb 0.454431 0.454431 0.432314)', 'rgb(255, 255, 255)')).toBeGreaterThan(
    4.5,
  )
  expect(contrast('color(srgb 1e0 0 0)', 'rgb(255, 255, 255)')).toBeCloseTo(
    contrast('rgb(255, 0, 0)', 'rgb(255, 255, 255)'),
    8,
  )
})

it('rejects unsupported or malformed serialization instead of silently reporting black', () => {
  for (const color of ['transparent', 'color(display-p3 1 0 0)', 'rgb(20)'])
    expect(() => contrast(color, 'rgb(0, 0, 0)')).toThrow()
})
