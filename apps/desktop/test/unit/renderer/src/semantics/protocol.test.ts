import { parseMarkdown, semanticLimits } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { describe, expect, it } from 'vitest'
import {
  type EncodedResponse,
  encodeSnapshot,
  type ParseRequest,
  parseResponse,
} from '../../../../../src/renderer/src/semantics/protocol'

const request: ParseRequest = {
  kind: 'parse',
  sequence: 1,
  generation: 2,
  documentId: 'test',
  revision: 3,
  sentAt: 0,
  source: '# 中文😀\n\n**Strong** and [link][r] and $x$\n\n[r]: https://example.invalid/\n',
  options: { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' },
}
function response(source = request.source): EncodedResponse {
  const document = parseMarkdown(source)
  const projection = renderMarkdown(document.root, request.options)
  const encoded = encodeSnapshot({ document, projection })
  return {
    kind: 'encoded-result',
    sequence: 1,
    generation: 2,
    documentId: 'test',
    revision: 3,
    sentAt: 1,
    payload: encoded.payload,
    metadata: {
      bytes: encoded.bytes,
      serializeMs: encoded.serializeMs,
      cached: false,
      transportInMs: 0,
    },
  }
}
describe('whole-root transferable semantic messages', () => {
  it('preserves full Unicode AST positions, references and projections after ownership transfer', () => {
    const encoded = response()
    const expected = JSON.parse(new TextDecoder().decode(encoded.payload))
    const transferred = structuredClone(encoded, { transfer: [encoded.payload] })
    expect(encoded.payload.byteLength).toBe(0)
    const parsed = parseResponse(transferred, request)
    if (parsed.kind !== 'result') throw new Error('No result')
    expect(parsed.snapshot.document).toEqual(expected.document)
    const original = parseMarkdown(request.source)
    expect(parsed.snapshot.document.root).toEqual(original.root)
    expect(parsed.snapshot.document.blocks).toEqual(original.blocks)
    expect(parsed.snapshot.document.counts).toEqual(original.counts)
    expect(parsed.snapshot.projection).toEqual(expected.projection)
    expect(parsed.snapshot.document.root.children.at(-1)?.type).toBe('definition')
    expect(parsed.snapshot.bytes).toBe(transferred.payload.byteLength + 1024)
  })

  it.each(['sequence', 'generation', 'revision', 'documentId'] as const)(
    'rejects a mismatched %s before decoding',
    (key) => {
      expect(() =>
        parseResponse({ ...response(), [key]: 'wrong', payload: new ArrayBuffer(0) }, request),
      ).toThrow('Invalid encoded semantic response')
    },
  )

  it('enforces actual buffer and envelope sizes rather than trusting claimed bytes', () => {
    const encoded = response()
    expect(() =>
      parseResponse({ ...encoded, metadata: { ...encoded.metadata, bytes: 1 } }, request),
    ).toThrow()
    expect(() =>
      parseResponse({ ...encoded, payload: new ArrayBuffer(semanticLimits.messageBytes) }, request),
    ).toThrow()
    expect(() => parseResponse({ ...encoded, padding: 'x'.repeat(1025) }, request)).toThrow()
    expect(() =>
      parseResponse({ ...encoded, payload: new Uint8Array(encoded.payload) }, request),
    ).toThrow()
  })

  it('rejects invalid UTF-8, JSON, bodies and source ranges', () => {
    const encoded = response()
    for (const bytes of [
      new Uint8Array([255]),
      new TextEncoder().encode('{'),
      new TextEncoder().encode('{}'),
    ]) {
      expect(() =>
        parseResponse(
          {
            ...encoded,
            payload: bytes.buffer,
            metadata: { ...encoded.metadata, bytes: bytes.length + 1024 },
          },
          request,
        ),
      ).toThrow()
    }
    const body = JSON.parse(new TextDecoder().decode(encoded.payload))
    body.document.blocks[0].to = request.source.length + 1
    const bytes = new TextEncoder().encode(JSON.stringify(body))
    expect(() =>
      parseResponse(
        {
          ...encoded,
          payload: bytes.buffer,
          metadata: { ...encoded.metadata, bytes: bytes.length + 1024 },
        },
        request,
      ),
    ).toThrow('Invalid source range')
  })

  it('keeps the transport cap for an oversized full semantic root', () => {
    const document = parseMarkdown('small')
    const projection = renderMarkdown(document.root, request.options)
    expect(() =>
      encodeSnapshot({
        document,
        projection: { ...projection, html: 'x'.repeat(semanticLimits.messageBytes) },
      }),
    ).toThrow('transport limit')
  })
})
