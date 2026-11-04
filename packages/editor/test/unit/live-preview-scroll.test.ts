import { expect, it } from 'vitest'
import { previewScrollDelta } from '../../src/live-preview-scroll'

it('reveals source and preview together with the minimum scroll and breathing room', () => {
  const viewport = { top: 48, bottom: 667 }
  expect(previewScrollDelta(viewport, { top: 575, bottom: 836 })).toBe(185)
  expect(previewScrollDelta(viewport, { top: 32, bottom: 293 })).toBe(-32)
  expect(previewScrollDelta(viewport, { top: 160, bottom: 421 })).toBe(0)
})

it('does not scroll a caret out of view to reveal an oversized editing context', () => {
  expect(previewScrollDelta({ top: 48, bottom: 667 }, { top: 575, bottom: 1400 })).toBeUndefined()
  expect(previewScrollDelta({ top: 48, bottom: 48 }, { top: 48, bottom: 50 })).toBeUndefined()
})

it('uses the actual viewport and tolerates fractional zoom geometry', () => {
  expect(previewScrollDelta({ top: 40.5, bottom: 430.25 }, { top: 320, bottom: 500.5 })).toBe(86.25)
  expect(previewScrollDelta({ top: 0, bottom: 40 }, { top: 5, bottom: 25 })).toBe(-5)
})
