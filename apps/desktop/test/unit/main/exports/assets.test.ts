import { expect, it, vi } from 'vitest'
import { ExportAssets } from '../../../../src/main/exports/assets'
import type { FileSessions } from '../../../../src/main/files/sessions'
import { ImageRepository } from '../../../../src/main/images/repository'

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
  'base64',
)
function harness(remote = false, fetch = vi.fn(async () => ({ bytes: pixel, mime: 'image/png' }))) {
  const describe = vi.fn(() => ({}))
  const images = new ImageRepository(fetch)
  const controller = new AbortController()
  const assets = new ExportAssets(
    1,
    'doc',
    null,
    { describe } as unknown as FileSessions,
    images,
    remote,
    controller.signal,
  )
  return { assets, images, controller, describe, fetch }
}
it('embeds only verified raster data and rejects unsupported, missing or escaped resources', async () => {
  const { assets } = harness()
  expect(await assets.resolve(`data:image/png;base64,${pixel.toString('base64')}`)).toBe(
    `data:image/png;base64,${pixel.toString('base64')}`,
  )
  for (const source of [
    'file:///secret.png',
    '../secret.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,ZmFrZQ==',
    'http://127.0.0.1/image',
  ])
    await expect(assets.resolve(source)).rejects.toMatchObject({ code: 'export-asset' })
})
it('requires current remote permission even for an export-cached image', async () => {
  const { assets, images, fetch } = harness(true)
  await expect(assets.resolve('https://example.com/a.png')).rejects.toMatchObject({
    code: 'export-asset',
  })
  expect(fetch).not.toHaveBeenCalled()
  images.permission(1, 'doc', true)
  await assets.resolve('https://example.com/a.png')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(images.bytes).toBe(0)
  images.permission(1, 'doc', false)
  await expect(assets.resolve('https://example.com/a.png')).rejects.toMatchObject({
    code: 'export-asset',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('rechecks ownership and cancellation before returning cached data', async () => {
  const { assets, describe, controller } = harness()
  const data = `data:image/png;base64,${pixel.toString('base64')}`
  await assets.resolve(data)
  describe.mockImplementation(() => {
    throw new Error('document closed')
  })
  await expect(assets.resolve(data)).rejects.toThrow('document closed')
  controller.abort(new Error('cancelled'))
  await expect(assets.resolve(data)).rejects.toThrow('cancelled')
})
it('counts repeated decoded image allocations and rejects oversized dimensions before browser decode', async () => {
  const { assets } = harness()
  const large = Buffer.from(pixel)
  large.writeUInt32BE(8000, 16)
  large.writeUInt32BE(2000, 20)
  const data = `data:image/png;base64,${large.toString('base64')}`
  await assets.resolve(data)
  await assets.resolve(data)
  await expect(assets.resolve(data)).rejects.toMatchObject({ code: 'export-limit' })
  large.writeUInt32BE(8193, 16)
  await expect(
    harness().assets.resolve(`data:image/png;base64,${large.toString('base64')}`),
  ).rejects.toMatchObject({ code: 'export-limit' })
})
