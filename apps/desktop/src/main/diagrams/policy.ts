export const diagramCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
export function diagramAssetPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'manuslip-diagram:' ||
      url.host !== 'render' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null
    if (url.pathname === '/diagram/index.html') return 'diagram/index.html'
    if (/^\/assets\/[a-z0-9_][a-z0-9_.-]*\.(?:js|css|woff2?|ttf)$/i.test(url.pathname))
      return url.pathname.slice(1)
    return null
  } catch {
    return null
  }
}
