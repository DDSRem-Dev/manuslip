import { expect, it, vi } from 'vitest'
import type { CapturedExport } from '../../../../src/renderer/src/export'
import { DocumentExport } from '../../../../src/renderer/src/export'
import type { Result } from '../../../../src/shared/contracts'
import type {
  ExportBridge,
  ExportOutcome,
  ExportRequest,
} from '../../../../src/shared/export-contracts'
import type { PandocOptions } from '../../../../src/shared/pandoc-contracts'

it('keeps a presentation active until closure and reports its captured revision without a file path', async () => {
  let finish: ((value: Result<ExportOutcome>) => void) | undefined
  const bridge: ExportBridge = {
    exportDocument: vi.fn<ExportBridge['exportDocument']>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    ),
    cancelExport: vi.fn<ExportBridge['cancelExport']>(async () => ({ ok: true, value: null })),
  }
  const exporter = new DocumentExport(
    () => ({
      documentId: crypto.randomUUID(),
      source: '# Slides',
      revision: 8,
      rawHtml: false,
      remoteImages: false,
    }),
    bridge,
  )
  const pending = exporter.start('present')
  expect(exporter.store.getState()).toMatchObject({ running: true, format: 'present', revision: 8 })
  await exporter.start('png')
  expect(bridge.exportDocument).toHaveBeenCalledTimes(1)
  finish?.({ ok: true, value: { kind: 'presented', revision: 8 } })
  await pending
  expect(exporter.store.getState()).toMatchObject({
    running: false,
    presented: true,
    cancelled: false,
    path: null,
    revision: 8,
  })
})

it.each(['html', 'pdf', 'png', 'jpeg', 'present', 'pandoc'] as const)(
  'holds one captured reading copy for %s until explicit confirmation, independent of later edits and results',
  async (format) => {
    const exportDocument = vi.fn<ExportBridge['exportDocument']>(async () => ({
      ok: true,
      value: { kind: 'cancelled' },
    }))
    let snapshot: CapturedExport = {
      documentId: crypto.randomUUID(),
      source: 'Earlier source',
      revision: 5,
      rawHtml: false,
      remoteImages: false,
      missing: 2,
      reading: {
        schema: 'mdast-reading/v1',
        layout: 'side-by-side',
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        units: [{ index: 0, output: 'Captured translation' }],
        missing: 'reject',
        stale: true,
        confirmed: false,
      },
    }
    const capture = vi.fn(() => snapshot)
    const exporter = new DocumentExport(
      capture,
      {
        exportDocument,
        cancelExport: async () => ({ ok: true, value: null }),
      },
      () => Promise.resolve(),
    )
    const options: PandocOptions = { format: 'docx', profile: 'numbered' }
    await exporter.start(format, format === 'pandoc' ? options : undefined)
    options.profile = 'document'
    expect(exportDocument).not.toHaveBeenCalled()
    expect(exporter.store.getState().confirmation).toMatchObject({
      revision: 5,
      target: 'zh-CN',
      layout: 'side-by-side',
      missing: 2,
      stale: true,
    })
    expect(exporter.store.getState().running).toBe(false)
    if (!snapshot.reading) throw new Error('Missing reading capture')
    snapshot = {
      ...snapshot,
      source: 'Later source',
      revision: 6,
      reading: {
        ...snapshot.reading,
        units: [{ index: 0, output: 'Later translation' }],
        layout: 'replace',
        targetLanguage: 'fr',
      },
    }
    await exporter.start('pdf')
    await exporter.confirm()
    if (format === 'pandoc')
      expect(exportDocument).toHaveBeenCalledWith(
        expect.objectContaining({ pandoc: { format: 'docx', profile: 'numbered' } }),
      )
    expect(capture).toHaveBeenCalledTimes(1)
    expect(exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Earlier source',
        revision: 5,
        format,
        reading: expect.objectContaining({
          layout: 'side-by-side',
          targetLanguage: 'zh-CN',
          units: [{ index: 0, output: 'Captured translation' }],
          missing: 'source',
          confirmed: true,
        }),
      }),
    )
    expect(exportDocument.mock.calls[0]?.[0]).not.toHaveProperty('missing')
    await exporter.start('pdf')
    exporter.cancelConfirmation()
    await exporter.confirm()
    expect(exportDocument).toHaveBeenCalledTimes(1)
  },
)

it('captures the clicked source once, permits later editing and ignores duplicate starts', async () => {
  let current = {
    documentId: crypto.randomUUID(),
    source: '# Before',
    revision: 3,
    rawHtml: false,
    remoteImages: false,
  }
  let finish: ((value: Result<ExportOutcome>) => void) | undefined
  const bridge: ExportBridge = {
    exportDocument: vi.fn<ExportBridge['exportDocument']>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    ),
    cancelExport: vi.fn<ExportBridge['cancelExport']>(async () => ({ ok: true, value: null })),
  }
  const exporter = new DocumentExport(() => current, bridge)
  const pending = exporter.start('html')
  current = { ...current, source: '# After', revision: 4 }
  await exporter.start('pdf')
  const request = vi.mocked(bridge.exportDocument).mock.calls[0]?.[0] as ExportRequest
  expect(request).toMatchObject({ source: '# Before', revision: 3, format: 'html' })
  expect(bridge.exportDocument).toHaveBeenCalledTimes(1)
  finish?.({ ok: true, value: { kind: 'exported', path: '/export.html', revision: 3 } })
  await pending
  expect(exporter.store.getState()).toMatchObject({
    running: false,
    revision: 3,
    path: '/export.html',
  })
  expect(current.source).toBe('# After')
})

it('cancels only its active job and discards results after document disposal', async () => {
  let finish: ((value: Result<ExportOutcome>) => void) | undefined
  const bridge: ExportBridge = {
    exportDocument: vi.fn<ExportBridge['exportDocument']>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    ),
    cancelExport: vi.fn<ExportBridge['cancelExport']>(async () => ({ ok: true, value: null })),
  }
  const exporter = new DocumentExport(
    () => ({
      documentId: crypto.randomUUID(),
      source: 'text',
      revision: 0,
      rawHtml: false,
      remoteImages: false,
    }),
    bridge,
  )
  const pending = exporter.start('pdf')
  exporter.dispose()
  expect(bridge.cancelExport).toHaveBeenCalledWith(
    vi.mocked(bridge.exportDocument).mock.calls[0]?.[0].jobId,
  )
  finish?.({ ok: true, value: { kind: 'exported', path: '/late.pdf', revision: 0 } })
  await pending
  expect(exporter.store.getState().path).toBeNull()
  await exporter.start('html')
  expect(bridge.exportDocument).toHaveBeenCalledTimes(1)
})

it('refuses composition snapshots and permits retry after a reported error', async () => {
  const exportDocument = vi.fn<ExportBridge['exportDocument']>(async () => ({
    ok: false,
    code: 'export-asset',
    error: 'image missing',
  }))
  let composing = true
  const exporter = new DocumentExport(
    () =>
      composing
        ? null
        : {
            documentId: crypto.randomUUID(),
            source: 'text',
            revision: 0,
            rawHtml: false,
            remoteImages: false,
          },
    { exportDocument, cancelExport: async () => ({ ok: true, value: null }) },
    () => Promise.resolve(),
  )
  await exporter.start('html')
  expect(exportDocument).not.toHaveBeenCalled()
  expect(exporter.store.getState().error).toBe('export-composing')
  composing = false
  await exporter.start('html')
  expect(exporter.store.getState()).toMatchObject({ running: false, error: 'export-asset' })
  exportDocument.mockResolvedValueOnce({ ok: true, value: { kind: 'cancelled' } })
  await exporter.start('html')
  expect(exporter.store.getState()).toMatchObject({ running: false, error: null, cancelled: true })
})

it('settles input before taking one snapshot and ignores duplicate starts while waiting', async () => {
  let current: CapturedExport = {
    documentId: crypto.randomUUID(),
    source: 'Earlier state',
    revision: 0,
    rawHtml: false,
    remoteImages: false,
  }
  let settle!: () => void
  const input = new Promise<void>((resolve) => {
    settle = resolve
  })
  const capture = vi.fn(() => current)
  const exportDocument = vi.fn<ExportBridge['exportDocument']>(async () => ({
    ok: true,
    value: { kind: 'cancelled' },
  }))
  const synchronizeInput = vi.fn(() => input)
  const exporter = new DocumentExport(
    capture,
    { exportDocument, cancelExport: vi.fn() },
    synchronizeInput,
  )
  const pending = exporter.start('html')
  await exporter.start('pdf')
  expect(exporter.store.getState()).toMatchObject({ running: true, revision: null })
  expect(capture).not.toHaveBeenCalled()
  expect(exportDocument).not.toHaveBeenCalled()
  current = { ...current, source: 'Settled input 世界', revision: 1 }
  settle()
  await pending
  expect(synchronizeInput).toHaveBeenCalledTimes(1)
  expect(capture).toHaveBeenCalledTimes(1)
  expect(exportDocument).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ source: 'Settled input 世界', revision: 1, format: 'html' }),
  )
  expect(exporter.store.getState().running).toBe(false)
})

it.each(['resolve', 'reject'])(
  'cancels pending input settlement and ignores its late %s during a later export',
  async (result) => {
    const releases: Array<{ resolve(): void; reject(error: Error): void }> = []
    const capture = vi.fn(() => ({
      documentId: crypto.randomUUID(),
      source: 'Settled input',
      revision: 2,
      rawHtml: false,
      remoteImages: false,
    }))
    const bridge: ExportBridge = {
      exportDocument: vi.fn<ExportBridge['exportDocument']>(async () => ({
        ok: true,
        value: { kind: 'cancelled' },
      })),
      cancelExport: vi.fn(),
    }
    const exporter = new DocumentExport(
      capture,
      bridge,
      () => new Promise<void>((resolve, reject) => releases.push({ resolve, reject })),
    )
    const cancelled = exporter.start('html')
    exporter.cancel()
    expect(exporter.store.getState()).toMatchObject({ running: false, cancelled: true })
    const retry = exporter.start('pdf')
    if (result === 'reject') releases[0]?.reject(new Error('Cancelled input wait'))
    else releases[0]?.resolve()
    await cancelled
    expect(capture).not.toHaveBeenCalled()
    expect(exporter.store.getState()).toMatchObject({ running: true, cancelled: false })
    releases[1]?.resolve()
    await retry
    expect(bridge.cancelExport).not.toHaveBeenCalled()
    expect(bridge.exportDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ source: 'Settled input', format: 'pdf', revision: 2 }),
    )
  },
)

it('discards an export disposed while input is settling', async () => {
  let settle!: () => void
  const capture = vi.fn(() => null)
  const bridge: ExportBridge = { exportDocument: vi.fn(), cancelExport: vi.fn() }
  const exporter = new DocumentExport(
    capture,
    bridge,
    () =>
      new Promise<void>((resolve) => {
        settle = resolve
      }),
  )
  const pending = exporter.start('html')
  exporter.dispose()
  settle()
  await pending
  await exporter.start('pdf')
  expect(capture).not.toHaveBeenCalled()
  expect(bridge.exportDocument).not.toHaveBeenCalled()
  expect(bridge.cancelExport).not.toHaveBeenCalled()
  expect(exporter.store.getState().running).toBe(false)
})

it('reports failed input settlement and permits another export', async () => {
  const synchronizeInput = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('input unavailable'))
    .mockResolvedValue(undefined)
  const capture = vi.fn(() => ({
    documentId: crypto.randomUUID(),
    source: 'Retry',
    revision: 0,
    rawHtml: false,
    remoteImages: false,
  }))
  const exportDocument = vi.fn<ExportBridge['exportDocument']>(async () => ({
    ok: true,
    value: { kind: 'cancelled' },
  }))
  const exporter = new DocumentExport(
    capture,
    { exportDocument, cancelExport: vi.fn() },
    synchronizeInput,
  )
  await exporter.start('html')
  expect(capture).not.toHaveBeenCalled()
  expect(exporter.store.getState()).toMatchObject({ running: false, error: 'export-render' })
  await exporter.start('html')
  expect(exportDocument).toHaveBeenCalledTimes(1)
  expect(exporter.store.getState()).toMatchObject({ running: false, error: null, cancelled: true })
})

it.each(['export-limit', 'export-reading-empty'])(
  'clears the input wait after %s and permits retry',
  async (error) => {
    const capture = vi
      .fn<() => CapturedExport | null>()
      .mockImplementationOnce(() => {
        throw new Error(error)
      })
      .mockReturnValue({
        documentId: crypto.randomUUID(),
        source: 'Retry',
        revision: 0,
        rawHtml: false,
        remoteImages: false,
      })
    const exportDocument = vi.fn<ExportBridge['exportDocument']>(async () => ({
      ok: true,
      value: { kind: 'cancelled' },
    }))
    const exporter = new DocumentExport(capture, { exportDocument, cancelExport: vi.fn() }, () =>
      Promise.resolve(),
    )
    await exporter.start('html')
    expect(exporter.store.getState()).toMatchObject({ running: false, error })
    expect(exportDocument).not.toHaveBeenCalled()
    await exporter.start('html')
    expect(exportDocument).toHaveBeenCalledTimes(1)
    expect(exporter.store.getState()).toMatchObject({ running: false, error: null })
  },
)
