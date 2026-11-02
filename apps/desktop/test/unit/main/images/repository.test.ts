import { expect, it, vi } from 'vitest'
import { imageLimits } from '../../../../src/main/images/network'
import { ImageRepository } from '../../../../src/main/images/repository'

it('requires document permission, deduplicates requests, reuses assets and revokes ownership', async () => {
  const fetch = vi.fn(async () => ({ bytes: Buffer.from('image'), mime: 'image/png' }))
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
  active[0]?.finish({ bytes: Buffer.from('preview'), mime: 'image/png' })
  await preview
  expect(images.bytes).toBe(7)
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
  const fetch = vi.fn(async () => ({ bytes: Buffer.from('transient'), mime: 'image/png' }))
  const images = new ImageRepository(fetch)
  images.permission(1, 'doc', true)
  expect(
    (
      await images.readForExport(1, 'doc', 'https://example.com/a', new AbortController().signal)
    ).bytes.toString(),
  ).toBe('transient')
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
