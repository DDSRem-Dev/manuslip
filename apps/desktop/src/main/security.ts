export function isTrustedRenderer(url: string, rendererUrl: string): boolean {
  try {
    const candidate = new URL(url)
    const expected = new URL(rendererUrl)
    return (
      candidate.origin === expected.origin &&
      candidate.protocol === expected.protocol &&
      candidate.host === expected.host &&
      candidate.pathname === expected.pathname &&
      candidate.search === expected.search &&
      candidate.username === '' &&
      candidate.password === ''
    )
  } catch {
    return false
  }
}

export const productionCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: manuslip-asset:",
  "font-src 'self'",
  "connect-src 'none'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ')
