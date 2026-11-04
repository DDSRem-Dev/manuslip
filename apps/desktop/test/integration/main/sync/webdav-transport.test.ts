import { afterEach, expect, it } from 'vitest'
import { startHttpServer } from '../../../../../../test/helpers/http-server'
import { syncHash, WebDavAdapter } from '../../../../src/main/sync/webdav'

const servers: Awaited<ReturnType<typeof startHttpServer>>[] = []
const signal = () => new AbortController().signal
const current = () => {}
async function listen(handle: Parameters<typeof startHttpServer>[0]) {
  const server = await startHttpServer(handle)
  servers.push(server)
  return `${server.url}/writing.md`
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

it('assembles binary response chunks without altering BOM, CRLF or multibyte characters', async () => {
  const bytes = Buffer.from('\ufeff# 世界 😀\r\n')
  const url = await listen((_request, response) => {
    response.writeHead(200, { ETag: '"strong-version"' })
    for (const byte of bytes) response.write(Buffer.from([byte]))
    response.end()
  })
  expect(await new WebDavAdapter(url, () => null).read(signal(), current)).toEqual({
    bytes,
    hash: syncHash(bytes),
    version: '"strong-version"',
  })
})

it.each(['declared', 'chunked'] as const)(
  'limits a %s response on the actual HTTP stream',
  async (kind) => {
    const url = await listen((_request, response) => {
      response.writeHead(200, kind === 'declared' ? { 'Content-Length': 9 } : {})
      response.write('12345')
      response.end('6789')
    })
    await expect(
      new WebDavAdapter(url, () => null, 8).read(signal(), current),
    ).rejects.toMatchObject({ code: 'sync-limit' })
  },
)

it('refuses weak validators without transmitting a PUT', async () => {
  const methods: string[] = []
  const url = await listen((request, response) => {
    methods.push(request.method || '')
    response.writeHead(200, { ETag: 'W/"weak-version"' }).end('remote')
  })
  const adapter = new WebDavAdapter(url, () => null)
  const snapshot = await adapter.read(signal(), current)
  expect(snapshot).toMatchObject({ bytes: Buffer.from('remote'), version: null })
  await expect(
    adapter.write(Buffer.from('local'), snapshot, signal(), current),
  ).rejects.toMatchObject({ code: 'sync-validator' })
  expect(methods).toEqual(['GET'])
})

it('detects a server acknowledging PUT without storing the requested bytes', async () => {
  const methods: string[] = []
  const url = await listen((request, response) => {
    methods.push(request.method || '')
    if (request.method === 'PUT') {
      request.resume()
      response.writeHead(204).end()
    } else response.writeHead(200, { ETag: '"changed"' }).end('different bytes')
  })
  await expect(
    new WebDavAdapter(url, () => null).write(Buffer.from('expected'), null, signal(), current),
  ).rejects.toMatchObject({ code: 'sync-verify' })
  expect(methods).toEqual(['PUT', 'GET'])
})

it('refuses redirects before sending credentials to the redirect target', async () => {
  let forwarded = 0
  const target = await listen((_request, response) => {
    forwarded++
    response.end('private')
  })
  const url = await listen((_request, response) => {
    response.writeHead(307, { Location: target }).end()
  })
  await expect(
    new WebDavAdapter(url, () => 'Basic dummy').read(signal(), current),
  ).rejects.toMatchObject({ code: 'sync-network' })
  expect(forwarded).toBe(0)
})

it('cancels an unfinished response body and releases the network connection', async () => {
  const entered = Promise.withResolvers<void>(),
    closed = Promise.withResolvers<void>()
  const url = await listen((_request, response) => {
    response.once('close', () => closed.resolve())
    response.writeHead(200, { ETag: '"streaming"' })
    response.write('partial')
    entered.resolve()
  })
  const controller = new AbortController()
  const pending = new WebDavAdapter(url, () => null).read(controller.signal, current)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await entered.promise
  controller.abort()
  await rejected
  await closed.promise
})
