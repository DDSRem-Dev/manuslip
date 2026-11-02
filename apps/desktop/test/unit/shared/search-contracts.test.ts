import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import {
  parseSearchOpen,
  parseSearchPoll,
  parseSearchRequest,
} from '../../../src/shared/search-contracts'

it('search IPC accepts only bounded queries and opaque roots/results', () => {
  const request = {
    id: randomUUID(),
    rootId: randomUUID(),
    query: '--literal',
    mode: 'text',
    matchCase: false,
  }
  expect(parseSearchRequest(request)).toEqual(request)
  for (const value of [
    { ...request, path: '/secret' },
    { ...request, rootId: '/folder' },
    { ...request, query: 'x'.repeat(257) },
    { ...request, query: 'a\nb' },
    { ...request, mode: 'shell' },
    { ...request, matchCase: 'true' },
  ])
    expect(() => parseSearchRequest(value)).toThrow()
  expect(() => parseSearchPoll({ id: request.id, cursor: 501 })).toThrow()
  expect(() => parseSearchPoll({ id: request.id, cursor: 1, path: '/secret' })).toThrow()
  expect(() => parseSearchOpen({ id: request.id, entryId: '/secret.md' })).toThrow()
})
