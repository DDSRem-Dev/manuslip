import { parseDocumentMarkdown, parseMarkdown, semanticLimits } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { expect, it } from 'vitest'
import { encodeSemanticSnapshot } from '../../../../../src/renderer/src/semantics/snapshot'
import { parseResponse } from '../../../../../src/renderer/src/semantics/protocol'

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
  expect(JSON.stringify(body.document.root)).toBe(JSON.stringify(document.root))
  expect(body.document.counts).toEqual(document.counts)
  expect(body.projection.html).toBe(renderMarkdown(document.root, options).html)
}, 20_000)

// The complete nested fixture took 33.5 s on the instrumented Intel CI runner.
it('transports the complete 1 MiB nested corpus within the retained snapshot budget', () => {
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const document = parseDocumentMarkdown(source)
  const encoded = encodeSemanticSnapshot(document, source.length, options)
  expect(encoded.bytes).toBeGreaterThan(semanticLimits.messageBytes)
  expect(encoded.bytes * 2).toBeLessThanOrEqual(semanticLimits.snapshotBytes)
  const identity = {
    sequence: 1,
    generation: 1,
    documentId: 'nested',
    revision: 1,
    sentAt: 0,
  }
  const request = { kind: 'parse' as const, ...identity, source, options }
  const response = parseResponse(
    {
      ...identity,
      kind: 'encoded-result',
      payload: encoded.payload,
      metadata: {
        bytes: encoded.bytes,
        cached: false,
        transportInMs: 0,
        serializeMs: encoded.serializeMs,
      },
    },
    request,
  )
  if (response.kind !== 'result') throw new Error('Missing complete nested snapshot')
  expect(JSON.stringify(response.snapshot.document.root)).toBe(JSON.stringify(document.root))
  expect(response.snapshot.projection.html).toBe(renderMarkdown(document.root, options).html)
}, 60_000)
