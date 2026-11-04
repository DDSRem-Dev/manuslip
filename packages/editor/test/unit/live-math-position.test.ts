import { expect, it } from 'vitest'
import { delimitedSourcePosition } from '../../src/live-source-position'

it('maps TeX offsets inside Markdown delimiters without confusing literal dollars', () => {
  expect(delimitedSourcePosition('$x_i^2$', 'x_i^2', 4)).toBe(5)
  expect(delimitedSourcePosition('$$x_i^2$$', 'x_i^2', 4)).toBe(6)
  expect(delimitedSourcePosition('$\\$$', '\\$', 1)).toBe(2)
  expect(delimitedSourcePosition('$ 😀+x $', '😀+x', 3)).toBe(5)
})

it('preserves line and column through display indentation and newline normalization', () => {
  const value = 'a + b\nc + d'
  const source = '$$\n  a + b\n  c + d\n$$'
  expect(delimitedSourcePosition(source, value, value.indexOf('d'))).toBe(source.indexOf('d'))
  expect(delimitedSourcePosition(source, value, value.indexOf('\n'))).toBe(source.indexOf('b') + 1)
  expect(delimitedSourcePosition('$$\n\n  x\n$$', '\n  x', 3)).toBe(6)
})

it('maps multiline source inside nested quotes without consuming quote markers', () => {
  const value = 'flowchart LR\nA[Same] --> B[Other]'
  const source = '```mermaid\n> > flowchart LR\n> > A[Same] --> B[Other]\n> > ```'
  expect(delimitedSourcePosition(source, value, value.indexOf('Other'))).toBe(
    source.indexOf('Other'),
  )
  const math = '$$\n> a + b\n> c + d\n> $$'
  expect(delimitedSourcePosition(math, 'a + b\nc + d', 8)).toBe(math.indexOf('+ d'))
})

it.each([
  String.raw`\(x_i^2\)`,
  '\\[\nx_i^2\n\\]',
  '```math\nx_i^2\n```',
  '~~~latex\nx_i^2\n~~~',
  '$$x_i^2$$',
])('maps every supported math notation: %s', (source) => {
  expect(delimitedSourcePosition(source, 'x_i^2', 0)).toBe(source.indexOf('x_i^2'))
  expect(delimitedSourcePosition(source, 'x_i^2', 4)).toBe(source.indexOf('2'))
})

it('rejects stale values, malformed fences and invalid offsets', () => {
  expect(delimitedSourcePosition('$x$', 'y', 0)).toBeUndefined()
  expect(delimitedSourcePosition('x', 'x', 0)).toBeUndefined()
  expect(delimitedSourcePosition('$x', 'x', 0)).toBeUndefined()
  expect(delimitedSourcePosition('$x$', 'x', 2)).toBeUndefined()
  expect(delimitedSourcePosition('$x$', 'x', -1)).toBeUndefined()
})

it('uses the same authored offsets for indented Mermaid fences and unfinished source', () => {
  const value = 'flowchart LR\nA[Shared] --> B[Shared]'
  for (const source of [
    `\`\`\`mermaid\n${value}\n\`\`\``,
    `  ~~~mermaid\n  ${value.replace('\n', '\n  ')}\n  ~~~`,
    `\`\`\`mermaid\n${value}`,
  ]) {
    expect(delimitedSourcePosition(source, value, value.lastIndexOf('Shared'))).toBe(
      source.lastIndexOf('Shared'),
    )
  }
})
