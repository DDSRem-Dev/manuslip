import { describe, expect, it, vi } from 'vitest'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import type { RenderOptions } from '../../src/index'
import { renderInitialProjectionLayout } from '../../src/projection-initial-layout'
import { renderProjectionLayout } from '../../src/projection-layout'
import { ProjectionSequence } from '../../src/projection-sequence'

const cap = 8 * 1024 * 1024
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
const normalize = (result: ReturnType<typeof renderProjectionLayout>) => ({
  ...result,
  projection: { ...result.projection, renderMs: null },
})
function check(source: string, syntax: 'commonmark' | 'manuslip' = 'manuslip', render = options) {
  const document = parseMarkdown(source, syntax)
  const unchanged = structuredClone(document)
  const pending: unknown[] = [document]
  while (pending.length) {
    const value = pending.pop()
    if (!value || typeof value !== 'object') continue
    pending.push(...Object.values(value))
    Object.freeze(value)
  }
  const expected = renderProjectionLayout(document.root, render, cap)
  const actual = renderInitialProjectionLayout(document.root, render, cap)
  expect(normalize(actual)).toEqual(normalize(expected))
  expect(document).toEqual(unchanged)
  expect(Object.isFrozen(actual.layout)).toBe(true)
  expect(Object.isFrozen(actual.layout.blocks)).toBe(true)
  for (const block of actual.layout.blocks) expect(Object.isFrozen(block)).toBe(true)
}

describe('initial projection without a complete body HAST', () => {
  it.each([
    ['commonmark', false],
    ['commonmark', true],
    ['manuslip', false],
    ['manuslip', true],
  ] as const)(
    'matches full HTML, widgets and layout for every CommonMark example in %s with rawHtml=%s',
    (syntax, rawHtml) => {
      for (const example of examples) check(example.markdown, syntax, { ...options, rawHtml })
    },
  )

  it.each([false, true])(
    'preserves complete global definitions, cyclic/repeated footnotes and widgets with rawHtml=%s',
    (rawHtml) => {
      for (const source of [
        '',
        '\ufeff# title\r\n\r\nparagraph\r\n',
        '---\nheading: hidden\n---\n\n[r]: /first\n\n[a][r]\n\n[r]: /second\n\n![b][r]\n',
        '> [r]: /nested\n>\n> definition\n\n[a][r]\n\n[r]: /later\n',
        '[^x]: first note\n\n[^x]: duplicate note\n\nOne[^x].\n\nTwo[^x].\n',
        '[^unused]: ```mermaid\n    graph TD; A-->B\n    ```\n\nText only\n',
        'First[^a].\n\nSecond[^b] and again[^a].\n\n[^a]: A with [^c]\n\n[^b]: B with [^c] and [^a]\n\n[^c]: C with [^a]\n',
        'a[^x]\n\n[^x]: note\n\n    > [r]: /inside-note\n    >\n    > $x$ and ![a][r]\n\n[a][r]\n',
        '| ![a](https://example.com/a.png) |\n| - |\n| $x$ |\n\n$$\ny^2\n$$\n',
        '- [x] task\n- [ ] task\n\n> > ```ts\n> > const x = 1\n> > ```\n',
        '<script>alert(1)</script>\n\n[a](javascript:alert(1)) ![](../../local.png) <i>x</i>\n',
        `# ${'界😀\ud800\udfff'.repeat(1000)}\n\nend\n`,
      ])
        check(source, 'manuslip', { ...options, rawHtml })
    },
  )

  it('preserves custom root output overrides through the full renderer', () => {
    const root = parseMarkdown('Original paragraph.\n').root
    root.data = { hChildren: [{ type: 'text', value: '\n' }] }
    const expected = renderProjectionLayout(root, options, cap)
    expect(expected.projection.html).toBe('\n')
    expect(normalize(renderInitialProjectionLayout(root, options, cap))).toEqual(
      normalize(expected),
    )
  })

  it('keeps the exact existing layout allowance and immutable empty layout', () => {
    const root = parseMarkdown('# Heading\n\nBody.\n').root
    const exact = 1024 + 192 * root.children.length
    expect(normalize(renderInitialProjectionLayout(root, options, exact))).toEqual(
      normalize(renderProjectionLayout(root, options, exact)),
    )
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, exact - 1])
      expect(() => renderInitialProjectionLayout(root, options, invalid)).toThrow('retained limit')
    const empty = renderInitialProjectionLayout(parseMarkdown('').root, options, 1024)
    expect(empty.layout).toEqual({ blocks: [], bodyEnd: 0, htmlLength: 0 })
    expect(empty.projection.html).toBe('')
  })

  it.each(['missing', 'duplicate'] as const)(
    'rejects %s top-level positions without publishing a partial layout',
    (mode) => {
      const root = parseMarkdown('First.\n\nSecond.\n').root
      const first = root.children[0],
        second = root.children[1]
      if (!first || !second) throw new Error('Missing fixture children')
      if (mode === 'missing') delete second.position
      else second.position = first.position
      for (const render of [renderProjectionLayout, renderInitialProjectionLayout])
        expect(() => render(root, options, cap)).toThrow('Ambiguous projection layout')
    },
  )

  it('snapshots options across body and footer conversion', () => {
    const root = parseMarkdown('First[^a].\n\nSecond <i>literal</i>.\n\n[^a]: note\n').root
    const expected = renderProjectionLayout(root, options, cap)
    const mutable = { ...options }
    const original = ProjectionSequence.prototype.render
    const spy = vi.spyOn(ProjectionSequence.prototype, 'render').mockImplementation(function (
      this: ProjectionSequence,
      node,
    ) {
      const result = original.call(this, node)
      mutable.rawHtml = true
      mutable.footnotesLabel = 'Changed'
      mutable.footnoteBackLabel = 'Changed'
      return result
    })
    try {
      expect(normalize(renderInitialProjectionLayout(root, mutable, cap))).toEqual(
        normalize(expected),
      )
    } finally {
      spy.mockRestore()
    }
  })

  for (const phase of ['body', 'footer'] as const)
    it.each([false, true])(
      `closes the shared state after a ${phase} failure with thrown undefined=%s`,
      (undefinedFailure) => {
        const root = parseMarkdown('First[^a].\n\nSecond.\n\n[^a]: note\n').root
        const expected = normalize(renderProjectionLayout(root, options, cap))
        const failure = undefinedFailure ? undefined : new Error('Trusted projection failure')
        const originalRender = ProjectionSequence.prototype.render
        let held: ProjectionSequence | undefined
        const spy =
          phase === 'body'
            ? vi.spyOn(ProjectionSequence.prototype, 'render').mockImplementation(function (
                this: ProjectionSequence,
                node,
              ) {
                held = this
                originalRender.call(this, node)
                throw failure
              })
            : vi.spyOn(ProjectionSequence.prototype, 'finish').mockImplementation(function (
                this: ProjectionSequence,
              ) {
                held = this
                throw failure
              })
        try {
          let failed = false
          try {
            renderInitialProjectionLayout(root, options, cap)
          } catch (error) {
            failed = true
            expect(error).toBe(failure)
          }
          expect(failed).toBe(true)
          expect(held).toBeDefined()
          if (!held) throw new Error('Missing observed sequence')
          expect(() => originalRender.call(held, { type: 'paragraph', children: [] })).toThrow(
            'closed',
          )
        } finally {
          spy.mockRestore()
        }
        expect(normalize(renderInitialProjectionLayout(root, options, cap))).toEqual(expected)
      },
    )
})
