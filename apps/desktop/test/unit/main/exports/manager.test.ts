import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import type { FileSessions } from '../../../../src/main/files/sessions'
import type { ImageRepository } from '../../../../src/main/images/repository'
import { defaultWritingStyle } from '../../../../src/main/styles/repository'
import { type ExportRequest, exportLimits } from '../../../../src/shared/export-contracts'

const stage = vi.hoisted(() => ({
  parse: vi.fn(),
  render: vi.fn(),
  workerDispose: vi.fn(),
  printDispose: vi.fn(),
  raster: vi.fn(),
  present: vi.fn(),
  pandocHtml: vi.fn(),
  convert: vi.fn(),
}))
vi.mock('../../../../src/main/exports/worker', () => ({
  ExportWorker: class {
    request = stage.parse
    dispose = stage.workerDispose
  },
}))
vi.mock('../../../../src/main/exports/print-host', () => ({
  PrintHost: class {
    render = stage.render
    raster = stage.raster
    present = stage.present
    pandocHtml = stage.pandocHtml
    dispose = stage.printDispose
  },
}))
vi.mock('../../../../src/main/diagrams/host', () => ({ ElectronDiagramFactory: class {} }))
vi.mock('../../../../src/main/pandoc/converter', () => ({ convertWithPandoc: stage.convert }))

import { ExportManager } from '../../../../src/main/exports/manager'

let directory: string
let manager: ExportManager
const window = { webContents: { id: 1 }, isDestroyed: () => false } as unknown as BrowserWindow
const request = (): ExportRequest => ({
  jobId: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
  revision: 2,
  source: '# Saved',
  format: 'html',
  rawHtml: false,
  remoteImages: false,
  locale: 'en',
})
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-export-unit-'))
  vi.clearAllMocks()
  stage.parse.mockResolvedValue({ html: '<h1>Saved</h1>', slots: [] })
  stage.render.mockResolvedValue('<h1>Saved</h1>')
  stage.raster.mockResolvedValue(Buffer.from('image'))
  stage.present.mockResolvedValue(undefined)
  stage.pandocHtml.mockResolvedValue('<h1>Saved</h1>')
  stage.convert.mockResolvedValue(Buffer.from('converted document'))
  const files = {
    describe: () => ({ name: 'Draft.md', displayPath: null }),
    assertExportDestination: vi.fn(async () => {}),
  } as unknown as FileSessions
  manager = new ExportManager(files, {} as ImageRepository)
})
afterEach(async () => {
  manager.closeOwner(1)
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
it('keeps a cancelled Pandoc job charged until its child closes and preserves the old output', async () => {
  const files = {
    describe: () => ({ name: 'Draft.md', displayPath: null }),
    assertExportDestination: vi.fn(async () => {}),
  } as unknown as FileSessions
  const tool = { path: 'selected.exe', fingerprint: 'a'.repeat(64), version: '3.13' }
  const capture = vi.fn(() => ({ ...tool }))
  manager = new ExportManager(files, {} as ImageRepository, undefined, { capture })
  let close!: () => void
  stage.convert.mockImplementation(
    (_tool, _input, _options, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        close = () => reject(signal.reason)
      }),
  )
  const target = join(directory, 'previous.docx')
  await writeFile(target, 'previous complete document')
  const job = {
    ...request(),
    format: 'pandoc' as const,
    pandoc: { format: 'docx' as const, profile: 'numbered' as const },
  }
  const pending = manager.start(window, job, async () => target)
  await vi.waitFor(() => expect(stage.convert).toHaveBeenCalledOnce())
  let settled = false
  void pending.then(() => {
    settled = true
  })
  manager.cancel(1, job.jobId)
  await tick()
  expect(settled).toBe(false)
  await expect(manager.start(window, request(), async () => null)).rejects.toMatchObject({
    code: 'export-busy',
  })
  expect(capture).toHaveBeenCalledOnce()
  close()
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(await readFile(target, 'utf8')).toBe('previous complete document')
  expect(await readdir(directory)).toEqual(['previous.docx'])
  await expect(manager.start(window, request(), async () => null)).resolves.toEqual({
    kind: 'cancelled',
  })
})

it('cancels while a native dialog is pending, rejects duplicates and ignores a late destination', async () => {
  let choose: ((path: string) => void) | undefined
  const job = request()
  const pending = manager.start(
    window,
    job,
    () =>
      new Promise((resolve) => {
        choose = resolve
      }),
  )
  await expect(manager.start(window, request(), async () => null)).rejects.toMatchObject({
    code: 'export-busy',
  })
  manager.cancel(2, job.jobId)
  manager.cancel(1, crypto.randomUUID())
  expect(stage.parse).not.toHaveBeenCalled()
  manager.cancel(1, job.jobId)
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  choose?.(join(directory, 'late.html'))
  await tick()
  expect(stage.parse).not.toHaveBeenCalled()
  expect(await readdir(directory)).toEqual([])
  await expect(manager.start(window, request(), async () => null)).resolves.toEqual({
    kind: 'cancelled',
  })
})

it('terminates a hung print stage on cancellation or document close, then permits a fresh export', async () => {
  stage.render.mockImplementation(() => new Promise(() => {}))
  const job = request()
  const target = join(directory, 'export.html')
  const pending = manager.start(window, job, async () => target)
  await vi.waitFor(() => expect(stage.render).toHaveBeenCalled())
  manager.closeDocument(1, job.documentId)
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(stage.workerDispose).toHaveBeenCalledTimes(1)
  expect(stage.printDispose).toHaveBeenCalledTimes(1)
  expect(await readdir(directory)).toEqual([])
  stage.render.mockResolvedValue('<p>Fresh</p>')
  await expect(manager.start(window, request(), async () => target)).resolves.toMatchObject({
    kind: 'exported',
  })
  expect(await readFile(target, 'utf8')).toContain('<p>Fresh</p>')
})

it('enforces the total deadline and releases the isolated stages after a hang', async () => {
  stage.render.mockImplementation(() => new Promise(() => {}))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const timed = manager.start(window, request(), async () => join(directory, 'timeout.html'))
  const timedRejection = expect(timed).rejects.toMatchObject({ code: 'export-timeout' })
  await vi.waitFor(() => expect(stage.render).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(exportLimits.totalMs)
  await timedRejection
  expect(stage.printDispose).toHaveBeenCalledTimes(1)
  expect(await readdir(directory)).toEqual([])
})

it('preserves a destination changed during rendering and cleans temporary files', async () => {
  const target = join(directory, 'existing.html')
  await writeFile(target, 'original')
  stage.render.mockImplementation(async () => {
    await writeFile(target, 'external change')
    return '<p>Copy</p>'
  })
  await expect(manager.start(window, request(), async () => target)).rejects.toMatchObject({
    code: 'file-changed',
  })
  expect(await readFile(target, 'utf8')).toBe('external change')
  expect(await readdir(directory)).toEqual(['existing.html'])
})

it('rejects source-file destinations and oversized projections before creating a print process', async () => {
  await expect(
    manager.start(window, request(), async () => join(directory, 'original.md')),
  ).rejects.toMatchObject({ code: 'export-target' })
  stage.parse.mockResolvedValue({
    html: '',
    slots: Array.from({ length: exportLimits.slots + 1 }, () => ({})),
  })
  await expect(
    manager.start(window, request(), async () => join(directory, 'huge.html')),
  ).rejects.toMatchObject({ code: 'export-limit' })
  expect(stage.render).not.toHaveBeenCalled()
  expect(await readdir(directory)).toEqual([])
})

it('captures safe document appearance once before an asynchronous destination picker', async () => {
  const appearance = defaultWritingStyle()
  appearance.typography.size = 20
  appearance.stylesheet = { name: 'local.css', source: 'h1 { color: red }' }
  const files = {
    describe: () => ({ name: 'Draft.md', displayPath: null }),
    assertExportDestination: vi.fn(async () => {}),
  } as unknown as FileSessions
  const capture = vi.fn(() => structuredClone(appearance))
  manager = new ExportManager(files, {} as ImageRepository, { capture })
  let choose: (value: string) => void = () => {}
  const pending = manager.start(
    window,
    request(),
    () =>
      new Promise((resolve) => {
        choose = resolve
      }),
  )
  await tick()
  appearance.typography.size = 28
  appearance.stylesheet.source = 'h1 { color: blue }'
  const path = join(directory, 'styled.html')
  choose(path)
  await expect(pending).resolves.toMatchObject({ kind: 'exported' })
  expect(capture).toHaveBeenCalledTimes(1)
  expect(stage.render.mock.calls[0]?.[0].appearanceCss).toContain('font-size:20px')
  expect(stage.render.mock.calls[0]?.[0].appearanceCss).toContain('color:red')
  const html = await readFile(path, 'utf8')
  expect(html).toContain('font-size:20px')
  expect(html).not.toContain('color:blue')
})

it.each(['png', 'jpeg'] as const)(
  'exports %s through the prepared isolated snapshot and preserves existing files on rejection',
  async (format) => {
    const target = join(directory, `image.${format === 'jpeg' ? 'jpg' : format}`)
    const job = { ...request(), format }
    await writeFile(target, 'previous image')
    stage.raster.mockRejectedValueOnce(new FileOperationError('export-image-limit'))
    await expect(manager.start(window, job, async () => target)).rejects.toMatchObject({
      code: 'export-image-limit',
    })
    expect(await readFile(target, 'utf8')).toBe('previous image')
    expect(stage.render.mock.calls[0]?.[0].mode).toBe('raster')
    await expect(
      manager.start(window, { ...job, jobId: crypto.randomUUID() }, async () => target),
    ).resolves.toMatchObject({ kind: 'exported' })
    expect(await readFile(target, 'utf8')).toBe('image')
    expect(stage.raster).toHaveBeenLastCalledWith(format, expect.any(AbortSignal))
  },
  // Real atomic replacement includes native ACL preservation on Windows.
  30000,
)

it('presents without a destination picker, keeps the captured revision and releases preparation resources while viewing', async () => {
  vi.useFakeTimers()
  let close: () => void = () => {}
  stage.present.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        close = resolve
      }),
  )
  const choose = vi.fn(async () => null)
  const pending = manager.start(window, { ...request(), format: 'present' }, choose)
  await vi.waitFor(() => expect(stage.present).toHaveBeenCalledExactlyOnceWith(window))
  expect(choose).not.toHaveBeenCalled()
  expect(stage.render.mock.calls[0]?.[0]).toMatchObject({ mode: 'presentation', reading: false })
  expect(stage.workerDispose).toHaveBeenCalledTimes(1)
  expect(stage.printDispose).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(exportLimits.totalMs + 1000)
  expect(stage.printDispose).not.toHaveBeenCalled()
  close()
  await expect(pending).resolves.toEqual({ kind: 'presented', revision: 2 })
  expect(stage.printDispose).toHaveBeenCalledTimes(1)
  expect(await readdir(directory)).toEqual([])
})

it('releases a crashed presentation and allows a fresh job', async () => {
  stage.present.mockRejectedValueOnce(new FileOperationError('export-render'))
  await expect(
    manager.start(window, { ...request(), format: 'present' }, async () => null),
  ).rejects.toMatchObject({ code: 'export-render' })
  expect(stage.printDispose).toHaveBeenCalledTimes(1)
  await expect(
    manager.start(window, { ...request(), format: 'present' }, async () => null),
  ).resolves.toMatchObject({ kind: 'presented', revision: 2 })
})

it('cancels an open presentation on document closure and disposes its window', async () => {
  stage.present.mockImplementation(() => new Promise<void>(() => {}))
  const job = { ...request(), format: 'present' as const }
  const pending = manager.start(window, job, async () => null)
  await vi.waitFor(() => expect(stage.present).toHaveBeenCalled())
  manager.closeDocument(1, job.documentId)
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(stage.printDispose).toHaveBeenCalledTimes(1)
  expect(await readdir(directory)).toEqual([])
})
