import { describe, expect, it } from 'vitest'
import { isTrustedRenderer, productionCsp } from '../../../src/main/security'

describe('renderer authorization', () => {
  it('accepts only the configured application page, allowing fragment navigation', () => {
    const file = 'file:///C:/app/out/renderer/index.html'
    expect(isTrustedRenderer(`${file}#content`, file)).toBe(true)
    for (const candidate of [
      'file:///C:/private/secret.md',
      'https://evil.example/index.html',
      'data:text/html,hello',
      `${file}?extra=1`,
      'invalid',
    ]) {
      expect(isTrustedRenderer(candidate, file)).toBe(false)
    }
    expect(isTrustedRenderer('http://localhost:5173/', 'http://localhost:5173/')).toBe(true)
    expect(isTrustedRenderer('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
    expect(isTrustedRenderer('http://user@localhost:5173/', 'http://localhost:5173/')).toBe(false)
    expect(isTrustedRenderer('http://localhost:5173/other', 'http://localhost:5173/')).toBe(false)
  })

  it('denies scripts outside the bundle, network, objects, and child frames', () => {
    expect(productionCsp).toContain("script-src 'self'")
    expect(productionCsp).not.toContain('unsafe-eval')
    expect(productionCsp).toContain("connect-src 'none'")
    expect(productionCsp).toContain("object-src 'none'")
    expect(productionCsp).toContain("frame-src 'none'")
  })
})
