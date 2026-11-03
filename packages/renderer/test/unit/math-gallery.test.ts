import { readFileSync } from 'node:fs'
import { parseDocumentMarkdown } from '@manuslip/core'
import { expect, it } from 'vitest'
import { renderExport } from '../../src/export'
import { renderMath } from '../../src/math'

it('renders every expression in the shipped LaTeX gallery as offline self-contained SVG', () => {
  const source = readFileSync(
    new URL('../../../../docs/examples/latex.md', import.meta.url),
    'utf8',
  )
  const result = renderExport(parseDocumentMarkdown(source).root, {
    rawHtml: false,
    footnotesLabel: 'Notes',
    footnoteBackLabel: 'Back',
  })
  expect(result.slots.length).toBeGreaterThanOrEqual(20)
  expect(result.slots.every((slot) => slot.kind === 'math')).toBe(true)
  expect(result.slots[0]?.source).toBe('E = mc^2')
  for (const slot of result.slots) {
    const svg = renderMath(slot.source, slot.display)
    expect(svg, slot.source).toContain('<svg')
    expect(svg, slot.source).not.toMatch(/<use|<script|(?:href|src)="https?:/)
  }
})
