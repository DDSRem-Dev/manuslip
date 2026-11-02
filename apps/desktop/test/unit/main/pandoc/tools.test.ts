import { beforeEach, expect, it, vi } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import type { PandocRepository } from '../../../../src/main/pandoc/repository'

const calls = vi.hoisted(() => ({ inspect: vi.fn(), assert: vi.fn(), run: vi.fn() }))
vi.mock('../../../../src/main/pandoc/binary', () => ({
  inspectPandocBinary: calls.inspect,
  assertPandocTool: calls.assert,
}))
vi.mock('../../../../src/main/pandoc/process', () => ({ runPandocProcess: calls.run }))

import { PandocTools } from '../../../../src/main/pandoc/tools'

const selected = { path: 'C:/private/pandoc.exe', fingerprint: 'a'.repeat(64), version: '3.13' }
const repository = () => ({
  get: vi.fn(() => null),
  set: vi.fn(async (_tool: unknown, current?: () => void) => {
    current?.()
  }),
  recovered: false,
  readOnly: false,
})
const service = (repo = repository()) => new PandocTools(repo as unknown as PandocRepository)
beforeEach(() => {
  vi.clearAllMocks()
  calls.inspect.mockResolvedValue({ path: selected.path, fingerprint: selected.fingerprint })
  calls.assert.mockResolvedValue(undefined)
  calls.run.mockResolvedValue(Buffer.from('pandoc 3.13\r\nFeatures: test\r\n'))
})
it('reports a missing tool without executing anything and exposes only detached public metadata', async () => {
  const tools = service()
  expect(() => tools.capture()).toThrow()
  expect(tools.state()).toMatchObject({ tool: null, persisted: true })
  await tools.select(
    1,
    async () => selected.path,
    () => {},
  )
  expect(JSON.stringify(tools.state())).not.toContain('private')
  expect(tools.state().tool).toEqual({ name: 'pandoc.exe', version: '3.13' })
  const captured = tools.capture()
  captured.version = '3.1'
  expect(tools.capture().version).toBe('3.13')
  expect(calls.run.mock.calls[0]?.[1]).toEqual(['--version'])
})
it('retains a usable session choice after a failed save, retries it and explicitly forgets it', async () => {
  const repo = repository(),
    tools = service(repo)
  repo.set.mockRejectedValueOnce(new Error('storage unavailable'))
  expect(
    await tools.select(
      1,
      async () => selected.path,
      () => {},
    ),
  ).toMatchObject({ persisted: false, tool: { version: '3.13' } })
  expect(tools.capture()).toEqual(selected)
  expect(await tools.retry(() => {})).toMatchObject({ persisted: true })
  expect(repo.set.mock.calls[1]?.[0]).toEqual(selected)
  expect(await tools.forget(() => {})).toMatchObject({ persisted: true, tool: null })
  expect(() => tools.capture()).toThrow()
  expect(repo.set.mock.calls[2]?.[0]).toBeNull()
})
it('preserves future settings while allowing an explicit tool for the current session', async () => {
  const repo = repository()
  repo.readOnly = true
  repo.set.mockRejectedValue(new FileOperationError('pandoc-storage'))
  const tools = service(repo)
  expect(
    await tools.select(
      1,
      async () => selected.path,
      () => {},
    ),
  ).toMatchObject({ readOnly: true, persisted: false })
  expect(tools.capture()).toEqual(selected)
})
it('keeps the previous tool when native selection is cancelled or the selected program is invalid', async () => {
  const tools = service()
  await tools.select(
    1,
    async () => selected.path,
    () => {},
  )
  expect(
    await tools.select(
      1,
      async () => null,
      () => {},
    ),
  ).toBeNull()
  calls.run.mockResolvedValueOnce(Buffer.from('different program 3.13\n'))
  await expect(
    tools.select(
      1,
      async () => 'other.exe',
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'pandoc-tool' })
  expect(tools.capture()).toEqual(selected)
})
it('retains the native picker charge until it settles and refuses late results after owner closure', async () => {
  const tools = service()
  let release!: (path: string) => void
  const pending = tools.select(
    1,
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
    () => {},
  )
  const observed = expect(pending).rejects.toMatchObject({ code: 'file-session' })
  tools.closeOwner(1)
  await expect(
    tools.select(
      1,
      async () => selected.path,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'pandoc-busy' })
  release(selected.path)
  await observed
  expect(calls.run).not.toHaveBeenCalled()
  expect(tools.state().tool).toBeNull()
  await expect(
    tools.select(
      1,
      async () => null,
      () => {},
    ),
  ).resolves.toBeNull()
})
it('prevents an older picker from replacing a newer explicit choice', async () => {
  const repo = repository(),
    tools = service(repo)
  let release!: (path: string) => void
  const pending = tools.select(
    1,
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
    () => {},
  )
  const observed = expect(pending).rejects.toMatchObject({ code: 'export-cancelled' })
  await tools.select(
    2,
    async () => selected.path,
    () => {},
  )
  release('old.exe')
  await observed
  expect(repo.set).toHaveBeenCalledTimes(1)
  expect(tools.capture()).toEqual(selected)
})
it('rechecks frame ownership before changing the session choice or writing settings', async () => {
  const repo = repository(),
    tools = service(repo)
  let current = true
  calls.assert.mockImplementationOnce(async () => {
    current = false
  })
  await expect(
    tools.select(
      1,
      async () => selected.path,
      () => {
        if (!current) throw new FileOperationError('file-session')
      },
    ),
  ).rejects.toMatchObject({ code: 'file-session' })
  expect(repo.set).not.toHaveBeenCalled()
  expect(tools.state().tool).toBeNull()
})
