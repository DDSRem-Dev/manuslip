import { crc32, deflateSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { imageLimits } from '../../../../src/main/images/network'
import { ImageRepository } from '../../../../src/main/images/repository'

function png(width = 1, height = 1): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  const chunk = (type: string, bytes: Buffer): Buffer => {
    const content = Buffer.concat([Buffer.from(type), bytes])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(content))
    return Buffer.concat([length, content, checksum])
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const pixel = png()

it('requires document permission, deduplicates requests, reuses assets and revokes ownership', async () => {
  const fetch = vi.fn(async () => ({ bytes: pixel, mime: 'image/png' }))
  const images = new ImageRepository(fetch)
  await expect(images.load(1, 'doc', 'https://example.com/a.png')).rejects.toThrow(
    'image-permission',
  )
  expect(fetch).not.toHaveBeenCalled()
  images.permission(1, 'doc', true)
  const first = images.load(1, 'doc', 'https://example.com/a.png')
  expect(images.load(1, 'doc', 'https://example.com/a.png')).toBe(first)
  const asset = await first
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await images.load(1, 'doc', 'https://example.com/a.png')).toBe(asset)
  const id = asset.split('/').at(-1) || ''
  expect(images.get(2, id)).toBeNull()
  expect(images.get(1, id)?.mime).toBe('image/png')
  images.revokeOwner(1)
  expect(images.get(1, id)).toBeNull()
  expect(images.bytes).toBe(0)
})

it('cancels export-owned network work without cancelling a preview or caching late bytes', async () => {
  const active: { signal: AbortSignal; finish(value: { bytes: Buffer; mime: string }): void }[] = []
  const images = new ImageRepository(
    async (_url, signal) => new Promise((finish) => active.push({ signal, finish })),
  )
  images.permission(1, 'doc', true)
  const preview = images.load(1, 'doc', 'https://example.com/p.png')
  const controller = new AbortController()
  const pending = images.readForExport(1, 'doc', 'https://example.com/e.png', controller.signal)
  const rejected = expect(pending).rejects.toThrow('image-cancelled')
  controller.abort()
  await rejected
  expect(active[0]?.signal.aborted).toBe(false)
  expect(active[1]?.signal.aborted).toBe(true)
  active[1]?.finish({ bytes: Buffer.from('late'), mime: 'image/png' })
  active[0]?.finish({ bytes: pixel, mime: 'image/png' })
  await preview
  expect(images.bytes).toBe(pixel.length + 4)
})

it('shares bounded network admission and removes cancelled queued export work', async () => {
  const active: { signal: AbortSignal; finish(value: { bytes: Buffer; mime: string }): void }[] = []
  const images = new ImageRepository(
    async (_url, signal) => new Promise((finish) => active.push({ signal, finish })),
  )
  images.permission(1, 'doc', true)
  const controllers = Array.from(
    { length: imageLimits.concurrency + imageLimits.queued },
    () => new AbortController(),
  )
  const pending = controllers.map((controller, index) =>
    images
      .readForExport(1, 'doc', `https://example.com/${index}`, controller.signal)
      .catch((error: Error) => error.message),
  )
  expect(active.length).toBe(imageLimits.concurrency)
  await expect(
    images.readForExport(1, 'doc', 'https://example.com/full', new AbortController().signal),
  ).rejects.toThrow('image-limit')
  controllers.at(-1)?.abort()
  const replacement = images
    .readForExport(1, 'doc', 'https://example.com/replacement', new AbortController().signal)
    .catch((error: Error) => error.message)
  images.revoke(1, 'doc')
  for (const request of active) {
    expect(request.signal.aborted).toBe(true)
    request.finish({ bytes: Buffer.from('late'), mime: 'image/png' })
  }
  await Promise.all([...pending, replacement])
  expect(images.bytes).toBe(0)
  expect(active.length).toBe(imageLimits.concurrency)
})

it('returns export bytes transiently and denies access after revocation or by another window', async () => {
  const fetch = vi.fn(async () => ({ bytes: pixel, mime: 'image/png' }))
  const images = new ImageRepository(fetch)
  images.permission(1, 'doc', true)
  expect(
    (await images.readForExport(1, 'doc', 'https://example.com/a', new AbortController().signal))
      .bytes,
  ).toEqual(pixel)
  expect(images.bytes).toBe(0)
  await expect(
    images.readForExport(2, 'doc', 'https://example.com/a', new AbortController().signal),
  ).rejects.toThrow('image-permission')
  images.permission(1, 'doc', false)
  await expect(
    images.readForExport(1, 'doc', 'https://example.com/a', new AbortController().signal),
  ).rejects.toThrow('image-permission')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('aborts in-flight requests and rejects late results after permission is revoked', async () => {
  let finish: ((value: { bytes: Buffer; mime: string }) => void) | undefined
  let signal: AbortSignal | undefined
  const images = new ImageRepository(async (_url, current) => {
    signal = current
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  images.permission(1, 'doc', true)
  const pending = images.load(1, 'doc', 'https://example.com/a.png')
  images.permission(1, 'doc', false)
  expect(signal?.aborted).toBe(true)
  finish?.({ bytes: Buffer.from('late'), mime: 'image/png' })
  await expect(pending).rejects.toThrow('image-load')
  expect(images.bytes).toBe(0)
})

it.each([
  ['truncated raster data', () => pixel.subarray(0, 8)],
  ['excessive width', () => png(8193, 1)],
  ['excessive height', () => png(1, 8193)],
  ['excessive pixel count', () => png(4001, 4000)],
  [
    'excessive decoded memory',
    () => Buffer.concat([png(4000, 4000), Buffer.alloc(4 * 1024 * 1024)]),
  ],
  ['excessive compressed bytes', () => Buffer.concat([pixel, Buffer.alloc(imageLimits.bytes)])],
] as const)('rejects %s before preview caching or export handoff', async (_name, createImage) => {
  const bytes = createImage()
  const images = new ImageRepository(async () => ({ bytes, mime: 'image/png' }))
  images.permission(1, 'doc', true)
  await expect(images.load(1, 'doc', 'https://example.com/image.png')).rejects.toThrow('image-load')
  await expect(
    images.readForExport(1, 'doc', 'https://example.com/image.png', new AbortController().signal),
  ).rejects.toThrow()
  expect(images.bytes).toBe(0)
})

it('evicts the least recently used image by decoded memory and releases its weight on revocation', async () => {
  const bytes = png(4000, 2000)
  const weight = bytes.length + 4000 * 2000 * 4
  expect(weight * 2).toBeLessThanOrEqual(imageLimits.total)
  expect(weight * 3).toBeGreaterThan(imageLimits.total)
  const fetch = vi.fn(async () => ({ bytes, mime: 'image/png' }))
  const images = new ImageRepository(fetch)
  images.permission(1, 'doc', true)
  const first = await images.load(1, 'doc', 'https://example.com/first.png')
  const second = await images.load(1, 'doc', 'https://example.com/second.png')
  const id = (url: string): string => url.split('/').at(-1) || ''
  expect(images.get(1, id(first))?.bytes).toEqual(bytes)
  const third = await images.load(1, 'doc', 'https://example.com/third.png')
  expect(images.get(1, id(second))).toBeNull()
  expect(images.get(1, id(first))?.bytes).toEqual(bytes)
  expect(images.get(1, id(third))?.bytes).toEqual(bytes)
  expect(images.bytes).toBe(weight * 2)
  expect(await images.load(1, 'doc', 'https://example.com/second.png')).not.toBe(second)
  expect(fetch).toHaveBeenCalledTimes(4)
  images.revoke(1, 'doc')
  expect(images.bytes).toBe(0)
})
