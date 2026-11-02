import { type ReplaceInput, replaceLimits } from '@manuslip/editor/replace'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
async function worker() {
  const messages: unknown[] = []
  const detached: number[] = []
  const host = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(value: unknown, options?: StructuredSerializeOptions) {
      messages.push(structuredClone(value, options))
      for (const item of options?.transfer || [])
        if (item instanceof ArrayBuffer) detached.push(item.byteLength)
    },
  }
  vi.stubGlobal('self', host)
  await import('../../../../src/renderer/src/replace.worker')
  return { messages, detached, post: (value: unknown) => host.onmessage?.({ data: value }) }
}
const request: ReplaceInput = {
  sequence: 1,
  lines: ['word WORD 中文😀', ''],
  wordChars: '',
  query: {
    search: 'word',
    replace: 'new',
    regexp: false,
    literal: false,
    wholeWord: false,
    caseSensitive: false,
  },
}
it('executes the actual worker and transfers an owned complete bounded result', async () => {
  const host = await worker()
  host.post(request)
  expect(host.messages[0]).toEqual({ sequence: 1, kind: 'started' })
  const result = host.messages[1] as { sequence: number; payload: ArrayBuffer }
  expect(result.sequence).toBe(1)
  expect(host.detached).toEqual([0])
  expect(JSON.parse(new TextDecoder().decode(result.payload))).toEqual({
    changes: [
      [0, 4, 'new'],
      [5, 9, 'new'],
    ],
    matches: 2,
  })
})
it('rejects actual oversized result bytes without posting any partial replacements', async () => {
  const host = await worker()
  host.post({
    ...request,
    lines: ['word word'],
    query: { ...request.query, replace: 'x'.repeat(replaceLimits.message / 2) },
  })
  expect(host.messages).toEqual([
    { sequence: 1, kind: 'started' },
    { sequence: 1, error: 'replace-limit' },
  ])
  expect(host.detached).toEqual([])
})
it('fails malformed input and invalid patterns with only a small explicit error', async () => {
  const host = await worker()
  host.post({ ...request, lines: [false] })
  host.post({ ...request, sequence: 2, query: { ...request.query, search: '[', regexp: true } })
  expect(host.messages).toEqual([
    { sequence: 1, error: 'replace-failed' },
    { sequence: 2, kind: 'started' },
    { sequence: 2, error: 'replace-query' },
  ])
})
