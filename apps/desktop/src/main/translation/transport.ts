import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { normalizeEndpoint } from '@manuslip/translate'
import { transportLimits } from '../../shared/translation-contracts'
import { TranslationFailure } from './errors'

export interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}
export interface Protocol {
  method: 'GET' | 'POST'
  authentication: 'bearer' | 'deepl'
  responseBytes?: number
}
export type Exchange = (
  url: string,
  body: Buffer,
  credential: string | null,
  signal: AbortSignal,
  protocol?: Protocol,
) => Promise<Reply>
/** Native transport has no browser cookies, proxy credentials, or ambient authentication. */
export const exchange: Exchange = (url, body, credential, signal, protocol) =>
  new Promise((resolve, reject) => {
    const endpoint = new URL(url)
    const method = protocol?.method ?? 'POST'
    const request = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(
      endpoint,
      {
        method,
        signal,
        agent: false,
        headers: {
          Accept: 'application/json',
          ...(method === 'POST'
            ? { 'Content-Type': 'application/json', 'Content-Length': body.length }
            : {}),
          ...(credential
            ? {
                Authorization: `${protocol?.authentication === 'deepl' ? 'DeepL-Auth-Key' : 'Bearer'} ${credential}`,
              }
            : {}),
        },
        ...(endpoint.hostname === 'localhost'
          ? { family: 4, lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4) }
          : {}),
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > (protocol?.responseBytes ?? transportLimits.response)) {
            reject(new TranslationFailure('translation-response'))
            response.destroy()
          } else chunks.push(chunk)
        })
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks, bytes),
          }),
        )
        response.once('error', () => reject(new TranslationFailure('translation-network')))
        response.once('aborted', () => reject(new TranslationFailure('translation-network')))
      },
    )
    request.once('error', () =>
      reject(
        new TranslationFailure(signal.aborted ? 'translation-cancelled' : 'translation-network'),
      ),
    )
    request.end(method === 'POST' ? body : undefined)
  })
function retryDelay(value: string | string[] | undefined, attempt: number): number {
  if (typeof value === 'string') {
    const milliseconds = /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now()
    if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds)
  }
  return 250 * 2 ** attempt
}
export async function providerRequest(
  endpoint: string,
  bytes: Buffer,
  credential: string | null,
  signal: AbortSignal,
  send: Exchange = exchange,
  protocol?: Protocol,
  deadlineMs: number = transportLimits.deadlineMs,
): Promise<Buffer> {
  const origin = new URL(endpoint).origin
  const expires = Date.now() + deadlineMs
  const deadline = AbortSignal.timeout(deadlineMs)
  const abort = AbortSignal.any([signal, deadline])
  try {
    for (let attempt = 0; attempt <= transportLimits.retries; attempt++) {
      let reply: Reply | undefined
      let url = endpoint
      try {
        for (let hop = 0; hop <= transportLimits.redirects; hop++) {
          abort.throwIfAborted()
          reply = protocol
            ? await send(url, bytes, credential, abort, protocol)
            : await send(url, bytes, credential, abort)
          if (![301, 302, 303, 307, 308].includes(reply.status)) break
          if (
            ![307, 308].includes(reply.status) ||
            hop === transportLimits.redirects ||
            typeof reply.headers.location !== 'string'
          )
            throw new TranslationFailure('translation-provider')
          const next = normalizeEndpoint(new URL(reply.headers.location, url).href)
          if (new URL(next).origin !== origin) throw new TranslationFailure('translation-provider')
          url = next
        }
        if (!reply) throw new TranslationFailure('translation-network')
        if (reply.body.length > (protocol?.responseBytes ?? transportLimits.response))
          throw new TranslationFailure('translation-response')
        if (reply.status >= 200 && reply.status < 300) return reply.body
        if (reply.status === 401 || reply.status === 403)
          throw new TranslationFailure('translation-auth')
        if (reply.status === 456) throw new TranslationFailure('translation-quota')
        if (reply.status !== 429 && (reply.status < 500 || reply.status > 599))
          throw new TranslationFailure('translation-provider')
        if (attempt === transportLimits.retries)
          throw new TranslationFailure(
            reply.status === 429 ? 'translation-rate' : 'translation-network',
          )
      } catch (error) {
        if (abort.aborted) throw error
        if (
          !(error instanceof TranslationFailure) ||
          error.code !== 'translation-network' ||
          attempt === transportLimits.retries
        )
          throw error
      }
      const wait = retryDelay(reply?.headers['retry-after'], attempt)
      if (wait >= expires - Date.now())
        throw new TranslationFailure(
          reply?.status === 429 ? 'translation-rate' : 'translation-timeout',
        )
      await delay(wait, undefined, { signal: abort })
    }
    throw new TranslationFailure('translation-network')
  } catch (error) {
    if (signal.aborted) throw new TranslationFailure('translation-cancelled')
    if (deadline.aborted) throw new TranslationFailure('translation-timeout')
    if (error instanceof TranslationFailure) throw error
    throw new TranslationFailure('translation-response')
  }
}
