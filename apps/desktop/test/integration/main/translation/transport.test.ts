import { afterEach, expect, it } from 'vitest'
import { requestBody, startHttpServer } from '../../../../../../test/helpers/http-server'
import { exchange, providerRequest } from '../../../../src/main/translation/transport'

const servers: Awaited<ReturnType<typeof startHttpServer>>[] = []
async function listen(handle: Parameters<typeof startHttpServer>[0]) {
  const server = await startHttpServer(handle)
  servers.push(server)
  return server.url
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

it('replays an exact POST only across an allowed same-origin redirect', async () => {
  const requests: {
    path: string
    method: string
    authorization: string | undefined
    body: Buffer
  }[] = []
  const url = await listen(async (request, response) => {
    requests.push({
      path: request.url || '',
      method: request.method || '',
      authorization: request.headers.authorization,
      body: await requestBody(request),
    })
    if (request.url === '/chat') response.writeHead(307, { Location: '/moved-chat' }).end()
    else response.writeHead(200).end('complete response 世界')
  })
  const body = Buffer.from('{"source":"Hello 世界 😀"}')
  expect(
    await providerRequest(`${url}/chat`, body, 'dummy-key', new AbortController().signal),
  ).toEqual(Buffer.from('complete response 世界'))
  expect(requests).toEqual([
    { path: '/chat', method: 'POST', authorization: 'Bearer dummy-key', body },
    { path: '/moved-chat', method: 'POST', authorization: 'Bearer dummy-key', body },
  ])
})

it('rejects a cross-origin redirect before transmitting the provider key or private prose to its target', async () => {
  let forwarded = 0
  const target = await listen((_request, response) => {
    forwarded++
    response.end('must not be requested')
  })
  const url = await listen(async (request, response) => {
    await requestBody(request)
    response.writeHead(307, { Location: `${target}/chat` }).end()
  })
  await expect(
    providerRequest(
      `${url}/chat`,
      Buffer.from('private prose'),
      'dummy-key',
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'translation-provider' })
  expect(forwarded).toBe(0)
})

it('enforces the deadline during a streaming body and closes the live HTTP connection', async () => {
  const closed = Promise.withResolvers<void>()
  const url = await listen(async (request, response) => {
    await requestBody(request)
    response.once('close', () => closed.resolve())
    response.writeHead(200)
    response.write('incomplete response')
  })
  await expect(
    providerRequest(
      `${url}/chat`,
      Buffer.from('source'),
      null,
      new AbortController().signal,
      exchange,
      undefined,
      500,
    ),
  ).rejects.toMatchObject({ code: 'translation-timeout' })
  await closed.promise
})

it('cancels an active response without retrying the request or retaining its socket', async () => {
  const entered = Promise.withResolvers<void>(),
    closed = Promise.withResolvers<void>()
  let calls = 0
  const url = await listen(async (request, response) => {
    calls++
    await requestBody(request)
    response.once('close', () => closed.resolve())
    response.writeHead(200)
    response.write('partial')
    entered.resolve()
  })
  const controller = new AbortController()
  const pending = providerRequest(`${url}/chat`, Buffer.from('source'), null, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ code: 'translation-cancelled' })
  await entered.promise
  controller.abort()
  await rejected
  await closed.promise
  expect(calls).toBe(1)
})
