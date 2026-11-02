import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseRememberDocuments,
  parseWorkspace,
  parseWorkspaceChange,
  parseWorkspaceList,
  parseWorkspacePage,
  workspaceLimits,
} from '../../../src/shared/workspace-contracts'

describe('workspace boundary schemas', () => {
  it('only accepts opaque workspace and directory IDs in change notifications', () => {
    const rootId = randomUUID(),
      directoryId = randomUUID()
    expect(parseWorkspaceChange({ rootId, directoryId })).toEqual({ rootId, directoryId })
    expect(() => parseWorkspaceChange({ rootId, directoryId: '../private' })).toThrow()
    expect(() => parseWorkspaceChange({ rootId: '/private', directoryId })).toThrow()
  })
  it('accepts session IDs and active membership without accepting path fields', () => {
    const id = randomUUID()
    expect(parseRememberDocuments({ ids: [id], activeId: id })).toEqual({ ids: [id], activeId: id })
    for (const value of [
      { ids: ['../notes.md'], activeId: null },
      { ids: [id, id], activeId: id },
      { ids: [], activeId: id },
      { ids: [id], activeId: null, path: 'C:/secret.md' },
      { ids: Array.from({ length: 33 }, randomUUID), activeId: null },
    ])
      expect(() => parseRememberDocuments(value)).toThrow()
  })
  it('bounds offsets and only accepts opaque IDs for listings', () => {
    const id = randomUUID()
    expect(parseWorkspaceList({ id, offset: 0 })).toEqual({ id, offset: 0 })
    for (const value of [
      { id, offset: -1 },
      { id, offset: 0.5 },
      { id, offset: workspaceLimits.scan + 1 },
      { id, offset: 0, path: '/private' },
      { id: '/private', offset: 0 },
    ])
      expect(() => parseWorkspaceList(value)).toThrow()
  })
  it('validates tree responses and startup metadata before exposure to the page', () => {
    const node = { id: randomUUID(), name: 'notes.md', kind: 'file' }
    expect(
      parseWorkspacePage({ nodes: [node], next: null, truncated: false, skippedLinks: false })
        .nodes,
    ).toEqual([node])
    expect(() =>
      parseWorkspacePage({
        nodes: Array.from({ length: workspaceLimits.page + 1 }, () => node),
        next: null,
        truncated: false,
        skippedLinks: false,
      }),
    ).toThrow()
    expect(() =>
      parseWorkspace({
        root: { ...node, displayPath: '/private' },
        recents: [],
        restore: [],
        recovered: false,
        readOnly: false,
        persistenceError: false,
        missingRoot: false,
      }),
    ).toThrow()
  })
})
