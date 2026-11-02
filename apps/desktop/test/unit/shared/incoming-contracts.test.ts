import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseIncomingState } from '../../../src/shared/incoming-contracts'

describe('incoming response boundary', () => {
  it('validates bounded opaque requests and named issues', () => {
    const request = { id: randomUUID(), name: 'notes.md', displayPath: '/notes.md' }
    expect(parseIncomingState({ requests: [request], issue: null }).requests).toEqual([request])
    for (const input of [
      { requests: [request, request], issue: null },
      {
        requests: Array.from({ length: 33 }, () => ({ ...request, id: randomUUID() })),
        issue: null,
      },
      { requests: [{ ...request, id: '/path.md' }], issue: null },
      { requests: [{ ...request, displayPath: 'x'.repeat(32769) }], issue: null },
      { requests: [], issue: 'arbitrary-error' },
    ])
      expect(() => parseIncomingState(input)).toThrow()
  })
})
