import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'
import { installTestPlugin, pluginManifest, runTestPlugin } from './plugin-helpers'

test('sandboxed plugins deny ungranted source, native files and direct network, then enforce approved origins and redirects', async () => {
  test.setTimeout(90_000)
  const info = test.info()
  const directory = await mkdtemp(resolve('test/e2e/result/plugin-permissions-'))
  if (!directory.startsWith(resolve('test/e2e/result') + sep))
    throw new Error('Unsafe fixture path')
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url || '')
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/redirected' })
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('Approved response 中文')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local server')
  const origin = `http://127.0.0.1:${address.port}`,
    source = join(directory, 'source.md'),
    fixture = join(directory, 'probe.json')
  await writeFile(source, '# Private source 中文\r\n')
  const application = await launchDesktop(join(directory, 'profile'), [source])
  try {
    const page = await application.firstWindow(),
      manifest = pluginManifest(
        'test.permissions',
        ['document.read', 'files.read', 'network'],
        [origin],
      )
    const code = `manuslipPlugin.register(async ({document}) => {
      const result = { noDocument: document === undefined, require: typeof require, process: typeof process, editor: typeof window.manuslip, api: Object.keys(manuslipPlugin).sort() };
      try { await fetch(${JSON.stringify(`${origin}/direct`)}); result.direct = true; } catch { result.direct = false; }
      try { await manuslipPlugin.readTextFile(); result.file = true; } catch { result.file = false; }
      try { result.proxy = await manuslipPlugin.fetchText(${JSON.stringify(`${origin}/allowed`)}); } catch { result.proxy = false; }
      try { await manuslipPlugin.fetchText(${JSON.stringify(`${origin}/redirect`)}); result.redirect = true; } catch { result.redirect = false; }
      try { await manuslipPlugin.fetchText('https://example.invalid/unlisted'); result.unlisted = true; } catch { result.unlisted = false; }
      return JSON.stringify(result);
    });`
    await installTestPlugin(application, page, fixture, manifest, code, [])
    await application.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { pluginPickers: number }
      state.pluginPickers = 0
      dialog.showOpenDialog = async () => {
        state.pluginPickers++
        return { canceled: true, filePaths: [] }
      }
    })
    const denied = await runTestPlugin(page, manifest.id)
    expect(denied.ok).toBe(true)
    if (!denied.ok) throw new Error('Missing denial probe')
    expect(JSON.parse(denied.value.text)).toMatchObject({
      noDocument: true,
      require: 'undefined',
      process: 'undefined',
      editor: 'undefined',
      direct: false,
      file: false,
      proxy: false,
      redirect: false,
      unlisted: false,
    })
    expect(requests).toEqual([])
    expect(
      await application.evaluate(
        () => (globalThis as unknown as { pluginPickers: number }).pluginPickers,
      ),
    ).toBe(0)
    expect(
      await page.evaluate(
        (id) => window.manuslip.grantPlugin(id, ['document.read', 'network']),
        manifest.id,
      ),
    ).toMatchObject({ ok: true })
    const allowed = await runTestPlugin(page, manifest.id)
    if (!allowed.ok) throw new Error('Missing allowed probe')
    expect(JSON.parse(allowed.value.text)).toMatchObject({
      noDocument: false,
      proxy: 'Approved response 中文',
      direct: false,
      file: false,
      redirect: false,
      unlisted: false,
    })
    expect(requests).toEqual(['/allowed', '/redirect'])
    const input = join(directory, 'chosen.txt')
    await writeFile(input, 'Explicit file 中文')
    const fileCode =
      'manuslipPlugin.register(async () => await manuslipPlugin.readTextFile() || "Cancelled")'
    await installTestPlugin(application, page, fixture, manifest, fileCode, ['files.read'])
    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] })
    }, input)
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: true,
      value: { text: 'Explicit file 中文' },
    })
    expect(await readFile(source, 'utf8')).toBe('# Private source 中文\r\n')
    expect(
      await application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter((window) =>
            window.webContents.getURL().startsWith('manuslip-plugin:'),
          ).length,
      ),
    ).toBe(0)
    await info.attach('plugin-permission-probes', {
      body: JSON.stringify({ denied: denied.value, allowed: allowed.value, requests }),
      contentType: 'application/json',
    })
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('a hung plugin process can be stopped while the editor saves, and disabling revokes an active command', async () => {
  test.setTimeout(90_000)
  const info = test.info()
  const directory = await mkdtemp(resolve('test/e2e/result/plugin-hang-'))
  if (!directory.startsWith(resolve('test/e2e/result') + sep))
    throw new Error('Unsafe fixture path')
  const source = join(directory, 'source.md'),
    fixture = join(directory, 'hang.json'),
    original = '# Keep writing\r\n'
  await writeFile(source, original)
  const application = await launchDesktop(join(directory, 'profile'), [source])
  try {
    const page = await application.firstWindow(),
      manifest = pluginManifest('test.hang')
    await installTestPlugin(
      application,
      page,
      fixture,
      manifest,
      'manuslipPlugin.register(() => { while (true) {} })',
      [],
    )
    const running = runTestPlugin(page, manifest.id)
    await expect
      .poll(() =>
        application.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter((window) =>
              window.webContents.getURL().startsWith('manuslip-plugin:'),
            ).length,
        ),
      )
      .toBe(1)
    const processes = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        pid: window.webContents.getOSProcessId(),
      })),
    )
    const plugin = processes.find((row) => row.url.startsWith('manuslip-plugin:')),
      editorProcess = processes.find((row) => !row.url.startsWith('manuslip-plugin:'))
    expect(plugin?.pid).toBeTruthy()
    expect(plugin?.pid).not.toBe(editorProcess?.pid)
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.locator('.cm-content'),
      modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await editor.press(`${modifier}+End`)
    await editor.type('Still editable')
    await editor.press(`${modifier}+s`)
    await expect.poll(() => readFile(source, 'utf8')).toBe(`${original}Still editable`)
    expect(
      await page.evaluate((id) => window.manuslip.enablePlugin(id, false), manifest.id),
    ).toMatchObject({ ok: true })
    expect(await running).toMatchObject({ ok: false, code: 'plugin-cancelled' })
    await expect
      .poll(() =>
        application.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().filter((window) =>
              window.webContents.getURL().startsWith('manuslip-plugin:'),
            ).length,
        ),
      )
      .toBe(0)
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: false,
      code: 'plugin-unavailable',
    })
    await installTestPlugin(
      application,
      page,
      fixture,
      manifest,
      'manuslipPlugin.register(() => "Recovered")',
      [],
    )
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: true,
      value: { text: 'Recovered' },
    })
    expect(await readFile(source, 'utf8')).toBe(`${original}Still editable`)
    await info.attach('plugin-process-isolation', {
      body: JSON.stringify(processes),
      contentType: 'application/json',
    })
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
