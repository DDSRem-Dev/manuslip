import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssets } from '../../../../src/main/assets/repository'
import { FileSessions } from '../../../../src/main/files/sessions'
import { authorizeWorkspaceFile, grantRoot } from '../../../../src/main/workspace/paths'
import { assetLimits } from '../../../../src/shared/asset-contracts'
import type { FileInfo } from '../../../../src/shared/file-contracts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cvlcAAAAASUVORK5CYII=',
  'base64',
)
describe('main-owned local image capabilities and imports', () => {
  let directory: string
  let files: FileSessions
  let assets: LocalAssets
  let info: FileInfo
  let path: string
  const clipboard = vi.fn<() => Promise<Buffer>>(async () => Buffer.from(png))
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-assets-')))
    path = join(directory, 'doc.md')
    await writeFile(path, '# Doc')
    files = new FileSessions(() => {})
    clipboard.mockReset().mockResolvedValue(Buffer.from(png))
    assets = new LocalAssets(files, clipboard)
    info = (await files.open(1, path)).info
  })
  afterEach(async () => {
    assets.revokeOwner(1)
    assets.revokeOwner(2)
    await files.closeOwner(1)
    await files.closeOwner(2)
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true, maxRetries: 5 })
  })
  it('loads a relative Unicode/escaped raster through an owner-scoped capability', async () => {
    await writeFile(join(directory, '图 #1.png'), png)
    const url = await assets.load(1, info.id, '%E5%9B%BE%20%231.png')
    expect(url).toMatch(/^manuslip-asset:\/\/image\/[a-f0-9-]+$/)
    const id = url.split('/').at(-1) || ''
    expect(await assets.get(1, id)).toMatchObject({ mime: 'image/png', bytes: png })
    expect(await assets.get(2, id)).toBeNull()
    await expect(assets.load(2, info.id, '图%20%231.png')).rejects.toMatchObject({
      code: 'file-session',
    })
    assets.revoke(1, info.id)
    expect(await assets.get(1, id)).toBeNull()
  })
  it.skipIf(process.platform !== 'win32')(
    'uses Windows filename case matching while preserving canonical authorization',
    async () => {
      await mkdir(join(directory, 'Assets'))
      await writeFile(join(directory, 'Assets', 'Picture.PNG'), png)
      expect(await assets.load(1, info.id, 'assets/picture.png')).toMatch(/^manuslip-asset:/)
    },
  )
  it('confines direct opens to the captured parent and rejects absolute/protocol/ADS references', async () => {
    await mkdir(join(directory, 'nested'))
    const childPath = join(directory, 'nested', 'child.md')
    await writeFile(childPath, 'child')
    await writeFile(join(directory, 'outside.png'), png)
    const child = await files.open(1, childPath)
    for (const reference of [
      '../outside.png',
      '%2e%2e/outside.png',
      'file:///secret',
      'C:/secret',
      '//server/a.png',
      'doc.md:secret',
      'assets%5cfile.png',
    ]) {
      await expect(assets.load(1, child.info.id, reference)).rejects.toBeDefined()
    }
  })
  it('allows a sibling asset inside the workspace captured when its document opened', async () => {
    await mkdir(join(directory, 'notes'))
    const childPath = join(directory, 'notes', 'note.md')
    await writeFile(childPath, 'note')
    await writeFile(join(directory, 'shared.png'), png)
    const root = await grantRoot(directory)
    const direct = await files.open(1, childPath)
    await expect(assets.load(1, direct.info.id, '../shared.png')).rejects.toMatchObject({
      code: 'asset-outside',
    })
    const child = await files.open(
      1,
      childPath,
      undefined,
      true,
      authorizeWorkspaceFile(root, childPath),
      root,
    )
    expect(child.info.id).toBe(direct.info.id)
    expect(await assets.load(1, child.info.id, '../shared.png')).toMatch(/^manuslip-asset:/)
  })
  it('rejects SVG/text disguised as a raster and oversized files before allocation', async () => {
    await writeFile(join(directory, 'fake.png'), '<svg onload="bad()"/>')
    await expect(assets.load(1, info.id, 'fake.png')).rejects.toMatchObject({ code: 'asset-type' })
    await writeFile(join(directory, 'big.png'), Buffer.alloc(assetLimits.bytes + 1))
    await expect(assets.load(1, info.id, 'big.png')).rejects.toMatchObject({ code: 'asset-large' })
    expect(assets.diagnostics.bytes).toBe(0)
  })
  it('rejects a junction in the read or import path without writing into its destination', async () => {
    await mkdir(join(directory, 'real-assets'))
    await writeFile(join(directory, 'real-assets', 'one.png'), png)
    await symlink(join(directory, 'real-assets'), join(directory, 'assets'), 'junction')
    await expect(assets.load(1, info.id, 'assets/one.png')).rejects.toMatchObject({
      code: 'workspace-link',
    })
    const capture = await assets.capture(1, info.id)
    await expect(assets.import(1, info.id, capture)).rejects.toMatchObject({
      code: 'workspace-link',
    })
    expect(await readdir(join(directory, 'real-assets'))).toEqual(['one.png'])
  })
  it('invalidates a cached token when its asset path is redirected through a junction', async () => {
    await mkdir(join(directory, 'assets'))
    await writeFile(join(directory, 'assets', 'one.png'), png)
    const url = await assets.load(1, info.id, 'assets/one.png')
    await rename(join(directory, 'assets'), join(directory, 'original'))
    await symlink(join(directory, 'original'), join(directory, 'assets'), 'junction')
    expect(await assets.get(1, url.split('/').at(-1) || '')).toBeNull()
  })
  it('imports captured bytes with unique names and keeps files after capability revocation', async () => {
    const first = await assets.capture(1, info.id)
    const relative = await assets.import(1, info.id, first)
    clipboard.mockResolvedValueOnce(Buffer.from(png))
    const second = await assets.capture(1, info.id)
    const another = await assets.import(1, info.id, second)
    expect(relative).not.toBe(another)
    expect(relative).toMatch(/^assets\/pasted-[a-f0-9-]{36}\.png$/)
    expect(await readFile(join(directory, relative))).toEqual(png)
    await expect(assets.import(1, info.id, first)).rejects.toMatchObject({ code: 'asset-capture' })
    assets.revokeOwner(1)
    expect(await readdir(join(directory, 'assets'))).toHaveLength(2)
  })
  it('captures before Save As, then imports beside the selected document', async () => {
    const untitled = files.create(1)
    const capture = await assets.capture(1, untitled.info.id)
    const target = join(directory, 'saved.md')
    await files.save(
      1,
      {
        id: untitled.info.id,
        action: 'save-as',
        revision: 0,
        text: '',
        expectedFingerprint: null,
        normalize: null,
        utf8: false,
      },
      { open: async () => null, save: async () => target, overwrite: async () => true },
    )
    clipboard.mockRejectedValue(new Error('Clipboard changed'))
    const relative = await assets.import(1, untitled.info.id, capture)
    expect(await readFile(join(directory, relative))).toEqual(png)
    expect(clipboard).toHaveBeenCalledTimes(1)
  })
  it('expires captures and rejects oversized dimensions without retaining bytes', async () => {
    vi.useFakeTimers()
    const capture = await assets.capture(1, info.id)
    await vi.advanceTimersByTimeAsync(assetLimits.captureMs)
    await expect(assets.import(1, info.id, capture)).rejects.toMatchObject({
      code: 'asset-capture',
    })
    const huge = Buffer.from(png)
    huge.writeUInt32BE(assetLimits.side + 1, 16)
    clipboard.mockResolvedValue(huge)
    await expect(assets.capture(1, info.id)).rejects.toMatchObject({ code: 'asset-large' })
    expect(assets.diagnostics.captures).toBe(0)
  })
  it('bounds capture concurrency before the OS read and allows retry after a failure', async () => {
    let resolve!: (value: Buffer) => void
    clipboard.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const first = assets.capture(1, info.id)
    await expect(assets.capture(1, info.id)).rejects.toMatchObject({ code: 'asset-busy' })
    expect(clipboard).toHaveBeenCalledTimes(1)
    resolve(png)
    assets.discard(1, info.id, await first)
    clipboard.mockRejectedValueOnce(new Error('Unavailable'))
    await expect(assets.capture(1, info.id)).rejects.toThrow('Unavailable')
    expect(await assets.capture(1, info.id)).toBeTypeOf('string')
  })
  it('bounds reads and waiting jobs before reading file bytes', async () => {
    let reject!: (error: Error) => void
    const gate = new Promise<never>((_resolve, fail) => {
      reject = fail
    })
    const context = vi.spyOn(files, 'assetContext').mockReturnValue(gate)
    const jobs = Array.from({ length: assetLimits.running + assetLimits.queue }, () =>
      assets.load(1, info.id, 'one.png').catch(() => null),
    )
    await expect(assets.load(1, info.id, 'one.png')).rejects.toMatchObject({ code: 'asset-busy' })
    expect(context).toHaveBeenCalledTimes(assetLimits.running)
    expect(assets.diagnostics).toMatchObject({ running: 4, queued: 32 })
    reject(new Error('closed'))
    await Promise.all(jobs)
    expect(assets.diagnostics).toMatchObject({ running: 0, queued: 0 })
  })
  it('evicts old capabilities at the entry limit and accounts for decoded size', async () => {
    await writeFile(join(directory, 'one.png'), png)
    const first = await assets.load(1, info.id, 'one.png')
    for (let index = 0; index < assetLimits.entries; index++)
      await assets.load(1, info.id, 'one.png')
    expect(assets.diagnostics).toMatchObject({
      entries: assetLimits.entries,
      bytes: assetLimits.entries * (png.length + 4),
    })
    expect(await assets.get(1, first.split('/').at(-1) || '')).toBeNull()
  })
  it('cannot resurrect a capability revoked while its protocol request is awaiting authorization', async () => {
    await writeFile(join(directory, 'one.png'), png)
    const url = await assets.load(1, info.id, 'one.png')
    const context = files.assetContext.bind(files)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(files, 'assetContext').mockImplementationOnce(async (owner, id) => {
      await gate
      return context(owner, id)
    })
    const pending = assets.get(1, url.split('/').at(-1) || '')
    assets.revokeOwner(1)
    release()
    expect(await pending).toBeNull()
    expect(assets.diagnostics).toMatchObject({ bytes: 0, entries: 0 })
  })
  it('revokes old-path capabilities after Save As and after document close', async () => {
    await writeFile(join(directory, 'one.png'), png)
    const url = await assets.load(1, info.id, 'one.png')
    const targetDirectory = join(directory, 'another')
    await mkdir(targetDirectory)
    await files.save(
      1,
      {
        id: info.id,
        action: 'save-as',
        revision: 0,
        text: '# Doc',
        expectedFingerprint: info.fingerprint,
        normalize: null,
        utf8: false,
      },
      {
        open: async () => null,
        save: async () => join(targetDirectory, 'copy.md'),
        overwrite: async () => true,
      },
    )
    expect(await assets.get(1, url.split('/').at(-1) || '')).toBeNull()
    await expect(assets.load(1, info.id, '../one.png')).rejects.toMatchObject({
      code: 'asset-outside',
    })
    await files.close(1, info.id)
    await expect(assets.capture(1, info.id)).rejects.toMatchObject({ code: 'file-session' })
  })
})
