import type { IncomingHttpHeaders } from 'node:http'
import { requestBody, startHttpServer } from './http-server'

/** A single conditional HTTP resource, including a hook for a competing writer at PUT. */
export async function startWebDavServer(initial: Buffer | null = null) {
  let bytes = initial,
    revision = 1
  const remote = {
    requests: [] as { method: string; path: string; headers: IncomingHttpHeaders; body: Buffer }[],
    beforePut: null as (() => void) | null,
    authorization: null as string | null,
    get bytes(): Buffer | null {
      return bytes
    },
    get etag(): string {
      return `"revision-${revision}"`
    },
    set(value: Buffer | null): void {
      bytes = value
      revision++
    },
  }
  const server = await startHttpServer(async (request, response) => {
    const body = await requestBody(request)
    remote.requests.push({
      method: request.method || '',
      path: request.url || '',
      headers: request.headers,
      body,
    })
    if (request.url !== '/writing.md') {
      response.writeHead(404).end()
      return
    }
    if (remote.authorization && request.headers.authorization !== remote.authorization) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'GET') {
      if (bytes === null) response.writeHead(404).end()
      else response.writeHead(200, { ETag: remote.etag }).end(bytes)
      return
    }
    if (request.method !== 'PUT') {
      response.writeHead(405).end()
      return
    }
    const competing = remote.beforePut
    remote.beforePut = null
    competing?.()
    const allowed =
      bytes === null
        ? request.headers['if-none-match'] === '*'
        : request.headers['if-match'] === remote.etag
    if (!allowed) {
      response.writeHead(412).end()
      return
    }
    remote.set(body)
    response.writeHead(204).end()
  })
  return { ...server, remote, resource: `${server.url}/writing.md` }
}
