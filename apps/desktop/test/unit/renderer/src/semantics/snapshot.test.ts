import { parseMarkdown, semanticLimits } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { expect, it } from 'vitest'
import { encodeSemanticSnapshot } from '../../../../../src/renderer/src/semantics/snapshot'

const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }

it('includes exact layout metadata only for bounded packed preview candidates', () => {
  const source = '# Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |'
  const document = parseMarkdown(source)
  const encoded = encodeSemanticSnapshot(document, source.length, options)
  const body = JSON.parse(new TextDecoder().decode(encoded.payload))
  expect(body.document).toEqual(JSON.parse(JSON.stringify(document)))
  const projection = renderMarkdown(document.root, options)
  expect(body.projection.html).toBe(projection.html)
  expect(body.projection.blocks).toEqual(projection.blocks)
  expect(body.layout.htmlLength).toBe(projection.html.length)
  expect(body.layout.blocks).toHaveLength(document.root.children.length)
})

it('preserves the native transport capacity for a dense document near the message cap', () => {
  const source =
    '# Dense document\n\n' +
    'A small paragraph. One more short sentence for the next block.\n\n'.repeat(16500)
  const document = parseMarkdown(source)
  const encoded = encodeSemanticSnapshot(document, source.length, options)
  const body = JSON.parse(new TextDecoder().decode(encoded.payload))
  expect(encoded.bytes).toBeLessThan(semanticLimits.messageBytes)
  expect(body.layout).toBeUndefined()
  expect(body.document.root).toEqual(document.root)
  expect(body.document.counts).toEqual(document.counts)
  expect(body.projection.html).toBe(renderMarkdown(document.root, options).html)
})
