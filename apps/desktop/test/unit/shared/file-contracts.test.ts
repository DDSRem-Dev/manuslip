import { describe, expect, it } from 'vitest'
import {
  parseCheckpoint,
  parseCommand,
  parseId,
  parseSaveOutcome,
  parseSaveRequest,
  parseSnapshot,
} from '../../../src/shared/file-contracts'

describe('file operation schemas', () => {
  it.each(['next-document', 'previous-document'])(
    'accepts the explicit %s navigation command',
    (command) => {
      expect(parseCommand(command)).toBe(command)
      expect(() => parseCommand({ command })).toThrow()
    },
  )
  const id = '12345678-1234-1234-1234-123456789abc'
  const request = {
    id,
    text: '世界',
    revision: 4,
    expectedFingerprint: null,
    action: 'save',
    normalize: null,
    utf8: false,
  }
  it('accepts explicit file operations without exposing path input', () => {
    expect(parseSaveRequest(request)).toEqual(request)
    expect(() => parseSaveRequest({ ...request, path: '/private.md' })).toThrow()
    expect(() => parseCheckpoint({ id, text: 'draft', revision: 1, path: '/private.md' })).toThrow()
  })
  it('rejects malformed IDs, revisions, action coercion and oversized request metadata', () => {
    for (const value of ['../escape', '-'.repeat(36), 0, {}, null])
      expect(() => parseId(value)).toThrow()
    for (const patch of [
      { revision: -1 },
      { revision: 1.5 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      { action: { toString: () => 'save' } },
      { normalize: 'CRLF' },
      { utf8: 1 },
      { expectedFingerprint: 'x'.repeat(129) },
    ])
      expect(() => parseSaveRequest({ ...request, ...patch })).toThrow()
    expect(() => parseCommand({ toString: () => 'new' })).toThrow()
    expect(() => parseSaveOutcome({ kind: 'saved', revision: -1 })).toThrow()
    expect(() => parseSnapshot({ text: 1, info: {} })).toThrow()
  })
})
