import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/** Real loopback transport; handler failures are reported to the owning test at teardown. */
export async function startHttpServer(
  handle: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
) {
  const errors: unknown[] = []
  const server = createServer((request, response) => {
    void Promise.resolve()
      .then(() => handle(request, response))
      .catch((error: unknown) => {
        errors.push(error)
        response.destroy()
      })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close(): Promise<void> {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      server.closeAllConnections()
      await closed
      if (errors.length) throw new AggregateError(errors, 'HTTP fixture failed')
    },
  }
}

export async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
