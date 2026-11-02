import { expect, it } from 'vitest'
import { rasterLimits, rasterSize } from '../../src/raster'

it('admits complete content dimensions and accounts for device scale before capture', () => {
  expect(rasterSize(1024, 1800.2, 1.5)).toEqual({
    width: 1024,
    height: 1801,
    pixelWidth: 1536,
    pixelHeight: 2702,
  })
  expect(rasterSize(1000, 8000, 1)).toMatchObject({ pixelHeight: 8000 })
  expect(() => rasterSize(1000, 8000, 2)).toThrow('export-image-limit')
})
it('admits exact side/pixel bounds but never crops or rounds down over-cap content', () => {
  expect(rasterSize(100, rasterLimits.side)).toMatchObject({ height: rasterLimits.side })
  expect(rasterSize(4000, 4000)).toMatchObject({ pixelWidth: 4000, pixelHeight: 4000 })
  expect(() => rasterSize(4000, 4000.1)).toThrow('export-image-limit')
  expect(() => rasterSize(100, rasterLimits.side + 0.1)).toThrow('export-image-limit')
})
it('rejects untrusted, degenerate and non-finite geometry before allocating a bitmap', () => {
  for (const value of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    expect(() => rasterSize(value, 100)).toThrow('export-image-limit')
    expect(() => rasterSize(100, value)).toThrow('export-image-limit')
    expect(() => rasterSize(100, 100, value)).toThrow('export-image-limit')
  }
  expect(() => rasterSize(100, 100, 4.1)).toThrow('export-image-limit')
})
