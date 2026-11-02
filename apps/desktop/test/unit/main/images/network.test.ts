import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('node:https', () => ({ request: mocks.request }))

import {
  fetchRemoteImage,
  imageMime,
  publicAddress,
  remoteImageUrl,
} from '../../../../src/main/images/network'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
beforeEach(() => {
  vi.resetAllMocks()
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})
it('rejects local, reserved, mapped and private destinations before making an HTTP request', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '192.168.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    expect(publicAddress(address), address).toBe(false)
  expect(publicAddress('8.8.8.8')).toBe(true)
  expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  for (const value of [
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://localhost/a.png',
    'https://user:pass@example.com/a.png',
    'http://example.com/a.png',
    'https://example.com:8443/a.png',
  ])
    expect(() => remoteImageUrl(value)).toThrow()
  mocks.lookup.mockResolvedValue([
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ])
  await expect(
    fetchRemoteImage('https://example.com/a.png', new AbortController().signal),
  ).rejects.toThrow('image-address')
  expect(mocks.request).not.toHaveBeenCalled()
})
it('pins the vetted DNS address, sends no credentials, sniffs raster MIME and revalidates redirects', async () => {
  mocks.request.mockImplementation((url, options, callback) => {
    expect(options.family).toBe(4)
    const pin = vi.fn()
    options.lookup('example.com', {}, pin)
    expect(pin).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(Object.keys(options.headers).sort()).toEqual(['Accept', 'Accept-Encoding'])
    const connection = new EventEmitter() as EventEmitter & { end(): void }
    connection.end = () => {
      const response = Readable.from([png]) as Readable & {
        statusCode: number
        headers: Record<string, string>
      }
      response.statusCode = 200
      response.headers = { 'content-type': 'image/png' }
      callback(response)
    }
    expect(url.hostname).toBe('example.com')
    return connection
  })
  expect(await fetchRemoteImage('https://example.com/a.png', new AbortController().signal)).toEqual(
    { bytes: png, mime: 'image/png' },
  )
  mocks.request.mockImplementation((_url, _options, callback) => {
    const connection = new EventEmitter() as EventEmitter & { end(): void }
    connection.end = () =>
      callback(
        Object.assign(Readable.from([]), {
          statusCode: 302,
          headers: { location: 'https://127.0.0.1/private' },
        }),
      )
    return connection
  })
  await expect(
    fetchRemoteImage('https://example.com/a.png', new AbortController().signal),
  ).rejects.toThrow('image-address')
  expect(mocks.request).toHaveBeenCalledTimes(2)
  expect(() => imageMime(Buffer.from('<svg onload="alert(1)"/>'))).toThrow('image-type')
})
it('cancels while DNS is pending rather than waiting for the system resolver', async () => {
  mocks.lookup.mockReturnValue(new Promise(() => {}))
  const controller = new AbortController()
  const request = fetchRemoteImage('https://example.com/a.png', controller.signal)
  controller.abort()
  await expect(request).rejects.toThrow('image-timeout')
  expect(mocks.request).not.toHaveBeenCalled()
})
