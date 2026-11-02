import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { parsePluginBundle, pluginFingerprint } from '../../../../src/main/plugins/bundle'
import { PluginRepository } from '../../../../src/main/plugins/repository'

let directory: string
beforeEach(async () => {
  await mkdir(resolve(tmpdir()), { recursive: true })
  directory = await mkdtemp(join(tmpdir(), 'manuslip-plugin-repository-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture path')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
const bundle = () =>
  parsePluginBundle({
    manifest: {
      apiVersion: 1,
      id: 'example.words',
      name: 'Words',
      version: '1.0.0',
      description: '',
      commands: [{ id: 'count', title: 'Count', kind: 'inspect' }],
      permissions: ['document.read'],
      networkOrigins: [],
    },
    code: 'manuslipPlugin.register(() => "done")',
  })
const installation = () => ({ bundle: bundle(), enabled: true, grants: ['document.read'] as const })
it('atomically serializes installation changes, binds reviewed code and returns detached metadata', async () => {
  const path = join(directory, 'plugins.json'),
    repository = new PluginRepository(path)
  await repository.load()
  await repository.mutate(
    () => [{ ...installation(), grants: ['document.read'] }],
    () => {},
  )
  await Promise.all([
    repository.mutate(
      (rows) => rows.map((row) => ({ ...row, enabled: false })),
      () => {},
    ),
    repository.mutate(
      (rows) => rows.map((row) => ({ ...row, enabled: true })),
      () => {},
    ),
  ])
  const reopened = new PluginRepository(path)
  await reopened.load()
  expect(reopened.state().plugins[0]).toMatchObject({
    id: 'example.words',
    enabled: true,
    grants: ['document.read'],
    fingerprint: pluginFingerprint(bundle()),
  })
  const captured = reopened.capture('example.words')
  captured.bundle.code = 'changed'
  captured.grants.length = 0
  expect(reopened.capture('example.words').bundle.code).toBe(bundle().code)
  expect(reopened.capture('example.words').grants).toEqual(['document.read'])
  expect(JSON.stringify(reopened.state())).not.toContain('manuslipPlugin')
})
it('keeps outside changes and stale authorization from altering installed state', async () => {
  const path = join(directory, 'plugins.json'),
    repository = new PluginRepository(path)
  await repository.mutate(
    () => [{ ...installation(), grants: ['document.read'] }],
    () => {},
  )
  await expect(
    repository.mutate(
      () => [],
      () => {
        throw new FileOperationError('file-session')
      },
    ),
  ).rejects.toMatchObject({ code: 'file-session' })
  const external = JSON.stringify({ schemaVersion: 2, private: 'preserve' })
  await writeFile(path, external)
  await expect(
    repository.mutate(
      () => [],
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'plugin-storage' })
  expect(await readFile(path, 'utf8')).toBe(external)
  expect(repository.state().plugins).toHaveLength(1)
})
it('retains corrupt backups, treats future schemas as read-only and rejects unknown grants', async () => {
  const path = join(directory, 'plugins.json')
  await writeFile(path, '{broken')
  const recovered = new PluginRepository(path)
  await recovered.load()
  expect(recovered.recovered).toBe(true)
  const backup = (await readdir(directory)).find((name) => name.startsWith('plugins.json.backup-'))
  expect(await readFile(join(directory, backup || ''), 'utf8')).toBe('{broken')
  await recovered.mutate(
    () => [],
    () => {},
  )
  await writeFile(path, '{"schemaVersion":2,"keep":true}')
  const future = new PluginRepository(path)
  await future.load()
  expect(future.readOnly).toBe(true)
  await expect(
    future.mutate(
      () => [],
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'plugin-readonly' })
  expect(await readFile(path, 'utf8')).toBe('{"schemaVersion":2,"keep":true}')
  expect(() =>
    parsePluginBundle({
      manifest: { ...bundle().manifest, permissions: ['shell'] },
      code: 'unsafe',
    }),
  ).toThrow()
})
