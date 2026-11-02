import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { parseExternalLink } from '../../shared/contracts'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6')
export const imageLimits = {
  bytes: 20 * 1024 * 1024,
  total: 64 * 1024 * 1024,
  timeout: 15000,
  redirects: 5,
  concurrency: 4,
  queued: 32,
} as const

export function publicAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
export function remoteImageUrl(value: string): URL {
  const url = new URL(parseExternalLink(value))
  if (
    url.port ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.local')
  )
    throw new Error('image-url')
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal) && !publicAddress(literal)) throw new Error('image-address')
  return url
}
export function imageMime(bytes: Buffer): string {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg'
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    return 'image/gif'
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  throw new Error('image-type')
}
export interface ImageData {
  bytes: Buffer
  mime: string
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => reject(new Error('image-timeout'))
    if (signal.aborted) {
      cancel()
      return
    }
    signal.addEventListener('abort', cancel, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', cancel)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel)
        reject(error)
      },
    )
  })
}

/** Native HTTPS has no ambient browser credentials, cookies, cache or service workers. */
export async function fetchRemoteImage(source: string, signal: AbortSignal): Promise<ImageData> {
  let url = remoteImageUrl(source)
  for (let redirects = 0; redirects <= imageLimits.redirects; redirects++) {
    signal.throwIfAborted()
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await abortable(lookup(host, { all: true, verbatim: true }), signal)
    signal.throwIfAborted()
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
      throw new Error('image-address')
    const pinned = addresses[0]
    if (!pinned) throw new Error('image-address')
    const result = await new Promise<ImageData | { redirect: string }>((resolve, reject) => {
      const connection = request(
        url,
        {
          signal,
          agent: false,
          headers: {
            Accept: 'image/png,image/jpeg,image/gif,image/webp',
            'Accept-Encoding': 'identity',
          },
          lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
          family: pinned.family,
          maxHeaderSize: 16384,
        },
        (response) => {
          const status = response.statusCode || 0
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.destroy()
            resolve({ redirect: response.headers.location })
            return
          }
          if (
            status !== 200 ||
            (response.headers['content-encoding'] &&
              response.headers['content-encoding'] !== 'identity') ||
            Number(response.headers['content-length']) > imageLimits.bytes
          ) {
            response.destroy()
            reject(new Error('image-response'))
            return
          }
          const declared = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
          if (
            !declared ||
            !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(declared)
          ) {
            response.destroy()
            reject(new Error('image-type'))
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > imageLimits.bytes) {
              response.destroy()
              reject(new Error('image-limit'))
              return
            }
            chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            try {
              const bytes = Buffer.concat(chunks)
              const mime = imageMime(bytes)
              if (mime !== declared) throw new Error('image-type')
              resolve({ bytes, mime })
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      connection.on('error', reject)
      connection.end()
    })
    if ('bytes' in result) return result
    url = remoteImageUrl(new URL(result.redirect, url).href)
  }
  throw new Error('image-redirects')
}
