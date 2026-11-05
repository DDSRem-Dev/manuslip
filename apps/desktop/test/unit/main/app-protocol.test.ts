import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Protocol } from 'electron'
import { expect, it, vi } from 'vitest'
import { appAssetPath, appEntry, registerAppProtocol } from '../../../src/main/app-protocol'
import { isTrustedRenderer, productionCsp } from '../../../src/main/security'

it('limits the app origin to built entry/assets and denies filesystem or alternate-origin requests', () => {
  expect(appAssetPath(appEntry)).toBe('index.html')
  expect(appAssetPath('manuslip-app://editor/assets/worker-abc.js')).toBe('assets/worker-abc.js')
  expect(appAssetPath('manuslip-app://editor/fonts/math.woff2')).toBe('fonts/math.woff2')
  for (const url of [
    'file:///etc/passwd',
    'https://editor/index.html',
    'manuslip-app://evil/index.html',
    'manuslip-app://user@editor/index.html',
    'manuslip-app://editor:123/index.html',
    'manuslip-app://editor/assets/../../private.txt',
    'manuslip-app://editor/assets/%2fsecret.js',
    'manuslip-app://editor/assets/%5csecret.js',
    'manuslip-app://editor/assets/.secret.js',
    'manuslip-app://editor/assets/source.js.map',
    'manuslip-app://editor/print/index.html',
    `${appEntry}?query=1`,
    `${appEntry}#fragment`,
    'manuslip-app://editor/package.json',
  ])
    expect(appAssetPath(url), url).toBeNull()
  expect(isTrustedRenderer(`${appEntry}#heading`, appEntry)).toBe(true)
  expect(isTrustedRenderer('manuslip-app://other/index.html', appEntry)).toBe(false)
})

it('serves the CSP with the document, refuses non-GET methods and hides missing-file details', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-protocol-'))
  try {
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Local</title>')
    const handle = vi.fn()
    registerAppProtocol({ handle } as unknown as Protocol, directory)
    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>
    const response = await handler(new Request(appEntry))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBe(productionCsp)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe(await readFile(join(directory, 'index.html'), 'utf8'))
    for (const request of [
      new Request(appEntry, { method: 'POST' }),
      new Request('manuslip-app://editor/assets/missing.js'),
      new Request('manuslip-app://editor/private.txt'),
    ]) {
      const denied = await handler(request)
      expect(denied.status).toBe(404)
      expect(await denied.text()).toBe('')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
