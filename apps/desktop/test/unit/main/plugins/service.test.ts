import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileSessions } from '../../../../src/main/files/sessions'
import { parsePluginBundle } from '../../../../src/main/plugins/bundle'
import { PluginRepository } from '../../../../src/main/plugins/repository'
import { Plugins } from '../../../../src/main/plugins/service'
import type { PluginRunRequest } from '../../../../src/shared/plugin-contracts'

vi.mock('electron', () => ({ dialog: {} }))
vi.mock('../../../../src/main/plugins/host', () => ({
  PluginHost: class {
    async run() {
      return 'Inspected'
    }
  },
}))
let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-plugin-service-'))
  if (!directory.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture path')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

it.each(['disable', 'permissions', 'remove', 'update'] as const)(
  'denies new execution throughout pending %s persistence',
  async (operation) => {
    const bundle = parsePluginBundle({
      manifest: {
        apiVersion: 1,
        id: 'example.race',
        name: 'Race',
        version: '1.0.0',
        description: '',
        commands: [{ id: 'inspect', title: 'Inspect', kind: 'inspect' }],
        permissions: ['document.read'],
        networkOrigins: [],
      },
      code: 'manuslipPlugin.register(() => "Inspected")',
    })
    const repository = new PluginRepository(join(directory, 'plugins.json'))
    await repository.load()
    await repository.mutate(
      () => [{ bundle, enabled: true, grants: ['document.read'] }],
      () => {},
    )
    const files = new FileSessions(() => {}),
      owner = 1,
      document = files.create(owner),
      service = new Plugins(repository, files),
      window = { webContents: { id: owner } } as BrowserWindow,
      request: PluginRunRequest = {
        jobId: crypto.randomUUID(),
        documentId: document.info.id,
        revision: 0,
        pluginId: bundle.manifest.id,
        commandId: 'inspect',
        text: 'Captured',
        selections: [{ anchor: 0, head: 0 }],
      }
    let candidate: Awaited<ReturnType<Plugins['choose']>> = null
    if (operation === 'update') {
      const path = join(directory, 'update.json')
      await writeFile(
        path,
        JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, version: '2.0.0' } }),
      )
      candidate = await service.choose(
        owner,
        async () => path,
        () => {},
      )
      expect(candidate).not.toBeNull()
    }
    let settle!: () => void
    const barrier = new Promise<void>((resolve) => {
        settle = resolve
      }),
      mutate = repository.mutate.bind(repository)
    vi.spyOn(repository, 'mutate').mockImplementationOnce(async (...args) => {
      await barrier
      return mutate(...args)
    })
    const changing =
      operation === 'update'
        ? service.install(owner, candidate?.token || '', [], () => {})
        : service.change(
            bundle.manifest.id,
            operation === 'disable'
              ? { enabled: false }
              : operation === 'permissions'
                ? { grants: [] }
                : null,
            () => {},
          )
    try {
      await expect(service.run(window, request, () => {})).rejects.toMatchObject({
        code: 'plugin-busy',
      })
    } finally {
      settle()
      await changing
    }
    if (operation === 'disable' || operation === 'remove')
      await expect(service.run(window, request, () => {})).rejects.toMatchObject({
        code: 'plugin-unavailable',
      })
    else {
      expect(await service.run(window, request, () => {})).toMatchObject({ text: 'Inspected' })
      expect(service.state().plugins[0]?.grants).toEqual([])
    }
    await files.closeOwner(owner)
  },
)
