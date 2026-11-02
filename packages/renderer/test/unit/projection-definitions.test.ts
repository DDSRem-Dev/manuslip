import type { Root as HastRoot } from 'hast'
import type { Nodes, Root } from 'mdast'
import { defaultHandlers, toHast } from 'mdast-util-to-hast'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, type RenderProjection, renderMarkdown } from '../../src/index'
import { projectHast, projectionOptions, projectWithHandlers } from '../../src/projection-engine'

const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
function comparable(projection: RenderProjection) {
  return { ...projection, renderMs: 0 }
}
function oracle(root: Root, render: RenderOptions) {
  const hast = toHast(root, projectionOptions(render))
  if (hast.type !== 'root') throw new Error('Missing oracle root')
  return { hast, projection: projectHast(root, hast, render) }
}

describe('complete projection definition indexing', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'preserves complete HAST and projections for every CommonMark example in %s',
    (syntax) => {
      for (const example of examples) {
        const root = parseMarkdown(example.markdown, syntax).root
        for (const rawHtml of [false, true]) {
          const render = { ...options, rawHtml }
          const expected = oracle(root, render)
          let actual: HastRoot | undefined
          const projection = projectWithHandlers(root, render, undefined, (hast) => {
            actual = hast
          })
          expect(actual, `HAST ${example.example}/${rawHtml}`).toEqual(expected.hast)
          expect(comparable(projection), `projection ${example.example}/${rawHtml}`).toEqual(
            comparable(expected.projection),
          )
        }
      }
    },
  )

  it.each([
    '[link][r] ![image][r] and [link][R].\n\n> [r]: https://example.invalid/first "First"\n\n[r]: https://example.invalid/second\n',
    'First[^one], then[^two], again[^one].\n\n[^one]: [inside][r] and [^two].\n\n    [r]: https://example.invalid/nested\n\n[^two]: ![inside][r]\n\n[r]: https://example.invalid/outer\n',
    'Read [link][late].\n\n[^unused]: Uncalled note.\n\n    [late]: https://example.invalid/from-unused\n\n[late]: https://example.invalid/later\n',
    '| Ref | Note |\n| --- | --- |\n| [x][r] | [^n] |\n\n- [x] Task [^n]\n\n[r]: https://example.invalid/\n\n[^n]: `code` $x$ and <b>raw</b>.\n',
    '```mermaid\nflowchart LR\nA-->B\n```\n\n$$\nx^2\n$$\n\n![remote](https://example.invalid/a.png)\n\n![local](assets/a.png)\n',
  ])(
    'matches the original converter with global references, widgets and both policies: %s',
    (source) => {
      const root = parseMarkdown(source).root
      const before = structuredClone(root)
      for (const rawHtml of [false, true]) {
        const render = { ...options, rawHtml }
        expect(comparable(renderMarkdown(root, render))).toEqual(
          comparable(oracle(root, render).projection),
        )
      }
      expect(root).toEqual(before)
    },
  )

  it('preserves preorder first-wins for duplicate link and footnote definitions', () => {
    const parsed = parseMarkdown(
      'Read [r] and [^n].\n\n[r]: https://example.invalid/first\n\n[^n]: First note.\n',
    ).root
    const firstLink = parsed.children.find((node) => node.type === 'definition')
    const firstNote = parsed.children.find((node) => node.type === 'footnoteDefinition')
    if (!firstLink || !firstNote) throw new Error('Missing test definitions')
    const root: Root = {
      ...parsed,
      children: [
        ...parsed.children,
        {
          ...firstLink,
          identifier: firstLink.identifier.toUpperCase(),
          url: 'https://example.invalid/last',
        },
        {
          ...firstNote,
          identifier: firstNote.identifier.toUpperCase(),
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Last note.' }] }],
        },
      ],
    }
    const actual = renderMarkdown(root, options)
    expect(comparable(actual)).toEqual(comparable(oracle(root, options).projection))
    expect(actual.html).toContain('https://example.invalid/first')
    expect(actual.html).toContain('First note.')
    expect(actual.html).not.toContain('Last note.')
  })

  it('passes the original root and complete maps to custom handlers before inline substitution', () => {
    const root = parseMarkdown(
      'Original [r] and [^n].\n\n[r]: https://example.invalid/\n\n[^n]: Note.\n',
    ).root
    const paragraph = root.children[0]
    let received: Nodes | undefined
    const projection = projectWithHandlers(
      root,
      options,
      undefined,
      undefined,
      {
        // @ts-expect-error: the public default root handler returns a HAST root.
        root(state, node, parent) {
          received = node
          expect(parent).toBeUndefined()
          expect(state.definitionById.get('R')?.url).toBe('https://example.invalid/')
          expect(state.footnoteById.get('N')?.type).toBe('footnoteDefinition')
          return defaultHandlers.root(state, node)
        },
      },
      (node) => (node === paragraph ? [{ type: 'text', value: 'Replacement.' }] : undefined),
    )
    expect(received).toBe(root)
    expect(projection.html).toBe('<p>Replacement.</p>')
  })

  it('keeps original root data and source positions in the native HAST', () => {
    const root = parseMarkdown('# Title\n\nBody.').root
    root.data = { hProperties: { className: ['custom-root'] } }
    let actual: HastRoot | undefined
    projectWithHandlers(root, options, undefined, (hast) => {
      actual = hast
    })
    expect(actual).toEqual(oracle(root, options).hast)
  })
})
