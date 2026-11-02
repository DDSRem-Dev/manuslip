import { describe, expect, it } from 'vitest'
import { diagramAssetPath, diagramCsp } from '../../../../src/main/diagrams/policy'

describe('diagram custom-origin policy', () => {
  it('admits only the isolated entry point and built script/font/style basenames', () => {
    expect(diagramAssetPath('manuslip-diagram://render/diagram/index.html')).toBe(
      'diagram/index.html',
    )
    expect(diagramAssetPath('manuslip-diagram://render/assets/mermaid.core-ABC.js')).toBe(
      'assets/mermaid.core-ABC.js',
    )
    for (const path of [
      'file:///etc/passwd',
      'https://render/assets/a.js',
      'manuslip-diagram://other/assets/a.js',
      'manuslip-diagram://render/assets/../../secret.js',
      'manuslip-diagram://render/assets/%2e%2e/secret.js',
      'manuslip-diagram://render/assets/a.svg',
      'manuslip-diagram://render/index.html',
      'manuslip-diagram://user@render/assets/a.js',
      'manuslip-diagram://render/assets/a.js?token=x',
    ])
      expect(diagramAssetPath(path), path).toBeNull()
  })
  it('blocks network, images, child frames, workers and inline scripts', () => {
    for (const rule of [
      "connect-src 'none'",
      "img-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "script-src 'self'",
      "form-action 'none'",
    ])
      expect(diagramCsp).toContain(rule)
    expect(diagramCsp).not.toContain("script-src 'self' 'unsafe-inline'")
  })
})
