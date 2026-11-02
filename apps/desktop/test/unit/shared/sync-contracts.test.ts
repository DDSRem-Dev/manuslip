import { expect, it } from 'vitest'
import {
  parseSyncChoice,
  parseSyncConnect,
  parseSyncCredential,
  parseSyncRecoveryId,
  parseSyncState,
} from '../../../src/shared/sync-contracts'

const id = '2ab118a0-f6ed-42c8-9854-cab68a72f489'
it('accepts only one child filename or an exact trusted-scheme file URL, with no renderer-supplied root', () => {
  for (const filename of [
    '../escape.md',
    'a/b.md',
    'C:\\escape.md',
    'file.md:stream',
    '.hidden.md',
    'CON.txt',
    'wrong.exe',
  ])
    expect(() => parseSyncConnect({ documentId: id, kind: 'folder', filename })).toThrow()
  expect(() =>
    parseSyncConnect({ documentId: id, kind: 'folder', filename: 'safe.md', root: 'C:\\' }),
  ).toThrow()
  for (const url of [
    'http://example.org/file.md',
    'https://user:secret@example.org/file.md',
    'https://example.org/file.md?token=secret',
    'https://example.org/',
  ])
    expect(() => parseSyncConnect({ documentId: id, kind: 'webdav', url })).toThrow()
  expect(parseSyncConnect({ documentId: id, kind: 'folder', filename: '中文.md' })).toEqual({
    documentId: id,
    kind: 'folder',
    filename: '中文.md',
  })
})
it('rejects malformed credential pairs, control characters, extra capabilities and unbounded input', () => {
  for (const patch of [
    { password: null },
    { username: 'header:injection' },
    { password: 'secret\r\nX-Header: bad' },
    { password: 'x'.repeat(4097) },
    { persist: 'yes' },
    { root: 'C:\\' },
  ])
    expect(() =>
      parseSyncCredential({
        documentId: id,
        username: 'user',
        password: 'secret',
        persist: false,
        ...patch,
      }),
    ).toThrow()
  expect(
    parseSyncCredential({ documentId: id, username: null, password: null, persist: false })
      .password,
  ).toBeNull()
  expect(() => parseSyncChoice('delete')).toThrow()
  expect(() => parseSyncRecoveryId('../escape')).toThrow()
  expect(parseSyncRecoveryId(`${id}-pending`)).toBe(`${id}-pending`)
})
it('bounds returned review payloads and exposes retained pending/damaged artifacts without private bytes', () => {
  const value = {
    connection: null,
    review: null,
    copies: [
      {
        id: `${id}-pending`,
        name: 'Unverified recovery',
        side: 'unknown',
        savedAt: 1,
        bytes: 12,
        state: 'incomplete',
      },
    ],
    recoveryBlocked: true,
    recovered: false,
    readOnly: false,
    busy: false,
  }
  expect(parseSyncState(value)).toEqual(value)
  expect(() => parseSyncState({ ...value, authorization: 'secret' })).toThrow()
  expect(() => parseSyncState({ ...value, copies: Array(201).fill(value.copies[0]) })).toThrow()
  const review = {
    id,
    kind: 'conflict',
    reason: 'initial',
    localBytes: 1,
    remoteBytes: 1,
    localPreview: 'x'.repeat(16385),
    remotePreview: 'A',
    canUpload: true,
    expiresAt: 1,
  }
  expect(() => parseSyncState({ ...value, review })).toThrow()
})
