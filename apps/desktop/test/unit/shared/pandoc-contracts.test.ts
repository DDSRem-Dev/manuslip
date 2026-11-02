import { expect, it } from 'vitest'
import { parsePandocOptions, parsePandocToolState } from '../../../src/shared/pandoc-contracts'

it('admits only fixed formats/profiles and never accepts executable paths or arguments', () => {
  for (const format of ['docx', 'epub', 'latex'])
    for (const profile of ['document', 'numbered'])
      expect(parsePandocOptions({ format, profile })).toEqual({ format, profile })
  for (const patch of [
    { format: '--filter=unsafe' },
    { profile: '../template' },
    { args: [] },
    { path: '/tool' },
    { format: ['docx'] },
    { profile: null },
  ])
    expect(() => parsePandocOptions({ format: 'docx', profile: 'document', ...patch })).toThrow()
})
it('returns only bounded public tool metadata and explicit persistence status', () => {
  const state = {
    tool: { name: 'pandoc.exe', version: '3.13' },
    persisted: false,
    recovered: true,
    readOnly: false,
  }
  expect(parsePandocToolState(state)).toEqual(state)
  expect(parsePandocToolState({ ...state, tool: null }).tool).toBeNull()
  for (const tool of [
    { name: '../tool', version: '3.13' },
    { name: 'pandoc', version: '4.0' },
    { name: 'pandoc', version: '3.13', path: '/private' },
    { name: 'a'.repeat(257), version: '3.13' },
  ])
    expect(() => parsePandocToolState({ ...state, tool })).toThrow()
  expect(() => parsePandocToolState({ ...state, persisted: 1 })).toThrow()
})
