import { expect, it } from 'vitest'
import { imageSizingStyle } from '../../src/image-layout'

it('preserves common Typora width, height and zoom forms as bounded image sizing', () => {
  expect(imageSizingStyle('width: 320px; height: auto; zoom:50%;')).toBe(
    'width: 320px; height: auto; zoom: 0.5',
  )
  expect(imageSizingStyle('WIDTH:75%; zoom:.75; height:100')).toBe(
    'width: 75%; zoom: 0.75; height: 100px',
  )
})

it.each([
  'background: url(https://example.invalid/track); position:fixed; inset:0',
  'width: expression(alert(1)); height: calc(100vh); zoom:var(--zoom)',
  'width: 0; height: -20px; zoom: 0',
  'width: 101%; height: 1000000px; zoom: 1000000%',
  'width: 100px!important; height: inherit; zoom:NaN',
  'width: url(javascript:alert(1)); color:red',
])('discards non-sizing and invalid CSS: %s', (style) => {
  expect(imageSizingStyle(style)).toBe('')
})

it('keeps safe sizing alongside discarded declarations', () => {
  expect(
    imageSizingStyle(
      'width: 240px; background-image:url(https://example.invalid/track); zoom:50%; position:fixed',
    ),
  ).toBe('width: 240px; zoom: 0.5')
})
