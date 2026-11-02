import assert from 'node:assert/strict'
import { once } from 'node:events'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { test } from 'vitest'
import { strongEntityTag, WebDavAdapter, webDavUrl } from '../../../../src/main/sync/webdav'

const current = () => {},
  signal = () => new AbortController().signal
async function server(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
) {
  const instance = createServer(handler).listen(0, '127.0.0.1')
  await once(instance, 'listening')
  const address = instance.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return {
    instance,
    url: `http://127.0.0.1:${address.port}/document.md`,
    close: async () => {
      instance.closeAllConnections()
      await new Promise<void>((resolve) => instance.close(() => resolve()))
    },
  }
}
test('limits URL scope and accepts only strong bounded entity tags', () => {
  for (const value of [
    'http://example.org/file.md',
    'https://user:secret@example.org/file.md',
    'https://example.org/file.md?token=secret',
    'https://example.org/folder/',
    ' https://example.org/file.md',
  ])
    assert.throws(() => webDavUrl(value))
  for (const value of ['W/"weak"', 'unquoted', '"a\nb"', '"a"b"', `"${'x'.repeat(512)}"`])
    assert.equal(strongEntityTag(value), null)
  assert.equal(strongEntityTag('"revision-1"'), '"revision-1"')
})
test('conditionally creates and updates exact binary content and verifies the committed representation', async () => {
  let body: Buffer | null = null,
    revision = 0
  const requests: { method: string | undefined; headers: IncomingHttpHeaders }[] = []
  const running = await server(async (request, response) => {
    requests.push({ method: request.method, headers: request.headers })
    if (request.method === 'GET') {
      if (body === null) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { ETag: `"${revision}"` }).end(body)
      return
    }
    const expected =
      body === null
        ? request.headers['if-none-match'] === '*'
        : request.headers['if-match'] === `"${revision}"`
    if (!expected) {
      response.writeHead(412).end()
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    body = Buffer.concat(chunks)
    revision++
    response.writeHead(204).end()
  })
  try {
    const adapter = new WebDavAdapter(running.url, () => 'Basic dXNlcjpwYXNz', 4096)
    assert.equal(await adapter.read(signal(), current), null)
    const first = Buffer.from([0xff, 0xfe, 0x41, 0, 13, 0, 10, 0]),
      created = await adapter.write(first, null, signal(), current)
    assert.deepEqual(created.bytes, first)
    const second = Buffer.from('中文\r\n😀\r\n'),
      updated = await adapter.write(second, created, signal(), current)
    assert.deepEqual(updated.bytes, second)
    await assert.rejects(adapter.write(Buffer.from('stale'), created, signal(), current), {
      code: 'sync-changed',
    })
    assert.deepEqual(body, second)
    assert.equal(requests.filter((row) => row.method === 'PUT')[0]?.headers['if-none-match'], '*')
    assert.equal(requests.filter((row) => row.method === 'PUT')[1]?.headers['if-match'], '"1"')
    assert.ok(
      requests.every(
        (row) => row.headers.authorization === 'Basic dXNlcjpwYXNz' && !row.headers.cookie,
      ),
    )
  } finally {
    await running.close()
  }
})
test('refuses redirects, weak-validator overwrite and chunked oversized responses', async () => {
  let mode = 'redirect',
    requests = 0,
    followed = 0
  const running = await server((request, response) => {
    requests++
    if (request.url === '/other') {
      followed++
      response.end('secret')
      return
    }
    if (mode === 'redirect') {
      response.writeHead(302, { Location: '/other' }).end()
      return
    }
    if (mode === 'weak') {
      response.writeHead(200, { ETag: 'W/"1"' }).end('existing')
      return
    }
    response.writeHead(200, { 'Transfer-Encoding': 'chunked' })
    response.write(Buffer.alloc(4096))
    response.end(Buffer.alloc(1))
  })
  try {
    const adapter = new WebDavAdapter(running.url, () => null, 4096)
    await assert.rejects(adapter.read(signal(), current), { code: 'sync-network' })
    assert.equal(followed, 0)
    mode = 'weak'
    const weak = await adapter.read(signal(), current),
      before = requests
    await assert.rejects(adapter.write(Buffer.from('new'), weak, signal(), current), {
      code: 'sync-validator',
    })
    assert.equal(requests, before)
    mode = 'oversized'
    await assert.rejects(adapter.read(signal(), current), { code: 'sync-limit' })
  } finally {
    await running.close()
  }
})
test('rechecks authorization before returning a remote snapshot', async () => {
  let allowed = true
  const running = await server((_request, response) => {
    allowed = false
    response.end('must not be applied')
  })
  try {
    const adapter = new WebDavAdapter(running.url, () => null, 4096)
    await assert.rejects(
      adapter.read(signal(), () => {
        if (!allowed) throw new Error('revoked')
      }),
      /revoked/,
    )
  } finally {
    await running.close()
  }
})
