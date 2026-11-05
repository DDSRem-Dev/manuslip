import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Protocol } from 'electron'
import { productionCsp } from './security'

export const appOrigin = 'manuslip-app://editor'
export const appEntry = `${appOrigin}/index.html`
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/** Serve only entry points and flat, built assets; never resolve a caller's filesystem path. */
export function appAssetPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'manuslip-app:' ||
      url.host !== 'editor' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[%\\]/.test(url.pathname)
    )
      return null
    if (url.pathname === '/index.html') return 'index.html'
    if (/^\/assets\/[a-z0-9_-][a-z0-9_.-]*\.(?:js|css|svg|woff2?|ttf)$/i.test(url.pathname))
      return url.pathname.slice(1)
    if (/^\/fonts\/[a-z0-9_-][a-z0-9_.-]*\.(?:woff2?|ttf)$/i.test(url.pathname))
      return url.pathname.slice(1)
  } catch {}
  return null
}

export function registerAppProtocol(protocol: Protocol, directory: string): void {
  protocol.handle('manuslip-app', async (request) => {
    const path = appAssetPath(request.url)
    if (!path || request.method !== 'GET') return new Response(null, { status: 404 })
    try {
      return new Response(new Uint8Array(await readFile(join(directory, path))), {
        headers: {
          'Content-Type': types[extname(path)] || 'application/octet-stream',
          'Content-Security-Policy': productionCsp,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
