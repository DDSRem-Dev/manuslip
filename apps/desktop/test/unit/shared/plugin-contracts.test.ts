import { expect, it } from 'vitest'
import {
  parsePluginManifest,
  parsePluginRun,
  parsePluginState,
  pluginUrl,
} from '../../../src/shared/plugin-contracts'

const manifest = () => ({
  apiVersion: 1,
  id: 'example.tools',
  name: 'Example',
  version: '1.0.0',
  description: 'Commands',
  commands: [{ id: 'trim', title: 'Trim', kind: 'transform' }],
  permissions: ['document.read', 'document.write'],
  networkOrigins: [],
})
it('rejects undeclared versions, arguments, duplicate commands, unsupported grants and ambiguous origins', () => {
  expect(parsePluginManifest(manifest())).toEqual(manifest())
  for (const patch of [
    { apiVersion: 2 },
    { id: '../escape' },
    { name: 'line\nbreak' },
    { name: '\u007f' },
    { version: 'latest' },
    { commands: [] },
    { commands: [manifest().commands[0], manifest().commands[0]] },
    { commands: [{ id: 'shell', title: 'Shell', kind: 'shell' }] },
    { permissions: ['shell'] },
    { permissions: ['document.read'] },
    { permissions: ['document.write', 'document.write'] },
    { networkOrigins: ['https://example.org'] },
    { args: ['--eval'] },
    { path: '/private' },
    { permissions: ['network', 'document.write'], networkOrigins: ['https://example.org/'] },
  ])
    expect(() => parsePluginManifest({ ...manifest(), ...patch })).toThrow()
  for (const url of [
    'file:///secret',
    'http://example.org',
    'https://user:secret@example.org',
    'https://example.org/#part',
  ])
    expect(() => pluginUrl(url)).toThrow()
  expect(pluginUrl('https://example.org/api?q=1').origin).toBe('https://example.org')
  expect(pluginUrl('http://127.0.0.1:3000/api').origin).toBe('http://127.0.0.1:3000')
})
it('validates exact document captures, bounded Unicode, selections and detached permission lists', () => {
  const request = {
    jobId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 2,
    pluginId: 'example.tools',
    commandId: 'trim',
    text: '中文😀',
    selections: [{ anchor: 0, head: 4 }],
  }
  expect(parsePluginRun(request)).toEqual(request)
  for (const patch of [
    { text: '\ud800' },
    { text: '中'.repeat(700_000) },
    { selections: [{ anchor: -1, head: 0 }] },
    { selections: [{ anchor: 0, head: 5 }] },
    { selections: [] },
    { revision: -1 },
    { filesystem: '/' },
  ])
    expect(() => parsePluginRun({ ...request, ...patch })).toThrow()
  const plugin = {
    ...manifest(),
    fingerprint: 'a'.repeat(64),
    enabled: true,
    grants: ['document.read'],
  }
  const state = { plugins: [plugin], recovered: false, readOnly: false }
  const parsed = parsePluginState(state)
  parsed.plugins[0]?.grants.push('document.write')
  expect(plugin.grants).toEqual(['document.read'])
  expect(() =>
    parsePluginState({ ...state, plugins: [{ ...plugin, grants: ['files.read'] }] }),
  ).toThrow()
  expect(() => parsePluginState({ ...state, plugins: [plugin, plugin] })).toThrow()
})
