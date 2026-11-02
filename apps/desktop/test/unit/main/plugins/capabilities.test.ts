import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import type { FileSessions } from '../../../../src/main/files/sessions'
import { PluginCapabilities } from '../../../../src/main/plugins/capabilities'
import type { PluginManifest } from '../../../../src/shared/plugin-contracts'

vi.mock('electron', () => ({ dialog: {} }))
const manifest: PluginManifest = {
  apiVersion: 1,
  id: 'test.network',
  name: 'Network',
  description: '',
  version: '1.0.0',
  commands: [{ id: 'probe', title: 'Probe', kind: 'inspect' }],
  permissions: ['network'],
  networkOrigins: ['https://example.org'],
}
function create(authorize = () => {}, signal = new AbortController().signal) {
  return new PluginCapabilities(
    {} as BrowserWindow,
    manifest,
    ['network'],
    {} as FileSessions,
    signal,
    authorize,
  )
}
afterEach(() => vi.unstubAllGlobals())
it('refuses unlisted origins, credentials, unsupported methods and over-cap input before any request', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const capabilities = create()
  for (const input of [
    { url: 'https://other.example/', method: 'GET', body: '' },
    { url: 'https://user:secret@example.org/', method: 'GET', body: '' },
    { url: 'https://example.org/', method: 'PUT', body: '' },
    { url: 'https://example.org/', method: 'GET', body: 'hidden' },
    { url: 'https://example.org/', method: 'POST', body: '中'.repeat(22_000) },
  ])
    await expect(capabilities.call('fetchText', input)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('streams a bounded UTF-8 response, blocks redirects and cancels a chunked over-cap body', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('Exact 中文 😀'))
  vi.stubGlobal('fetch', fetcher)
  const capabilities = create()
  expect(
    await capabilities.call('fetchText', {
      url: 'https://example.org/api',
      method: 'POST',
      body: 'Request',
    }),
  ).toBe('Exact 中文 😀')
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    method: 'POST',
    body: 'Request',
  })
  const cancelled = vi.fn(),
    stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
        controller.enqueue(new Uint8Array([1]))
      },
      cancel: cancelled,
    })
  fetcher.mockResolvedValueOnce(new Response(stream))
  await expect(
    capabilities.call('fetchText', { url: 'https://example.org/api', method: 'GET', body: '' }),
  ).rejects.toMatchObject({ code: 'plugin-limit' })
  expect(cancelled).toHaveBeenCalledOnce()
  const declared = new Response(new ReadableStream({ cancel: cancelled }), {
    headers: { 'Content-Length': String(1024 * 1024 + 1) },
  })
  fetcher.mockResolvedValueOnce(declared)
  await expect(
    capabilities.call('fetchText', { url: 'https://example.org/api', method: 'GET', body: '' }),
  ).rejects.toMatchObject({ code: 'plugin-failed' })
  expect(cancelled).toHaveBeenCalledTimes(2)
})
it('rechecks authorization after request settlement and holds its single pending call', async () => {
  let resolve!: (response: Response) => void,
    allowed = true
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const capabilities = create(() => {
    if (!allowed) throw new FileOperationError('file-session')
  })
  const running = capabilities.call('fetchText', {
    url: 'https://example.org/api',
    method: 'GET',
    body: '',
  })
  await expect(
    capabilities.call('fetchText', { url: 'https://example.org/api', method: 'GET', body: '' }),
  ).rejects.toMatchObject({ code: 'plugin-limit' })
  allowed = false
  const cancelled = vi.fn()
  resolve(new Response(new ReadableStream({ cancel: cancelled })))
  await expect(running).rejects.toMatchObject({ code: 'file-session' })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(cancelled).toHaveBeenCalledOnce()
})
