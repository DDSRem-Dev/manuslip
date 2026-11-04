import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop } from './helpers'
import { installTestPlugin, pluginManifest, runTestPlugin } from './plugin-helpers'

test('plugin installs survive restart, updates revoke grants and a stale proposal cannot replace newer writing', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(resolve('test/e2e/result/plugin-restart-'))
  if (!directory.startsWith(resolve('test/e2e/result') + sep))
    throw new Error('Unsafe fixture path')
  const path = join(directory, 'source.md'),
    profile = join(directory, 'profile'),
    fixture = join(directory, 'plugin.json')
  await writeFile(path, '# Original\r\n')
  let application = await launchDesktop(profile, [path])
  try {
    let page = await application.firstWindow()
    const manifest = pluginManifest('test.restart', ['document.read', 'document.write'])
    manifest.commands = [{ id: 'probe', title: 'Propose edit', kind: 'transform' }]
    await installTestPlugin(
      application,
      page,
      fixture,
      manifest,
      'manuslipPlugin.register(({document}) => document.text + "\\nPlugin proposal\\n")',
      ['document.read', 'document.write'],
    )
    const installed = await page.evaluate(() => window.manuslip.plugins())
    await application.close()
    application = await launchDesktop(profile, [path])
    page = await application.firstWindow()
    expect(await page.evaluate(() => window.manuslip.plugins())).toEqual(installed)
    await clickDocumentAction(page, 'Plugin commands')
    const modal = page.getByRole('dialog', { name: 'Plugin commands', exact: true })
    await modal.getByRole('button', { name: 'Propose edit', exact: true }).click()
    await expect(
      modal.getByRole('textbox', { name: 'Proposed document', exact: true }),
    ).toHaveValue('# Original\n\nPlugin proposal\n')
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.locator('.cm-content'),
      modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await editor.press(`${modifier}+End`)
    await editor.type('Later writing')
    await editor.press(`${modifier}+s`)
    await expect.poll(() => readFile(path, 'utf8')).toBe('# Original\r\nLater writing')
    await clickDocumentAction(page, 'Plugin commands')
    await expect(
      modal.getByRole('button', { name: 'Apply to document', exact: true }),
    ).toBeDisabled()
    await expect(
      modal.getByText('The source changed. Run the command again before applying.', {
        exact: true,
      }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Discard result', exact: true }).click()
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    const updated = { ...manifest, version: '2.0.0' }
    await installTestPlugin(
      application,
      page,
      fixture,
      updated,
      'manuslipPlugin.register(() => "Updated proposal")',
      [],
    )
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: false,
      code: 'plugin-permission',
    })
    expect(await page.evaluate(() => window.manuslip.plugins())).toMatchObject({
      ok: true,
      value: { plugins: [{ version: '2.0.0', grants: [] }] },
    })
    expect(await readFile(path, 'utf8')).toBe('# Original\r\nLater writing')
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

test('plugin text-file writes require native choice, preserve an open source and remain charged until a cancelled picker settles', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(resolve('test/e2e/result/plugin-file-write-'))
  if (!directory.startsWith(resolve('test/e2e/result') + sep))
    throw new Error('Unsafe fixture path')
  const source = join(directory, 'source.md'),
    fixture = join(directory, 'plugin.json'),
    target = join(directory, 'chosen.txt')
  await writeFile(source, '# Preserve source\r\n')
  await writeFile(target, 'Old output')
  const application = await launchDesktop(join(directory, 'profile'), [source])
  try {
    const page = await application.firstWindow(),
      manifest = pluginManifest('test.file-write', ['files.write'])
    await installTestPlugin(
      application,
      page,
      fixture,
      manifest,
      'manuslipPlugin.register(async () => String(await manuslipPlugin.writeTextFile("Chosen output 中文")))',
      ['files.write'],
    )
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, source)
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: false,
      code: 'plugin-failed',
    })
    expect(await readFile(source, 'utf8')).toBe('# Preserve source\r\n')
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, target)
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: true,
      value: { text: 'true' },
    })
    expect(await readFile(target, 'utf8')).toBe('Chosen output 中文')
    await application.evaluate(({ dialog }) => {
      const state = globalThis as unknown as {
        pluginPickerOpen: boolean
        pluginPickerDone(value: { canceled: boolean; filePath: string }): void
      }
      state.pluginPickerOpen = false
      dialog.showSaveDialog = () =>
        new Promise((resolve) => {
          state.pluginPickerOpen = true
          state.pluginPickerDone = resolve
        })
    })
    const running = runTestPlugin(page, manifest.id)
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as unknown as { pluginPickerOpen: boolean }).pluginPickerOpen,
        ),
      )
      .toBe(true)
    expect(
      await page.evaluate((id) => window.manuslip.enablePlugin(id, false), manifest.id),
    ).toMatchObject({ ok: true })
    expect(
      await page.evaluate((id) => window.manuslip.enablePlugin(id, true), manifest.id),
    ).toMatchObject({ ok: true })
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({ ok: false, code: 'plugin-busy' })
    await application.evaluate(
      (_, target) =>
        (
          globalThis as unknown as {
            pluginPickerDone(value: { canceled: boolean; filePath: string }): void
          }
        ).pluginPickerDone({ canceled: false, filePath: target }),
      target,
    )
    expect(await running).toMatchObject({ ok: false, code: 'plugin-cancelled' })
    expect(await readFile(target, 'utf8')).toBe('Chosen output 中文')
    expect(await readFile(source, 'utf8')).toBe('# Preserve source\r\n')
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

test('a plugin that hangs during initial loading reaches its real deadline and releases the isolated renderer', async () => {
  test.setTimeout(45_000)
  const directory = await mkdtemp(resolve('test/e2e/result/plugin-load-timeout-'))
  if (!directory.startsWith(resolve('test/e2e/result') + sep))
    throw new Error('Unsafe fixture path')
  const source = join(directory, 'source.md'),
    fixture = join(directory, 'plugin.json')
  await writeFile(source, '# Usable after timeout\r\n')
  const application = await launchDesktop(join(directory, 'profile'), [source])
  try {
    const page = await application.firstWindow(),
      manifest = pluginManifest('test.timeout')
    await installTestPlugin(application, page, fixture, manifest, 'while (true) {}', [])
    const started = Date.now(),
      result = await runTestPlugin(page, manifest.id)
    expect(result).toMatchObject({ ok: false, code: 'plugin-timeout' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(14_000)
    expect(Date.now() - started).toBeLessThan(25_000)
    expect(
      await application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter((window) =>
            window.webContents.getURL().startsWith('manuslip-plugin:'),
          ).length,
      ),
    ).toBe(0)
    await installTestPlugin(
      application,
      page,
      fixture,
      manifest,
      'manuslipPlugin.register(() => "Retry works")',
      [],
    )
    expect(await runTestPlugin(page, manifest.id)).toMatchObject({
      ok: true,
      value: { text: 'Retry works' },
    })
    expect(await readFile(source, 'utf8')).toBe('# Usable after timeout\r\n')
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
