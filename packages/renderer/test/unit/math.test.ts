import { expect, it } from 'vitest'
import { renderMath } from '../../src/math'

it('renders math and chemistry as self-contained SVG without a browser DOM', () => {
  for (const source of ['x^2 + \\frac{1}{2}', '\\ce{H2O -> H+ + OH-}', '\\sum_{i=1}^{n} i']) {
    const svg = renderMath(source, true)
    expect(svg).toContain('<svg')
    expect(svg).toContain('<path')
    expect(svg).not.toContain('<use')
    expect(svg).not.toContain('https:')
  }
})

it('bounds input and keeps user macros private to each expression', () => {
  expect(() => renderMath('a'.repeat(4097), false)).toThrow('math-limit')
  expect(renderMath('\\newcommand{\\private}{x}\\private', false)).toContain('<svg')
  expect(() => renderMath('\\private', false)).toThrow()
  expect(() => renderMath('\\require{html}\\href{javascript:alert(1)}{x}', false)).toThrow()
})
