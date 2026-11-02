import { semanticLimits } from '@manuslip/core'
import { afterEach, expect, it, vi } from 'vitest'
import {
  type EncodedResponse,
  type ParseRequest,
  parseResponse,
} from '../../../../../src/renderer/src/semantics/protocol'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function worker() {
  const messages: unknown[] = []
  const detached: number[] = []
  const host: {
    onmessage: ((event: { data: unknown }) => void) | null
    postMessage(value: unknown, options?: StructuredSerializeOptions): void
  } = {
    onmessage: null,
    postMessage(value, options) {
      messages.push(structuredClone(value, options))
      if (options?.transfer)
        for (const item of options.transfer)
          if (item instanceof ArrayBuffer) detached.push(item.byteLength)
    },
  }
  vi.stubGlobal('self', host)
  await import('../../../../../src/renderer/src/semantics/semantic.worker')
  return {
    messages,
    detached,
    post: (request: ParseRequest) => {
      if (!host.onmessage) throw new Error('No semantic worker handler')
      host.onmessage({ data: request })
    },
  }
}
const request: ParseRequest = {
  kind: 'parse',
  sequence: 1,
  generation: 1,
  documentId: 'first',
  revision: 0,
  sentAt: 0,
  source: '# 中文\n\nRead [reference][r], $x$ and `code`.\n\n[r]: https://example.invalid/',
  options: { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' },
}

it('retains an intact cache copy after transferring ownership of the whole snapshot', async () => {
  const host = await worker()
  host.post(request)
  const first = parseResponse(host.messages[0], request)
  if (first.kind !== 'result') throw new Error('No initial snapshot')
  expect(first.snapshot.cached).toBe(false)
  const next = { ...request, sequence: 2, documentId: 'second', revision: 5 }
  host.post(next)
  const second = parseResponse(host.messages[1], next)
  if (second.kind !== 'result') throw new Error('No cached snapshot')
  expect(second.snapshot.cached).toBe(true)
  expect(second.snapshot.serializeMs).toBe(0)
  expect(second.snapshot.document).toEqual(first.snapshot.document)
  expect(second.snapshot.projection).toEqual(first.snapshot.projection)
  expect(host.detached).toEqual([0, 0])
  expect((host.messages[0] as EncodedResponse).payload.byteLength).toBeGreaterThan(0)
  const changed = { ...next, sequence: 3, revision: 6, source: `${request.source}\n\nnew content` }
  host.post(changed)
  const third = parseResponse(host.messages[2], changed)
  if (third.kind !== 'result') throw new Error('No changed snapshot')
  expect(third.snapshot.cached).toBe(false)
  expect(third.snapshot.document.counts.characters).toBe([...changed.source].length)
})

it('sends a small explicit error when input exceeds semantic capacity', async () => {
  const host = await worker()
  const oversized = { ...request, source: 'x'.repeat(semanticLimits.previewBytes + 1) }
  host.post(oversized)
  expect(parseResponse(host.messages[0], oversized)).toMatchObject({
    kind: 'error',
    code: 'semantic-limit',
  })
  expect(host.detached).toEqual([])
  expect(JSON.stringify(host.messages[0]).length).toBeLessThan(1024)
})
