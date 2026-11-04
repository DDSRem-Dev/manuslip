import type { Element, Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { expect, it } from 'vitest'
import { renderMath } from '../../src/math'

function mapped(source: string) {
  const result: { latex: string; source: string; from: number; to: number }[] = []
  const visit = (node: Root | Element): void => {
    if (node.type === 'element' && node.properties.dataSourceFrom !== undefined) {
      const from = Number(node.properties.dataSourceFrom),
        to = Number(node.properties.dataSourceTo)
      expect(from).toBeGreaterThanOrEqual(0)
      expect(to).toBeLessThanOrEqual(source.length)
      expect(from).toBeLessThan(to)
      result.push({
        latex: String(node.properties.dataLatex),
        source: source.slice(from, to),
        from,
        to,
      })
    }
    for (const child of node.children) if (child.type === 'element') visit(child)
  }
  visit(fromHtml(renderMath(source, true), { fragment: true }))
  return result
}

it('maps identical script glyphs independently of SVG layout and TeX script order', () => {
  for (const source of ['x_x^x', 'x^x_x']) {
    const spans = mapped(source).filter((span) => span.latex === 'x')
    expect(spans.map((span) => span.from).sort((a, b) => a - b)).toEqual([0, 2, 4])
    expect(spans.every((span) => span.source === 'x')).toBe(true)
  }
})

it('distinguishes repeated fractions, rows and cells without matching environment names', () => {
  const source = String.raw`\begin{pmatrix}a&b\\a&\frac{a+a}{a+a}\end{pmatrix}`
  const spans = mapped(source).filter((span) => span.latex === 'a')
  expect(spans.map((span) => span.from)).toEqual([15, 20, 28, 30, 33, 35])
  expect(new Set(spans.map((span) => span.from)).size).toBe(6)
})

it('keeps original whitespace, comments, command boundaries and root degree positions', () => {
  const source = String.raw`\sqrt[3]{\alpha + a} + % a is a comment
  \frac{a + a}{a+a}`
  const spans = mapped(source)
  expect(spans.find((span) => span.latex === '3')?.from).toBe(source.indexOf('3'))
  expect(spans.find((span) => span.latex === '\\alpha')?.source).toBe('\\alpha')
  const positions = spans.filter((span) => span.latex === 'a').map((span) => span.from)
  expect(positions).toHaveLength(5)
  expect(positions.every((at) => at < source.indexOf('%') || at > source.indexOf('\n'))).toBe(true)
})

it('leaves expanded user macros unmapped instead of pointing into their definitions', () => {
  expect(mapped(String.raw`\newcommand{\twice}[1]{#1 + #1}\twice{x}`)).toEqual([])
})

it('maps fraction denominators on later aligned rows', () => {
  const source = [
    String.raw`\begin{aligned}`,
    String.raw`f(x) &= x^2 + 1 \\`,
    String.raw`g(x) &= \frac{x+x}{x+x}`,
    String.raw`\end{aligned}`,
  ].join('\n')
  expect(mapped(source)).toContainEqual({
    latex: 'x',
    source: 'x',
    from: source.lastIndexOf('}{x') + 2,
    to: source.lastIndexOf('}{x') + 3,
  })
})

it('skips array column specifications when locating identical visible letters', () => {
  const source = String.raw`\begin{array}{rr}r&r\end{array}`
  expect(
    mapped(source)
      .filter((span) => span.latex === 'r')
      .map((span) => span.from),
  ).toEqual([source.indexOf('}r') + 1, source.indexOf('&r') + 1])
})
