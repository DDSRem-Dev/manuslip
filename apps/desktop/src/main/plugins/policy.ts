import { randomUUID } from 'node:crypto'

export const pluginCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "media-src 'none'",
].join('; ')
export const pluginHostHtml =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Manuslip plugin command</title></head><body><script src="/plugin.js"></script></body></html>'
export function pluginOrigin(): string {
  return `manuslip-plugin://job-${randomUUID()}`
}
export function pluginAsset(url: string, origin: string): 'host' | 'code' | null {
  try {
    const input = new URL(url),
      expected = new URL(origin)
    if (
      input.protocol !== expected.protocol ||
      input.host !== expected.host ||
      input.username ||
      input.password ||
      input.hash ||
      input.search
    )
      return null
    return input.pathname === '/index.html'
      ? 'host'
      : input.pathname === '/plugin.js'
        ? 'code'
        : null
  } catch {
    return null
  }
}
